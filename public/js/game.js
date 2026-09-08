// 遊戲邏輯核心（權威模擬）。
// 規則：不碰 DOM、Canvas、Audio、window、setTimeout。所有視聽回饋透過 fx 介面通知外界。
// 這個模組同時在瀏覽器（單機）與伺服器（多人）執行。
import { TAU, rand, randInt, rnd, clamp, dist2, angleDiff } from '../../shared/math.js';
import {
  WORLD, PLAYER_BASE, PLAYER_COLORS, ENEMY_TYPES, DIFFICULTY, AI, BOSS_NAMES, BOSS_EVERY, BOSS_RADIUS, BOSS_KINDS, BOSS_DOUBLE_FROM_WAVE, BOSS_DOUBLE_CHANCE, AMBIENT, PERFECT_WAVE_BONUS, GRAZE_SCORE,
  UPGRADES, UPGRADE_EVERY_WAVES, WAVE_MODES, MODE_SCHEDULE, MODE_CHANCE_AFTER, MODE_CHANCE,
  DOWNED_TIME, REVIVE_RANGE, REVIVE_TIME, OFFLINE_GRACE, sanitizeName, applyPerks, applyShip, activeSynergies, SYNERGIES, WIN_WAVE, WIN_BONUS, WEAPON_STATS,
} from '../../shared/constants.js';

// ---------- fx 介面（預設全部 no-op，讓邏輯可在無視聽環境執行） ----------
const noop = () => {};
export const NULL_FX = {
  burst: noop, burstDir: noop, ring: noop, muzzle: noop, ghost: noop, text: noop, bolt: noop,
  shake: noop, flash: noop, slowmo: noop, hitStop: noop, aberrate: noop, zoom: noop, crossPunch: noop, crossRecoil: noop,
  sfx: noop, beep: noop, noise: noop,
  local: () => NULL_FX,
};

// ---------- 世界 ----------
export function createWorld() {
  return {
    W: WORLD.W, H: WORLD.H,
    scene: 'menu',           // menu | lobby | play | pause | upgrade | gameover
    time: 0, wave: 0, waveTimer: 1.5, score: 0, combo: 0, comboTimer: 0,
    players: [], bullets: [], enemies: [], enemyBullets: [], pickups: [], lasers: [],
    abandoned: false, mods: {}, won: false, endless: false,   // mods：每日挑戰規則 {fast, elite, noPickup, glass, lancers, swarm, mines}
    bosses: [], bossWarn: 0, upgradeOffered: false, upgradeDue: false,
    ambientCd: 25, waveDamaged: false, graze: 0,
    waveMode: null, modeTimer: 0, modeSpawnCd: 0, beacon: null, lastMode: null,
    pendingUpgrades: new Map(),
    timers: [],
    nextId: 1,
  };
}

export function addPlayer(world, { id, name, local = false, token = null, acctId = null, perks = null, ship = 'falcon', weapon = 'blaster' }) {
  const pid = id ?? world.nextId++;
  const idx = world.players.length;
  const p = {
    id: pid, name: sanitizeName(name), local, token, acctId, color: PLAYER_COLORS[(pid - 1) % PLAYER_COLORS.length],
    x: world.W / 2 + (idx - 1.5) * 60, y: world.H / 2, vx: 0, vy: 0, angle: 0,
    r: PLAYER_BASE.r, hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.maxHp, dead: false,
    downed: false, downTimer: 0, reviveProgress: 0, offline: false, offlineAt: 0,
    fireCd: 0, fireRate: PLAYER_BASE.fireRate, damage: PLAYER_BASE.damage, spread: PLAYER_BASE.spread,
    dashCd: 0, dashCdMax: PLAYER_BASE.dashCd, dashing: 0, inv: 0, shield: 0, rapid: 0,
    upgrades: {}, drones: [], speedMul: 1, magnetR: PLAYER_BASE.magnetR,
    lifesteal: 0, explosive: 0, pierce: 0, bounce: 0, homing: 0, bulletSize: 1,
    laser: 0, laserOn: false,
    kills: 0,
    input: { ix: 0, iy: 0, angle: 0, fire: false, dash: false },
    inputQueue: [], lastSeq: 0, netInput: false,
    luck: 0, perks: [], ship: 'falcon',
    syn: {}, killStreak: 0, dashHits: new Set(),
    weapon, weaponOn: false,
  };
  applyShip(p, ship);
  applyPerks(p, perks);
  if (world.mods.glass) { p.maxHp = Math.round(p.maxHp / 2); p.hp = p.maxHp; p.damage *= 1.5; }
  world.players.push(p);
  return p;
}

/** 遊戲進行中加入：放在中央、3 秒無敵 */
export function joinMidGame(world, opts) {
  const p = addPlayer(world, opts);
  p.x = world.W / 2; p.y = world.H / 2; p.inv = 3;
  return p;
}

/** 開始一局：重置世界（保留玩家名單），startWave 可指定起始波（Boss 挑戰用 4） */
export function startRun(world, { startWave = 0, mods = null, daily = false } = {}) {
  const roster = world.players.map(p => ({ id: p.id, name: p.name, local: p.local, token: p.token, acctId: p.acctId, perks: p.perks, ship: p.ship, weapon: p.weapon }));
  const fresh = createWorld();
  Object.assign(world, fresh, { players: [] });
  world.mods = Object.fromEntries((mods || []).map(m => [typeof m === 'string' ? m : m.id, true]));
  if (daily) world.mods.daily = true;
  roster.forEach(r => addPlayer(world, r));
  world.wave = world.mods.skip ? Math.max(startWave, 3) : startWave;
  world.upgradeOffered = true;
  world.scene = 'play';
}

/** 中途離開：這局立即結束（成績仍以目前分數結算）。回傳是否真的結束了一局。 */
export function abandonRun(world) {
  if (world.scene !== 'play' && world.scene !== 'pause' && world.scene !== 'upgrade') return false;
  world.scene = 'gameover'; world.abandoned = true; world.pendingUpgrades.clear();
  return true;
}

export function togglePause(world) {
  if (world.scene === 'play') world.scene = 'pause';
  else if (world.scene === 'pause') world.scene = 'play';
}

/** 連線模式：把一筆帶序號的輸入排進玩家佇列（伺服器用）。佇列上限防止灌包加速。 */
export function queueInput(p, seq, input) {
  p.netInput = true;
  if (p.inputQueue.length >= 8) p.inputQueue.shift();
  p.inputQueue.push({ seq, input });
}

function schedule(world, delay, fn) { world.timers.push({ at: world.time + delay, fn }); }
/** 可行動的玩家：沒死、沒倒地、沒斷線 */
export function activePlayers(world) { return world.players.filter(p => !p.dead && !p.downed && !p.offline); }
function nearestPlayer(world, x, y) {
  let best = null, bd = Infinity;
  for (const p of activePlayers(world)) { const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
export function nearestTarget(world, x, y, maxD) {
  let best = null, bd = maxD * maxD;
  for (const e of world.enemies) { const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
  for (const b of world.bosses) if (!b.entering && b.dying <= 0) { const d = dist2(x, y, b.x, b.y); if (d < bd) { bd = d; best = b; } }
  return best;
}
function nPlayers(world) { return Math.max(1, world.players.filter(p => !p.offline).length); }

// ---------- 敵人 ----------
function edgeSpawn(world, side = randInt(0, 3)) {
  const m = 60;
  if (side === 0) return { x: rand(0, world.W), y: -m };
  if (side === 1) return { x: world.W + m, y: rand(0, world.H) };
  if (side === 2) return { x: rand(0, world.W), y: world.H + m };
  return { x: -m, y: rand(0, world.H) };
}
function spawnEnemy(world, type, x, y, scale = 1, opts = {}) {
  const t = ENEMY_TYPES[type];
  if (x === undefined) ({ x, y } = edgeSpawn(world));
  const w = world.wave, n = nPlayers(world);
  const elite = !!opts.elite;
  const sizeMul = 1 + Math.min(DIFFICULTY.sizeCap, w * DIFFICULTY.sizePerWave);
  const hpMul = (1 + w * DIFFICULTY.hpPerWave) * (1 + (n - 1) * 0.35) * (elite ? 3 : 1) * (world.mods.swarm ? 0.75 : 1);
  const spdMod = world.mods.fast ? 1.3 : 1;
  const e = {
    id: world.nextId++, type, x, y, vx: 0, vy: 0,
    r: t.r * scale * sizeMul * (elite ? 1.5 : 1),
    hp: t.hp * hpMul * scale, maxHp: t.hp * hpMul * scale,
    speed: t.speed * (1 + w * DIFFICULTY.speedPerWave) * (elite ? 0.9 : 1) * spdMod,
    color: t.color, score: Math.round(t.score * scale * (elite ? 4 : 1)),
    kind: t.kind, contact: t.contact * (elite ? 1.5 : 1), split: t.split && scale === 1, elite,
    shootCd: rand(1, 2.5), wobble: rand(0, TAU), hitFlash: 0, squash: 0, rot: rand(0, TAU), rotV: rand(-1.5, 1.5),
    tier: opts.tier ?? 0,
    // AI 狀態
    flank: (rnd() < 0.5 ? -1 : 1) * rand(0.4, 1),   // 包抄方向與強度
    lunge: 0, lungeCd: rand(AI.dartLungeCd[0], AI.dartLungeCd[1]),
    dodgeCd: rand(0, 1), mineCd: rand(AI.mineCd[0], AI.mineCd[1]),
    laserCd: rand(1.5, 3), laserId: null,
    blinkCd: AI.bountyBlinkCd, blinkFlash: 0,
  };
  if (t.kind === 'drift') { const a = opts.dir ?? Math.atan2(world.H / 2 - y, world.W / 2 - x) + rand(-0.6, 0.6); e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed; }
  world.enemies.push(e);
  return e;
}
/** 非波次單位：流星（直線穿越、撞到誰都痛、可打爆）與外星飛碟（橫越、隨機攻擊玩家與敵人） */
function spawnAmbient(world, kind, fx, opts = {}) {
  const w = world.wave, W = world.W, H = world.H;
  if (kind === 'meteor') {
    const fromLeft = rnd() < 0.5, big = opts.big ?? rnd() < 0.5;
    const x = opts.x ?? (fromLeft ? -80 : W + 80), y = opts.y ?? rand(-60, H * 0.5);
    const tx = opts.tx ?? (fromLeft ? W + 80 : -80), ty = opts.ty ?? rand(H * 0.5, H + 60);
    const a = Math.atan2(ty - y, tx - x), spd = (opts.speed ?? AMBIENT.meteorSpeed) * (big ? 0.85 : 1.15);
    const hp = (opts.hp ?? AMBIENT.meteorHp) * (1 + w * 0.12) * (big ? 1.6 : 1);
    const e = { id: world.nextId++, type: 'meteor', kind: 'meteor', ambient: true, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: big ? 58 : 40, hp, maxHp: hp, speed: spd, color: '#ffb070', score: big ? AMBIENT.meteorScore * 2 : AMBIENT.meteorScore, contact: AMBIENT.meteorDmg, shootCd: 9, wobble: 0, hitFlash: 0, squash: 0, rot: rand(0, TAU), rotV: rand(-2, 2), tier: 0, flank: 0, lunge: 0, lungeCd: 9, dodgeCd: 9, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, life: 12 };
    world.enemies.push(e);
    if (!opts.silent) { fx.text(clamp(x, 80, W - 80), clamp(y, 60, H - 60), '流星來襲', '#ffb070', 18, 1.4); fx.beep(80, 0.6, 'sawtooth', 0.06, -40); }
    return e;
  }
  const fromLeft = rnd() < 0.5;
  const hp = AMBIENT.ufoHp * (1 + w * 0.1) * (1 + (nPlayers(world) - 1) * 0.3);
  const e = { id: world.nextId++, type: 'ufo', kind: 'ufo', ambient: true, ally: !!opts.ally, x: fromLeft ? -60 : W + 60, y: rand(120, 320), vx: 0, vy: 0, r: 26, hp, maxHp: hp, speed: 160, color: opts.ally ? '#f15bb5' : '#90f1a8', score: AMBIENT.ufoScore, contact: 12, shootCd: 1, wobble: rand(0, TAU), hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: fromLeft ? 1 : -1, lunge: 0, lungeCd: 9, dodgeCd: 0, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, life: AMBIENT.ufoLife };
  world.enemies.push(e);
  fx.text(e.x < 0 ? 120 : W - 120, e.y, opts.ally ? '母艦召喚飛碟' : '不明飛行物', e.color, 16, 1.4); fx.beep(900, 0.4, 'sine', 0.05, 400);
  return e;
}
function waveEnemies(world) { return world.enemies.filter(e => !e.ambient); }
function pickType(world) {
  const w = world.wave, roll = rnd();
  let type = 'drifter';
  if (w >= 2 && roll < 0.25) type = 'dart';
  if (w >= 2 && roll > 0.8) type = 'shooter';
  if (w >= 4 && roll > 0.7 && roll <= 0.8) type = 'splitter';
  const lancerFrom = world.mods.lancers ? 2 : DIFFICULTY.lancerFromWave, lancerLo = world.mods.lancers ? 0.82 : 0.88;
  if (w >= lancerFrom && roll > lancerLo && roll <= 0.94) type = 'lancer';
  if (w >= 5 && roll > 0.94) type = 'tank';
  return type;
}
function spawnWithElite(world, type, x, y) {
  const elite = world.wave >= DIFFICULTY.eliteFromWave && rnd() < DIFFICULTY.eliteChance(world.wave) * (world.mods.elite ? 3 : 1);
  return spawnEnemy(world, type, x, y, 1, { elite });
}

function chooseMode(world) {
  const w = world.wave;
  if (MODE_SCHEDULE[w]) return MODE_SCHEDULE[w];
  if (w >= MODE_CHANCE_AFTER && rnd() < MODE_CHANCE) {
    const keys = Object.keys(WAVE_MODES).filter(k => k !== world.lastMode);
    return keys[randInt(0, keys.length - 1)];
  }
  return null;
}

function nextWave(world, fx) {
  if (world.wave > 0 && !world.waveDamaged && activePlayers(world).length) { const bonus = PERFECT_WAVE_BONUS * world.wave; world.score += bonus; fx.text(world.W / 2, world.H / 2 - 100, `無傷清波 +${bonus}`, '#90f1a8', 26, 2); fx.sfx('pickup'); }
  world.waveDamaged = false;
  world.wave++;
  world.upgradeOffered = false;
  world.waveMode = null; world.beacon = null; world.modeTimer = 0;
  if (world.wave % BOSS_EVERY === 0) { startBossWave(world, fx); return; }
  const mode = chooseMode(world);
  if (mode) { startMode(world, mode, fx); return; }
  fx.sfx('wave');
  fx.text(world.W / 2, world.H / 2 - 60, `第 ${world.wave} 波`, '#fff', 36, 1.6);
  const n = Math.round((DIFFICULTY.baseCount + world.wave * DIFFICULTY.countPerWave) * (1 + (nPlayers(world) - 1) * 0.5) * (world.mods.swarm ? 1.5 : 1));
  // 夾擊隊形：從兩個相對的邊同時進場，逼玩家兩面應戰
  const pincer = world.wave >= DIFFICULTY.pincerFromWave && rnd() < 0.5 ? randInt(0, 1) : -1;
  if (pincer >= 0) fx.text(world.W / 2, world.H / 2 - 20, '偵測到夾擊隊形', '#ff8c42', 18, 1.6);
  for (let i = 0; i < n; i++) {
    const type = pickType(world);
    schedule(world, i * 0.3, () => { if (pincer < 0) spawnWithElite(world, type); else { const s = edgeSpawn(world, pincer + (i % 2) * 2); spawnWithElite(world, type, s.x, s.y); } });
  }
  if (world.wave % 3 === 0) schedule(world, 0.8, () => spawnEnemy(world, 'tank'));
}

// ---------- 特殊波次 ----------
function startMode(world, mode, fx) {
  const m = WAVE_MODES[mode];
  world.waveMode = mode; world.lastMode = mode; world.modeTimer = m.duration; world.modeSpawnCd = 0;
  fx.sfx('wave');
  fx.text(world.W / 2, world.H / 2 - 70, `第 ${world.wave} 波 · ${m.name}`, '#ffd166', 36, 2);
  fx.text(world.W / 2, world.H / 2 - 30, m.desc, '#fff', 18, 2.4);
  const n = nPlayers(world);
  if (mode === 'asteroids') {
    const count = Math.round((5 + world.wave) * (1 + (n - 1) * 0.4));
    for (let i = 0; i < count; i++) schedule(world, i * 0.5, () => spawnEnemy(world, 'rock', undefined, undefined, 1, { tier: 2 }));
    for (let i = 0; i < 2; i++) schedule(world, 3 + i * 2, () => spawnEnemy(world, 'dart'));
  } else if (mode === 'defend') {
    const hp = 300 * n;
    world.beacon = { x: world.W / 2, y: world.H / 2, r: 40, hp, maxHp: hp, hitFlash: 0, alive: true, kind: 'beacon' };
  } else if (mode === 'convoy') {
    const hp = 260 * n;
    world.beacon = { x: -70, y: world.H / 2, r: 36, hp, maxHp: hp, hitFlash: 0, alive: true, kind: 'convoy', vx: (world.W + 160) / 36, vy: 0 };
    world.modeSpawnCd = 1.5;
  } else if (mode === 'hunt') {
    // 懸賞目標從離玩家最遠的邊進場，外加幾隻護衛
    const p = nearestPlayer(world, world.W / 2, world.H / 2);
    const x = p && p.x > world.W / 2 ? 80 : world.W - 80;
    spawnEnemy(world, 'bounty', x, rand(120, world.H - 120));
    for (let i = 0; i < 3; i++) schedule(world, 1 + i * 1.2, () => spawnEnemy(world, i === 1 ? 'shooter' : 'drifter'));
  }
}
function updateMode(world, dt, fx) {
  const mode = world.waveMode;
  if (!mode) return;
  const m = WAVE_MODES[mode];
  if (m.duration > 0) world.modeTimer = Math.max(0, world.modeTimer - dt);

  if (mode === 'survive') {
    world.modeSpawnCd -= dt;
    if (world.modeSpawnCd <= 0) {
      const intensity = 1 + world.wave * 0.05;
      world.modeSpawnCd = 0.22 / intensity;
      const x = rand(20, world.W - 20);
      world.enemyBullets.push({ id: world.nextId++, x, y: -10, vx: rand(-40, 40), vy: rand(220, 330) * intensity, life: 6, r: rand(5, 9) });
      if (rnd() < 0.15) {
        const p = nearestPlayer(world, world.W / 2, world.H / 2);
        if (p) { const fromLeft = rnd() < 0.5; const sx = fromLeft ? -10 : world.W + 10, sy = rand(0, world.H); const a = Math.atan2(p.y - sy, p.x - sx); world.enemyBullets.push({ id: world.nextId++, x: sx, y: sy, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 6, r: 6 }); }
      }
    }
    if (world.modeTimer <= 0) finishMode(world, fx, true);
  } else if (mode === 'defend') {
    const b = world.beacon;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    world.modeSpawnCd -= dt;
    if (world.modeSpawnCd <= 0) {
      world.modeSpawnCd = Math.max(0.5, 1.3 - world.wave * 0.04) / (1 + (nPlayers(world) - 1) * 0.4);
      spawnWithElite(world, rnd() < 0.7 ? 'drifter' : 'dart');
    }
    if (world.modeTimer <= 0) finishMode(world, fx, b.alive);
  } else if (mode === 'asteroids') {
    if (waveEnemies(world).length === 0 && world.timers.length === 0) finishMode(world, fx, true);
  } else if (mode === 'convoy') {
    const b = world.beacon;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    if (b.alive) { b.x += b.vx * dt; b.y = world.H / 2 + Math.sin(world.time * 0.5) * 90; }
    world.modeSpawnCd -= dt;
    if (world.modeSpawnCd <= 0) {
      world.modeSpawnCd = Math.max(0.55, 1.4 - world.wave * 0.04) / (1 + (nPlayers(world) - 1) * 0.4);
      const roll = rnd();
      spawnWithElite(world, roll < 0.55 ? 'drifter' : roll < 0.8 ? 'dart' : 'shooter');
    }
    if (!b.alive) finishMode(world, fx, false);
    else if (b.x > world.W + 60) finishMode(world, fx, true);
  } else if (mode === 'hunt') {
    const alive = world.enemies.some(e => e.type === 'bounty');
    if (!alive && world.timers.length === 0) finishMode(world, fx, true);
    else if (world.modeTimer <= 0) { fx.text(world.W / 2, world.H / 2 - 80, '懸賞目標逃脫', '#ff5f7a', 26, 2); finishMode(world, fx, false); }
  }
}
function finishMode(world, fx, success) {
  const mode = world.waveMode;
  world.waveMode = null;
  for (const e of world.enemies) fx.burst(e.x, e.y, e.color, 6, 120, 0.4, 2);
  world.enemies.length = 0; world.enemyBullets.length = 0; world.timers.length = 0;
  if (success) {
    const bonus = (mode === 'defend' || mode === 'convoy') ? Math.round(300 * (world.beacon.hp / world.beacon.maxHp) + 100 * world.wave) : mode === 'hunt' ? 400 + 100 * world.wave : 150 * world.wave;
    world.score += bonus;
    fx.text(world.W / 2, world.H / 2 - 40, `${WAVE_MODES[mode].name} 成功 +${bonus}`, '#ffd166', 32, 2);
    const kinds = ['heal', 'shield', 'spread', 'rapid', 'laser'];
    world.pickups.push({ id: world.nextId++, x: world.W / 2 + rand(-40, 40), y: world.H / 2 + rand(-40, 40), kind: kinds[randInt(0, kinds.length - 1)], life: 12, t: 0 });
    fx.sfx('wave');
  } else {
    fx.text(world.W / 2, world.H / 2 - 40, `${WAVE_MODES[mode].name} 失敗`, '#ff5f7a', 32, 2);
  }
  world.beacon = null; world.lasers.length = 0;
  world.waveTimer = 3;
}

// ---------- Boss ----------
function startBossWave(world, fx) {
  world.bossWarn = 2.6;
  [0, 0.5, 1].forEach(d => schedule(world, d, () => fx.beep(220, 0.35, 'sawtooth', 0.12, -40)));
  fx.shake(6);
  world.enemyBullets.length = 0;
}
function makeBoss(world, kind, tier, slot, hpMul) {
  const K = BOSS_KINDS[kind];
  const n = nPlayers(world);
  const hp = 1100 * (1 + (tier - 1) * 0.8) * (1 + (n - 1) * 0.6) * K.hpMul * hpMul;
  const suffix = kind === 'annihilator' ? BOSS_NAMES[Math.min(tier - 1, BOSS_NAMES.length - 1)].replace('殲滅者 ', '') : ['Mk.I', 'Mk.II', 'Mk.III', 'Ω'][Math.min(tier - 1, 3)];
  return {
    id: world.nextId++, kind, tier, slot, name: `${K.name} ${suffix}`,
    x: world.W * (slot === 0 ? 0.5 : slot < 0 ? 0.3 : 0.7), y: -220, r: K.r, hp, maxHp: hp, phase: 1,
    vx: 0, vy: 0, t: rand(0, 3), spin: 0, hitFlash: 0, speedMul: K.speed,
    entering: true, atk: 'idle', atkT: 1.8 + rand(0, 0.8), atkIdx: randInt(0, 3), sub: 0, aim: 0, chargeDir: null, chargeT: 0, dying: 0, laserId: null,
    cloak: 0, dodgeCd: rand(0, 1), wantPickup: null, slow: 0, armor: kind === 'titan' ? 0.7 : 1,
    color: K.color, baseColor: K.color, color2: K.color2,
  };
}
function spawnBoss(world, fx) {
  const tier = Math.floor(world.wave / BOSS_EVERY);
  const kinds = Object.keys(BOSS_KINDS);
  const final = world.wave === WIN_WAVE && !world.endless;
  const double = !final && world.wave >= BOSS_DOUBLE_FROM_WAVE && rnd() < BOSS_DOUBLE_CHANCE;
  if (final) world.bosses.push(makeBoss(world, 'annihilator', tier, 0, 1));
  else if (double) { world.bosses.push(makeBoss(world, kinds[randInt(0, kinds.length - 1)], tier, -1, 0.65)); world.bosses.push(makeBoss(world, kinds[randInt(0, kinds.length - 1)], tier, 1, 0.65)); fx.text(world.W / 2, world.H / 2 - 80, '偵測到兩艘巨型敵艦！', '#ff3860', 30, 2.2); }
  else world.bosses.push(makeBoss(world, world.wave === BOSS_EVERY ? 'annihilator' : kinds[randInt(0, kinds.length - 1)], tier, 0, 1));
  fx.sfx('wave');
}
/** 建立一道雷射（先預警再發射）。owner: 敵人 id；bossId: Boss id */
function spawnLaser(world, x, y, angle, opts) {
  const L = { id: world.nextId++, x, y, angle, phase: 'warn', t: opts.warn, warn: opts.warn, fire: opts.fire, len: opts.len ?? AI.laserLen, w: opts.w ?? AI.laserWidth, dmg: opts.dmg ?? AI.laserDmg, sweep: opts.sweep ?? 0, owner: opts.owner ?? null, boss: !!opts.boss, bossId: opts.bossId ?? null, track: opts.track ?? true, color: opts.color ?? '#e040fb' };
  world.lasers.push(L);
  return L;
}
function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return dist2(px, py, x1 + dx * t, y1 + dy * t);
}
function bossFire(world, x, y, a, spd, r = 7, life = 4, extra = {}) {
  world.enemyBullets.push({ id: world.nextId++, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, r, boss: true, ...extra });
}
/** Boss 的通用智慧：閃避子彈、搶道具吃 */
function bossBrain(world, b, dt, fx) {
  b.dodgeCd -= dt;
  if (b.dodgeCd <= 0 && b.atk !== 'charge' && b.atk !== 'laser') {
    for (const bl of world.bullets) {
      const rx = b.x - bl.x, ry = b.y - bl.y, rd = Math.hypot(rx, ry);
      if (rd > 260) continue;
      const sp = Math.hypot(bl.vx, bl.vy) || 1, ux = bl.vx / sp, uy = bl.vy / sp;
      if (rx * ux + ry * uy < 0) continue;
      const perp = Math.abs(rx * uy - ry * ux);
      if (perp < b.r * 0.9) {
        const s = (rx * uy - ry * ux) >= 0 ? 1 : -1;
        b.vx += -uy * s * 320 * b.speedMul; b.vy += ux * s * 160 * b.speedMul;
        b.dodgeCd = 1.6; fx.ghost(b.x, b.y, b.r * 0.9, b.color, 0.25);
        break;
      }
    }
  }
  // 搶道具：附近有道具且沒在放大招時飄過去吃掉
  if (!b.wantPickup && b.atk === 'idle' && rnd() < dt * 0.5) {
    let best = null, bd = 320 * 320;
    for (const k of world.pickups) { const d = dist2(k.x, k.y, b.x, b.y); if (d < bd) { bd = d; best = k; } }
    if (best) b.wantPickup = best.id;
  }
  if (b.wantPickup) {
    const k = world.pickups.find(k => k.id === b.wantPickup);
    if (!k) { b.wantPickup = null; return; }
    b.vx += (k.x - b.x) * 2.2 * dt * b.speedMul; b.vy += (k.y - b.y) * 2.2 * dt * b.speedMul;
    if (dist2(k.x, k.y, b.x, b.y) < (b.r + 14) ** 2) {
      world.pickups.splice(world.pickups.indexOf(k), 1); b.wantPickup = null;
      if (k.kind === 'heal') { b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.08); fx.text(b.x, b.y - b.r - 20, 'Boss 回復', '#3ddc84', 20, 1.2); }
      else if (k.kind === 'bomb') { for (let i = 0; i < 14; i++) bossFire(world, b.x, b.y, i * TAU / 14, 220, 8, 4); fx.text(b.x, b.y - b.r - 20, 'Boss 引爆炸彈！', '#ff3860', 20, 1.2); }
      else { b.buff = 8; fx.text(b.x, b.y - b.r - 20, 'Boss 強化', '#ffd166', 20, 1.2); }
      fx.burst(b.x, b.y, '#ffd166', 20, 200, 0.5, 3); fx.sfx('pickup');
    }
  }
}
function updateBoss(world, b, dt, fx) {
  const W = world.W, H = world.H;
  b.t += dt; b.spin += dt * (b.phase === 3 ? 2.5 : 1.2);
  b.hitFlash = Math.max(0, b.hitFlash - dt);
  if (b.buff > 0) b.buff -= dt;
  if (b.slow > 0) b.slow -= dt;

  if (b.dying > 0) {
    b.dying -= dt;
    if (rnd() < 0.6) { fx.burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), rnd() < 0.5 ? '#fff' : b.color, 10, 240, 0.5, 5); fx.noise(0.1, 0.1); }
    fx.shake(8);
    if (b.dying <= 0) killBoss(world, b, fx);
    return;
  }
  const hoverY = H * 0.27, homeX = W * (b.slot === 0 ? 0.5 : b.slot < 0 ? 0.3 : 0.7);
  if (b.entering) {
    b.y += (hoverY - b.y) * Math.min(1, dt * 2.5);
    if (Math.abs(b.y - hoverY) < 2) { b.entering = false; fx.text(b.x, H / 2 - 40, b.name, b.color, 40, 1.8); }
    return;
  }
  const p = nearestPlayer(world, b.x, b.y);
  if (!p) return;

  const frac = b.hp / b.maxHp;
  const wantPhase = frac < 0.33 ? 3 : frac < 0.66 ? 2 : 1;
  if (wantPhase !== b.phase) {
    b.phase = wantPhase;
    b.color = b.phase === 2 ? b.color2 : b.baseColor;
    fx.burst(b.x, b.y, '#fff', 50, 400, 0.8, 5); fx.shake(14);
    fx.ring(b.x, b.y, '#fff', b.r, b.r + 300, 0.5, 5); fx.aberrate(1);
    fx.text(b.x, b.y - b.r - 40, b.phase === 3 ? '狂暴模式！' : '第二階段', '#fff', 26, 1.4);
    world.enemyBullets = world.enemyBullets.filter(x => !x.boss); world.lasers = world.lasers.filter(L => L.bossId !== b.id); b.laserId = null;
    b.atk = 'idle'; b.atkT = 1.2;
  }

  bossBrain(world, b, dt, fx);
  const spdMul = b.speedMul * (b.slow > 0 ? 0.5 : 1) * (b.buff > 0 ? 1.4 : 1);
  if (b.atk !== 'charge' && b.atk !== 'strike') {
    const targetX = b.wantPickup ? b.x : clamp((b.kind === 'phantom' && b.cloak > 0 ? p.x + Math.cos(b.t * 2) * 300 : homeX * 0.4 + p.x * 0.6) + Math.sin(b.t * 0.8) * 200, b.r + 20, W - b.r - 20);
    const targetY = b.wantPickup ? b.y : hoverY + Math.sin(b.t * 1.3) * 40 + (b.kind === 'phantom' ? Math.sin(b.t * 0.6) * 160 : 0);
    b.vx += (targetX - b.x) * 1.5 * dt * spdMul; b.vy += (targetY - b.y) * 1.5 * dt * spdMul;
    b.vx *= Math.pow(0.1, dt); b.vy *= Math.pow(0.1, dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.x = clamp(b.x, b.r * 0.5, W - b.r * 0.5); b.y = clamp(b.y, b.r * 0.5, H - b.r * 0.5);
  }
  if (b.cloak > 0) { b.cloak -= dt; if (b.cloak <= 0) { fx.burst(b.x, b.y, b.color, 30, 300, 0.5, 4); fx.text(b.x, b.y - b.r - 20, '現形！', '#fff', 22, 1); } }

  b.atkT -= dt;
  // 預判瞄準：對玩家速度做提前量
  const lead = 0.35 + b.tier * 0.05;
  const aimA = Math.atan2(p.y + p.vy * lead - b.y, p.x + p.vx * lead - b.x);
  const rate = b.buff > 0 ? 0.75 : 1;
  switch (b.atk) {
    case 'idle':
      if (b.atkT <= 0) {
        const pools = {
          annihilator: b.phase === 1 ? ['ring', 'volley', 'wall', 'charge', 'laser', 'ring', 'homing'] : b.phase === 2 ? ['spiral', 'laser', 'volley', 'charge', 'homing', 'summon', 'wall', 'ring'] : ['spiral', 'charge', 'laser', 'wall', 'volley', 'homing', 'laser', 'summon', 'spiral', 'charge'],
          hive:        b.phase === 1 ? ['summon', 'swarm', 'ring', 'meteors', 'homing'] : b.phase === 2 ? ['swarm', 'ufo', 'summon', 'meteors', 'ring', 'homing'] : ['swarm', 'meteors', 'ufo', 'summon', 'spiral', 'homing', 'swarm'],
          phantom:     b.phase === 1 ? ['cloak', 'volley', 'spiral', 'cloak', 'laser'] : b.phase === 2 ? ['cloak', 'strike', 'volley', 'laser', 'cloak', 'spiral'] : ['cloak', 'strike', 'laser', 'cloak', 'strike', 'spiral', 'volley'],
          titan:       b.phase === 1 ? ['meteors', 'shockwave', 'wall', 'ring'] : b.phase === 2 ? ['meteors', 'shockwave', 'charge', 'wall', 'summonRocks'] : ['meteors', 'shockwave', 'charge', 'meteors', 'wall', 'summonRocks', 'shockwave'],
        };
        const pool = pools[b.kind];
        b.atk = pool[b.atkIdx++ % pool.length];
        b.atkT = 0; b.sub = 0;
        if (b.atk === 'charge') { b.atkT = 0.9; b.chargeDir = null; fx.text(b.x, b.y - b.r - 20, '!!', '#ffd166', 30, 0.8); fx.beep(180, 0.5, 'sawtooth', 0.08, 200); }
        if (b.atk === 'strike') { b.atkT = 0.5; }
      }
      break;
    case 'ring':
      if (b.atkT <= 0) {
        const n = 18 + b.tier * 4, off = b.sub * 0.2;
        for (let i = 0; i < n; i++) bossFire(world, b.x, b.y, off + i * TAU / n, 180 + b.tier * 20);
        fx.beep(260, 0.15, 'square', 0.07, -100);
        b.sub++; b.atkT = 0.45 * rate;
        if (b.sub >= 3) { b.atk = 'idle'; b.atkT = 1.6 - b.phase * 0.2; }
      }
      break;
    case 'spiral':
      if (b.atkT <= 0) {
        const arms = b.phase === 3 ? 3 : 2;
        for (let k = 0; k < arms; k++) bossFire(world, b.x, b.y, b.spin * 3 + k * TAU / arms, 230, 6, 5);
        b.sub++; b.atkT = 0.06;
        if (b.sub >= 45) { b.atk = 'idle'; b.atkT = 1.4; }
      }
      break;
    case 'volley':
      if (b.atkT <= 0) {
        const spread = b.phase === 1 ? 3 : 5;
        for (let i = 0; i < spread; i++) bossFire(world, b.x + Math.cos(aimA) * b.r, b.y + Math.sin(aimA) * b.r, aimA + (i - (spread - 1) / 2) * 0.18, 360, 7, 3);
        fx.beep(500, 0.1, 'square', 0.06, -300);
        b.sub++; b.atkT = 0.35 * rate;
        if (b.sub >= 3) { b.atk = 'idle'; b.atkT = 1.3; }
      }
      break;
    case 'wall': {
      if (b.atkT <= 0) {
        const cols = 16, gap = randInt(1, cols - 2), spacing = W / cols;
        for (let i = 0; i < cols; i++) { if (i === gap || i === gap + 1) continue; bossFire(world, spacing * (i + 0.5), b.y + b.r * 0.5, Math.PI / 2, 200 + b.phase * 30, 9, 6, { wall: true }); }
        fx.beep(150, 0.3, 'square', 0.08, -60);
        b.sub++; b.atkT = 1.1;
        if (b.sub >= (b.phase === 3 ? 3 : 2)) { b.atk = 'idle'; b.atkT = 1.5; }
      }
      break;
    }
    case 'homing': {
      if (b.atkT <= 0) {
        const n = 3 + b.tier;
        for (let i = 0; i < n; i++) bossFire(world, b.x, b.y, aimA + (i - (n - 1) / 2) * 0.5, 140, 11, 5, { homing: 2.2 });
        fx.beep(700, 0.25, 'sine', 0.07, -400);
        b.atk = 'idle'; b.atkT = 2;
      }
      break;
    }
    case 'charge':
      if (!b.chargeDir) {
        b.aim = aimA;
        if (b.atkT <= 0) { b.chargeDir = { x: Math.cos(aimA), y: Math.sin(aimA) }; b.chargeT = 0.75; fx.sfx('dash'); fx.shake(8); }
      } else {
        const spd = (850 + b.tier * 80) * (b.kind === 'titan' ? 0.7 : 1);
        b.x += b.chargeDir.x * spd * dt; b.y += b.chargeDir.y * spd * dt;
        fx.ghost(b.x, b.y, b.r * 0.9, b.color, 0.35);
        b.chargeT -= dt;
        const hitWall = b.x < b.r || b.x > W - b.r || b.y < b.r || b.y > H - b.r;
        if (b.chargeT <= 0 || hitWall) {
          b.x = clamp(b.x, b.r, W - b.r); b.y = clamp(b.y, b.r, H - b.r);
          if (hitWall) { fx.shake(16); fx.burst(b.x, b.y, b.color, 30, 350, 0.6, 5); fx.noise(0.2, 0.2); if (b.kind === 'titan') for (let i = 0; i < 3; i++) spawnAmbient(world, 'meteor', fx, { silent: true, x: rand(100, W - 100), y: -70, tx: rand(100, W - 100), ty: H + 60, big: false, hp: AMBIENT.meteorHp * 0.5 }); }
          b.vx = 0; b.vy = 0; b.atk = 'idle'; b.atkT = 1.2;
        }
      }
      break;
    case 'laser': {
      if (!b.laserId) {
        const sweep = (rnd() < 0.5 ? 1 : -1) * AI.bossLaserSweep;
        const L = spawnLaser(world, b.x, b.y, aimA - sweep * 0.5, { warn: AI.bossLaserWarn, fire: AI.bossLaserFire + b.phase * 0.2, len: 2200, w: AI.bossLaserWidth, dmg: AI.bossLaserDmg, sweep: sweep / (AI.bossLaserFire + b.phase * 0.2), boss: true, bossId: b.id, track: false, color: b.color });
        b.laserId = L.id;
        fx.beep(90, 0.9, 'sawtooth', 0.1, 260); fx.text(b.x, b.y - b.r - 20, '雷射充能', '#ff8c42', 22, 0.9);
      } else if (!world.lasers.some(L => L.id === b.laserId)) { b.laserId = null; b.atk = 'idle'; b.atkT = 1.4; }
      break;
    }
    case 'summon':
      if (b.atkT <= 0) {
        const n = 2 + b.tier;
        for (let i = 0; i < n; i++) { const a = i * TAU / n + b.t; spawnEnemy(world, rnd() < 0.5 ? 'dart' : 'drifter', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30)); }
        fx.burst(b.x, b.y, '#f15bb5', 24, 280, 0.5, 3);
        fx.beep(330, 0.3, 'triangle', 0.08, 300);
        b.atk = 'idle'; b.atkT = 2;
      }
      break;
    // ---- 蜂巢母艦 ----
    case 'swarm':
      if (b.atkT <= 0) {
        const a = b.t * 4 + b.sub * 0.7;
        spawnEnemy(world, 'dart', b.x + Math.cos(a) * (b.r + 20), b.y + Math.sin(a) * (b.r + 20));
        fx.burst(b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r, b.color, 6, 160, 0.4, 3);
        b.sub++; b.atkT = 0.25;
        if (b.sub >= 5 + b.tier) { b.atk = 'idle'; b.atkT = 2.2; }
      }
      break;
    case 'ufo':
      if (b.atkT <= 0) { spawnAmbient(world, 'ufo', fx, { ally: true }); b.atk = 'idle'; b.atkT = 2.5; }
      break;
    case 'meteors':
      if (b.atkT <= 0) {
        const big = b.kind === 'titan';
        spawnAmbient(world, 'meteor', fx, { silent: b.sub > 0, x: rand(80, W - 80), y: -80, tx: p.x + rand(-200, 200), ty: H + 80, big, hp: AMBIENT.meteorHp * (big ? 0.9 : 0.45), speed: big ? 260 : 380 });
        b.sub++; b.atkT = big ? 0.8 : 0.45;
        if (b.sub >= (big ? 3 + b.phase : 5 + b.phase)) { b.atk = 'idle'; b.atkT = 2.2; }
      }
      break;
    // ---- 幽影 ----
    case 'cloak':
      if (b.atkT <= 0) {
        if (b.sub === 0) { b.cloak = 3.5 + b.phase * 0.5; b.sub = 1; b.atkT = b.cloak; fx.text(b.x, b.y - b.r - 20, '隱形', b.color, 20, 1); fx.burst(b.x, b.y, '#fff', 20, 200, 0.4, 3); fx.beep(1200, 0.5, 'sine', 0.05, -800); }
        else { b.atk = 'idle'; b.atkT = 0.4; }
      }
      break;
    case 'strike':
      // 瞬移到玩家旁邊，扇形齊射後再閃走
      if (b.atkT <= 0) {
        const a = rand(0, TAU), d = 260;
        fx.burst(b.x, b.y, b.color, 16, 200, 0.4, 3);
        b.x = clamp(p.x + Math.cos(a) * d, b.r, W - b.r); b.y = clamp(p.y + Math.sin(a) * d, b.r, H - b.r); b.vx = b.vy = 0; b.cloak = 0;
        fx.burst(b.x, b.y, '#fff', 24, 260, 0.4, 3); fx.shake(8);
        const aa = Math.atan2(p.y - b.y, p.x - b.x);
        for (let i = 0; i < 7; i++) bossFire(world, b.x, b.y, aa + (i - 3) * 0.14, 380, 6, 3);
        fx.beep(700, 0.15, 'square', 0.08, -400);
        b.atk = 'idle'; b.atkT = 1.4;
      }
      break;
    // ---- 星隕 ----
    case 'shockwave':
      if (b.atkT <= 0) {
        const n = 28;
        for (let i = 0; i < n; i++) bossFire(world, b.x, b.y, i * TAU / n + b.sub * 0.11, 150 + b.sub * 40, 10, 5, { wall: true });
        fx.ring(b.x, b.y, b.color, b.r, b.r + 500, 0.8, 6); fx.shake(12); fx.noise(0.2, 0.15);
        b.sub++; b.atkT = 0.9;
        if (b.sub >= 2 + (b.phase > 1 ? 1 : 0)) { b.atk = 'idle'; b.atkT = 2; }
      }
      break;
    case 'summonRocks':
      if (b.atkT <= 0) {
        for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + b.t; spawnEnemy(world, 'rock', b.x + Math.cos(a) * (b.r + 40), b.y + Math.sin(a) * (b.r + 40), 0.7, { tier: 1, dir: a }); }
        fx.burst(b.x, b.y, b.color, 24, 280, 0.5, 4); fx.beep(120, 0.4, 'sawtooth', 0.08, -60);
        b.atk = 'idle'; b.atkT = 2.4;
      }
      break;
  }

  for (const q of activePlayers(world)) {
    if (dist2(b.x, b.y, q.x, q.y) < (b.r + q.r) ** 2) {
      hurtPlayer(world, q, 35, fx);
      const a = Math.atan2(q.y - b.y, q.x - b.x);
      q.vx = Math.cos(a) * 550; q.vy = Math.sin(a) * 550;
    }
  }
}
function damageBoss(world, b, dmg, x, y, fx) {
  if (!b || b.entering || b.dying > 0) return;
  b.hp -= dmg * (b.armor || 1); b.hitFlash = 0.06;
  if (b.cloak > 0) b.cloak = Math.max(0, b.cloak - 0.4);   // 被打到會逐漸現形
  fx.burst(x, y, b.color, 3, 100, 0.3, 2);
  if (b.hp <= 0) { b.hp = 0; b.dying = 1.8; b.cloak = 0; world.enemyBullets = world.enemyBullets.filter(x => !x.boss); world.lasers = world.lasers.filter(L => L.bossId !== b.id); b.wantPickup = null; fx.sfx('explode'); }
}
function killBoss(world, b, fx) {
  const gain = 500 * b.tier;
  world.score += gain; world.combo += 10; world.comboTimer = 3;
  fx.text(b.x, b.y - 20, `${b.name} 擊破 +${gain}`, '#ffd166', 34, 2);
  fx.burst(b.x, b.y, '#fff', 100, 600, 1.2, 7); fx.burst(b.x, b.y, b.color, 100, 500, 1.2, 6);
  fx.ring(b.x, b.y, '#fff', b.r, Math.max(world.W, world.H), 0.9, 8); fx.ring(b.x, b.y, b.color, b.r, Math.max(world.W, world.H) * 0.6, 0.7, 5);
  fx.shake(24); fx.flash(0.6); fx.hitStop(0.25); fx.aberrate(1); fx.zoom(1); fx.crossPunch();
  const kinds = ['heal', 'shield', 'spread', 'laser'];
  for (let i = 0; i < 3; i++) world.pickups.push({ id: world.nextId++, x: b.x + rand(-80, 80), y: b.y + rand(-50, 50), kind: kinds[randInt(0, 3)], life: 15, t: 0 });
  world.bosses.splice(world.bosses.indexOf(b), 1);
  if (world.bosses.length) return;   // 還有另一隻：獎勵等全部擊破
  const win = world.wave >= WIN_WAVE && !world.won;
  for (const p of world.players) {
    p.maxHp += 20; if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + 40);
    if (p.downed) revive(world, p, fx);
    fx.text(p.x, p.y - 40, '最大生命 +20', '#3ddc84', 18, 1.5);
  }
  world.upgradeDue = true;
  world.waveTimer = 4;
  if (win) {
    // 突圍成功：加分並進入勝利畫面；之後可選擇繼續無盡模式（每日挑戰直接結算）
    world.won = true; world.score += WIN_BONUS;
    world.enemyBullets.length = 0; world.lasers.length = 0; world.timers.length = 0;
    fx.text(world.W / 2, world.H / 2 - 120, `突圍成功 +${WIN_BONUS}`, '#ffd166', 44, 3); fx.flash(0.4);
    world.scene = world.mods.daily ? 'gameover' : 'victory';
  }
}
/** 勝利畫面 → 繼續無盡模式 */
export function continueEndless(world) {
  if (world.scene !== 'victory') return false;
  world.endless = true; world.scene = 'play'; world.upgradeOffered = false; world.waveTimer = 3;
  return true;
}
/** 勝利畫面 → 結束這局結算 */
export function finishRun(world) {
  if (world.scene !== 'victory') return false;
  world.scene = 'gameover';
  return true;
}

// ---------- 子彈 / 道具 ----------
function spawnBullet(world, p, x, y, a, dmgMul = 1) {
  world.bullets.push({
    id: world.nextId++, owner: p.id, x, y, vx: Math.cos(a) * PLAYER_BASE.bulletSpeed, vy: Math.sin(a) * PLAYER_BASE.bulletSpeed,
    life: PLAYER_BASE.bulletLife, dmg: p.damage * dmgMul,
    pierce: p.pierce, bounce: p.bounce, homing: p.homing, size: p.bulletSize, hit: new Set(),
    burn: p.syn.ember && rnd() < 0.15,
  });
  return world.bullets[world.bullets.length - 1];
}
function spawnPickup(world, x, y, force = false, luck = 0) {
  if (world.mods.noPickup) return;
  const roll = force ? rnd() * 0.34 : rnd() * (1 - Math.min(0.5, luck));   // 幸運：把亂數壓進掉落區間
  let kind = null;
  if (roll < 0.10) kind = 'heal';
  else if (roll < 0.17) kind = 'spread';
  else if (roll < 0.24) kind = 'rapid';
  else if (roll < 0.29) kind = 'shield';
  else if (roll < 0.33) kind = 'bomb';
  else if (roll < 0.355) kind = 'laser';
  if (kind) world.pickups.push({ id: world.nextId++, x, y, kind, life: 10, t: 0 });
}
function applyPickup(world, p, kind, fx) {
  fx.sfx('pickup');
  const labels = { heal: '+HP', spread: '散射', rapid: '連射', shield: '護盾', bomb: '炸彈', laser: '雷射' };
  const colors = { heal: '#3ddc84', spread: '#ffd166', rapid: '#ff8c42', shield: '#4cc9f0', bomb: '#ff3860', laser: '#b8ffff' };
  fx.text(p.x, p.y - 30, labels[kind], colors[kind], 18);
  switch (kind) {
    case 'heal': p.hp = Math.min(p.maxHp, p.hp + 30); break;
    case 'spread': p.spread = Math.min(5, p.spread + 1); break;
    case 'rapid': p.rapid = 8; break;
    case 'shield': p.shield = Math.min(3, p.shield + 1); break;
    case 'laser': p.laser = PLAYER_BASE.laserTime; break;
    case 'bomb':
      fx.shake(14); fx.flash(0.6); fx.slowmo(0.6);   // 約 0.6 秒的震動與慢動作（以真實時間計）
      for (let i = world.enemies.length - 1; i >= 0; i--) { const o = world.enemies[i]; if (!o) continue; o.hp -= 60; if (o.hp <= 0) killEnemy(world, i, p, fx); }
      for (const bb of world.bosses) damageBoss(world, bb, 120, bb.x, bb.y, fx);
      world.enemyBullets.length = 0; world.lasers = world.lasers.filter(L => L.boss);
      fx.burst(p.x, p.y, '#ff3860', 60, 500, 0.8, 4);
      break;
  }
}

// ---------- 擊殺 / 受傷 / 倒地 ----------
function killEnemy(world, idx, killer, fx) {
  const e = world.enemies[idx];
  if (!e) return;
  world.enemies.splice(idx, 1);
  world.combo++; world.comboTimer = 2.2;
  const mult = 1 + Math.floor(world.combo / 5) * 0.5;
  const gain = Math.round(e.score * mult);
  world.score += gain;
  if (killer) { killer.kills++; if (killer.syn.recharge && ++killer.killStreak >= 20) { killer.killStreak = 0; if (killer.shield < 3) { killer.shield++; fx.text(killer.x, killer.y - 50, '護盾回充', '#4cc9f0', 16, 1.2); } } }
  fx.text(e.x, e.y - 10, `+${gain}${mult > 1 ? ' ×' + mult : ''}`, e.color, 14 + Math.min(world.combo, 20) * 0.4);
  if (e.laserId) world.lasers = world.lasers.filter(L => !(L.id === e.laserId && L.phase === 'warn'));
  if (e.type === 'bounty') { fx.text(e.x, e.y - 40, '懸賞達成！', '#ffd166', 28, 2); fx.shake(10); }
  if (e.type === 'meteor') { fx.text(e.x, e.y - 40, '流星擊碎！', '#ffb070', 24, 1.6); spawnPickup(world, e.x, e.y, true); }
  if (e.type === 'ufo') { fx.text(e.x, e.y - 40, '飛碟擊落！', '#90f1a8', 24, 1.6); spawnPickup(world, e.x, e.y, true); }
  const big = e.type === 'tank' || e.elite || e.type === 'bounty';
  fx.burst(e.x, e.y, e.color, big ? 40 : 18, big ? 320 : 220, 0.7, big ? 5 : 3);
  fx.burst(e.x, e.y, '#ffffff', 6, 80, 0.3, 2);
  fx.ring(e.x, e.y, '#fff', e.r, e.r + (big ? 110 : 55), 0.28, big ? 4 : 2.5);
  fx.ring(e.x, e.y, e.color, e.r * 0.5, e.r + (big ? 70 : 35), 0.22, 2);
  fx.shake(big ? 12 : 4);
  const lfx = fx.local(killer);
  lfx.crossPunch(); lfx.zoom(big ? 1 : 0.4);
  if (big) lfx.aberrate(0.5);
  fx.sfx('explode');
  fx.beep(330 + Math.min(world.combo, 30) * 22, 0.09, 'triangle', 0.06, 200);
  if (e.split) for (let i = 0; i < 3; i++) spawnEnemy(world, 'splitter', e.x + rand(-20, 20), e.y + rand(-20, 20), 0.5);
  if (e.type === 'rock' && e.tier > 0) {
    for (let i = 0; i < 2; i++) spawnEnemy(world, 'rock', e.x + rand(-10, 10), e.y + rand(-10, 10), e.tier === 2 ? 0.55 : 0.3, { tier: e.tier - 1, dir: Math.atan2(e.vy, e.vx) + (i ? 0.9 : -0.9) });
  }
  spawnPickup(world, e.x, e.y, e.elite, killer ? killer.luck : 0);
  if (killer) {
    if (killer.lifesteal > 0 && !killer.dead) killer.hp = Math.min(killer.maxHp, killer.hp + killer.lifesteal);
    if (killer.explosive > 0 && !e.fromChain) {
      const R = 90;
      fx.burst(e.x, e.y, '#ff8c42', 14, 260, 0.45, 4);
      fx.ghost(e.x, e.y, R, '#ff8c42', 0.25);
      for (let i = world.enemies.length - 1; i >= 0; i--) {
        const o = world.enemies[i];
        if (!o) continue;
        if (dist2(o.x, o.y, e.x, e.y) < (R + o.r) ** 2) { o.hp -= killer.explosive; o.hitFlash = 0.1; if (killer.syn.vamp && !killer.dead) killer.hp = Math.min(killer.maxHp, killer.hp + 2); if (o.hp <= 0) { o.fromChain = true; killEnemy(world, i, killer, fx); } }
      }
      for (const bb of world.bosses) if (dist2(bb.x, bb.y, e.x, e.y) < (R + bb.r) ** 2) damageBoss(world, bb, killer.explosive, e.x, e.y, fx);
    }
  }
}

function hurtPlayer(world, p, dmg, fx) {
  if (p.dead || p.downed || p.offline || p.inv > 0) return;
  const lfx = fx.local(p);
  if (p.shield > 0) {
    p.shield--; p.inv = 0.6;
    fx.burst(p.x, p.y, '#4cc9f0', 20, 200, 0.5, 3); fx.beep(600, 0.15, 'sine', 0.08, -300); fx.text(p.x, p.y - 30, '護盾抵擋', '#4cc9f0');
    return;
  }
  p.hp -= dmg; p.inv = 0.8; world.waveDamaged = true;
  lfx.flash(1); lfx.shake(14); lfx.aberrate(0.9);
  world.combo = 0;
  fx.burst(p.x, p.y, '#ff5f7a', 16, 200, 0.5, 3);
  fx.ring(p.x, p.y, '#ff5f7a', 10, 90, 0.35, 3);
  fx.sfx('hurt');
  if (p.hp <= 0) {
    p.hp = 0;
    const others = world.players.filter(q => q !== p && !q.dead && !q.offline);
    if (others.length === 0) killPlayer(world, p, fx);
    else {
      p.downed = true; p.downTimer = DOWNED_TIME; p.reviveProgress = 0; p.vx = p.vy = 0;
      fx.burst(p.x, p.y, p.color, 30, 250, 0.8, 3);
      fx.text(p.x, p.y - 40, `${p.name} 倒地！靠近救援`, '#ff5f7a', 20, 2.5);
      checkGameOver(world, fx);
    }
  }
}
function killPlayer(world, p, fx) {
  p.dead = true; p.downed = false; p.hp = 0;
  fx.burst(p.x, p.y, '#ffffff', 50, 300, 1, 4); fx.burst(p.x, p.y, p.color, 30, 250, 0.8, 3);
  fx.shake(24);
  fx.text(p.x, p.y - 40, `${p.name} 陣亡`, '#ff5f7a', 20, 2);
  checkGameOver(world, fx);
}
function revive(world, p, fx) {
  p.downed = false; p.reviveProgress = 0; p.hp = Math.max(1, Math.round(p.maxHp * 0.5)); p.inv = 2;
  fx.burst(p.x, p.y, '#3ddc84', 30, 220, 0.7, 3); fx.ring(p.x, p.y, '#3ddc84', 10, 120, 0.5, 3);
  fx.text(p.x, p.y - 40, `${p.name} 復活！`, '#3ddc84', 22, 1.8);
  fx.sfx('pickup');
}
function checkGameOver(world, fx) {
  if (world.players.some(p => !p.dead && !p.downed && !p.offline)) return;
  world.scene = 'gameover'; fx.sfx('gameover');
}

// ---------- 升級 ----------
function offerUpgrades(world, fx) {
  world.pendingUpgrades.clear();
  for (const p of world.players) {
    if (p.dead || p.offline) continue;
    const pool = UPGRADES.filter(u => (p.upgrades[u.id] || 0) < u.max);
    const picks = [];
    while (picks.length < 3 && pool.length) picks.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
    world.pendingUpgrades.set(p.id, picks);
  }
  if (world.pendingUpgrades.size === 0) { world.waveTimer = 2.5; return; }
  world.scene = 'upgrade';
  [523, 659, 784].forEach((f, i) => schedule(world, i * 0.1, () => fx.beep(f, 0.2, 'sine', 0.06)));
}
export function chooseUpgrade(world, playerId, idx, fx = NULL_FX) {
  const choices = world.pendingUpgrades.get(playerId);
  const p = world.players.find(q => q.id === playerId);
  if (!choices || !p) return false;
  const u = choices[idx];
  if (!u) return false;
  u.apply(p);
  p.upgrades[u.id] = (p.upgrades[u.id] || 0) + 1;
  // 組合技：新啟動的宣告出來
  for (const id of activeSynergies(p.upgrades)) if (!p.syn[id]) { p.syn[id] = true; const s = SYNERGIES.find(x => x.id === id); fx.text(p.x, p.y - 70, `組合技 ${s.icon} ${s.name}！`, '#ff8c42', 26, 2.2); fx.ring(p.x, p.y, '#ff8c42', 10, 160, 0.6, 4); fx.sfx('wave'); }
  fx.text(p.x, p.y - 40, `${u.icon} ${u.name}`, '#ffd166', 22, 1.6);
  fx.burst(p.x, p.y, '#ffd166', 20, 200, 0.6, 3);
  fx.sfx('pickup');
  world.pendingUpgrades.delete(playerId);
  if (world.pendingUpgrades.size === 0) { world.scene = 'play'; world.waveTimer = 2.5; }
  return true;
}
/** 玩家離開時若正在等他選升級，直接略過，避免其他人卡住 */
export function dropPendingUpgrade(world, playerId) {
  if (world.pendingUpgrades.delete(playerId) && world.pendingUpgrades.size === 0 && world.scene === 'upgrade') { world.scene = 'play'; world.waveTimer = 2.5; }
}

// ---------- 玩家移動（伺服器模擬與客戶端預測共用，必須是純函式：只改 p） ----------
export function stepPlayer(world, p, inp, dt, fx = NULL_FX) {
  const W = world.W, H = world.H;
  let ix = inp.ix, iy = inp.iy;
  const len = Math.hypot(ix, iy) || 1; ix /= len; iy /= len;

  p.dashCd = Math.max(0, p.dashCd - dt);
  if (inp.dash && p.dashCd <= 0 && (ix || iy)) {
    p.dashing = PLAYER_BASE.dashTime; p.dashCd = p.dashCdMax; p.inv = Math.max(p.inv, p.syn.ghost ? 0.5 : 0.25); p.dashHits.clear();
    p.vx = ix * PLAYER_BASE.dashSpeed; p.vy = iy * PLAYER_BASE.dashSpeed;
    fx.sfx('dash'); fx.burst(p.x, p.y, p.color, 10, 120, 0.4, 2);
  }
  if (p.dashing > 0) {
    p.dashing -= dt;
    fx.ghost(p.x, p.y, 8, p.color, 0.3);
    if (p.syn.ghost) for (let j = world.enemies.length - 1; j >= 0; j--) { const e = world.enemies[j]; if (!e || p.dashHits.has(e.id) || dist2(e.x, e.y, p.x, p.y) > (e.r + p.r + 6) ** 2) continue; p.dashHits.add(e.id); e.hp -= 40; e.hitFlash = 0.1; fx.burst(e.x, e.y, p.color, 8, 160, 0.3, 2); if (e.hp <= 0) killEnemy(world, j, p, fx); }
  } else {
    const accel = PLAYER_BASE.accel * p.speedMul, maxSpd = PLAYER_BASE.maxSpeed * p.speedMul;
    p.vx += ix * accel * dt; p.vy += iy * accel * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > maxSpd) { p.vx = p.vx / sp * maxSpd; p.vy = p.vy / sp * maxSpd; }
    if (!ix && !iy) { p.vx *= Math.pow(0.001, dt); p.vy *= Math.pow(0.001, dt); }
  }
  p.x = clamp(p.x + p.vx * dt, p.r, W - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, H - p.r);
  p.angle = inp.angle;
  p.inv = Math.max(0, p.inv - dt);
  p.rapid = Math.max(0, p.rapid - dt);
}

// ---------- 主更新 ----------
export function update(world, dt, fx = NULL_FX) {
  if (world.scene !== 'play') return;
  const W = world.W, H = world.H;
  world.time += dt;

  for (let i = world.timers.length - 1; i >= 0; i--) if (world.timers[i].at <= world.time) world.timers.splice(i, 1)[0].fn();

  // 斷線玩家：保留一段時間後移除
  for (let i = world.players.length - 1; i >= 0; i--) {
    const p = world.players[i];
    if (p.offline && world.time - p.offlineAt > OFFLINE_GRACE) { world.players.splice(i, 1); world.pendingUpgrades.delete(p.id); }
  }

  // 玩家
  for (const p of world.players) {
    if (p.dead || p.offline) continue;
    const lfx = fx.local(p);

    if (p.downed) {
      p.downTimer -= dt;
      p.inputQueue.length = 0;
      const rescuer = activePlayers(world).find(q => dist2(q.x, q.y, p.x, p.y) < REVIVE_RANGE ** 2);
      if (rescuer) {
        p.reviveProgress += dt;
        if (p.reviveProgress >= REVIVE_TIME) { revive(world, p, fx); fx.text(rescuer.x, rescuer.y - 40, '救援成功', '#3ddc84', 16, 1.2); }
      } else p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.5);
      if (p.downTimer <= 0 && p.downed) killPlayer(world, p, fx);
      continue;
    }

    if (p.netInput) {
      const n = Math.min(2, p.inputQueue.length);
      for (let i = 0; i < n; i++) { const q = p.inputQueue.shift(); p.input = q.input; p.lastSeq = q.seq; stepPlayer(world, p, q.input, dt, fx); }
      if (n === 0) { p.inv = Math.max(0, p.inv - dt); p.rapid = Math.max(0, p.rapid - dt); p.dashCd = Math.max(0, p.dashCd - dt); }
    } else {
      stepPlayer(world, p, p.input, dt, fx);
    }
    const inp = p.input;

    // 雷射道具：按住射擊時射出貫穿光束，期間不發射一般子彈
    p.laser = Math.max(0, p.laser - dt);
    p.laserOn = p.laser > 0 && !!inp.fire;
    if (p.laserOn) {
      const x1 = p.x + Math.cos(p.angle) * 18, y1 = p.y + Math.sin(p.angle) * 18, x2 = p.x + Math.cos(p.angle) * PLAYER_BASE.laserRange, y2 = p.y + Math.sin(p.angle) * PLAYER_BASE.laserRange;
      const dps = p.damage * PLAYER_BASE.laserDps;
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (!e || segDist2(e.x, e.y, x1, y1, x2, y2) > (e.r + 6) ** 2) continue;
        e.hp -= dps * dt; e.hitFlash = 0.05;
        if (rnd() < 0.25) fx.burstDir(e.x, e.y, '#b8ffff', 2, p.angle + Math.PI, 1.2, 160, 0.2, 2);
        if (e.hp <= 0) killEnemy(world, j, p, fx);
      }
      for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && segDist2(bb.x, bb.y, x1, y1, x2, y2) < (bb.r + 6) ** 2) damageBoss(world, bb, dps * dt, bb.x, bb.y, fx);
      if (rnd() < 0.3) fx.sfx('hit');
      p.vx -= Math.cos(p.angle) * 40 * dt; p.vy -= Math.sin(p.angle) * 40 * dt;
    }
    // 射擊：依主武器分派
    p.fireCd -= dt;
    p.weaponOn = false;
    if (!p.laserOn && p.weapon === 'flame') {
      // 火焰槍：扇形持續噴射，點燃
      if (inp.fire) {
        p.weaponOn = true;
        const dps = p.damage * WEAPON_STATS.flameDps * (p.rapid > 0 ? 1.5 : 1);
        const R = WEAPON_STATS.flameRange, cone = WEAPON_STATS.flameCone + (p.spread - 1) * 0.08;
        const inCone = (x, y, r) => { const d = Math.hypot(x - p.x, y - p.y); return d < R + r && Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), p.angle)) < cone + r / Math.max(60, d); };
        for (let j = world.enemies.length - 1; j >= 0; j--) {
          const e = world.enemies[j];
          if (!e || !inCone(e.x, e.y, e.r)) continue;
          e.hp -= dps * dt; e.hitFlash = 0.05; e.burn = Math.max(e.burn || 0, 1.5); e.burnDps = p.damage * 0.6;
          if (e.hp <= 0) killEnemy(world, j, p, fx);
        }
        for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && inCone(bb.x, bb.y, bb.r)) damageBoss(world, bb, dps * dt, bb.x, bb.y, fx);
        if (rnd() < 0.9) fx.burstDir(p.x + Math.cos(p.angle) * 20, p.y + Math.sin(p.angle) * 20, rnd() < 0.5 ? '#ff8c42' : '#ffd166', 3, p.angle, cone * 0.9, 520, 0.42, 5);
        if (rnd() < 0.15) fx.noise(0.08, 0.03);
        p.vx -= Math.cos(p.angle) * 60 * dt; p.vy -= Math.sin(p.angle) * 60 * dt;
      }
    } else if (!p.laserOn && p.weapon === 'frost') {
      // 冰凍光線：窄光束，減速並累積凍結
      if (inp.fire) {
        p.weaponOn = true;
        const dps = p.damage * WEAPON_STATS.frostDps * (p.rapid > 0 ? 1.5 : 1);
        const x1 = p.x + Math.cos(p.angle) * 18, y1 = p.y + Math.sin(p.angle) * 18, x2 = p.x + Math.cos(p.angle) * WEAPON_STATS.frostRange, y2 = p.y + Math.sin(p.angle) * WEAPON_STATS.frostRange;
        for (let j = world.enemies.length - 1; j >= 0; j--) {
          const e = world.enemies[j];
          if (!e || segDist2(e.x, e.y, x1, y1, x2, y2) > (e.r + 8) ** 2) continue;
          e.hp -= dps * dt; e.hitFlash = 0.04; e.slow = 1.2;
          if (!(e.stun > 0)) { e.freeze = (e.freeze || 0) + dt; if (e.freeze >= WEAPON_STATS.frostFreezeAfter) { e.freeze = 0; e.stun = 1.2; fx.text(e.x, e.y - e.r - 8, '凍結', '#b8ffff', 14, 0.8); fx.ring(e.x, e.y, '#b8ffff', e.r, e.r + 30, 0.4, 3); } }
          if (rnd() < 0.2) fx.burst(e.x, e.y, '#b8ffff', 2, 60, 0.4, 2);
          if (e.hp <= 0) killEnemy(world, j, p, fx);
        }
        for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && segDist2(bb.x, bb.y, x1, y1, x2, y2) < (bb.r + 8) ** 2) { damageBoss(world, bb, dps * dt, bb.x, bb.y, fx); bb.slow = 0.6; }
      }
    } else if (!p.laserOn && p.weapon === 'arc') {
      // 閃電鏈：自動鎖定最近目標，連鎖跳躍
      if (inp.fire && p.fireCd <= 0) {
        p.fireCd = (p.rapid > 0 ? p.fireRate * 0.45 : p.fireRate) * WEAPON_STATS.arcRate;
        const first = nearestTarget(world, p.x, p.y, WEAPON_STATS.arcRange);
        if (first) {
          const pts = [{ x: p.x + Math.cos(p.angle) * 16, y: p.y + Math.sin(p.angle) * 16 }];
          const hit = new Set(); let cur = first;
          const dmg = p.damage * WEAPON_STATS.arcDmg;
          for (let k = 0; k < WEAPON_STATS.arcTargets + Math.floor((p.spread - 1) / 2) && cur; k++) {
            hit.add(cur); pts.push({ x: cur.x, y: cur.y });
            if (cur.tier !== undefined && cur.r <= 200 && !cur.name) { const idx = world.enemies.indexOf(cur); if (idx >= 0) { cur.hp -= dmg * Math.pow(0.85, k); cur.hitFlash = 0.08; cur.squash = 1; cur.vx *= 0.5; cur.vy *= 0.5; if (cur.hp <= 0) killEnemy(world, idx, p, fx); } }
            else damageBoss(world, cur, dmg * Math.pow(0.85, k), cur.x, cur.y, fx);
            let next = null, bd = WEAPON_STATS.arcJump ** 2;
            for (const e of world.enemies) { if (hit.has(e)) continue; const d = dist2(e.x, e.y, cur.x, cur.y); if (d < bd) { bd = d; next = e; } }
            cur = next;
          }
          fx.bolt(pts, '#9ff');
          fx.beep(1600, 0.06, 'square', 0.05, -900); fx.sfx('hit');
          lfx.crossRecoil();
        } else { p.fireCd = 0.1; }
      }
    } else if (inp.fire && p.fireCd <= 0 && !p.laserOn) {
      p.fireCd = p.rapid > 0 ? p.fireRate * 0.45 : p.fireRate;
      const n = p.spread;
      for (let i = 0; i < n; i++) {
        const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.16;
        spawnBullet(world, p, p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, p.angle + off + rand(-0.03, 0.03));
      }
      p.vx -= Math.cos(p.angle) * 30; p.vy -= Math.sin(p.angle) * 30;
      fx.muzzle(p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, p.angle);
      lfx.crossRecoil();
      fx.sfx('shoot');
    }

    // 僚機
    for (let i = 0; i < p.drones.length; i++) {
      const d = p.drones[i];
      d.a += dt * 2;
      const orbit = 42 + i * 6;
      d.x = p.x + Math.cos(d.a + i * TAU / p.drones.length) * orbit;
      d.y = p.y + Math.sin(d.a + i * TAU / p.drones.length) * orbit;
      d.cd -= dt;
      if (d.cd <= 0) {
        const t = nearestTarget(world, d.x, d.y, 420);
        if (t) { d.cd = p.syn.swarm ? 0.25 : 0.5; const db = spawnBullet(world, p, d.x, d.y, Math.atan2(t.y - d.y, t.x - d.x), 0.6); if (p.syn.swarm) db.homing = Math.max(db.homing, 3); fx.beep(1200, 0.04, 'square', 0.02, -400); }
        else d.cd = 0.15;
      }
    }
  }

  // 子彈
  for (let i = world.bullets.length - 1; i >= 0; i--) {
    const b = world.bullets[i];
    const owner = world.players.find(q => q.id === b.owner);
    if (b.homing > 0) {
      const t = nearestTarget(world, b.x, b.y, 300);
      if (t) {
        const want = Math.atan2(t.y - b.y, t.x - b.x), cur = Math.atan2(b.vy, b.vx);
        const turn = clamp(angleDiff(want, cur), -1, 1) * b.homing * 3.5 * dt;
        const sp = Math.hypot(b.vx, b.vy), na = cur + turn;
        b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.bounce > 0) {
      let hit = false;
      if (b.x < 0) { b.x = 0; b.vx = Math.abs(b.vx); hit = true; } else if (b.x > W) { b.x = W; b.vx = -Math.abs(b.vx); hit = true; }
      if (b.y < 0) { b.y = 0; b.vy = Math.abs(b.vy); hit = true; } else if (b.y > H) { b.y = H; b.vy = -Math.abs(b.vy); hit = true; }
      if (hit) {
        b.bounce--; b.life = Math.max(b.life, 0.8); fx.burst(b.x, b.y, '#fff', 3, 80, 0.2, 2);
        // 彈幕牆：反彈時分裂成兩發（分裂彈不再分裂）
        if (owner && owner.syn.wall && !b.split) { const a = Math.atan2(b.vy, b.vx), sp = Math.hypot(b.vx, b.vy); b.split = true; for (const off of [-0.45, 0.45]) world.bullets.push({ ...b, id: world.nextId++, vx: Math.cos(a + off) * sp, vy: Math.sin(a + off) * sp, hit: new Set(), split: true, dmg: b.dmg * 0.7 }); }
      }
    }
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { world.bullets.splice(i, 1); continue; }
    const hitR = 4 * b.size;
    let bossHit = null;
    for (const bb of world.bosses) if (!b.hit.has(bb) && !bb.entering && bb.dying <= 0 && dist2(b.x, b.y, bb.x, bb.y) < (bb.r + hitR) ** 2) { bossHit = bb; break; }
    const boss = bossHit;
    if (boss) {
      damageBoss(world, boss, b.dmg, b.x, b.y, fx); fx.sfx('hit');
      fx.burstDir(b.x, b.y, '#fff', 5, Math.atan2(b.vy, b.vx) + Math.PI, 0.9);
      const lfx = fx.local(owner); lfx.hitStop(0.012, true); lfx.aberrate(0.12);
      if (b.pierce > 0) { b.pierce--; b.hit.add(boss); } else { world.bullets.splice(i, 1); continue; }
    }
    let dead = false;
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const e = world.enemies[j];
      if (!e || b.hit.has(e)) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (e.r + hitR) ** 2) {
        e.hp -= b.dmg; e.hitFlash = 0.08; e.squash = 1;
        e.vx += b.vx * 0.05; e.vy += b.vy * 0.05;
        if (owner && owner.syn.shock) { e.stun = 0.3; e.vx += b.vx * 0.3; e.vy += b.vy * 0.3; }
        if (b.burn) { e.burn = 3; e.burnDps = (owner ? owner.damage : 8) * 0.6; }
        const ba = Math.atan2(b.vy, b.vx);
        fx.burstDir(b.x, b.y, e.color, 4, ba + Math.PI, 1.0);
        fx.burstDir(b.x, b.y, '#fff', 2, ba, 0.4, 160, 0.2, 2);
        if (e.maxHp >= 60) fx.text(e.x + rand(-10, 10), e.y - e.r - 6, String(Math.round(b.dmg)), '#fff', 12, 0.5);
        fx.local(owner).hitStop(0.015, true);
        fx.sfx('hit');
        if (e.hp <= 0) killEnemy(world, j, owner, fx);
        if (b.pierce > 0) { b.pierce--; b.hit.add(e); continue; }
        dead = true; break;
      }
    }
    if (dead) world.bullets.splice(i, 1);
  }

  // 敵人
  const beacon = world.beacon && world.beacon.alive ? world.beacon : null;
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.squash = Math.max(0, e.squash - dt * 9);
    if (e.burn > 0) {
      e.burn -= dt; e.hp -= e.burnDps * dt;
      if (rnd() < 0.3) fx.burstDir(e.x + rand(-e.r, e.r) * 0.6, e.y, '#ff8c42', 1, -Math.PI / 2, 0.6, 90, 0.35, 2.5);
      if (e.hp <= 0) { const owner = world.players.find(q => q.syn.ember); killEnemy(world, i, owner, fx); continue; }
    }
    if (e.slow > 0) e.slow -= dt; else if (e.freeze > 0) e.freeze = Math.max(0, e.freeze - dt);
    if (e.stun > 0) { e.stun -= dt; e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt); e.x += e.vx * dt; e.y += e.vy * dt; continue; }
    e.wobble += dt * 3; e.rot += e.rotV * dt;

    if (e.kind === 'meteor') {
      // 流星：直線穿越，撞到誰都痛（敵人、Boss、玩家、信標）
      e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt;
      if (rnd() < 0.7) fx.burstDir(e.x, e.y, rnd() < 0.5 ? '#ffb070' : '#ffd166', 2, Math.atan2(-e.vy, -e.vx), 0.5, 200, 0.5, 4);
      for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || o === e || o.ambient) continue; if (dist2(o.x, o.y, e.x, e.y) < (o.r + e.r) ** 2) { o.hp -= 200; o.hitFlash = 0.1; fx.burst(o.x, o.y, o.color, 10, 200, 0.4, 3); if (o.hp <= 0) { killEnemy(world, j, null, fx); if (j < i) i--; } else { const a = Math.atan2(o.y - e.y, o.x - e.x); o.vx += Math.cos(a) * 400; o.vy += Math.sin(a) * 400; } } }
      for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && !e.hitBoss && dist2(bb.x, bb.y, e.x, e.y) < (bb.r + e.r) ** 2) { e.hitBoss = true; damageBoss(world, bb, 120, e.x, e.y, fx); fx.shake(6); }
      if (beacon && dist2(e.x, e.y, beacon.x, beacon.y) < (e.r + beacon.r) ** 2 && !e.hitBeacon) { e.hitBeacon = true; beacon.hp -= 60; beacon.hitFlash = 0.2; fx.shake(6); }
      if (e.life <= 0 || e.x < -150 || e.x > W + 150 || e.y < -150 || e.y > H + 150) { world.enemies.splice(i, 1); continue; }
    } else if (e.kind === 'ufo') {
      // 飛碟：橫越畫面、隨機對玩家或敵人開火，時間到就飛走
      e.life -= dt; e.wobble += dt * 2;
      const dir = e.flank, leaving = e.life <= 0;
      const ty = 200 + Math.sin(e.wobble) * 90;
      e.vx += ((leaving ? dir * 420 : dir * e.speed) - e.vx) * Math.min(1, dt * 2); e.vy += ((ty - e.y) * 2 - e.vy) * Math.min(1, dt * 2);
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (!leaving && (e.x > W - 60 && dir > 0 || e.x < 60 && dir < 0)) e.flank = -dir;
      e.shootCd -= dt;
      if (e.shootCd <= 0 && !leaving) {
        e.shootCd = AMBIENT.ufoShootCd;
        const targets = [...activePlayers(world), ...world.enemies.filter(o => !o.ambient && o !== e), ...world.bosses.filter(bb => !bb.entering && bb.dying <= 0)];
        const pool = e.ally ? [...activePlayers(world)] : targets;
        const tg = pool.length ? pool[randInt(0, pool.length - 1)] : null;
        if (tg) { const a = Math.atan2(tg.y + (tg.vy || 0) * 0.3 - e.y, tg.x + (tg.vx || 0) * 0.3 - e.x); world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, life: 3, r: 5, kind: 'ufo', ufo: true }); fx.beep(1500, 0.06, 'square', 0.03, -700); }
      }
      if (leaving && (e.x < -100 || e.x > W + 100)) { world.enemies.splice(i, 1); continue; }
    } else if (e.kind === 'drift') {
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.x < e.r && e.vx < 0) e.vx = -e.vx; if (e.x > W - e.r && e.vx > 0) e.vx = -e.vx;
      if (e.y < e.r && e.vy < 0) e.vy = -e.vy; if (e.y > H - e.r && e.vy > 0) e.vy = -e.vy;
    } else {
      let tgt = beacon;
      if (!tgt) { tgt = nearestPlayer(world, e.x, e.y); if (!tgt) break; }
      const wave = world.wave;
      // 搶道具：附近有道具就改去吃，吃到有 Buff
      if (e.buffSpeed > 0) e.buffSpeed -= dt; if (e.buffRapid > 0) e.buffRapid -= dt; if (e.buffSpread > 0) e.buffSpread -= dt;
      if (wave >= DIFFICULTY.pickupHuntFromWave && (e.kind === 'chase' || e.kind === 'orbit') && !e.lunge) {
        if (!e.wantPickup && rnd() < dt * 1.2) { let best = null, bd = 260 * 260; for (const k of world.pickups) { const dd = dist2(k.x, k.y, e.x, e.y); if (dd < bd) { bd = dd; best = k; } } if (best) { e.wantPickup = best.id; e.wantT = 3; } }
        if (e.wantPickup) {
          const k = world.pickups.find(k => k.id === e.wantPickup); e.wantT -= dt;
          if (!k || e.wantT <= 0) e.wantPickup = null;
          else {
            tgt = k;
            if (dist2(k.x, k.y, e.x, e.y) < (e.r + 14) ** 2) {
              world.pickups.splice(world.pickups.indexOf(k), 1); e.wantPickup = null;
              const label = { heal: '敵人回復', shield: '敵人裝甲', spread: '敵人散射', rapid: '敵人狂暴', bomb: '敵人自爆！', laser: '敵人雷射' }[k.kind];
              fx.text(e.x, e.y - e.r - 10, label, '#ff5f7a', 14, 1.2); fx.burst(e.x, e.y, '#ffd166', 12, 160, 0.4, 3); fx.sfx('pickup');
              if (k.kind === 'heal') e.hp = Math.min(e.maxHp * 1.5, e.hp + e.maxHp * 0.6);
              else if (k.kind === 'shield') { e.hp += e.maxHp * 0.8; e.maxHp *= 1.8; e.armored = true; }
              else if (k.kind === 'spread') e.buffSpread = 12;
              else if (k.kind === 'rapid') { e.buffRapid = 10; e.buffSpeed = 10; }
              else if (k.kind === 'bomb') { for (let s = 0; s < 10; s++) { const a = s * TAU / 10; world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 2, r: 5, kind: 'shard' }); } fx.burst(e.x, e.y, '#ff3860', 30, 300, 0.5, 4); fx.shake(8); }
              else if (k.kind === 'laser') { const L = spawnLaser(world, e.x, e.y, Math.atan2(tgt.y - e.y, tgt.x - e.x), { warn: AI.laserWarn, fire: AI.laserFire, owner: e.id, color: '#b8ffff' }); e.laserId = L.id; }
            }
          }
        }
      }
      const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;
      let tx = dx / d, ty = dy / d;
      let steer = true;
      // 追擊者也會閃避（較晚、較弱）
      if (e.kind === 'chase' && wave >= DIFFICULTY.chaserDodgeFromWave && e.type !== 'tank') {
        e.dodgeCd -= dt;
        if (e.dodgeCd <= 0) for (const b of world.bullets) {
          const rx = e.x - b.x, ry = e.y - b.y, rd = Math.hypot(rx, ry);
          if (rd > 110) continue;
          const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
          if (rx * ux + ry * uy < 0) continue;
          if (Math.abs(rx * uy - ry * ux) < e.r + 8) { const s = (rx * uy - ry * ux) >= 0 ? 1 : -1; e.vx += -uy * s * 300; e.vy += ux * s * 300; e.dodgeCd = 1.5; fx.ghost(e.x, e.y, e.r * 0.8, e.color, 0.2); break; }
        }
      }

      if (e.kind === 'chase') {
        // 包抄：距離越遠，越從側面繞進來，讓一群敵人自然形成包圍
        const bend = e.flank * AI.flankTurn * clamp((d - 140) / 420, 0, 1);
        const ca = Math.cos(bend), sa = Math.sin(bend);
        tx = (dx / d) * ca - (dy / d) * sa; ty = (dx / d) * sa + (dy / d) * ca;
        if (e.type === 'dart') {
          // 飛鏢：繞飛一陣子後直線突進
          e.lungeCd -= dt;
          if (e.lunge > 0) { e.lunge -= dt; steer = false; fx.ghost(e.x, e.y, e.r * 0.8, e.color, 0.2); }
          else if (e.lungeCd <= 0 && d < 460 && d > 120) {
            e.lunge = AI.dartLungeTime; e.lungeCd = rand(AI.dartLungeCd[0], AI.dartLungeCd[1]);
            const a = Math.atan2(dy, dx), sp = e.speed * AI.dartLungeSpeed;
            e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; steer = false;
            fx.beep(900, 0.08, 'square', 0.03, -500);
          } else { tx += Math.cos(e.wobble) * 0.5; ty += Math.sin(e.wobble) * 0.5; }
        }
      } else if (e.kind === 'orbit' || e.kind === 'lancer') {
        // 風箏戰術：維持距離帶並橫向移動；太近就退、太遠就進
        const [near, far] = e.kind === 'orbit' ? AI.shooterRange : AI.lancerRange;
        const radial = d > far ? 1 : d < near ? -1 : 0;
        const side = e.flank > 0 ? 1 : -1;
        tx = (dx / d) * radial * 0.8 + (-dy / d) * side * 0.7; ty = (dy / d) * radial * 0.8 + (dx / d) * side * 0.7;
        // 閃避：偵測朝自己飛來的玩家子彈，側移躲開
        e.dodgeCd -= dt;
        if (wave >= DIFFICULTY.dodgeFromWave && e.dodgeCd <= 0) {
          for (const b of world.bullets) {
            const rx = e.x - b.x, ry = e.y - b.y, rd = Math.hypot(rx, ry);
            if (rd > AI.dodgeRange) continue;
            const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
            const along = rx * ux + ry * uy;
            if (along < 0) continue;
            const perp = Math.abs(rx * uy - ry * ux);
            if (perp < e.r + 12) {
              const s = (rx * uy - ry * ux) >= 0 ? 1 : -1;
              e.vx += -uy * s * AI.dodgePush; e.vy += ux * s * AI.dodgePush;
              e.dodgeCd = AI.dodgeCd; fx.ghost(e.x, e.y, e.r, e.color, 0.25);
              break;
            }
          }
        }
        if (e.kind === 'orbit') {
          e.shootCd -= dt;
          if (e.shootCd <= 0 && d < 560) {
            e.shootCd = rand(1.3, 2.2) * (e.buffRapid > 0 ? 0.5 : 1);
            // 預判射擊：從第 leadFromWave 波起瞄準玩家的未來位置
            let ax = dx, ay = dy;
            const lead = wave >= DIFFICULTY.leadFromWave && tgt.vx !== undefined && rnd() < 0.7;
            if (lead) { const tl = d / 320; ax = tgt.x + tgt.vx * tl - e.x; ay = tgt.y + tgt.vy * tl - e.y; }
            const a = Math.atan2(ay, ax);
            const cnt = e.elite || e.buffSpread > 0 ? 5 : randInt(1, DIFFICULTY.shooterVolley(wave));
            const spd = lead ? 340 : 270;
            for (let k = 0; k < cnt; k++) { const aa = a + (k - (cnt - 1) / 2) * (e.elite ? 0.18 : 0.22); world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(aa) * spd, vy: Math.sin(aa) * spd, life: 3, r: 5, kind: lead ? 'lead' : undefined }); }
            fx.beep(lead ? 520 : 400, 0.1, 'sine', 0.04, -200);
          }
          // 佈雷：在身後留下感應地雷
          if (wave >= DIFFICULTY.mineFromWave || world.mods.mines) {
            e.mineCd -= dt;
            if (e.mineCd <= 0) { e.mineCd = rand(AI.mineCd[0], AI.mineCd[1]); world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: 0, vy: 0, life: AI.mineLife, r: 10, kind: 'mine' }); fx.beep(200, 0.15, 'triangle', 0.05, -100); }
          }
        } else {
          // 雷射兵：鎖定 → 預警線追蹤玩家 → 鎖死 → 發射貫穿雷射
          e.laserCd -= dt;
          if (!e.laserId && e.laserCd <= 0 && d < 820) {
            const L = spawnLaser(world, e.x, e.y, Math.atan2(dy, dx), { warn: AI.laserWarn, fire: AI.laserFire, owner: e.id, color: e.color });
            e.laserId = L.id; e.laserCd = rand(AI.laserCd[0], AI.laserCd[1]);
            fx.beep(1400, 0.5, 'sine', 0.05, -900);
          }
          if (e.laserId) { steer = false; e.vx *= Math.pow(0.05, dt); e.vy *= Math.pow(0.05, dt); if (!world.lasers.some(L => L.id === e.laserId)) e.laserId = null; }
        }
      } else if (e.kind === 'flee') {
        // 懸賞目標：遠離最近的玩家、避開牆角、定期或被貼近時閃現、回頭還擊
        e.blinkFlash = Math.max(0, e.blinkFlash - dt);
        tx = -dx / d; ty = -dy / d;
        const m = 150;
        if (e.x < m) tx += 1; if (e.x > W - m) tx -= 1; if (e.y < m) ty += 1; if (e.y > H - m) ty -= 1;
        const side = e.flank > 0 ? 1 : -1; tx += (-dy / d) * side * 0.6; ty += (dx / d) * side * 0.6;
        e.blinkCd -= dt;
        if (e.blinkCd <= 0 || d < 150) {
          e.blinkCd = AI.bountyBlinkCd;
          fx.burst(e.x, e.y, e.color, 18, 220, 0.4, 3); fx.ring(e.x, e.y, e.color, e.r, e.r + 60, 0.3, 3);
          for (let k = 0; k < 12; k++) {
            const nx = rand(120, W - 120), ny = rand(120, H - 120);
            if (activePlayers(world).every(q => dist2(q.x, q.y, nx, ny) > AI.bountyBlinkDist ** 2) || k === 11) { e.x = nx; e.y = ny; break; }
          }
          e.vx = e.vy = 0; e.blinkFlash = 0.3;
          fx.burst(e.x, e.y, '#fff', 12, 180, 0.35, 2); fx.beep(1000, 0.12, 'sine', 0.05, 600);
        }
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = AI.bountyShootCd;
          const a = Math.atan2(dy, dx);
          for (let k = -1; k <= 1; k++) { const aa = a + k * 0.25; world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(aa) * 300, vy: Math.sin(aa) * 300, life: 3, r: 5, kind: 'lead' }); }
          fx.beep(600, 0.1, 'square', 0.04, -300);
        }
      }
      if (steer) {
        const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
        const spd = e.speed * (e.slow > 0 ? WEAPON_STATS.frostSlow : 1) * (e.buffSpeed > 0 ? 1.4 : 1);
        e.vx += (tx * spd - e.vx) * Math.min(1, dt * 3);
        e.vy += (ty * spd - e.vy) * Math.min(1, dt * 3);
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.kind !== 'chase') { e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r, H - e.r); }
      if (beacon && dist2(e.x, e.y, beacon.x, beacon.y) < (e.r + beacon.r) ** 2) {
        beacon.hp -= e.contact; beacon.hitFlash = 0.15;
        fx.burst(e.x, e.y, e.color, 14, 200, 0.5, 3); fx.shake(4); fx.sfx('hit');
        world.enemies.splice(i, 1);
        if (beacon.hp <= 0) { beacon.hp = 0; beacon.alive = false; fx.burst(beacon.x, beacon.y, '#4cc9f0', 60, 400, 1, 5); fx.ring(beacon.x, beacon.y, '#4cc9f0', 40, 400, 0.6, 5); fx.shake(20); fx.text(beacon.x, beacon.y - 60, '信標被摧毀！', '#ff5f7a', 30, 2); fx.sfx('explode'); }
        continue;
      }
    }
    for (let j = 0; j < world.enemies.length; j++) {
      if (i === j) continue;
      const o = world.enemies[j];
      if (!o || o.kind === 'meteor' || e.kind === 'meteor') continue;
      const ddx = e.x - o.x, ddy = e.y - o.y, dd = Math.hypot(ddx, ddy), min = e.r + o.r;
      if (dd < min && dd > 0) { e.x += ddx / dd * (min - dd) * 4 * dt; e.y += ddy / dd * (min - dd) * 4 * dt; }
    }
    for (const q of activePlayers(world)) {
      if (dist2(e.x, e.y, q.x, q.y) < (e.r + q.r) ** 2) {
        hurtPlayer(world, q, e.contact, fx);
        const a = Math.atan2(e.y - q.y, e.x - q.x);
        if (e.kind !== 'drift') { e.vx = Math.cos(a) * 300; e.vy = Math.sin(a) * 300; }
        q.vx -= Math.cos(a) * 250; q.vy -= Math.sin(a) * 250;
      }
    }
  }

  // 敵方子彈（含追蹤能量球）
  for (let i = world.enemyBullets.length - 1; i >= 0; i--) {
    const b = world.enemyBullets[i];
    if (b.homing) {
      const p = nearestPlayer(world, b.x, b.y);
      if (p) {
        const want = Math.atan2(p.y - b.y, p.x - b.x), cur = Math.atan2(b.vy, b.vx);
        const na = cur + clamp(angleDiff(want, cur), -1, 1) * b.homing * dt;
        const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.kind === 'mine') {
      // 感應地雷：玩家靠近或時間到就炸成一圈碎片
      const near = activePlayers(world).some(q => dist2(b.x, b.y, q.x, q.y) < (AI.mineTrigger + q.r) ** 2);
      if (near || b.life <= 0) {
        world.enemyBullets.splice(i, 1);
        fx.burst(b.x, b.y, '#ff8c42', 16, 220, 0.4, 3); fx.ring(b.x, b.y, '#ff8c42', 8, 70, 0.3, 3); fx.noise(0.12, 0.08);
        for (let k = 0; k < AI.mineShards; k++) { const a = k * TAU / AI.mineShards + rand(-0.1, 0.1); world.enemyBullets.push({ id: world.nextId++, x: b.x, y: b.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, life: 1.6, r: 4, kind: 'shard' }); }
        continue;
      }
    }
    if (b.life <= 0 || b.y > H + 40 || b.y < -60 || b.x < -60 || b.x > W + 60) { world.enemyBullets.splice(i, 1); continue; }
    if (beacon && b.kind !== 'mine' && dist2(b.x, b.y, beacon.x, beacon.y) < (b.r + beacon.r) ** 2) {
      beacon.hp -= 10; beacon.hitFlash = 0.15; fx.burst(b.x, b.y, '#4cc9f0', 4, 120, 0.3, 2);
      world.enemyBullets.splice(i, 1);
      if (beacon.hp <= 0) { beacon.hp = 0; beacon.alive = false; fx.burst(beacon.x, beacon.y, '#4cc9f0', 60, 400, 1, 5); fx.ring(beacon.x, beacon.y, '#4cc9f0', 40, 400, 0.6, 5); fx.shake(20); fx.text(beacon.x, beacon.y - 60, beacon.kind === 'convoy' ? '運輸艦被擊沉！' : '信標被摧毀！', '#ff5f7a', 30, 2); fx.sfx('explode'); }
      continue;
    }
    if (b.ufo) {
      let used = false;
      for (let j = world.enemies.length - 1; j >= 0 && !used; j--) { const o = world.enemies[j]; if (!o || o.ambient) continue; if (dist2(b.x, b.y, o.x, o.y) < (b.r + o.r) ** 2) { o.hp -= 20; o.hitFlash = 0.08; fx.burst(b.x, b.y, o.color, 4, 120, 0.3, 2); if (o.hp <= 0) killEnemy(world, j, null, fx); used = true; } }
      for (const bb of world.bosses) if (!used && !bb.entering && bb.dying <= 0 && dist2(b.x, b.y, bb.x, bb.y) < (b.r + bb.r) ** 2) { damageBoss(world, bb, 20, b.x, b.y, fx); used = true; }
      if (used) { world.enemyBullets.splice(i, 1); continue; }
    }
    let hitP = false;
    for (const q of activePlayers(world)) {
      const dd = dist2(b.x, b.y, q.x, q.y);
      if (dd < (b.r + q.r) ** 2) { hurtPlayer(world, q, b.boss ? 18 : b.kind === 'shard' || b.kind === 'ufo' ? 10 : 15, fx); world.enemyBullets.splice(i, 1); hitP = true; break; }
      // 擦彈：子彈貼身飛過沒打中 → 加分
      if (!b.grazed && b.kind !== 'mine' && dd < (b.r + q.r + 16) ** 2) { b.grazed = true; world.graze++; const gain = GRAZE_SCORE * (1 + Math.floor(world.combo / 10)); world.score += gain; fx.local(q).text(q.x, q.y + 24, `擦彈 +${gain}`, '#b8ffff', 11, 0.6); }
    }
    if (hitP) continue;
  }

  // 雷射：預警（跟隨發射者、前 70% 時間追蹤玩家）→ 發射（線段判定、Boss 版會掃射）
  for (let i = world.lasers.length - 1; i >= 0; i--) {
    const L = world.lasers[i];
    if (L.boss) { const bb = world.bosses.find(x => x.id === L.bossId); if (!bb || bb.dying > 0) { world.lasers.splice(i, 1); continue; } L.x = bb.x; L.y = bb.y; }
    else if (L.owner !== null) {
      const e = world.enemies.find(o => o.id === L.owner);
      if (!e) { if (L.phase === 'warn') { world.lasers.splice(i, 1); continue; } }
      else { L.x = e.x; L.y = e.y; }
    }
    if (L.phase === 'warn' && L.track && L.t > L.warn * 0.3) {
      const p = nearestPlayer(world, L.x, L.y);
      if (p) { const want = Math.atan2(p.y - L.y, p.x - L.x); L.angle += clamp(angleDiff(want, L.angle), -1, 1) * 2.5 * dt; }
    }
    L.t -= dt;
    if (L.phase === 'warn') {
      if (L.t <= 0) { L.phase = 'fire'; L.t = L.fire; fx.shake(L.boss ? 10 : 4); fx.noise(0.15, 0.12); fx.beep(L.boss ? 60 : 120, L.fire, 'sawtooth', 0.08, -30); }
      continue;
    }
    L.angle += L.sweep * dt;
    const x2 = L.x + Math.cos(L.angle) * L.len, y2 = L.y + Math.sin(L.angle) * L.len;
    for (const q of activePlayers(world)) {
      if (segDist2(q.x, q.y, L.x, L.y, x2, y2) < (q.r + L.w * 0.5) ** 2) { hurtPlayer(world, q, L.dmg, fx); q.vx += Math.cos(L.angle + Math.PI / 2) * 120 * (rnd() < 0.5 ? 1 : -1); }
    }
    if (beacon && segDist2(beacon.x, beacon.y, L.x, L.y, x2, y2) < (beacon.r + L.w * 0.5) ** 2) { beacon.hp -= 30 * dt; beacon.hitFlash = 0.1; }
    if (rnd() < 0.5) { const t = rand(0.1, 1); fx.burst(L.x + (x2 - L.x) * t, L.y + (y2 - L.y) * t, L.color, 1, 60, 0.25, 2); }
    if (L.t <= 0) world.lasers.splice(i, 1);
  }

  // 道具
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const k = world.pickups[i];
    k.life -= dt; k.t += dt;
    if (k.life <= 0) { world.pickups.splice(i, 1); continue; }
    const p = nearestPlayer(world, k.x, k.y);
    if (!p) continue;
    const d = Math.hypot(p.x - k.x, p.y - k.y) || 1;
    if (d < p.magnetR) { k.x += (p.x - k.x) / d * 260 * dt; k.y += (p.y - k.y) / d * 260 * dt; }
    if (d < p.r + 14) { applyPickup(world, p, k.kind, fx); world.pickups.splice(i, 1); }
  }

  if (world.comboTimer > 0) { world.comboTimer -= dt; if (world.comboTimer <= 0) world.combo = 0; }

  // Boss / 特殊波次
  if (world.bossWarn > 0) { world.bossWarn -= dt; if (world.bossWarn <= 0) spawnBoss(world, fx); }
  for (let i = world.bosses.length - 1; i >= 0; i--) if (world.bosses[i]) updateBoss(world, world.bosses[i], dt, fx);
  // 太空環境事件：流星 / 飛碟
  if (world.wave >= AMBIENT.fromWave && world.bossWarn <= 0 && !world.mods.daily) { world.ambientCd -= dt; if (world.ambientCd <= 0) { world.ambientCd = rand(AMBIENT.cd[0], AMBIENT.cd[1]); spawnAmbient(world, rnd() < 0.7 ? 'meteor' : 'ufo', fx); } }
  updateMode(world, dt, fx);

  // 波次結束 → 升級（每 UPGRADE_EVERY_WAVES 波或 Boss 後）→ 倒數下一波
  const cleared = waveEnemies(world).length === 0 && world.bosses.length === 0 && world.bossWarn <= 0 && !world.waveMode && world.timers.length === 0;
  if (cleared && world.scene === 'play') {
    if (world.wave > 0 && !world.upgradeOffered) {
      world.upgradeOffered = true;
      if (world.upgradeDue || world.wave % UPGRADE_EVERY_WAVES === 0) { world.upgradeDue = false; offerUpgrades(world, fx); return; }
    }
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) { nextWave(world, fx); world.waveTimer = 2.5; }
  }
}
