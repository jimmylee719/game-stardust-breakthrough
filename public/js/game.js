// 遊戲邏輯核心（權威模擬）。
// 規則：不碰 DOM、Canvas、Audio、window、setTimeout。所有視聽回饋透過 fx 介面通知外界。
// 這個模組同時在瀏覽器（單機）與伺服器（多人）執行。
import { TAU, rand, randInt, rnd, clamp, dist2, angleDiff } from '../../shared/math.js';
import {
  SKILLS, skillById, ENERGY,
  WORLD, PLAYER_BASE, PLAYER_COLORS, ENEMY_TYPES, DIFFICULTY, AI, BOSS_NAMES, BOSS_EVERY, BOSS_RADIUS, BOSS_KINDS, BOSS_DOUBLE_FROM_WAVE, BOSS_DOUBLE_CHANCE, AMBIENT, PERFECT_WAVE_BONUS, GRAZE_SCORE, ENEMY_BLINK_FROM_WAVE,
  UPGRADES, UPGRADE_EVERY_WAVES, WAVE_MODES, MODE_SCHEDULE, MODE_CHANCE_AFTER, MODE_CHANCE,
  DOWNED_TIME, REVIVE_RANGE, REVIVE_TIME, OFFLINE_GRACE, sanitizeName, applyPerks, applyShip, activeSynergies, SYNERGIES, WIN_WAVE, WIN_BONUS, WEAPON_STATS,
  ARENAS, arenaById, affinity, WEAPON_ELEMENT, AFFIXES, EVENTS, EVENT_FROM_WAVE, EVENT_CD, EVOLUTIONS, evolutionFor, ELEMENTS,
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
    zones: [], safeZones: [], doom: null,   // 生化毒區、母艦毀滅攻擊的安全區與倒數
    waveMode: null, modeTimer: 0, modeSpawnCd: 0, beacon: null, lastMode: null,
    chrono: 0, waveTheme: null, arena: 'space', hazardCd: 6, wells: [], flare: null, blizzard: 0, wind: null, drag: 1,   // 場地與其危險（updateArena）
    event: null, eventCd: 30, crate: null, hole: null, eclipse: 0, dustBonus: 0, lastEvent: null,   // 隨機事件
    stats: freshStats(),
    pendingUpgrades: new Map(),
    timers: [],
    nextId: 1,
  };
}

/** 一局的統計（死亡畫面、成就、任務都靠這個） */
export function freshStats() {
  return { dmgDealt: 0, dmgTaken: 0, kills: {}, elites: 0, bosses: 0, blinks: 0, dashes: 0, pickups: 0, grazes: 0, maxCombo: 0, swings: 0, parries: 0,
    noFireT: 0, bestNoFire: 0, noHitT: 0, bestNoHit: 0, stillT: 0, bestStill: 0, killedBy: null, events: [], evolved: null, upgrades: 0, crateHp: -1, bossesSeen: [], doubleBoss: false, doomHit: false, doomSurvived: false, kamiKills: 0, recentPickups: [], hoard: 0, sniperKills: 0, weaponKills: {}, timeAlive: 0 };
}
export function addPlayer(world, { id, name, local = false, token = null, acctId = null, perks = null, ship = 'falcon', weapon = 'blaster', skin = 'classic', skill = 'swarm' }) {
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
    weapon, weaponOn: false, skin, blinkCd: 0, blinkCdMax: PLAYER_BASE.blinkCd, blinkFlash: 0, toxicT: 0,
    flags: {}, emp: 0, frozen: 0, turrets: [], evolved: null, lastHitBy: null, swingT: 0, swingCd: 0, laserRamp: 0, stormCd: 0, adaptMul: 1,
    skill, energy: 0, overdrive: 0, novaT: 0, skillHeld: false,
  };
  p.baseWeapon = weapon;
  applyShip(p, ship);
  if (p.flags.meleeOnly) p.weapon = 'blade';
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
export function startRun(world, { startWave = 0, mods = null, daily = false, arena = null } = {}) {
  const roster = world.players.map(p => ({ id: p.id, name: p.name, local: p.local, token: p.token, acctId: p.acctId, perks: p.perks, ship: p.ship, weapon: p.flags?.meleeOnly ? p.baseWeapon || p.weapon : p.weapon, skin: p.skin, skill: p.skill }));
  const fresh = createWorld();
  Object.assign(world, fresh, { players: [] });
  world.arena = arenaById(arena || world.arena).id;
  if (world.arena === 'abyss') world.drag = 0.85;
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

function schedule(world, delay, fn, spawn = false) { world.timers.push({ at: world.time + delay, fn, spawn }); }
const spawnPending = world => world.timers.some(t => t.spawn);
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
/** AI 威脅等級：波數 + 每多一位玩家再加幾波。所有「第 N 波起」的 AI 門檻都用這個 */
function threat(world) { return world.wave + (nPlayers(world) - 1) * DIFFICULTY.perPlayer.threat; }
/** 敵人攻擊力倍率：每波遞增、多人再加成 */
function dmgMul(world) { return Math.min(DIFFICULTY.dmgCap, (1 + world.wave * DIFFICULTY.dmgPerWave) * (1 + (nPlayers(world) - 1) * DIFFICULTY.perPlayer.dmg)); }
const ENEMY_LABEL = { lead: '射手', shard: '碎片', ufo: '飛碟', mine: '地雷', shell: '重砲', acid: '酸液', snipe: '狙擊手', mortar: '迫擊砲', hex: '咒球', spore: '孢子', ice: '冰刺', void: '虛空球', plasma: '脈衝體' };
function enemyLabel(e) { return e.name || (ENEMY_TYPES[e.type] && ENEMY_TYPES[e.type].name) || e.type; }
/**
 * 對敵人造成傷害的唯一入口（子彈 / 光束 / 光刃 / 爆炸 / 僚機都走這裡）。
 * 處理：屬性相剋、相位免疫、精英護盾、護盾兵正面盾、統計。回傳實際造成的傷害；呼叫端再檢查 hp <= 0 → killEnemy。
 */
function hitEnemy(world, e, dmg, opts = {}, fx = NULL_FX) {
  if (!e || e.hp <= 0) return 0;
  if (e.phaseT > 0) { if (rnd() < 0.3) fx.text(e.x, e.y - e.r - 6, '相位', '#c77dff', 11, 0.4); return 0; }
  const by = opts.by || null;
  if (by && by.overdrive > 0) dmg *= 1.5;
  // 護盾兵：正面 ±60° 擋掉
  if (e.kind === 'warden' && opts.x !== undefined && e.shieldUp) {
    const facing = Math.atan2(e.fy ?? 0, e.fx ?? 1), fromA = Math.atan2(opts.y - e.y, opts.x - e.x);
    if (Math.abs(angleDiff(fromA, facing)) < 1.05) { fx.burst(opts.x, opts.y, '#4cc9f0', 4, 120, 0.25, 2); if (rnd() < 0.25) fx.text(e.x, e.y - e.r - 8, '盾擋', '#4cc9f0', 11, 0.4); fx.beep(500, 0.05, 'triangle', 0.03, -200); return 0; }
  }
  let mul = 1;
  const el = opts.element || (by ? WEAPON_ELEMENT[by.weapon] : null);
  if (el && e.element) { mul = affinity(e.element, el); if (mul !== 1 && !e.affTold) { e.affTold = true; fx.text(e.x, e.y - e.r - 12, mul > 1 ? `效果拔群 ×${mul}` : `抗性 ×${mul}`, mul > 1 ? '#ffd166' : '#8890a0', 12, 0.9); } }
  if (e.armored) mul *= 0.7;
  let real = dmg * mul;
  if (e.shieldHp > 0) { const a = Math.min(e.shieldHp, real); e.shieldHp -= a; real -= a; fx.burst(e.x, e.y, '#4cc9f0', 3, 100, 0.25, 2); if (e.shieldHp <= 0) fx.ring(e.x, e.y, '#4cc9f0', e.r, e.r + 30, 0.3, 3); }
  e.hp -= real; e.hitFlash = 0.08;
  if (e.hp <= 0 && by) e.killer = by;
  world.stats.dmgDealt += real;
  if (by && el && world.stats.weaponKills) e.lastWeapon = by.weapon;
  return real;
}

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
  const hpMul = (1 + w * DIFFICULTY.hpPerWave) * (1 + (n - 1) * DIFFICULTY.perPlayer.hp) * (elite ? 3 : 1) * (world.mods.swarm ? 0.75 : 1);
  const A = arenaById(world.arena);
  const element = opts.element || t.element || A.elements[randInt(0, A.elements.length - 1)];
  const spdMod = (world.mods.fast ? 1.3 : 1) * (element === 'ice' ? 1.05 : 1);
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
    element, affixes: [], shieldHp: 0, shieldCd: 6, phaseT: 0, phaseCd: 3, atkCd: rand(1.5, 3), fx: 1, fy: 0, shieldUp: t.kind === 'warden', hunter: !!opts.hunter,
  };
  if (element !== 'neutral') e.color = ELEMENTS[element].color;
  if (elite) {
    const keys = Object.keys(AFFIXES), k = w >= DIFFICULTY.affixFromWave + 4 && rnd() < 0.5 ? 2 : 1;
    while (e.affixes.length < (opts.affixes ?? k)) { const a = keys[randInt(0, keys.length - 1)]; if (!e.affixes.includes(a)) e.affixes.push(a); }
    if (e.affixes.includes('hasted')) e.speed *= 1.4;
    if (e.affixes.includes('shielded')) e.shieldHp = 40;
  }
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
  const e = { id: world.nextId++, type: 'ufo', kind: 'ufo', ambient: true, ally: !!opts.ally, fleet: !!opts.fleet, x: fromLeft ? -60 : W + 60, y: rand(120, 320), vx: 0, vy: 0, r: 26, hp, maxHp: hp, speed: 160, color: opts.ally ? '#f15bb5' : '#90f1a8', score: AMBIENT.ufoScore, contact: AMBIENT.ufoDmg, shootCd: 1, wobble: rand(0, TAU), hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: fromLeft ? 1 : -1, lunge: 0, lungeCd: 9, dodgeCd: 0, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, life: AMBIENT.ufoLife };
  world.enemies.push(e);
  if (!opts.fleet) { fx.text(e.x < 0 ? 120 : W - 120, e.y, opts.ally ? '母艦召喚飛碟' : '不明飛行物', e.color, 16, 1.4); fx.beep(900, 0.4, 'sine', 0.05, 400); }
  return e;
}
function waveEnemies(world) { return world.enemies.filter(e => !e.ambient); }
/** 敵人閃現：子彈快打到時瞬移到側面（有冷卻） */
function enemyBlink(world, e, fx, dt = 1 / 60) {
  e.blinkCd2 = (e.blinkCd2 ?? rand(0, 2)) - dt;
  if (e.blinkCd2 > 0) return;
  for (const b of world.bullets) {
    const rx = e.x - b.x, ry = e.y - b.y, rd = Math.hypot(rx, ry);
    if (rd > 120) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
    if (rx * ux + ry * uy < 0 || Math.abs(rx * uy - ry * ux) > e.r + 10) continue;
    const s = (rx * uy - ry * ux) >= 0 ? 1 : -1;
    fx.burst(e.x, e.y, e.color, 10, 160, 0.3, 2);
    e.x = clamp(e.x - uy * s * 170, e.r, world.W - e.r); e.y = clamp(e.y + ux * s * 170, e.r, world.H - e.r);
    e.vx = 0; e.vy = 0; e.blinkCd2 = rand(3, 5); e.blinkFlash = 0.3;
    fx.burst(e.x, e.y, '#fff', 8, 140, 0.3, 2); fx.beep(1300, 0.08, 'sine', 0.03, 500);
    return;
  }
}
/** 直接扣血（毒區、毀滅攻擊）：無視護盾與無敵，但會走倒地 / 陣亡流程 */
function drainPlayer(world, p, amount, fx, by = '毒區') {
  if (p.dead || p.downed || p.offline || amount <= 0) return;
  p.hp -= amount; world.waveDamaged = true; world.stats.dmgTaken += amount; world.stats.noHitT = 0; p.lastHitBy = by;
  if (p.hp <= 0) { p.hp = 0; world.stats.killedBy = by; playerDown(world, p, fx); }
}
function playerDown(world, p, fx) {
  const others = world.players.filter(q => q !== p && !q.dead && !q.offline);
  if (others.length === 0) killPlayer(world, p, fx);
  else {
    p.downed = true; p.downTimer = DOWNED_TIME; p.reviveProgress = 0; p.vx = p.vy = 0;
    fx.burst(p.x, p.y, p.color, 30, 250, 0.8, 3);
    fx.text(p.x, p.y - 40, `${p.name} 倒地！靠近救援`, '#ff5f7a', 20, 2.5);
    checkGameOver(world, fx);
  }
}
/** 飛碟軍團：母艦帶隊 + 3–5 艘護衛，母艦會發動毀滅攻擊（只有安全區裡安全） */
function spawnFleet(world, fx) {
  const W = world.W, w = world.wave, n = nPlayers(world);
  const hp = AMBIENT.mothershipHp * (1 + w * 0.15) * (1 + (n - 1) * 0.5);
  const m = { id: world.nextId++, type: 'mothership', kind: 'mothership', ambient: true, x: W / 2, y: -140, vx: 0, vy: 0, r: 72, hp, maxHp: hp, speed: 60, color: '#90f1a8', score: AMBIENT.mothershipScore, contact: 25, shootCd: 2, toxicCd: 5, doomCd: 6, dooms: 0, wobble: 0, hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: 1, lunge: 0, lungeCd: 9, dodgeCd: 9, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, life: AMBIENT.mothershipLife };
  world.enemies.push(m);
  const k = randInt(3, 5);
  for (let i = 0; i < k; i++) schedule(world, 0.4 + i * 0.5, () => { const u = spawnAmbient(world, 'ufo', fx, { fleet: true }); u.life = AMBIENT.mothershipLife - 2; });
  fx.text(W / 2, world.H / 2 - 120, '⚠ 飛碟軍團接近 ⚠', '#90f1a8', 34, 3); fx.shake(6);
  [0, 0.6, 1.2].forEach(d => schedule(world, d, () => fx.beep(160, 0.4, 'sawtooth', 0.1, -60)));
  return m;
}
/** 母艦毀滅攻擊：先標出安全區倒數，時間到不在安全區的玩家血量只剩 1 */
function startDoom(world, m, fx) {
  const W = world.W, H = world.H, zones = [];
  const k = randInt(AMBIENT.safeZones[0], AMBIENT.safeZones[1]);
  for (let i = 0; i < k * 8 && zones.length < k; i++) {
    const x = rand(140, W - 140), y = rand(140, H - 140);
    if (zones.every(z => dist2(z.x, z.y, x, y) > 260 * 260)) zones.push({ id: world.nextId++, x, y, r: AMBIENT.safeR });
  }
  world.safeZones = zones; world.doom = { t: AMBIENT.doomWarn, warn: AMBIENT.doomWarn, by: m.id };
  fx.text(W / 2, H / 2 - 150, `母艦充能毀滅攻擊！進入安全區（${zones.length} 個）`, '#ff3860', 30, 2.5);
  fx.beep(70, 1.5, 'sawtooth', 0.12, 90); fx.shake(4);
}
function fireDoom(world, fx) {
  const zones = world.safeZones;
  fx.flash(1); fx.shake(30); fx.aberrate(1); fx.noise(0.5, 0.35); fx.ring(world.W / 2, -100, '#90f1a8', 100, 2200, 1.2, 12);
  for (const q of activePlayers(world)) {
    const safe = zones.some(z => dist2(q.x, q.y, z.x, z.y) < (z.r - q.r * 0.5) ** 2);
    if (safe) { fx.text(q.x, q.y - 40, '安全區內，平安度過', '#90f1a8', 16, 1.5); continue; }
    if (q.hp > 1) { q.hp = 1; world.waveDamaged = true; fx.text(q.x, q.y - 40, '被毀滅波擊中！只剩 1 點生命', '#ff3860', 18, 2.5); fx.burst(q.x, q.y, '#ff3860', 30, 300, 0.6, 4); }
  }
  // 波及所有一般敵人，Boss 也受傷
  for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (o && !o.ambient) { o.hp = 0; killEnemy(world, j, null, fx); } }
  for (const bb of world.bosses) damageBoss(world, bb, 200, bb.x, bb.y, fx);
  world.safeZones = []; world.doom = null;
}
/** 小隊主題：這一波偏好的敵種（第 3 波起 50% 機率有主題） */
const SQUADS = { kamikaze: ['自爆蟲潮', 3], sniper: ['狙擊陣地', 6], warden: ['盾牆推進', 4], mortar: ['砲擊陣列', 5], shooter: ['火力壓制', 2], dart: ['飛鏢風暴', 2], hexer: ['咒術集會', 7], lancer: ['雷射封鎖線', 5] };
function pickType(world) {
  const w = threat(world), roll = rnd(), A = arenaById(world.arena);
  if (w >= 2 && rnd() < 0.12 + Math.min(0.13, w * 0.01)) return A.unique;
  if (world.waveTheme && rnd() < 0.45) return world.waveTheme;
  const lancerFrom = world.mods.lancers ? 2 : DIFFICULTY.lancerFromWave;
  if (world.mods.lancers && roll < 0.2) return 'lancer';
  let type = 'drifter';
  if (w >= 2 && roll < 0.20) type = 'dart';
  else if (w >= 2 && roll < 0.38) type = 'shooter';
  else if (w >= 3 && roll < 0.46) type = 'kamikaze';
  else if (w >= 4 && roll < 0.54) type = 'splitter';
  else if (w >= 4 && roll < 0.61) type = 'warden';
  else if (w >= 5 && roll < 0.67) type = 'mortar';
  else if (w >= lancerFrom && roll < 0.73) type = 'lancer';
  else if (w >= 6 && roll < 0.79) type = 'sniper';
  else if (w >= 7 && roll < 0.85) type = 'hexer';
  else if (w >= 5 && roll < 0.90) type = 'tank';
  return type;
}
function spawnWithElite(world, type, x, y) {
  const elite = world.wave >= DIFFICULTY.eliteFromWave && rnd() < DIFFICULTY.eliteChance(threat(world)) * (world.mods.elite ? 3 : 1);
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
  if (world.stats.doomHit && activePlayers(world).length) world.stats.doomSurvived = true;
  world.stats.doomHit = false;
  world.waveDamaged = false;
  world.wave++;
  world.upgradeOffered = false;
  world.waveMode = null; world.beacon = null; world.modeTimer = 0; world.waveTheme = null;
  if (world.wave % BOSS_EVERY === 0) { startBossWave(world, fx); return; }
  const mode = chooseMode(world);
  if (mode) { startMode(world, mode, fx); return; }
  fx.sfx('wave');
  fx.text(world.W / 2, world.H / 2 - 60, `第 ${world.wave} 波`, '#fff', 36, 1.6);
  const n = Math.min(80, Math.round((DIFFICULTY.baseCount + world.wave * DIFFICULTY.countPerWave) * (1 + (nPlayers(world) - 1) * DIFFICULTY.perPlayer.count) * (world.mods.swarm ? 1.5 : 1)));
  // 小隊主題
  world.waveTheme = null;
  if (world.wave >= 3 && rnd() < 0.5) { const th = threat(world), opts = Object.entries(SQUADS).filter(([, v]) => th >= v[1]); if (opts.length) { const [k, v] = opts[randInt(0, opts.length - 1)]; world.waveTheme = k; fx.text(world.W / 2, world.H / 2 + 10, `敵方小隊：${v[0]}`, '#ff8c9c', 18, 1.8); } }
  // 夾擊隊形：從兩個相對的邊同時進場，逼玩家兩面應戰
  const pincer = world.wave >= DIFFICULTY.pincerFromWave && rnd() < 0.5 ? randInt(0, 1) : -1;
  if (pincer >= 0) fx.text(world.W / 2, world.H / 2 - 20, '偵測到夾擊隊形', '#ff8c42', 18, 1.6);
  for (let i = 0; i < n; i++) {
    const type = pickType(world);
    schedule(world, i * 0.3, () => { if (pincer < 0) spawnWithElite(world, type); else { const s = edgeSpawn(world, pincer + (i % 2) * 2); spawnWithElite(world, type, s.x, s.y); } }, true);
  }
  if (world.wave % 3 === 0) schedule(world, 0.8, () => spawnEnemy(world, 'tank'), true);
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
    for (let i = 0; i < count; i++) schedule(world, i * 0.5, () => spawnEnemy(world, 'rock', undefined, undefined, 1, { tier: 2 }), true);
    for (let i = 0; i < 2; i++) schedule(world, 3 + i * 2, () => spawnEnemy(world, 'dart'), true);
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
    for (let i = 0; i < 3; i++) schedule(world, 1 + i * 1.2, () => spawnEnemy(world, i === 1 ? 'shooter' : 'drifter'), true);
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
    if (waveEnemies(world).length === 0 && !spawnPending(world)) finishMode(world, fx, true);
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
    if (!alive && !spawnPending(world)) finishMode(world, fx, true);
    else if (world.modeTimer <= 0) { fx.text(world.W / 2, world.H / 2 - 80, '懸賞目標逃脫', '#ff5f7a', 26, 2); finishMode(world, fx, false); }
  }
}
function finishMode(world, fx, success) {
  const mode = world.waveMode;
  world.waveMode = null;
  for (const e of world.enemies) fx.burst(e.x, e.y, e.color, 6, 120, 0.4, 2);
  world.enemies.length = 0; world.enemyBullets.length = 0; world.timers.length = 0;
  world.doom = null; world.safeZones.length = 0;
  if (success) {
    const bonus = (mode === 'defend' || mode === 'convoy') ? Math.round(300 * (world.beacon.hp / world.beacon.maxHp) + 100 * world.wave) : mode === 'hunt' ? 400 + 100 * world.wave : 150 * world.wave;
    world.score += bonus;
    fx.text(world.W / 2, world.H / 2 - 40, `${WAVE_MODES[mode].name} 成功 +${bonus}`, '#ffd166', 32, 2);
    const kinds = ['heal', 'shield', 'spread', 'rapid'];
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
  else if (double) { world.bosses.push(makeBoss(world, kinds[randInt(0, kinds.length - 1)], tier, -1, 0.65)); world.bosses.push(makeBoss(world, kinds[randInt(0, kinds.length - 1)], tier, 1, 0.65)); fx.text(world.W / 2, world.H / 2 - 80, '偵測到兩艘巨型敵艦！', '#ff3860', 30, 2.2); world.stats.doublePending = true; }
  else world.bosses.push(makeBoss(world, world.wave === BOSS_EVERY ? 'annihilator' : kinds[randInt(0, kinds.length - 1)], tier, 0, 1));
  for (const b of world.bosses) if (!world.stats.bossesSeen.includes(b.kind)) world.stats.bossesSeen.push(b.kind);
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
      hurtPlayer(world, q, 35, fx, { x: b.x, y: b.y, by: b.name + ' 撞擊' });
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
  for (const q of activePlayers(world)) q.energy = Math.min(ENERGY.max, (q.energy || 0) + ENERGY.perBoss);
  const gain = 500 * b.tier;
  world.score += gain; world.combo += 10; world.comboTimer = 3;
  fx.text(b.x, b.y - 20, `${b.name} 擊破 +${gain}`, '#ffd166', 34, 2);
  fx.burst(b.x, b.y, '#fff', 100, 600, 1.2, 7); fx.burst(b.x, b.y, b.color, 100, 500, 1.2, 6);
  fx.ring(b.x, b.y, '#fff', b.r, Math.max(world.W, world.H), 0.9, 8); fx.ring(b.x, b.y, b.color, b.r, Math.max(world.W, world.H) * 0.6, 0.7, 5);
  fx.shake(24); fx.flash(0.6); fx.hitStop(0.25); fx.aberrate(1); fx.zoom(1); fx.crossPunch();
  const kinds = ['heal', 'shield', 'spread', 'rapid'];
  for (let i = 0; i < 3; i++) world.pickups.push({ id: world.nextId++, x: b.x + rand(-80, 80), y: b.y + rand(-50, 50), kind: kinds[randInt(0, 3)], life: 15, t: 0 });
  world.bosses.splice(world.bosses.indexOf(b), 1);
  world.stats.bosses++;
  if (world.bosses.length) return;   // 還有另一隻：獎勵等全部擊破
  if (world.stats.doublePending) { world.stats.doubleBoss = true; world.stats.doublePending = false; }
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
  const spd = PLAYER_BASE.bulletSpeed * (world.arena === 'abyss' ? 0.75 : 1);
  world.bullets.push({
    id: world.nextId++, owner: p.id, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
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
  if (kind) world.pickups.push({ id: world.nextId++, x, y, kind, life: 10, t: 0 });
}
function applyPickup(world, p, kind, fx) {
  fx.sfx('pickup');
  world.stats.pickups++; world.stats.recentPickups.push(world.time); world.stats.recentPickups = world.stats.recentPickups.filter(t => world.time - t < 10); world.stats.hoard = Math.max(world.stats.hoard, world.stats.recentPickups.length);
  const labels = { heal: '+HP', spread: '散射', rapid: '連射', shield: '護盾', bomb: '炸彈', laser: '雷射' };
  const colors = { heal: '#3ddc84', spread: '#ffd166', rapid: '#ff8c42', shield: '#4cc9f0', bomb: '#ff3860', laser: '#b8ffff' };
  fx.text(p.x, p.y - 30, labels[kind], colors[kind], 18);
  switch (kind) {
    case 'heal': p.hp = Math.min(p.maxHp, p.hp + 30); break;
    case 'spread': p.spread = Math.min(5, p.spread + 1); break;
    case 'rapid': p.rapid = 8; break;
    case 'shield': if (p.flags.noShield) { p.hp = Math.min(p.maxHp, p.hp + 15); fx.text(p.x, p.y - 44, '這台機體用不了護盾 → +15 HP', '#4cc9f0', 12, 1); } else p.shield = Math.min(3, p.shield + 1); break;
    case 'laser': p.laser = PLAYER_BASE.laserTime; break;
    case 'dust': world.dustBonus += 15; fx.text(p.x, p.y - 44, '星塵 +15', '#fff3c4', 13, 1); break;
    case 'bomb':
      fx.shake(14); fx.flash(0.6); fx.slowmo(0.6);   // 約 0.6 秒的震動與慢動作（以真實時間計）
      for (const o of world.enemies.slice()) { const i = world.enemies.indexOf(o); if (i < 0) continue; o.hp -= 60; if (o.hp <= 0) killEnemy(world, i, p, fx); }
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
  // 發射者被擊落：它射出的子彈一起消散（含地雷）
  let gone = 0;
  world.enemyBullets = world.enemyBullets.filter(b => { if (b.owner !== e.id) return true; if (gone++ < 12) fx.burst(b.x, b.y, '#fff', 2, 60, 0.25, 2); return false; });
  world.combo++; world.comboTimer = 2.2; world.stats.maxCombo = Math.max(world.stats.maxCombo, world.combo);
  const mult = 1 + Math.floor(world.combo / 5) * 0.5;
  const gain = Math.round(e.score * mult) + (e.hunter ? 400 : 0);
  world.score += gain;
  world.stats.kills[e.type] = (world.stats.kills[e.type] || 0) + 1; if (e.elite) world.stats.elites++;
  if (killer) { const wk = e.lastWeapon || killer.weapon; world.stats.weaponKills[wk] = (world.stats.weaponKills[wk] || 0) + 1; if (killer.flags.killResetBlink) killer.blinkCd = 0; if (e.kind === 'sniper' && e.aimT > 0) world.stats.sniperKills++; }
  if (e.hunter) { fx.text(e.x, e.y - 50, '追獵者殲滅 +400', '#ffd166', 26, 2); fx.shake(10); }
  onEnemyDeath(world, e, killer, fx);
  if (killer) { killer.energy = Math.min(ENERGY.max, (killer.energy || 0) + ENERGY.perKill + (e.elite ? ENERGY.perElite : 0)); }
  if (killer) { killer.kills++; if (killer.syn.recharge && ++killer.killStreak >= 20) { killer.killStreak = 0; if (killer.shield < 3) { killer.shield++; fx.text(killer.x, killer.y - 50, '護盾回充', '#4cc9f0', 16, 1.2); } } }
  fx.text(e.x, e.y - 10, `+${gain}${mult > 1 ? ' ×' + mult : ''}`, e.color, 14 + Math.min(world.combo, 20) * 0.4);
  if (e.laserId) world.lasers = world.lasers.filter(L => !(L.id === e.laserId && L.phase === 'warn'));
  if (e.type === 'bounty') { fx.text(e.x, e.y - 40, '懸賞達成！', '#ffd166', 28, 2); fx.shake(10); }
  if (e.type === 'meteor') { fx.text(e.x, e.y - 40, '流星擊碎！', '#ffb070', 24, 1.6); spawnPickup(world, e.x, e.y, true); }
  if (e.type === 'ufo') { fx.text(e.x, e.y - 40, '飛碟擊落！', '#90f1a8', 24, 1.6); spawnPickup(world, e.x, e.y, true); }
  if (e.type === 'mothership') { fx.text(e.x, e.y - 60, '母艦擊沉！+' + e.score, '#ffd166', 34, 2.5); fx.shake(20); fx.flash(0.5); for (let k = 0; k < 3; k++) spawnPickup(world, e.x + rand(-60, 60), e.y + rand(-40, 40), true); for (const o of world.enemies) if (o.fleet) o.life = 0; if (world.doom && world.doom.by === e.id) { world.doom = null; world.safeZones = []; } }
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
      for (const o of world.enemies.slice()) {
        const i = world.enemies.indexOf(o);
        if (i < 0) continue;
        if (dist2(o.x, o.y, e.x, e.y) < (R + o.r) ** 2) { o.hp -= killer.explosive; o.hitFlash = 0.1; if (killer.syn.vamp && !killer.dead) killer.hp = Math.min(killer.maxHp, killer.hp + 2); if (o.hp <= 0) { o.fromChain = true; killEnemy(world, i, killer, fx); } }
      }
      for (const bb of world.bosses) if (dist2(bb.x, bb.y, e.x, e.y) < (R + bb.r) ** 2) damageBoss(world, bb, killer.explosive, e.x, e.y, fx);
    }
  }
}

function hurtPlayer(world, p, dmg, fx, src = null) {
  if (p.dead || p.downed || p.offline || p.inv > 0) return;
  const lfx = fx.local(p);
  dmg = Math.round(dmg * dmgMul(world));
  // 堡壘：正面 120° 能量盾擋住有來源方向的攻擊
  if (p.flags.frontShield && src && src.x !== undefined && Math.abs(angleDiff(Math.atan2(src.y - p.y, src.x - p.x), p.angle)) < 1.05) {
    p.inv = 0.08; fx.burst(p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, '#4cc9f0', 8, 160, 0.3, 2); fx.beep(700, 0.06, 'triangle', 0.04, -300); world.stats.parries++;
    return;
  }
  if (src && src.vamp) { src.vamp.hp = Math.min(src.vamp.maxHp, src.vamp.hp + dmg * 1.5); fx.text(src.vamp.x, src.vamp.y - src.vamp.r - 8, '吸血', '#ff3860', 11, 0.6); }
  if (p.shield > 0) {
    p.shield--; p.inv = 0.6;
    fx.burst(p.x, p.y, '#4cc9f0', 20, 200, 0.5, 3); fx.beep(600, 0.15, 'sine', 0.08, -300); fx.text(p.x, p.y - 30, '護盾抵擋', '#4cc9f0');
    return;
  }
  p.hp -= dmg; p.inv = 0.8; world.waveDamaged = true;
  lfx.flash(1); lfx.shake(14); lfx.aberrate(0.9);
  world.combo = 0; world.stats.dmgTaken += dmg; world.stats.noHitT = 0; world.stats.stillT = 0;
  p.lastHitBy = src && src.by ? src.by : '不明攻擊';
  fx.burst(p.x, p.y, '#ff5f7a', 16, 200, 0.5, 3);
  fx.ring(p.x, p.y, '#ff5f7a', 10, 90, 0.35, 3);
  fx.sfx('hurt');
  if (p.hp <= 0) { p.hp = 0; world.stats.killedBy = p.lastHitBy; playerDown(world, p, fx); }
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
  p.emp = 0; p.frozen = 0; p.hexed = 0; p.dashing = 0; p.bash = false; p.laser = 0;
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
    const evo = !p.evolved ? evolutionFor(p.weapon, p.upgrades) : null;
    if (evo) picks.push(evoCard(evo));
    while (picks.length < 3 && pool.length) picks.push(pool.splice(randInt(0, pool.length - 1), 1)[0]);
    world.pendingUpgrades.set(p.id, picks);
  }
  if (world.pendingUpgrades.size === 0) { world.waveTimer = 2.5; return; }
  world.scene = 'upgrade';
  [523, 659, 784].forEach((f, i) => schedule(world, i * 0.1, () => fx.beep(f, 0.2, 'sine', 0.06)));
}
/** 武器進化卡（長得像升級卡，給 render / snapshot 用） */
export function evoCard(evo) {
  return { id: 'evo:' + evo.id, icon: evo.icon, name: '進化 · ' + evo.name, max: 1, evo, desc: () => evo.desc, apply: p => { p.evolved = evo.id; } };
}
export function chooseUpgrade(world, playerId, idx, fx = NULL_FX) {
  const choices = world.pendingUpgrades.get(playerId);
  const p = world.players.find(q => q.id === playerId);
  if (!choices || !p) return false;
  if (idx === -1) {
    // 放棄升級：回 20 生命（也是「裸裝」成就的路）
    p.hp = Math.min(p.maxHp, p.hp + 20); fx.text(p.x, p.y - 40, '放棄升級 +20 HP', '#3ddc84', 18, 1.4);
    world.pendingUpgrades.delete(playerId);
    if (world.pendingUpgrades.size === 0) { world.scene = 'play'; world.waveTimer = 2.5; }
    return true;
  }
  const u = choices[idx];
  if (!u) return false;
  u.apply(p);
  world.stats.upgrades++;
  if (u.evo) { world.stats.evolved = u.evo.id; fx.text(p.x, p.y - 70, `武器進化 ${u.evo.icon} ${u.evo.name}！`, '#fff', 30, 2.5); fx.ring(p.x, p.y, '#fff', 10, 220, 0.8, 5); fx.flash(0.3); fx.sfx('wave'); world.pendingUpgrades.delete(playerId); if (world.pendingUpgrades.size === 0) { world.scene = 'play'; world.waveTimer = 2.5; } return true; }
  if (p.flags.adapt) { p.damage *= 1.04; p.adaptMul *= 1.04; }
  if (u.id === 'drone' && p.flags.droneBoost) p.drones.push({ a: rand(0, TAU), cd: rand(0, 0.5), x: p.x, y: p.y });
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

  const F = p.flags || {};
  p.dashCd = Math.max(0, p.dashCd - dt);
  if (p.frozen > 0) { ix = 0; iy = 0; }
  if (inp.dash && p.dashCd <= 0 && (ix || iy) && !(p.emp > 0) && !(p.frozen > 0)) {
    p.dashing = PLAYER_BASE.dashTime; p.dashCd = p.dashCdMax; p.inv = Math.max(p.inv, p.syn.ghost ? 0.5 : 0.25); p.dashHits.clear();
    if (world.stats) world.stats.dashes++;
    // 工程師：衝刺時在原地放下砲塔（最多 2 座）
    if (F.turrets && p.turrets) { p.turrets.push({ x: p.x, y: p.y, life: 20, cd: 0.3, a: p.angle }); while (p.turrets.length > F.turrets) p.turrets.shift(); fx.ring(p.x, p.y, '#ffd166', 8, 60, 0.4, 3); fx.text(p.x, p.y - 30, '砲塔部署', '#ffd166', 12, 0.8); }
    p.vx = ix * PLAYER_BASE.dashSpeed; p.vy = iy * PLAYER_BASE.dashSpeed;
    fx.sfx('dash'); fx.burst(p.x, p.y, p.color, 10, 120, 0.4, 2);
  }
  if (p.dashing > 0) {
    p.dashing -= dt;
    fx.ghost(p.x, p.y, 8, p.color, 0.3);
    const slash = F.dashSlash || p.evolved === 'dance';
    if (p.syn.ghost || slash) for (let j = world.enemies.length - 1; j >= 0; j--) { const e = world.enemies[j]; if (!e || p.dashHits.has(e.id) || dist2(e.x, e.y, p.x, p.y) > (e.r + p.r + (slash ? 40 : 6)) ** 2) continue; p.dashHits.add(e.id); hitEnemy(world, e, slash ? (p.damage || 8) * WEAPON_STATS.bladeDmg * (F.bladeMaster ? 2 : 1) : 40, { by: p, x: p.x, y: p.y, element: slash ? 'kinetic' : null }, fx); fx.burst(e.x, e.y, p.color, 8, 160, 0.3, 2); if (slash) fx.bolt([{ x: p.x - Math.cos(p.angle) * 20, y: p.y - Math.sin(p.angle) * 20 }, { x: e.x, y: e.y }], '#fff'); if (e.hp <= 0) killEnemy(world, j, p, fx); }
  } else {
    const ice = world.arena === 'glacier';
    const envMul = (world.drag || 1) * (world.blizzard > 0 ? 0.75 : 1) * (p.hexed > 0 ? 0.55 : 1);
    const odMul = p.overdrive > 0 ? 1.3 : 1;
    const accel = PLAYER_BASE.accel * p.speedMul * odMul * (ice ? 0.55 : 1) * envMul, maxSpd = PLAYER_BASE.maxSpeed * p.speedMul * odMul * envMul;
    p.vx += ix * accel * dt; p.vy += iy * accel * dt;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > maxSpd) { p.vx = p.vx / sp * maxSpd; p.vy = p.vy / sp * maxSpd; }
    if (!ix && !iy) { const k = ice ? 0.3 : 0.001; p.vx *= Math.pow(k, dt); p.vy *= Math.pow(k, dt); }
    if (world.wind) { p.vx += world.wind.x * dt; p.vy += world.wind.y * dt; }
  }
  p.x = clamp(p.x + p.vx * dt, p.r, W - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, H - p.r);
  // 閃現：朝移動方向（沒移動就朝瞄準方向）瞬移，過程無敵
  p.blinkCd = Math.max(0, (p.blinkCd || 0) - dt);
  if (p.blinkFlash > 0) p.blinkFlash -= dt;
  if (inp.blink && p.blinkCd <= 0 && !(p.emp > 0) && !(p.frozen > 0)) {
    const a = (ix || iy) ? Math.atan2(iy, ix) : inp.angle;
    const ox = p.x, oy = p.y;
    if (world.stats) world.stats.blinks++;
    if (F.shieldBash) {
      // 堡壘：盾擊 — 短距衝撞，沿路擊退並傷害
      p.blinkCd = p.blinkCdMax || PLAYER_BASE.blinkCd; p.inv = Math.max(p.inv, 0.35); p.blinkFlash = 0.3;
      p.dashing = 0.16; p.vx = Math.cos(a) * 750; p.vy = Math.sin(a) * 750; p.dashHits.clear(); p.bash = true;
      fx.ring(p.x, p.y, '#4cc9f0', 10, 70, 0.3, 4); fx.beep(300, 0.15, 'square', 0.08, -150); fx.sfx('dash');
    } else {
      p.x = clamp(p.x + Math.cos(a) * PLAYER_BASE.blinkDist, p.r, W - p.r);
      p.y = clamp(p.y + Math.sin(a) * PLAYER_BASE.blinkDist, p.r, H - p.r);
      p.blinkCd = p.blinkCdMax || PLAYER_BASE.blinkCd; p.inv = Math.max(p.inv, PLAYER_BASE.blinkInv); p.blinkFlash = 0.3; p.dashing = 0;
      fx.burst(ox, oy, p.color, 14, 220, 0.4, 3); fx.ring(ox, oy, p.color, 6, 60, 0.3, 3);
      fx.burst(p.x, p.y, '#fff', 12, 200, 0.35, 2); fx.ghost(p.x, p.y, 16, p.color, 0.35);
      fx.beep(1100, 0.12, 'sine', 0.06, 700); fx.sfx('dash');
      // 黃蜂：落點爆炸
      if (F.blinkStrike) { fx.ring(p.x, p.y, '#ffd166', 10, 100, 0.35, 4); fx.burst(p.x, p.y, '#ffd166', 16, 220, 0.4, 3); fx.noise(0.1, 0.08); for (let j = world.enemies.length - 1; j >= 0; j--) { const e = world.enemies[j]; if (!e || dist2(e.x, e.y, p.x, p.y) > (90 + e.r) ** 2) continue; hitEnemy(world, e, 40, { by: p, x: p.x, y: p.y, element: 'kinetic' }, fx); const aa = Math.atan2(e.y - p.y, e.x - p.x); e.vx += Math.cos(aa) * 300; e.vy += Math.sin(aa) * 300; if (e.hp <= 0) killEnemy(world, j, p, fx); } for (const bb of world.bosses) if (dist2(bb.x, bb.y, p.x, p.y) < (90 + bb.r) ** 2) damageBoss(world, bb, 40, p.x, p.y, fx); }
    }
  }
  // 盾擊沿路撞擊
  if (p.bash && p.dashing > 0) for (let j = world.enemies.length - 1; j >= 0; j--) { const e = world.enemies[j]; if (!e || p.dashHits.has(e.id) || dist2(e.x, e.y, p.x, p.y) > (e.r + p.r + 12) ** 2) continue; p.dashHits.add(e.id); hitEnemy(world, e, 30, { by: p, x: p.x, y: p.y, element: 'kinetic' }, fx); const aa = Math.atan2(e.y - p.y, e.x - p.x); e.vx += Math.cos(aa) * 520; e.vy += Math.sin(aa) * 520; e.stun = Math.max(e.stun || 0, 0.4); fx.burst(e.x, e.y, '#4cc9f0', 10, 200, 0.3, 3); if (e.hp <= 0) killEnemy(world, j, p, fx); }
  if (p.dashing <= 0) p.bash = false;
  p.angle = inp.angle;
  p.inv = Math.max(0, p.inv - dt);
  p.rapid = Math.max(0, p.rapid - dt);
  p.emp = Math.max(0, (p.emp || 0) - dt); p.frozen = Math.max(0, (p.frozen || 0) - dt); p.hexed = Math.max(0, (p.hexed || 0) - dt);
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

  // 全隊統計：不開火 / 完全靜止（成就與任務用），每 tick 只算一次
  {
    const live = world.players.filter(q => !q.dead && !q.downed && !q.offline && q.input);
    const anyFire = live.some(q => q.input.fire), anyMove = live.some(q => q.input.ix || q.input.iy || q.input.fire);
    if (anyFire) world.stats.noFireT = 0; else if (waveEnemies(world).length) world.stats.noFireT += dt;
    world.stats.bestNoFire = Math.max(world.stats.bestNoFire, world.stats.noFireT);
    if (anyMove || !live.length) world.stats.stillT = 0; else world.stats.stillT += dt;
    world.stats.bestStill = Math.max(world.stats.bestStill, world.stats.stillT);
  }
  // 玩家
  for (const p of world.players) {
    if (p.dead || p.offline) continue;
    const lfx = fx.local(p);

    if (p.downed) {
      p.downTimer -= dt;
      p.inputQueue.length = 0; p.beam = null; p.laserOn = false; p.weaponOn = false; if (p.turrets) p.turrets.length = 0;
      const rescuer = activePlayers(world).find(q => dist2(q.x, q.y, p.x, p.y) < REVIVE_RANGE ** 2);
      if (rescuer) {
        p.reviveProgress += dt;
        if (p.reviveProgress >= REVIVE_TIME) { revive(world, p, fx); fx.text(rescuer.x, rescuer.y - 40, '救援成功', '#3ddc84', 16, 1.2); }
      } else p.reviveProgress = Math.max(0, p.reviveProgress - dt * 0.5);
      if (p.downTimer <= 0 && p.downed) killPlayer(world, p, fx);
      continue;
    }

    if (p.netInput) {
      p.inputCredit = Math.min(4, (p.inputCredit || 0) + 1);
      const n = Math.min(p.inputCredit, p.inputQueue.length); p.inputCredit -= n;
      for (let i = 0; i < n; i++) { const q = p.inputQueue.shift(); p.input = q.input; p.lastSeq = q.seq; stepPlayer(world, p, q.input, dt, fx); }
      if (n === 0) { p.inv = Math.max(0, p.inv - dt); p.rapid = Math.max(0, p.rapid - dt); p.dashCd = Math.max(0, p.dashCd - dt); p.blinkCd = Math.max(0, p.blinkCd - dt); }
    } else {
      stepPlayer(world, p, p.input, dt, fx);
    }
    const inp = p.input;
    // ---- 主動技能：能量 / 超載 / 原子彈倒數 / 施放（按下邊緣觸發）----
    p.energy = Math.min(ENERGY.max, (p.energy || 0) + ENERGY.passive * dt);
    if (p.overdrive > 0) { p.overdrive -= dt; p.dashCd = 0; if (rnd() < dt * 8) fx.burst(p.x, p.y, '#ffd166', 2, 120, 0.3, 2); }
    if (p.novaT > 0) { p.novaT -= dt; if (p.novaT <= 0) fireNova(world, p, fx); }
    if (inp.skill && !p.skillHeld) castSkill(world, p, fx);
    p.skillHeld = !!inp.skill;

    // ---- 射擊：依主武器分派。每種武器對升級 / 道具的反應都不同（見 WEAPON_MODS），進化見 EVOLUTIONS ----
    p.laser = Math.max(0, p.laser - dt);
    p.fireCd -= dt; p.weaponOn = false; p.beam = null;
    const wpn = p.laser > 0 ? 'laser' : p.weapon;
    p.laserOn = wpn === 'laser' && !!inp.fire && !(p.frozen > 0);
    if (p.frozen > 0) { if (rnd() < 0.1) fx.local(p).text(p.x, p.y - 30, '凍住了！', '#b8ffff', 12, 0.4); }
    else if (wpn === 'laser') fireLaser(world, p, inp, dt, fx, lfx);
    else if (wpn === 'flame') fireFlame(world, p, inp, dt, fx, lfx);
    else if (wpn === 'frost') fireFrost(world, p, inp, dt, fx, lfx);
    else if (wpn === 'arc') fireArc(world, p, inp, dt, fx, lfx);
    else if (wpn === 'blade') fireBlade(world, p, inp, dt, fx, lfx);
    else fireBlaster(world, p, inp, dt, fx, lfx);
    if (p.evolved === 'storm') { p.stormCd -= dt; if (p.stormCd <= 0) { p.stormCd = 1; const t = nearestTarget(world, p.x, p.y, 600); if (t) { fx.bolt([{ x: t.x + rand(-40, 40), y: t.y - 320 }, { x: t.x + rand(-15, 15), y: t.y - 120 }, { x: t.x, y: t.y }], '#fff'); fx.burst(t.x, t.y, '#9ff', 10, 200, 0.3, 3); fx.beep(1800, 0.08, 'square', 0.05, -1200); const d = p.damage * WEAPON_STATS.arcDmg * 1.5; if (t.name) damageBoss(world, t, d, t.x, t.y, fx); else { const j = world.enemies.indexOf(t); if (j >= 0) { hitEnemy(world, t, d, { by: p, x: p.x, y: p.y, element: 'plasma' }, fx); if (t.hp <= 0) killEnemy(world, j, p, fx); } } } } }

    // 砲塔（工程師）：繼承主武器屬性
    for (let i = p.turrets.length - 1; i >= 0; i--) {
      const T = p.turrets[i]; T.life -= dt; T.cd -= dt;
      if (T.life <= 0) { fx.burst(T.x, T.y, '#ffd166', 10, 150, 0.4, 3); p.turrets.splice(i, 1); continue; }
      const t = nearestTarget(world, T.x, T.y, 520);
      if (t) { T.a = Math.atan2(t.y - T.y, t.x - T.x); if (T.cd <= 0) { T.cd = 0.32; const b = spawnBullet(world, p, T.x + Math.cos(T.a) * 14, T.y + Math.sin(T.a) * 14, T.a, 0.7); b.element = WEAPON_ELEMENT[p.weapon]; fx.beep(1000, 0.04, 'square', 0.02, -300); } }
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
        if (t) { d.cd = p.syn.swarm ? 0.25 : 0.5; const db = spawnBullet(world, p, d.x, d.y, Math.atan2(t.y - d.y, t.x - d.x), p.flags.droneBoost ? 0.6 * 1.4 / 0.65 : 0.6); db.element = WEAPON_ELEMENT[p.weapon]; if (p.syn.swarm) db.homing = Math.max(db.homing, 3); fx.beep(1200, 0.04, 'square', 0.02, -400); }
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
        if (e.phaseT > 0) continue;   // 相位中：子彈穿過去
        const real = hitEnemy(world, e, b.dmg * (b.rail ? 1 + 0.15 * b.hit.size : 1), { by: owner, x: b.x, y: b.y, element: b.element || (owner ? WEAPON_ELEMENT[owner.weapon] : null) }, fx);
        if (real <= 0 && e.kind === 'warden') { dead = true; break; }   // 被正面盾擋下
        e.squash = 1;
        e.vx += b.vx * 0.05; e.vy += b.vy * 0.05;
        if (owner && owner.syn.shock) { e.stun = 0.3; e.vx += b.vx * 0.3; e.vy += b.vy * 0.3; }
        if ((b.burn || b.element === 'fire') && e.element !== 'fire') { e.burn = 3; e.burnDps = (owner ? owner.damage : 8) * 0.6; e.burnBy = owner ? owner.id : null; }
        if (b.element === 'ice' && e.element !== 'ice') e.slow = 1;
        const ba = Math.atan2(b.vy, b.vx);
        fx.burstDir(b.x, b.y, e.color, 4, ba + Math.PI, 1.0);
        fx.burstDir(b.x, b.y, '#fff', 2, ba, 0.4, 160, 0.2, 2);
        if (e.maxHp >= 60 && real > 0) fx.text(e.x + rand(-10, 10), e.y - e.r - 6, String(Math.round(real)), '#fff', 12, 0.5);
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
  const beacon = world.beacon && world.beacon.alive ? world.beacon : world.crate && world.crate.alive ? world.crate : null;
  if (world.chrono > 0) { world.chrono -= dt; for (const bb of world.bosses) bb.slow = Math.max(bb.slow || 0, 0.1); }
  const elist = world.enemies.slice();
  for (let s = elist.length - 1; s >= 0; s--) {
    const e = elist[s]; let i = world.enemies.indexOf(e);
    if (i < 0) continue;   // 同一輪裡其他敵人的爆炸可能已把它移除
    e.warn = warnLevel(world, e);
    if (world.chrono > 0 && !e.ambient) { e.stun = Math.max(e.stun || 0, 0.08); e.chrono = true; } else e.chrono = false;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.squash = Math.max(0, e.squash - dt * 9);
    if (e.affixes && e.affixes.length) {
      if (e.affixes.includes('regen')) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.02 * dt);
      if (e.affixes.includes('shielded') && e.shieldHp <= 0) { e.shieldCd -= dt; if (e.shieldCd <= 0) { e.shieldCd = 6; e.shieldHp = 40; fx.ring(e.x, e.y, '#4cc9f0', e.r, e.r + 24, 0.3, 3); } }
      if (e.affixes.includes('phasing')) { e.phaseCd -= dt; if (e.phaseCd <= 0) { e.phaseCd = 3; e.phaseT = 1; fx.ghost(e.x, e.y, e.r, '#c77dff', 0.3); } }
      if (e.affixes.includes('commander')) for (const o of world.enemies) if (o !== e && !o.ambient && dist2(o.x, o.y, e.x, e.y) < 220 * 220) o.cmdT = 0.3;
    }
    if (e.phaseT > 0) e.phaseT -= dt;
    if (e.cmdT > 0) e.cmdT -= dt;
    if (e.burn > 0) {
      e.burn -= dt; const bo = (e.burnBy != null ? world.players.find(q => q.id === e.burnBy) : null) || null;
      hitEnemy(world, e, e.burnDps * dt, { by: bo, element: 'fire' }, fx);
      if (rnd() < 0.3) fx.burstDir(e.x + rand(-e.r, e.r) * 0.6, e.y, '#ff8c42', 1, -Math.PI / 2, 0.6, 90, 0.35, 2.5);
      if (e.hp <= 0) { const owner = bo || world.players.find(q => q.syn.ember) || null; killEnemy(world, i, owner, fx); continue; }
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
        const pool = e.ally || e.fleet ? [...activePlayers(world)] : targets;
        const tg = pool.length ? pool[randInt(0, pool.length - 1)] : null;
        if (tg) { const a = Math.atan2(tg.y + (tg.vy || 0) * 0.3 - e.y, tg.x + (tg.vx || 0) * 0.3 - e.x); for (let k = -1; k <= 1; k++) world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: Math.cos(a + k * 0.2) * 330, vy: Math.sin(a + k * 0.2) * 330, life: 3, r: 5, kind: 'ufo', ufo: !e.fleet && !e.ally }); fx.beep(1500, 0.06, 'square', 0.03, -700); }
      }
      // 生化毒物：定期在身下留下毒區
      e.toxicCd = (e.toxicCd ?? AMBIENT.ufoToxicCd * 0.6) - dt;
      if (e.toxicCd <= 0 && !leaving) { e.toxicCd = AMBIENT.ufoToxicCd; world.zones.push({ id: world.nextId++, x: e.x, y: e.y + 40, r: AMBIENT.toxicR, life: AMBIENT.toxicLife, kind: 'toxic' }); fx.burst(e.x, e.y + 40, '#3ddc84', 14, 120, 0.6, 4); fx.beep(300, 0.3, 'triangle', 0.05, -100); }
      if (leaving && (e.x < -100 || e.x > W + 100)) { world.enemies.splice(i, 1); continue; }
    } else if (e.kind === 'mothership') {
      // 母艦：緩慢橫移、齊射、灑毒、定期毀滅攻擊；時間到離開
      e.life -= dt; e.wobble += dt;
      const leaving = e.life <= 0;
      const ty = leaving ? -200 : 150, tx = leaving ? e.x : W / 2 + Math.sin(e.wobble * 0.35) * 380;
      e.vx += ((tx - e.x) * 0.8 - e.vx) * Math.min(1, dt * 2); e.vy += ((ty - e.y) * 1.2 - e.vy) * Math.min(1, dt * 2);
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (leaving && e.y < -180) { world.enemies.splice(i, 1); if (world.doom && world.doom.by === e.id) { world.doom = null; world.safeZones = []; } continue; }
      if (!leaving && e.y > 40) {
        e.shootCd -= dt;
        if (e.shootCd <= 0) { e.shootCd = 1.3; const tg = nearestPlayer(world, e.x, e.y); if (tg) { const a = Math.atan2(tg.y + tg.vy * 0.35 - e.y, tg.x + tg.vx * 0.35 - e.x); for (let k = -2; k <= 2; k++) world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y + 30, vx: Math.cos(a + k * 0.16) * 300, vy: Math.sin(a + k * 0.16) * 300, life: 4, r: 6, kind: 'ufo' }); fx.beep(600, 0.1, 'square', 0.05, -300); } }
        e.toxicCd -= dt;
        if (e.toxicCd <= 0) { e.toxicCd = 6; const tg = nearestPlayer(world, e.x, e.y); const zx = tg ? tg.x + rand(-80, 80) : e.x, zy = tg ? tg.y + rand(-80, 80) : e.y + 100; world.zones.push({ id: world.nextId++, x: clamp(zx, 60, W - 60), y: clamp(zy, 60, H - 60), r: AMBIENT.toxicR * 1.3, life: AMBIENT.toxicLife, kind: 'toxic' }); fx.text(zx, zy - 60, '生化毒物投放', '#3ddc84', 16, 1.4); fx.burst(zx, zy, '#3ddc84', 20, 160, 0.6, 4); }
        if (!world.doom && e.dooms < AMBIENT.doomMax) { e.doomCd -= dt; if (e.doomCd <= 0) { e.doomCd = AMBIENT.doomEvery; e.dooms++; startDoom(world, e, fx); } }
      }
    } else if (e.kind === 'drift') {
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (e.x < e.r && e.vx < 0) e.vx = -e.vx; if (e.x > W - e.r && e.vx > 0) e.vx = -e.vx;
      if (e.y < e.r && e.vy < 0) e.vy = -e.vy; if (e.y > H - e.r && e.vy > 0) e.vy = -e.vy;
    } else {
      let tgt = beacon;
      if (!tgt) { tgt = nearestPlayer(world, e.x, e.y); if (!tgt) continue; }
      if (world.hole) { const hd = Math.hypot(world.hole.x - e.x, world.hole.y - e.y) || 1; if (hd < world.hole.r) { e.vx += (world.hole.x - e.x) / hd * 420 * dt; e.vy += (world.hole.y - e.y) / hd * 420 * dt; } }
      const wave = threat(world);
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
        // 圍攻：靠近後先站到自己在玩家周圍的位置（每隻不同角度），大家到位或等太久就一起衝
        if (tgt === nearestPlayer(world, e.x, e.y) && d < 360 && e.type !== 'dart' && !e.wantPickup) {
          if (e.slot === undefined) e.slot = (e.id * 2.399) % TAU;
          e.encT = (e.encT || 0) + dt;
          if (e.encT < 2.0) {
            const px = tgt.x + Math.cos(e.slot + world.time * 0.3) * 160, py = tgt.y + Math.sin(e.slot + world.time * 0.3) * 160;
            const ex = px - e.x, ey = py - e.y, ed = Math.hypot(ex, ey) || 1;
            if (ed > 26) { tx = ex / ed; ty = ey / ed; } else { tx *= 0.15; ty *= 0.15; e.encT += dt * 2; }
          } else if (e.encT > 6.5) e.encT = 0;
        } else e.encT = 0;
        // 閃現躲子彈（第 7 波起）
        if (e.type === 'dart' && wave >= ENEMY_BLINK_FROM_WAVE) enemyBlink(world, e, fx, dt);
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
        } else if (e.type === 'drifter') {
          // 蟲群：貼近後短距衝撞（撞到玩家就炸）
          e.lungeCd -= dt;
          if (e.lunge > 0) { e.lunge -= dt; steer = false; }
          else if (e.lungeCd <= 0 && d < 200) { e.lunge = 0.35; e.lungeCd = rand(1.6, 2.6); const a = Math.atan2(dy, dx), sp = e.speed * 2.6; e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; steer = false; fx.beep(700, 0.06, 'square', 0.03, -300); }
        } else if (e.type === 'tank') {
          e.atkCd -= dt;
          if (e.atkCd <= 0 && d < 700) { e.atkCd = 3.5; const a = Math.atan2(dy, dx); world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 5, r: 12, kind: 'shell', dmg: 25, by: '重裝' }); fx.beep(120, 0.3, 'square', 0.08, -60); fx.burstDir(e.x, e.y, '#9b5de5', 6, a, 0.4, 200, 0.3, 3); }
        } else if (e.type === 'splitter' && e.split) {
          e.atkCd -= dt;
          if (e.atkCd <= 0 && d < 500) { e.atkCd = 3; const a = Math.atan2(dy, dx); world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 2.2, r: 9, kind: 'acid', dmg: 12, by: '分裂體' }); fx.beep(240, 0.12, 'triangle', 0.05, -80); }
        } else if (e.type === 'frostbite') {
          e.atkCd -= dt;
          if (e.atkCd <= 0 && d < 420) { e.atkCd = 2.4; const a = Math.atan2(dy, dx); for (let k = -1; k <= 1; k++) world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: Math.cos(a + k * 0.3) * 340, vy: Math.sin(a + k * 0.3) * 340, life: 2.5, r: 5, kind: 'ice', dmg: 8, by: '霜噬' }); fx.beep(1500, 0.08, 'sine', 0.04, -600); }
        }
      } else if (e.kind === 'orbit' || e.kind === 'lancer') {
        if (e.kind === 'orbit' && wave >= ENEMY_BLINK_FROM_WAVE) enemyBlink(world, e, fx, dt);
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
            for (let k = 0; k < cnt; k++) { const aa = a + (k - (cnt - 1) / 2) * (e.elite ? 0.18 : 0.22); world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: Math.cos(aa) * spd, vy: Math.sin(aa) * spd, life: 3, r: 5, kind: lead ? 'lead' : undefined }); }
            fx.beep(lead ? 520 : 400, 0.1, 'sine', 0.04, -200);
          }
          // 佈雷：在身後留下感應地雷
          if (wave >= DIFFICULTY.mineFromWave || world.mods.mines) {
            e.mineCd -= dt;
            if (e.mineCd <= 0) { e.mineCd = rand(AI.mineCd[0], AI.mineCd[1]); world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: 0, vy: 0, life: AI.mineLife, r: 10, kind: 'mine' }); fx.beep(200, 0.15, 'triangle', 0.05, -100); }
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
          for (let k = -1; k <= 1; k++) { const aa = a + k * 0.25; world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: e.x, y: e.y, vx: Math.cos(aa) * 300, vy: Math.sin(aa) * 300, life: 3, r: 5, kind: 'lead' }); }
          fx.beep(600, 0.1, 'square', 0.04, -300);
        }
      } else if (BEHAVE[e.kind]) {
        const r = BEHAVE[e.kind](world, e, tgt, dx, dy, d, dt, fx, wave);
        if (r === 'dead') continue;
        if (r) { if (r.tx !== undefined) { tx = r.tx; ty = r.ty; } if (r.steer === false) steer = false; }
      }
      if (steer) {
        const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
        const spd = e.speed * (e.slow > 0 ? WEAPON_STATS.frostSlow : 1) * (e.buffSpeed > 0 ? 1.4 : 1) * (e.encT >= 2.0 ? 1.35 : 1) * (e.cmdT > 0 ? 1.25 : 1) * (world.drag || 1);
        e.vx += (tx * spd - e.vx) * Math.min(1, dt * 3);
        e.vy += (ty * spd - e.vy) * Math.min(1, dt * 3);
      }
      e.x += e.vx * dt; e.y += e.vy * dt;
      if (world.wind) { e.x += world.wind.x * dt * 0.6; e.y += world.wind.y * dt * 0.6; }
      if (e.kind !== 'chase') { e.x = clamp(e.x, e.r, W - e.r); e.y = clamp(e.y, e.r, H - e.r); }
      if (beacon && beacon.alive && dist2(e.x, e.y, beacon.x, beacon.y) < (e.r + beacon.r) ** 2) {
        beacon.hp -= e.contact; beacon.hitFlash = 0.15;
        fx.burst(e.x, e.y, e.color, 14, 200, 0.5, 3); fx.shake(4); fx.sfx('hit');
        world.enemies.splice(i, 1);
        if (beacon.hp <= 0) { beacon.hp = 0; beacon.alive = false; fx.burst(beacon.x, beacon.y, '#4cc9f0', 60, 400, 1, 5); fx.ring(beacon.x, beacon.y, '#4cc9f0', 40, 400, 0.6, 5); fx.shake(20); fx.text(beacon.x, beacon.y - 60, beacon.kind === 'crate' ? '補給箱被搶走了！' : '信標被摧毀！', '#ff5f7a', 30, 2); fx.sfx('explode'); }
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
    let removed = false;
    for (const q of activePlayers(world)) {
      if (dist2(e.x, e.y, q.x, q.y) < (e.r + q.r) ** 2) {
        const wasInv = q.inv > 0;
        hurtPlayer(world, q, e.contact * (e.cmdT > 0 ? 1.25 : 1), fx, { x: e.x, y: e.y, by: enemyLabel(e), vamp: e.affixes && e.affixes.includes('vampiric') ? e : null });
        if (!wasInv && e.affixes && e.affixes.includes('thorns')) drainPlayer(world, q, 8, fx, '荊棘反傷');
        if (!wasInv && (ENEMY_TYPES[e.type] || {}).freezeTouch && !(q.frozen > 0)) { q.frozen = 0.8; fx.text(q.x, q.y - 34, '凍住了！', '#b8ffff', 14, 0.9); fx.ring(q.x, q.y, '#b8ffff', 6, 50, 0.4, 3); }
        const a = Math.atan2(e.y - q.y, e.x - q.x);
        if (e.kind !== 'drift') { e.vx = Math.cos(a) * 300; e.vy = Math.sin(a) * 300; }
        q.vx -= Math.cos(a) * 250; q.vy -= Math.sin(a) * 250;
        if (e.type === 'drifter' && !wasInv) {
          // 蟲群撞上就炸成碎片
          for (let k = 0; k < 6; k++) { const aa = k * TAU / 6 + rand(-0.2, 0.2); world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(aa) * 240, vy: Math.sin(aa) * 240, life: 1.2, r: 4, kind: 'shard', by: '蟲群碎片' }); }
          fx.burst(e.x, e.y, e.color, 16, 220, 0.5, 3); fx.ring(e.x, e.y, e.color, e.r, e.r + 50, 0.3, 3); fx.noise(0.08, 0.06);
          world.enemies.splice(i, 1); removed = true; break;
        }
      }
    }
    if (removed) continue;
  }

  // 敵方子彈（含追蹤能量球）
  for (let i = world.enemyBullets.length - 1; i >= 0; i--) {
    const b = world.enemyBullets[i];
    if (world.chrono > 0) continue;   // 時間停止：敵彈定住（也不會傷人）
    if (b.homing) {
      const p = nearestPlayer(world, b.x, b.y);
      if (p) {
        const want = Math.atan2(p.y - b.y, p.x - b.x), cur = Math.atan2(b.vy, b.vx);
        const na = cur + clamp(angleDiff(want, cur), -1, 1) * b.homing * dt;
        const sp = Math.hypot(b.vx, b.vy); b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.kind === 'mark') {
      // 迫擊砲落點標記：時間到爆炸（範圍傷害 + 碎片）
      if (b.life <= 0) {
        world.enemyBullets.splice(i, 1);
        fx.burst(b.x, b.y, '#ffb347', 22, 260, 0.5, 4); fx.ring(b.x, b.y, '#ffb347', 10, b.r + 20, 0.35, 4); fx.shake(6); fx.noise(0.15, 0.1);
        for (const q of activePlayers(world)) if (dist2(b.x, b.y, q.x, q.y) < (b.r + q.r) ** 2) hurtPlayer(world, q, 22, fx, { x: b.x, y: b.y, by: '迫擊砲' });
        for (let k = 0; k < 6; k++) { const a = k * TAU / 6; world.enemyBullets.push({ id: world.nextId++, x: b.x, y: b.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, life: 1.2, r: 4, kind: 'shard', by: '迫擊砲碎片' }); }
      }
      continue;
    }
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
    if (b.life <= 0 || b.y > H + 40 || b.y < -60 || b.x < -60 || b.x > W + 60) { if (b.kind === 'acid' && b.life <= 0) { world.zones.push({ id: world.nextId++, x: b.x, y: b.y, r: 45, life: 1.8, kind: 'toxic' }); fx.burst(b.x, b.y, '#f15bb5', 6, 100, 0.3, 2); } world.enemyBullets.splice(i, 1); continue; }
    if (world.hole) { const hd = Math.hypot(world.hole.x - b.x, world.hole.y - b.y) || 1; if (hd < world.hole.r) { b.vx += (world.hole.x - b.x) / hd * 500 * dt; b.vy += (world.hole.y - b.y) / hd * 500 * dt; } }
    if (world.wind) { b.x += world.wind.x * dt * 0.5; b.y += world.wind.y * dt * 0.5; }
    if (beacon && beacon.alive && b.kind !== 'mine' && dist2(b.x, b.y, beacon.x, beacon.y) < (b.r + beacon.r) ** 2) {
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
      if (dd < (b.r + q.r) ** 2) {
        const dmg = b.dmg ?? (b.boss ? 18 : b.kind === 'shard' || b.kind === 'ufo' ? 10 : b.kind === 'spore' ? 10 : b.kind === 'hex' ? 12 : b.kind === 'void' ? 14 : 15);
        const wasInv = q.inv > 0;
        hurtPlayer(world, q, dmg, fx, { x: b.x - b.vx * 0.1, y: b.y - b.vy * 0.1, by: b.by || (b.boss ? 'Boss 彈幕' : ENEMY_LABEL[b.kind] || '敵彈'), vamp: b.vampOwner ? world.enemies.find(o => o && o.id === b.vampOwner) || null : null });
        if (!wasInv && b.kind === 'ice') q.hexed = Math.max(q.hexed || 0, 1.2);
        if (!wasInv && b.kind === 'acid') world.zones.push({ id: world.nextId++, x: b.x, y: b.y, r: 45, life: 1.8, kind: 'toxic' });
        world.enemyBullets.splice(i, 1); hitP = true; break;
      }
      // 擦彈：子彈貼身飛過沒打中 → 加分
      if (!b.grazed && b.kind !== 'mine' && dd < (b.r + q.r + 16) ** 2) { b.grazed = true; world.graze++; world.stats.grazes++; const gain = GRAZE_SCORE * (1 + Math.floor(world.combo / 10)); world.score += gain; fx.local(q).text(q.x, q.y + 24, `擦彈 +${gain}`, '#b8ffff', 11, 0.6); }
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
      if (segDist2(q.x, q.y, L.x, L.y, x2, y2) < (q.r + L.w * 0.5) ** 2) { hurtPlayer(world, q, L.dmg, fx, { x: L.x, y: L.y, by: L.boss ? 'Boss 雷射' : '雷射兵' }); q.vx += Math.cos(L.angle + Math.PI / 2) * 120 * (rnd() < 0.5 ? 1 : -1); }
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
  if (world.wave >= AMBIENT.fromWave && world.bossWarn <= 0 && !world.mods.daily) { world.ambientCd -= dt; if (world.ambientCd <= 0) { world.ambientCd = rand(AMBIENT.cd[0], AMBIENT.cd[1]); const fleetOk = world.wave >= AMBIENT.fleetFromWave && !world.enemies.some(e => e.kind === 'mothership') && world.bosses.length === 0 && rnd() < AMBIENT.fleetChance; if (fleetOk) { spawnFleet(world, fx); world.ambientCd += 30; } else spawnAmbient(world, rnd() < 0.7 ? 'meteor' : 'ufo', fx); } }
  updateArena(world, dt, fx);
  updateEvents(world, dt, fx);
  updateZones(world, dt, fx);
  world.stats.timeAlive = world.time;
  for (const q of activePlayers(world)) { world.stats.noHitT += dt / Math.max(1, activePlayers(world).length); }
  world.stats.bestNoHit = Math.max(world.stats.bestNoHit, world.stats.noHitT);
  if (world.doom && world.doom.t <= dt && activePlayers(world).some(q => !world.safeZones.some(z => dist2(q.x, q.y, z.x, z.y) < (z.r - q.r * 0.5) ** 2))) world.stats.doomHit = true;
  if (world.doom) { world.doom.t -= dt; if (world.doom.t <= 0) fireDoom(world, fx); }
  updateMode(world, dt, fx);

  // 波次結束 → 升級（每 UPGRADE_EVERY_WAVES 波或 Boss 後）→ 倒數下一波
  const cleared = waveEnemies(world).length === 0 && world.bosses.length === 0 && world.bossWarn <= 0 && !world.waveMode && !spawnPending(world);
  if (cleared && world.scene === 'play') {
    if (world.wave > 0 && !world.upgradeOffered) {
      world.upgradeOffered = true;
      if (world.upgradeDue || world.wave % UPGRADE_EVERY_WAVES === 0) { world.upgradeDue = false; offerUpgrades(world, fx); return; }
    }
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) { nextWave(world, fx); world.waveTimer = 2.5; }
  }
}

// ====================================================================
// 武器實作（每種武器對升級 / 道具的反應都不同，見 constants.WEAPON_MODS；進化見 EVOLUTIONS）
// ====================================================================
/** 光束撞牆反射：回傳線段列表 */
function beamSegments(world, x, y, angle, range, bounces) {
  const segs = []; let rem = range, cx = x, cy = y, a = angle;
  for (let k = 0; k <= bounces && rem > 1; k++) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = rem;
    if (dx > 1e-6) t = Math.min(t, (world.W - cx) / dx); else if (dx < -1e-6) t = Math.min(t, (0 - cx) / dx);
    if (dy > 1e-6) t = Math.min(t, (world.H - cy) / dy); else if (dy < -1e-6) t = Math.min(t, (0 - cy) / dy);
    t = Math.max(0, t);
    const ex = cx + dx * t, ey = cy + dy * t;
    segs.push({ x1: cx, y1: cy, x2: ex, y2: ey, a });
    rem -= t; if (rem <= 1) break;
    if (ex <= 0.5 || ex >= world.W - 0.5) a = Math.PI - a;
    if (ey <= 0.5 || ey >= world.H - 0.5) a = -a;
    cx = clamp(ex, 0.5, world.W - 0.5); cy = clamp(ey, 0.5, world.H - 0.5);
  }
  return segs;
}
/** 追蹤升級：把瞄準角往最近目標彎（最多 strength 弧度） */
function bendAim(world, p, range, strength) {
  const t = nearestTarget(world, p.x, p.y, range);
  if (!t) return p.angle;
  const want = Math.atan2(t.y - p.y, t.x - p.x);
  return p.angle + clamp(angleDiff(want, p.angle), -strength, strength);
}
function fireBlaster(world, p, inp, dt, fx, lfx) {
  if (!inp.fire || p.fireCd > 0) return;
  p.fireCd = p.rapid > 0 ? p.fireRate * 0.45 : p.fireRate;
  const rail = p.evolved === 'railgun';
  const n = p.spread;
  const shoot = () => {
    if (p.dead || p.downed) return;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * 0.16;
      const b = spawnBullet(world, p, p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, p.angle + off + rand(-0.03, 0.03));
      if (rail) { b.rail = true; b.pierce += 3; b.vx *= 1.45; b.vy *= 1.45; b.life = 0.9; b.size = Math.max(b.size, 1.3); }
    }
    fx.muzzle(p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22, p.angle);
    fx.sfx('shoot');
  };
  shoot();
  if (rail) { schedule(world, 0.05, shoot); schedule(world, 0.1, shoot); p.fireCd *= 1.6; }
  p.vx -= Math.cos(p.angle) * 30; p.vy -= Math.sin(p.angle) * 30;
  lfx.crossRecoil();
}
function fireFlame(world, p, inp, dt, fx, lfx) {
  if (!inp.fire) return;
  p.weaponOn = true;
  const rapid = p.rapid > 0;
  const dps = p.damage * WEAPON_STATS.flameDps * (rapid ? 1.5 : 1) * (PLAYER_BASE.fireRate / p.fireRate);
  const R = WEAPON_STATS.flameRange * (rapid ? 1.4 : 1), cone = WEAPON_STATS.flameCone + (p.spread - 1) * 0.1;
  const a = p.homing > 0 ? bendAim(world, p, R, 0.3 * p.homing) : p.angle;
  p.fa = a; p.fr = R; p.fc = cone;
  const inCone = (x, y, r) => { const d = Math.hypot(x - p.x, y - p.y); return d < R + r && Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), a)) < cone + r / Math.max(60, d); };
  const inferno = p.evolved === 'inferno';
  for (let j = world.enemies.length - 1; j >= 0; j--) {
    const e = world.enemies[j];
    if (!e || !inCone(e.x, e.y, e.r)) continue;
    hitEnemy(world, e, dps * dt, { by: p, x: p.x, y: p.y, element: 'fire' }, fx);
    if (e.element !== 'fire') { const stacks = inferno ? Math.min(3, (e.burnStack || 1) + dt * 1.5) : 1; e.burnStack = stacks; e.burn = Math.max(e.burn || 0, 1.5 + p.pierce * 0.8); e.burnDps = p.damage * 0.6 * stacks; e.burnBy = p.id; }
    if (p.bulletSize > 1) { const k = (p.bulletSize - 1) * 200 * dt; e.vx += Math.cos(a) * k; e.vy += Math.sin(a) * k; }
    if (e.hp <= 0) killEnemy(world, j, p, fx);
  }
  for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && inCone(bb.x, bb.y, bb.r)) damageBoss(world, bb, dps * dt, bb.x, bb.y, fx);
  if (p.bounce > 0 || inferno) {
    p.fireZoneCd = (p.fireZoneCd ?? 0) - dt;
    if (p.fireZoneCd <= 0) { p.fireZoneCd = 0.6; const d = R * 0.7; world.zones.push({ id: world.nextId++, x: clamp(p.x + Math.cos(a) * d, 30, world.W - 30), y: clamp(p.y + Math.sin(a) * d, 30, world.H - 30), r: 55, life: inferno ? 5 : 3, kind: 'fire', dps: p.damage * 0.9, owner: p.id }); }
  }
  if (rnd() < 0.9) fx.burstDir(p.x + Math.cos(a) * 20, p.y + Math.sin(a) * 20, rnd() < 0.5 ? '#ff8c42' : '#ffd166', 3, a, cone * 0.9, 520 * (rapid ? 1.3 : 1), 0.42, 5);
  if (rnd() < 0.15) fx.noise(0.08, 0.03);
  p.vx -= Math.cos(a) * 60 * dt; p.vy -= Math.sin(a) * 60 * dt;
}
function fireFrost(world, p, inp, dt, fx, lfx) {
  if (!inp.fire) return;
  p.weaponOn = true;
  const dps = p.damage * WEAPON_STATS.frostDps * (p.rapid > 0 ? 1.5 : 1) * (PLAYER_BASE.fireRate / p.fireRate);
  const width = 8 + (p.spread - 1) * 7;
  const a = p.homing > 0 ? bendAim(world, p, WEAPON_STATS.frostRange, 0.35 * p.homing) : p.angle;
  const segs = beamSegments(world, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, WEAPON_STATS.frostRange, p.bounce);
  const zero = p.evolved === 'zero';
  const freezeAfter = (zero ? 1 : WEAPON_STATS.frostFreezeAfter) / (p.rapid > 0 ? 2 : 1);
  const stunDur = 1.2 + (p.bulletSize - 1) * 1.2;
  for (const S of segs) {
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const e = world.enemies[j];
      if (!e || segDist2(e.x, e.y, S.x1, S.y1, S.x2, S.y2) > (e.r + width) ** 2) continue;
      hitEnemy(world, e, dps * dt, { by: p, x: S.x1, y: S.y1, element: 'ice' }, fx);
      if (e.element !== 'ice') { e.slow = 1.2; if (!(e.stun > 0)) { e.freeze = (e.freeze || 0) + dt; if (e.freeze >= freezeAfter) { e.freeze = 0; e.stun = stunDur; e.frozenBy = p.id; fx.text(e.x, e.y - e.r - 8, '凍結', '#b8ffff', 14, 0.8); fx.ring(e.x, e.y, '#b8ffff', e.r, e.r + 30, 0.4, 3); } } }
      if (rnd() < 0.2) fx.burst(e.x, e.y, '#b8ffff', 2, 60, 0.4, 2);
      if (e.hp <= 0) killEnemy(world, j, p, fx);
    }
    for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && segDist2(bb.x, bb.y, S.x1, S.y1, S.x2, S.y2) < (bb.r + width) ** 2) { damageBoss(world, bb, dps * dt, bb.x, bb.y, fx); bb.slow = 0.6; }
  }
  p.beam = segs.map(S => [Math.round(S.x1), Math.round(S.y1), Math.round(S.x2), Math.round(S.y2)]); p.beamW = width;
}
function fireArc(world, p, inp, dt, fx, lfx) {
  p.arcCharge = p.arcCharge || 0;
  const storm = p.evolved === 'storm';
  const range = WEAPON_STATS.arcRange * (1 + 0.5 * p.homing);
  if (!inp.fire) { p.arcCharge = Math.max(0, p.arcCharge - dt * 2); return; }
  if (p.fireCd > 0) { if (p.arcCharge > 0 && !nearestTarget(world, p.x, p.y, range)) p.weaponOn = true; return; }
  p.fireCd = (p.rapid > 0 ? p.fireRate * 0.5 : p.fireRate) * WEAPON_STATS.arcRate;
  const first = nearestTarget(world, p.x, p.y, range);
  if (first) {
    const pts = [{ x: p.x + Math.cos(p.angle) * 16, y: p.y + Math.sin(p.angle) * 16 }];
    const hit = new Set(); let cur = first;
    const dmg = p.damage * WEAPON_STATS.arcDmg * (1 + 0.4 * (p.bulletSize - 1) / 0.5) * (1 + Math.min(1.5, p.arcCharge) / 1.5);
    if (p.arcCharge > 0.5) fx.text(p.x, p.y - 34, `蓄電釋放 ×${(1 + Math.min(1.5, p.arcCharge) / 1.5).toFixed(1)}`, '#9ff', 14, 0.8);
    p.arcCharge = 0;
    const targets = (WEAPON_STATS.arcTargets + (p.spread - 1)) * (storm ? 2 : 1);
    const jump = WEAPON_STATS.arcJump * (1 + 0.6 * p.pierce);
    let revisits = p.bounce;
    for (let k = 0; k < targets && cur; k++) {
      hit.add(cur); pts.push({ x: cur.x, y: cur.y });
      const d = dmg * Math.pow(0.85, k);
      if (cur.tier !== undefined && !cur.name) { const idx = world.enemies.indexOf(cur); if (idx >= 0) { hitEnemy(world, cur, d, { by: p, x: p.x, y: p.y, element: 'plasma' }, fx); cur.squash = 1; cur.vx *= 0.5; cur.vy *= 0.5; if (cur.hp <= 0) killEnemy(world, idx, p, fx); } }
      else damageBoss(world, cur, d, cur.x, cur.y, fx);
      let next = null, bd = jump ** 2;
      for (const e of world.enemies) { if (hit.has(e)) continue; const dd = dist2(e.x, e.y, cur.x, cur.y); if (dd < bd) { bd = dd; next = e; } }
      if (!next && revisits > 0) { revisits--; for (const e of world.enemies) { if (e === cur) continue; const dd = dist2(e.x, e.y, cur.x, cur.y); if (dd < bd) { bd = dd; next = e; } } }
      cur = next;
    }
    fx.bolt(pts, storm ? '#fff' : '#9ff');
    fx.beep(1600, 0.06, 'square', 0.05, -900); fx.sfx('hit');
    lfx.crossRecoil();
  } else {
    // 沒有目標：蓄電，機頭噼啪作響
    p.fireCd = 0.1; p.weaponOn = true; p.arcCharge = Math.min(1.5, p.arcCharge + 0.1);
    const nx = p.x + Math.cos(p.angle) * 18, ny = p.y + Math.sin(p.angle) * 18;
    const k = 1 + Math.floor(p.arcCharge * 2);
    for (let q = 0; q < k; q++) { const a = p.angle + rand(-1.2, 1.2), l = 14 + p.arcCharge * 22; fx.bolt([{ x: nx, y: ny }, { x: nx + Math.cos(a) * l * 0.5 + rand(-6, 6), y: ny + Math.sin(a) * l * 0.5 + rand(-6, 6) }, { x: nx + Math.cos(a) * l, y: ny + Math.sin(a) * l }], p.arcCharge >= 1.5 ? '#fff' : '#9ff'); }
    if (rnd() < 0.5) fx.beep(900 + p.arcCharge * 600, 0.04, 'square', 0.02, 300);
    if (p.arcCharge >= 1.5 && rnd() < 0.15) fx.text(nx, ny - 20, '蓄滿', '#fff', 11, 0.4);
  }
}
function fireLaser(world, p, inp, dt, fx, lfx) {
  if (!inp.fire) { p.laserRamp = Math.max(0, (p.laserRamp || 0) - dt * 2); return; }
  const weaponLaser = !(p.laser > 0);
  const solar = p.evolved === 'solar' && weaponLaser;
  const beams = weaponLaser ? p.spread : 1;
  const width = (6 + (p.bulletSize - 1) * 8) * (solar ? 2 : 1);
  const rampMax = solar ? 2.5 : 1 + 0.25 * p.pierce;
  const ramp = weaponLaser ? Math.min(rampMax, 1 + (p.laserRamp || 0) * 0.5) : 1;
  const dps = p.damage * (weaponLaser ? WEAPON_STATS.laserDps : PLAYER_BASE.laserDps) * (p.rapid > 0 ? 1.6 : 1) * ramp * (weaponLaser ? PLAYER_BASE.fireRate / p.fireRate : 1);
  const base = weaponLaser && p.homing > 0 ? bendAim(world, p, PLAYER_BASE.laserRange, 0.35 * p.homing) : p.angle;
  const all = []; let hitAny = false;
  for (let i = 0; i < beams; i++) {
    const a = base + (beams === 1 ? 0 : (i - (beams - 1) / 2) * 0.14);
    const segs = beamSegments(world, p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 18, a, PLAYER_BASE.laserRange, weaponLaser ? p.bounce : 0);
    all.push(...segs);
    for (const S of segs) {
      for (let j = world.enemies.length - 1; j >= 0; j--) {
        const e = world.enemies[j];
        if (!e || segDist2(e.x, e.y, S.x1, S.y1, S.x2, S.y2) > (e.r + width) ** 2) continue;
        if (hitEnemy(world, e, dps * dt, { by: p, x: S.x1, y: S.y1, element: 'light' }, fx) > 0) hitAny = true;
        if (rnd() < 0.25) fx.burstDir(e.x, e.y, '#b8ffff', 2, S.a + Math.PI, 1.2, 160, 0.2, 2);
        if (e.hp <= 0) killEnemy(world, j, p, fx);
      }
      for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && segDist2(bb.x, bb.y, S.x1, S.y1, S.x2, S.y2) < (bb.r + width) ** 2) { damageBoss(world, bb, dps * dt / (solar ? (bb.armor || 1) : 1), bb.x, bb.y, fx); hitAny = true; }
    }
  }
  p.laserRamp = hitAny ? Math.min(3, (p.laserRamp || 0) + dt) : Math.max(0, (p.laserRamp || 0) - dt * 2);
  p.beam = all.map(S => [Math.round(S.x1), Math.round(S.y1), Math.round(S.x2), Math.round(S.y2)]); p.beamW = width;
  if (rnd() < 0.3) fx.sfx('hit');
  p.vx -= Math.cos(p.angle) * 40 * dt; p.vy -= Math.sin(p.angle) * 40 * dt;
}
function fireBlade(world, p, inp, dt, fx, lfx) {
  p.swingCd = Math.max(0, (p.swingCd || 0) - dt); p.swingT = Math.max(0, (p.swingT || 0) - dt);
  if (!inp.fire || p.swingCd > 0) return;
  const F = p.flags || {};
  p.swingCd = p.fireRate * WEAPON_STATS.bladeRate / (p.rapid > 0 ? 2 : 1);
  p.swingT = 0.18; p.swingDir = p.swingDir === 1 ? -1 : 1; p.weaponOn = true; world.stats.swings++;
  const range = WEAPON_STATS.bladeRange * (1 + 0.4 * (p.bulletSize - 1) / 0.5) * (p.rapid > 0 ? 1.15 : 1);
  const arc = WEAPON_STATS.bladeArc + (p.spread - 1) * 0.25;
  // 追蹤升級：目標在 2.5 倍距離內就先短距衝過去
  if (p.homing > 0) { const t = nearestTarget(world, p.x, p.y, range * 2.5); if (t) { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d > range) { const k = Math.min(d - range * 0.7, 80 + 40 * p.homing); p.x = clamp(p.x + (t.x - p.x) / d * k, p.r, world.W - p.r); p.y = clamp(p.y + (t.y - p.y) / d * k, p.r, world.H - p.r); fx.ghost(p.x, p.y, 10, p.color, 0.25); } } }
  const dmg = p.damage * WEAPON_STATS.bladeDmg * (F.bladeMaster ? 2 : 1);
  const knock = WEAPON_STATS.bladeKnock * (1 + p.pierce);
  const inArc = (x, y, r) => { const d = Math.hypot(x - p.x, y - p.y); return d < range + r && Math.abs(angleDiff(Math.atan2(y - p.y, x - p.x), p.angle)) < arc / 2 + r / Math.max(40, d); };
  const doSwing = (ox, oy, mul, tag) => {
    let hits = 0;
    for (let j = world.enemies.length - 1; j >= 0; j--) {
      const e = world.enemies[j];
      if (!e || !inArc(e.x, e.y, e.r)) continue;
      const real = hitEnemy(world, e, dmg * mul, { by: p, x: ox, y: oy, element: 'kinetic' }, fx);
      if (real > 0) { hits++; const a = Math.atan2(e.y - oy, e.x - ox); e.vx += Math.cos(a) * knock; e.vy += Math.sin(a) * knock; e.squash = 1; fx.burstDir(e.x, e.y, '#fff', 5, a, 0.5, 200, 0.25, 2); if (e.affixes && e.affixes.includes('thorns')) hurtPlayer(world, p, 8, fx, { x: e.x, y: e.y, by: '荊棘反傷' }); if (F.bladeMaster && !p.dead) p.hp = Math.min(p.maxHp, p.hp + 2); }
      if (e.hp <= 0) killEnemy(world, j, p, fx);
    }
    for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && inArc(bb.x, bb.y, bb.r)) { damageBoss(world, bb, dmg * mul, bb.x, bb.y, fx); hits++; }
    // 格擋：扇形內的敵彈全部打掉
    let parried = 0;
    world.enemyBullets = world.enemyBullets.filter(b => { if (b.kind === 'mark' || !inArc(b.x, b.y, b.r)) return true; parried++; fx.burst(b.x, b.y, '#fff', 3, 120, 0.2, 2); return false; });
    if (parried) { world.stats.parries += parried; if (F.bladeMaster && !p.dead) p.hp = Math.min(p.maxHp, p.hp + parried); fx.text(p.x, p.y - 34, `格擋 ×${parried}`, '#fff', 12, 0.6); fx.beep(1500, 0.05, 'triangle', 0.05, -500); }
    if (tag && hits) fx.text(p.x, p.y - 46, tag, '#f8c', 12, 0.5);
    return hits;
  };
  const hits = doSwing(p.x, p.y, 1, null);
  if (hits) lfx.crossPunch();
  fx.beep(hits ? 260 : 420, 0.08, 'sawtooth', 0.05, hits ? -120 : 300);
  // 反彈升級：放出一道劍氣
  if (p.bounce > 0) { const b = spawnBullet(world, p, p.x + Math.cos(p.angle) * 30, p.y + Math.sin(p.angle) * 30, p.angle, 0.6); b.pierce += 5; b.life = 0.5; b.size = 2.2; b.slash = true; }
  // 幻影劍舞：0.25 秒後在原位再揮一次殘影
  if (p.evolved === 'dance') { const ox = p.x, oy = p.y, oa = p.angle; schedule(world, 0.25, () => { if (p.dead) return; const sx = p.x, sy = p.y, sa = p.angle; p.x = ox; p.y = oy; p.angle = oa; fx.ghost(ox, oy, 14, '#f8c', 0.3); doSwing(ox, oy, 0.5, '殘影'); p.x = sx; p.y = sy; p.angle = sa; }); }
}

/** 敵人死亡時的種類 / 詞綴效果（killEnemy 內呼叫） */
function onEnemyDeath(world, e, killer, fx) {
  const shard = (n, spd, r = 4, life = 1.6) => { for (let k = 0; k < n; k++) { const a = k * TAU / n + rand(-0.1, 0.1); world.enemyBullets.push({ id: world.nextId++, x: e.x, y: e.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, r, kind: 'shard' }); } };
  if (e.affixes) {
    if (e.affixes.includes('volatile')) { shard(10, 260); fx.burst(e.x, e.y, '#ff3860', 20, 260, 0.5, 3); fx.text(e.x, e.y - 30, '易爆！', '#ff3860', 14, 0.8); }
    if (e.affixes.includes('splitting')) for (let k = 0; k < 2; k++) spawnEnemy(world, 'kamikaze', e.x + rand(-20, 20), e.y + rand(-20, 20));
  }
  if (e.type === 'tank') { shard(16, 170, 7, 3); fx.ring(e.x, e.y, '#9b5de5', e.r, e.r + 120, 0.5, 5); }
  if (e.type === 'spore') { world.zones.push({ id: world.nextId++, x: e.x, y: e.y, r: 90, life: 7, kind: 'toxic' }); fx.burst(e.x, e.y, '#3ddc84', 24, 200, 0.6, 4); }
  if (e.type === 'sentinel') { world.zones.push({ id: world.nextId++, x: e.x, y: e.y, r: 110, life: 6, kind: 'rift' }); fx.text(e.x, e.y - 30, '虛空裂隙', '#c77dff', 14, 1); }
  // 絕對零度 / 穿甲：凍結中被打碎 → 對周圍造成傷害
  if (e.stun > 0 && e.frozenBy) {
    const p = world.players.find(q => q.id === e.frozenBy);
    if (p) { const d = p.pierce * 20 + (p.evolved === 'zero' ? 60 : 0); if (d > 0) { fx.ring(e.x, e.y, '#b8ffff', e.r, e.r + 110, 0.4, 4); fx.burst(e.x, e.y, '#fff', 18, 260, 0.4, 3); fx.text(e.x, e.y - 30, '碎裂', '#b8ffff', 14, 0.8); for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || o === e || dist2(o.x, o.y, e.x, e.y) > (110 + o.r) ** 2) continue; hitEnemy(world, o, d, { by: p, x: e.x, y: e.y, element: 'ice' }, fx); if (o.hp <= 0) { o.fromChain = true; killEnemy(world, j, p, fx); } } for (const bb of world.bosses) if (dist2(bb.x, bb.y, e.x, e.y) < (110 + bb.r) ** 2) damageBoss(world, bb, d, e.x, e.y, fx); } }
  }
}

// ====================================================================
// 主動技能（SKILLS）：伺服器權威；能量由擊殺累積
// ====================================================================
function castSkill(world, p, fx) {
  if (world.scene !== 'play' || p.dead || p.downed) return;
  const S = skillById(p.skill); const lfx = fx.local(p);
  if ((p.energy || 0) < S.energy) { lfx.text(p.x, p.y - 40, `能量不足 ${Math.floor(p.energy)}/${S.energy}`, '#ff8c9c', 12, 0.8); return; }
  if (p.novaT > 0) return;
  p.energy -= S.energy; world.stats.skills = (world.stats.skills || 0) + 1;
  fx.text(p.x, p.y - 50, `${S.icon} ${S.name}`, '#ffd166', 20, 1.4); fx.sfx('wave');
  switch (S.id) {
    case 'swarm':
      for (let k = 0; k < 30; k++) schedule(world, k * 0.05, () => { if (p.dead || p.downed) return; const b = spawnBullet(world, p, p.x, p.y, p.angle + rand(-1.4, 1.4), 14 / Math.max(1, p.damage)); b.homing = 3; b.size = 0.6; b.life = 3; b.missile = true; b.pierce = 0; b.bounce = 0; b.element = 'kinetic'; fx.burstDir(p.x, p.y, '#ffd166', 2, p.angle, 1.2, 160, 0.3, 2); });
      fx.beep(700, 0.3, 'square', 0.06, 400);
      break;
    case 'nova':
      p.novaT = 1.2; fx.text(world.W / 2, world.H / 2 - 120, '原子彈引爆倒數', '#ff3860', 30, 1.2); fx.beep(120, 1.2, 'sawtooth', 0.1, -60);
      break;
    case 'chrono':
      world.chrono = 3.5; fx.flash(0.35); fx.text(world.W / 2, world.H / 2 - 120, '時間停止', '#b8ffff', 34, 1.5); fx.beep(2000, 0.6, 'sine', 0.08, -1500);
      break;
    case 'aegis': {
      for (const q of activePlayers(world)) { if (q.flags.noShield) q.hp = Math.min(q.maxHp, q.hp + 40); else q.shield = Math.min(5, (q.shield || 0) + 2); q.inv = Math.max(q.inv, 0.6); fx.ring(q.x, q.y, '#4cc9f0', 10, 90, 0.5, 4); }
      for (const e of world.enemies) { const d = Math.hypot(e.x - p.x, e.y - p.y) || 1; if (d < 280 && !e.ambient) { e.vx += (e.x - p.x) / d * 700; e.vy += (e.y - p.y) / d * 700; e.stun = Math.max(e.stun || 0, 0.4); } }
      world.enemyBullets = world.enemyBullets.filter(b => dist2(b.x, b.y, p.x, p.y) > 320 * 320);
      fx.ring(p.x, p.y, '#4cc9f0', 20, 320, 0.6, 6); fx.shake(8); fx.beep(500, 0.4, 'triangle', 0.08, 300);
      break;
    }
    case 'singularity': {
      const x = clamp(p.x + Math.cos(p.angle) * 260, 120, world.W - 120), y = clamp(p.y + Math.sin(p.angle) * 260, 120, world.H - 120);
      world.hole = { x, y, r: 240, life: 4, skill: true, by: p.id }; fx.ring(x, y, '#c77dff', 240, 10, 0.8, 4); fx.beep(80, 1, 'sine', 0.1, -40);
      break;
    }
    case 'overdrive':
      p.overdrive = 6; p.rapid = Math.max(p.rapid, 6); p.inv = Math.max(p.inv, 0.5); fx.ring(p.x, p.y, '#ffd166', 10, 80, 0.4, 4); fx.beep(900, 0.5, 'square', 0.08, 900);
      break;
  }
}
function fireNova(world, p, fx) {
  fx.flash(1); fx.shake(30); fx.ring(p.x, p.y, '#fff', 20, 1400, 1.2, 10); fx.ring(p.x, p.y, '#ff8c42', 20, 900, 0.9, 8); fx.noise(0.6, 0.2); fx.beep(60, 1.5, 'sawtooth', 0.15, -30);
  for (const o of world.enemies.slice()) { const i = world.enemies.indexOf(o); if (i < 0 || o.ambient && o.type === 'mothership') continue; hitEnemy(world, o, 260, { by: p, x: p.x, y: p.y, element: 'fire' }, fx); fx.burst(o.x, o.y, '#ff8c42', 6, 200, 0.5, 3); if (o.hp <= 0) killEnemy(world, world.enemies.indexOf(o), p, fx); }
  for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0) damageBoss(world, bb, 400, bb.x, bb.y, fx);
  world.enemyBullets.length = 0; world.lasers = world.lasers.filter(L => L.boss);
}
function blastHole(world, fx) {
  const h = world.hole, p = world.players.find(q => q.id === h.by) || null;
  fx.flash(0.5); fx.shake(16); fx.ring(h.x, h.y, '#c77dff', 20, 300, 0.7, 6); fx.burst(h.x, h.y, '#c77dff', 50, 500, 0.8, 4); fx.beep(70, 0.8, 'sawtooth', 0.12, 200);
  for (const o of world.enemies.slice()) { if (o.ambient || dist2(o.x, o.y, h.x, h.y) > (240 + o.r) ** 2) continue; hitEnemy(world, o, 150, { by: p, x: h.x, y: h.y, element: 'plasma' }, fx); if (o.hp <= 0) { const i = world.enemies.indexOf(o); if (i >= 0) killEnemy(world, i, p, fx); } }
  for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && dist2(bb.x, bb.y, h.x, h.y) < (240 + bb.r) ** 2) damageBoss(world, bb, 220, h.x, h.y, fx);
}
/** 敵人技能預警：0 無、1 快要放技能（黃 !）、2 正在放 / 高威脅（紅 !!），畫在頭上讓玩家知道先打誰 */
const WARN = {
  sniper: e => e.aimT > 0 ? 2 : e.atkCd < 1 ? 1 : 0,
  mortar: e => e.atkCd < 0.9 ? 2 : 0,
  hexer: e => (e.hexCd ?? 9) < 0.9 ? 2 : e.atkCd < 0.6 ? 1 : 0,
  pulsar: e => (e.empCd ?? 9) < 1 ? 2 : e.atkCd < 0.5 ? 1 : 0,
  spore: e => e.atkCd < 0.8 ? 1 : 0,
  sentinel: e => (e.tpCd ?? 9) < 0.7 || e.atkCd < 0.6 ? 1 : 0,
  warden: e => e.atkCd < 0.8 ? 1 : 0,
  tank: e => e.atkCd < 0.9 ? 1 : 0,
  splitter: e => e.atkCd < 0.8 ? 1 : 0,
  frostbite: e => e.atkCd < 0.8 ? 1 : 0,
  shooter: e => (e.shootCd ?? 9) < 0.45 ? 1 : 0,
  lancer: e => e.laserId ? 2 : (e.laserCd ?? 9) < 1 ? 1 : 0,
  mothership: (e, world) => world.doom || (e.doomCd ?? 9) < 2.5 ? 2 : 0,
  drifter: e => (e.lungeCd ?? 9) < 0.4 ? 1 : 0,
};
function warnLevel(world, e) { const f = WARN[e.type]; return f ? f(e, world) : 0; }

// ====================================================================
// 新敵種 AI（每種都有自己的攻擊；回傳 {tx,ty,steer} 或 'dead'）
// ====================================================================
function dodgeBullets(world, e, fx, dt = 1 / 60, range = 150, push = 420) {
  e.dodgeCd -= dt;
  if (e.dodgeCd > 0) return;
  for (const b of world.bullets) {
    const rx = e.x - b.x, ry = e.y - b.y, rd = Math.hypot(rx, ry);
    if (rd > range) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1, ux = b.vx / sp, uy = b.vy / sp;
    if (rx * ux + ry * uy < 0) continue;
    if (Math.abs(rx * uy - ry * ux) < e.r + 12) { const sgn = (rx * uy - ry * ux) >= 0 ? 1 : -1; e.vx += -uy * sgn * push; e.vy += ux * sgn * push; e.dodgeCd = 1.2; fx.ghost(e.x, e.y, e.r, e.color, 0.25); return; }
  }
}
function keepRange(dx, dy, d, near, far, side) {
  const radial = d > far ? 1 : d < near ? -1 : 0;
  return { tx: (dx / d) * radial * 0.8 + (-dy / d) * side * 0.7, ty: (dy / d) * radial * 0.8 + (dx / d) * side * 0.7 };
}
function eb(world, e, x, y, a, spd, extra) { world.enemyBullets.push({ id: world.nextId++, owner: e.id, x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life: 3, r: 5, vampOwner: e.affixes && e.affixes.includes('vampiric') ? e.id : undefined, ...extra }); }
const BEHAVE = {
  warden(world, e, tgt, dx, dy, d, dt, fx) {
    // 盾面慢慢轉向玩家（每秒 0.9 弧度）：繞到側面 / 背後才打得到
    { const want = Math.atan2(dy, dx), cur = Math.atan2(e.fy ?? 0, e.fx ?? 1); const na = cur + clamp(angleDiff(want, cur), -1, 1) * 0.9 * dt; e.fx = Math.cos(na); e.fy = Math.sin(na); } e.shieldUp = true;
    e.atkCd -= dt;
    if (e.atkCd <= 0 && d < 560) { e.atkCd = 2.6; for (let k = 0; k < 3; k++) schedule(world, k * 0.12, () => { if (e.hp <= 0 || !world.enemies.includes(e)) return; const a = Math.atan2(tgt.y - e.y, tgt.x - e.x); eb(world, e, e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, a, 330, { by: '護盾兵' }); }); fx.beep(380, 0.1, 'square', 0.04, -100); }
    const k = d > 260 ? 1 : 0; return { tx: dx / d * k + (-dy / d) * 0.25 * (e.flank > 0 ? 1 : -1), ty: dy / d * k + (dx / d) * 0.25 * (e.flank > 0 ? 1 : -1) };
  },
  sniper(world, e, tgt, dx, dy, d, dt, fx, wave) {
    e.blinkFlash = Math.max(0, e.blinkFlash - dt);
    if (e.aimT > 0) {
      e.aimT -= dt; e.vx *= Math.pow(0.02, dt); e.vy *= Math.pow(0.02, dt);
      if (e.aimT > 0.45) { const tl = d / 760; e.aimA = Math.atan2(tgt.y + (tgt.vy || 0) * tl - e.y, tgt.x + (tgt.vx || 0) * tl - e.x); }
      if (e.aimT <= 0) {
        eb(world, e, e.x, e.y, e.aimA, 780, { r: 6, life: 2.5, kind: 'snipe', dmg: 28, by: '狙擊手' });
        fx.beep(1900, 0.12, 'sawtooth', 0.07, -1400); fx.burstDir(e.x, e.y, '#ff8c9c', 8, e.aimA, 0.2, 300, 0.3, 3);
        // 射完閃現換位
        for (let k = 0; k < 10; k++) { const nx = rand(100, world.W - 100), ny = rand(100, world.H - 100); const dd = Math.hypot(nx - tgt.x, ny - tgt.y); if ((dd > 500 && dd < 760) || k === 9) { fx.burst(e.x, e.y, e.color, 10, 160, 0.3, 2); e.x = nx; e.y = ny; e.blinkFlash = 0.3; fx.burst(e.x, e.y, '#fff', 8, 140, 0.3, 2); break; } }
        e.atkCd = rand(2.2, 3.2) * (e.buffRapid > 0 ? 0.5 : 1);
      }
      return { steer: false };
    }
    dodgeBullets(world, e, fx, dt);
    e.atkCd -= dt;
    if (e.atkCd <= 0 && d < 900 && d > 250) { e.aimT = 1.4; e.aimA = Math.atan2(dy, dx); fx.beep(1200, 0.4, 'sine', 0.04, 500); }
    return keepRange(dx, dy, d, 560, 760, e.flank > 0 ? 1 : -1);
  },
  mortar(world, e, tgt, dx, dy, d, dt, fx) {
    dodgeBullets(world, e, fx, dt, 120, 300);
    e.atkCd -= dt;
    if (e.atkCd <= 0 && d < 720) {
      e.atkCd = 2.8 * (e.buffRapid > 0 ? 0.5 : 1);
      const n = e.buffSpread > 0 || e.elite ? 2 : 1;
      for (let k = 0; k < n; k++) { const mx = clamp(tgt.x + (tgt.vx || 0) * 0.9 + rand(-40, 40) * k, 40, world.W - 40), my = clamp(tgt.y + (tgt.vy || 0) * 0.9 + rand(-40, 40) * k, 40, world.H - 40); world.enemyBullets.push({ id: world.nextId++, owner: e.id, x: mx, y: my, vx: 0, vy: 0, life: 1.3, r: 70, kind: 'mark' }); }
      fx.beep(160, 0.25, 'triangle', 0.07, 200); fx.burstDir(e.x, e.y, '#ffb347', 8, -Math.PI / 2, 0.5, 260, 0.4, 3);
    }
    return keepRange(dx, dy, d, 360, 560, e.flank > 0 ? 1 : -1);
  },
  kamikaze(world, e, tgt, dx, dy, d, dt, fx) {
    e.warn = d < 320 ? 2 : 0;
    if (d < 250 && rnd() < dt * 6) fx.beep(1400 - d * 2, 0.05, 'square', 0.03);
    if (d < 60 + e.r + tgt.r) {
      // 自爆：玩家與其他敵人都吃傷害
      fx.burst(e.x, e.y, e.color, 26, 300, 0.5, 4); fx.ring(e.x, e.y, e.color, e.r, 110, 0.35, 4); fx.shake(6); fx.noise(0.12, 0.08);
      for (const q of activePlayers(world)) if (dist2(q.x, q.y, e.x, e.y) < (95 + q.r) ** 2) hurtPlayer(world, q, 30, fx, { x: e.x, y: e.y, by: enemyLabel(e) + '自爆' });
      for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || o === e || o.ambient || dist2(o.x, o.y, e.x, e.y) > (95 + o.r) ** 2) continue; o.hp -= 60; o.hitFlash = 0.1; if (o.hp <= 0) { world.stats.kamiKills++; killEnemy(world, j, null, fx); } }
      if ((ENEMY_TYPES[e.type] || {}).lava) world.zones.push({ id: world.nextId++, x: e.x, y: e.y, r: 80, life: 6, kind: 'lava' });
      const bc = world.beacon && world.beacon.alive ? world.beacon : world.crate && world.crate.alive ? world.crate : null;
      if (bc && dist2(bc.x, bc.y, e.x, e.y) < (95 + bc.r) ** 2) { bc.hp -= 40; bc.hitFlash = 0.2; if (bc.hp <= 0) { bc.hp = 0; bc.alive = false; fx.text(bc.x, bc.y - 60, bc.kind === 'crate' ? '補給箱被搶走了！' : '信標被摧毀！', '#ff5f7a', 30, 2); } }
      const idx = world.enemies.indexOf(e); if (idx >= 0) world.enemies.splice(idx, 1);
      return 'dead';
    }
    return { tx: dx / d + Math.cos(e.wobble * 2.5) * 0.6, ty: dy / d + Math.sin(e.wobble * 2.5) * 0.6 };
  },
  hexer(world, e, tgt, dx, dy, d, dt, fx) {
    dodgeBullets(world, e, fx, dt);
    e.atkCd -= dt; e.hexCd = (e.hexCd ?? 2) - dt;
    if (e.hexCd <= 0 && d < 600) { e.hexCd = 4.5; world.zones.push({ id: world.nextId++, x: tgt.x, y: tgt.y, r: 110, life: 6, kind: 'hex' }); fx.text(tgt.x, tgt.y - 40, '減速咒印', '#c77dff', 14, 1); fx.ring(tgt.x, tgt.y, '#c77dff', 10, 110, 0.5, 3); fx.beep(500, 0.3, 'sine', 0.05, -300); }
    if (e.atkCd <= 0 && d < 600) { e.atkCd = 2.5; const a = Math.atan2(dy, dx); for (const off of [-0.5, 0.5]) eb(world, e, e.x, e.y, a + off, 200, { r: 7, life: 4, kind: 'hex', homing: 2.0, dmg: 12, by: '咒球' }); fx.beep(800, 0.15, 'triangle', 0.05, -400); }
    return keepRange(dx, dy, d, 300, 420, e.flank > 0 ? 1 : -1);
  },
  sentinel(world, e, tgt, dx, dy, d, dt, fx) {
    e.blinkFlash = Math.max(0, e.blinkFlash - dt);
    e.atkCd -= dt; e.tpCd = (e.tpCd ?? 3.5) - dt;
    if (e.tpCd <= 0) { e.tpCd = 3.5; fx.burst(e.x, e.y, e.color, 12, 160, 0.3, 2); for (let k = 0; k < 8; k++) { const nx = rand(120, world.W - 120), ny = rand(120, world.H - 120); if (k === 7 || activePlayers(world).every(q => dist2(q.x, q.y, nx, ny) > 160 * 160)) { e.x = nx; e.y = ny; break; } } e.blinkFlash = 0.3; fx.burst(e.x, e.y, '#fff', 10, 140, 0.3, 2); fx.beep(1000, 0.1, 'sine', 0.04, 500); }
    if (e.atkCd <= 0 && d < 900) { e.atkCd = 2.2; const a = Math.atan2(dy, dx); for (const off of [-0.35, 0.35]) eb(world, e, e.x, e.y, a + off, 240, { r: 8, life: 4, kind: 'void', homing: 1.2, dmg: 14, by: '虛空哨兵' }); fx.beep(300, 0.2, 'sawtooth', 0.05, -100); }
    return { tx: 0, ty: 0 };
  },
  pulsar(world, e, tgt, dx, dy, d, dt, fx) {
    e.atkCd -= dt; e.empCd = (e.empCd ?? 3) - dt;
    if (e.empCd <= 0) { e.empCd = 5; world.zones.push({ id: world.nextId++, x: e.x, y: e.y, r: 10, grow: 420, life: 1.1, kind: 'emp', hit: [] }); fx.text(e.x, e.y - e.r - 14, 'EMP', '#ffd166', 16, 0.8); fx.beep(90, 0.5, 'sawtooth', 0.08, 400); }
    if (e.atkCd <= 0 && d < 560) { e.atkCd = 2.2; const a = Math.atan2(dy, dx); for (let k = -1; k <= 1; k++) eb(world, e, e.x, e.y, a + k * 0.22, 300, { r: 6, life: 3, kind: 'plasma', dmg: 12, by: '脈衝體' }); fx.beep(900, 0.08, 'square', 0.04, -300); }
    return keepRange(dx, dy, d, 260, 380, e.flank > 0 ? 1 : -1);
  },
  spore(world, e, tgt, dx, dy, d, dt, fx) {
    e.atkCd -= dt;
    if (e.atkCd <= 0 && d < 700) { e.atkCd = 3; for (let k = 0; k < 3; k++) { const a = rand(0, TAU); eb(world, e, e.x, e.y, a, 140, { r: 6, life: 6, kind: 'spore', homing: 1.5, dmg: 10, by: '孢子' }); } fx.burst(e.x, e.y, '#3ddc84', 10, 120, 0.5, 3); fx.beep(200, 0.2, 'triangle', 0.05, 100); }
    return { tx: dx / d, ty: dy / d };
  },
  angler(world, e, tgt, dx, dy, d, dt, fx) {
    e.lure = true;
    for (const q of activePlayers(world)) { const qd = Math.hypot(e.x - q.x, e.y - q.y) || 1; if (qd < 300 && qd > e.r) { q.vx += (e.x - q.x) / qd * 700 * dt; q.vy += (e.y - q.y) / qd * 700 * dt; if (rnd() < dt * 2) fx.local(q).text(q.x, q.y - 30, '被吸過去了', '#4cc9f0', 11, 0.5); } }
    const k = d > 300 ? 1 : 0.15; return { tx: dx / d * k, ty: dy / d * k };
  },
};

// ====================================================================
// 場地危險（每個場地各有一套）與區域效果
// ====================================================================
function updateArena(world, dt, fx) {
  const A = world.arena, W = world.W, H = world.H;
  if (world.blizzard > 0) world.blizzard -= dt;
  if (world.wind) { world.wind.life -= dt; if (world.wind.life <= 0) world.wind = null; }
  if (world.eclipse > 0) world.eclipse -= dt;
  // 重力井 / 黑洞：拉玩家與子彈
  const pulls = world.wells.map(w => ({ ...w, k: 1 })); if (world.hole) pulls.push({ ...world.hole, k: world.hole.skill ? 1.6 : 2.2 });
  for (const w of pulls) {
    if (!w.skill) for (const q of activePlayers(world)) { const qd = Math.hypot(w.x - q.x, w.y - q.y) || 1; if (qd < w.r) { q.vx += (w.x - q.x) / qd * 260 * w.k * dt; q.vy += (w.y - q.y) / qd * 260 * w.k * dt; if (w.k > 1 && qd < 50) drainPlayer(world, q, 25 * dt, fx, '黑洞'); } }
    for (const b of world.bullets) { const bd = Math.hypot(w.x - b.x, w.y - b.y) || 1; if (bd < w.r) { b.vx += (w.x - b.x) / bd * 600 * w.k * dt; b.vy += (w.y - b.y) / bd * 600 * w.k * dt; } }
  }
  for (let i = world.wells.length - 1; i >= 0; i--) { world.wells[i].life -= dt; if (world.wells[i].life <= 0) world.wells.splice(i, 1); }
  if (world.hole) { world.hole.life -= dt; for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (o && !o.ambient && dist2(o.x, o.y, world.hole.x, world.hole.y) < 60 * 60) { o.hp = 0; fx.burst(o.x, o.y, o.color, 12, 200, 0.4, 3); killEnemy(world, j, null, fx); } } if (world.hole.life <= 0) { if (world.hole.skill) blastHole(world, fx); world.hole = null; } }
  // 太陽風暴帶
  if (world.flare) {
    const F = world.flare; F.t -= dt;
    // 弧形：以畫面外的太陽（sx, H/2）為圓心、半徑 = 太陽到 F.x 的距離，帶子像日冕一樣向外擴散
    if (F.t <= 0) { F.x += F.dir * F.speed * dt; const R = Math.abs(F.x - F.sx); for (const q of activePlayers(world)) if (Math.abs(Math.hypot(q.x - F.sx, q.y - H / 2) - R) < F.w / 2 && !F.hit.includes(q.id)) { F.hit.push(q.id); hurtPlayer(world, q, 22, fx, { x: F.sx, y: H / 2, by: '太陽風暴' }); } if (F.x < -220 || F.x > W + 220) world.flare = null; }
  }
  if (world.wave < 2 || world.scene !== 'play') return;
  world.hazardCd -= dt;
  if (world.hazardCd > 0) return;
  const p = nearestPlayer(world, W / 2, H / 2);
  if (A === 'space') { world.hazardCd = rand(18, 30); world.zones.push({ id: world.nextId++, x: rand(150, W - 150), y: rand(150, H - 150), r: 130, life: 7, kind: 'rift' }); fx.text(W / 2, 90, '虛空裂隙開啟', '#c77dff', 18, 1.5); fx.beep(80, 0.6, 'sine', 0.06, 200); }
  else if (A === 'inferno') {
    world.hazardCd = rand(9, 15);
    if (rnd() < 0.6) { const x = rand(120, W - 120), y = rand(120, H - 120); world.zones.push({ id: world.nextId++, x, y, r: 95, life: 10, kind: 'lava' }); fx.text(x, y - 60, '熔岩浮出', '#ff8c42', 16, 1.2); fx.burst(x, y, '#ff8c42', 20, 200, 0.6, 4); }
    else if (p) { const x = clamp(p.x + p.vx * 0.8, 60, W - 60), y = clamp(p.y + p.vy * 0.8, 60, H - 60); world.zones.push({ id: world.nextId++, x, y, r: 70, life: 1.6, kind: 'geyser', fired: false }); fx.beep(150, 0.5, 'sawtooth', 0.06, 300); }
  }
  else if (A === 'mercury') {
    world.hazardCd = rand(14, 22);
    if (rnd() < 0.5) { world.wells.push({ id: world.nextId++, x: rand(200, W - 200), y: rand(200, H - 200), r: 260, life: 8 }); fx.text(W / 2, 90, '重力井', '#ffd166', 18, 1.5); }
    else { const fromLeft = rnd() < 0.5; world.flare = { x: fromLeft ? -60 : W + 60, sx: fromLeft ? -760 : W + 760, dir: fromLeft ? 1 : -1, w: 90, t: 2.2, speed: 280, hit: [] }; fx.text(W / 2, 90, '太陽風暴接近', '#ffd166', 22, 2); fx.beep(60, 1.2, 'sawtooth', 0.08, 120); }
  }
  else if (A === 'venom') {
    world.hazardCd = rand(10, 16);
    world.zones.push({ id: world.nextId++, x: rand(100, W - 100), y: rand(100, H - 100), r: 100, life: 12, kind: 'toxic', vx: rand(-25, 25), vy: rand(-25, 25) });
    if (rnd() < 0.4) world.zones.push({ id: world.nextId++, x: rand(100, W - 100), y: rand(100, H - 100), r: 170, life: 9, kind: 'fog', vx: rand(-20, 20), vy: rand(-20, 20) });
    fx.text(W / 2, 90, '毒霧潮', '#3ddc84', 16, 1.2);
  }
  else if (A === 'abyss') {
    world.hazardCd = rand(12, 20);
    if (rnd() < 0.65) { const a = rand(0, TAU); world.wind = { x: Math.cos(a) * 150, y: Math.sin(a) * 150, life: 6 }; fx.text(W / 2, 90, '洋流', '#4cc9f0', 18, 1.5); }
    else { world.zones.push({ id: world.nextId++, x: rand(200, W - 200), y: rand(200, H - 200), r: 200, life: 7, kind: 'pressure' }); fx.text(W / 2, 90, '深海壓力區', '#4cc9f0', 18, 1.5); }
  }
  else if (A === 'glacier') {
    world.hazardCd = rand(10, 16);
    if (rnd() < 0.45) { world.blizzard = 6; fx.text(W / 2, 90, '暴風雪', '#b8ffff', 20, 1.8); fx.noise(0.6, 0.08); }
    else for (const q of activePlayers(world)) for (let k = 0; k < 3; k++) { const a = rand(0, TAU), dd = rand(40, 160); world.zones.push({ id: world.nextId++, x: clamp(q.x + Math.cos(a) * dd, 40, W - 40), y: clamp(q.y + Math.sin(a) * dd, 40, H - 40), r: 55, life: 1.4, kind: 'spike', fired: false }); }
  }
}
function updateZones(world, dt, fx) {
  for (let i = world.zones.length - 1; i >= 0; i--) {
    const z = world.zones[i]; z.life -= dt;
    if (z.life <= 0) { world.zones.splice(i, 1); continue; }
    if (z.vx) { z.x = clamp(z.x + z.vx * dt, 40, world.W - 40); z.y = clamp(z.y + z.vy * dt, 40, world.H - 40); }
    if (z.kind === 'toxic') {
      for (const q of activePlayers(world)) if (dist2(q.x, q.y, z.x, z.y) < z.r * z.r) { drainPlayer(world, q, AMBIENT.toxicDps * dt, fx, '生化毒物'); q.toxicT = (q.toxicT || 0) + dt; if (q.toxicT > 0.5) { q.toxicT = 0; fx.local(q).text(q.x, q.y - 30, '中毒', '#3ddc84', 12, 0.5); fx.burst(q.x, q.y, '#3ddc84', 3, 60, 0.4, 2); } }
    } else if (z.kind === 'lava') {
      for (const q of activePlayers(world)) if (dist2(q.x, q.y, z.x, z.y) < z.r * z.r) { drainPlayer(world, q, 10 * dt, fx, '熔岩'); if (rnd() < dt * 2) { fx.local(q).text(q.x, q.y - 30, '燒傷', '#ff8c42', 12, 0.5); fx.burst(q.x, q.y, '#ff8c42', 3, 80, 0.4, 2); } }
      for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || o.ambient || o.element === 'fire' || dist2(o.x, o.y, z.x, z.y) > z.r * z.r) continue; o.hp -= 8 * dt; if (o.hp <= 0) killEnemy(world, j, null, fx); }
    } else if (z.kind === 'fire') {
      const owner = world.players.find(q => q.id === z.owner);
      for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || dist2(o.x, o.y, z.x, z.y) > (z.r + o.r * 0.5) ** 2) continue; hitEnemy(world, o, z.dps * dt, { by: owner, x: z.x, y: z.y, element: 'fire' }, fx); if (o.element !== 'fire') { o.burn = Math.max(o.burn || 0, 1); o.burnDps = z.dps * 0.5; o.burnBy = z.owner; } if (o.hp <= 0) killEnemy(world, j, owner, fx); }
      for (const bb of world.bosses) if (!bb.entering && bb.dying <= 0 && dist2(bb.x, bb.y, z.x, z.y) < (z.r + bb.r) ** 2) damageBoss(world, bb, z.dps * dt, bb.x, bb.y, fx);
    } else if (z.kind === 'hex') {
      for (const q of activePlayers(world)) if (dist2(q.x, q.y, z.x, z.y) < z.r * z.r) q.hexed = Math.max(q.hexed || 0, 0.15);
    } else if (z.kind === 'rift') {
      for (const b of world.bullets) { const bd = Math.hypot(z.x - b.x, z.y - b.y) || 1; if (bd < z.r) { b.vx += (z.x - b.x) / bd * 900 * dt; b.vy += (z.y - b.y) / bd * 900 * dt; if (bd < 16) b.life = 0; } }
      for (let j = world.enemies.length - 1; j >= 0; j--) { const o = world.enemies[j]; if (!o || o.ambient) continue; const od = Math.hypot(z.x - o.x, z.y - o.y) || 1; if (od < z.r) { o.vx += (z.x - o.x) / od * 300 * dt; o.vy += (z.y - o.y) / od * 300 * dt; if (od < z.r * 0.3) { o.hp -= 40 * dt; if (o.hp <= 0) killEnemy(world, j, null, fx); } } }
      for (const q of activePlayers(world)) { const qd = Math.hypot(z.x - q.x, z.y - q.y) || 1; if (qd < z.r) { q.vx += (z.x - q.x) / qd * 140 * dt; q.vy += (z.y - q.y) / qd * 140 * dt; } }
    } else if (z.kind === 'emp') {
      z.r += z.grow * dt;
      for (const q of activePlayers(world)) if (!z.hit.includes(q.id) && Math.abs(Math.hypot(q.x - z.x, q.y - z.y) - z.r) < 24) { z.hit.push(q.id); q.emp = 2; hurtPlayer(world, q, 8, fx, { x: z.x, y: z.y, by: 'EMP' }); fx.local(q).text(q.x, q.y - 34, 'EMP：2 秒不能衝刺 / 閃現', '#ffd166', 12, 1.2); }
    } else if (z.kind === 'geyser' || z.kind === 'spike') {
      if (z.life < 0.45 && !z.fired) { z.fired = true; const dmg = z.kind === 'geyser' ? 25 : 18; fx.burst(z.x, z.y, z.kind === 'geyser' ? '#ff8c42' : '#b8ffff', 22, 300, 0.5, 4); fx.ring(z.x, z.y, z.kind === 'geyser' ? '#ff8c42' : '#b8ffff', 10, z.r + 10, 0.3, 4); fx.noise(0.1, 0.08); for (const q of activePlayers(world)) if (dist2(q.x, q.y, z.x, z.y) < (z.r + q.r * 0.5) ** 2) hurtPlayer(world, q, dmg, fx, { x: z.x, y: z.y + 1, by: z.kind === 'geyser' ? '火柱' : '冰刺' }); }
    } else if (z.kind === 'pressure') {
      for (const q of activePlayers(world)) { const qd = Math.hypot(z.x - q.x, z.y - q.y) || 1; if (qd < z.r) { q.vx += (z.x - q.x) / qd * 220 * dt; q.vy += (z.y - q.y) / qd * 220 * dt; if (qd < 40) drainPlayer(world, q, 12 * dt, fx, '深海壓力'); } }
    }
  }
}

// ====================================================================
// 隨機事件
// ====================================================================
function pickEvent(world) {
  const keys = Object.keys(EVENTS).filter(k => k !== world.lastEvent);
  return keys[randInt(0, keys.length - 1)];
}
export function startEvent(world, id, fx) {
  const E = EVENTS[id]; if (!E) return;
  const W = world.W, H = world.H, n = nPlayers(world);
  world.event = { id, t: E.dur || 0.01 }; world.lastEvent = id; world.stats.events.push(id);
  fx.text(W / 2, H / 2 - 150, `${E.icon} ${E.name}`, '#ffd166', 32, 2.4); fx.text(W / 2, H / 2 - 112, E.desc, '#fff', 15, 2.6); fx.beep(660, 0.3, 'triangle', 0.08, 200);
  const p = nearestPlayer(world, W / 2, H / 2) || { x: W / 2, y: H / 2 };
  switch (id) {
    case 'supply': { const hp = 200 * n; world.crate = { kind: 'crate', x: clamp(p.x + rand(-300, 300), 120, W - 120), y: clamp(p.y + rand(-200, 200), 120, H - 120), r: 34, hp, maxHp: hp, hitFlash: 0, alive: true }; fx.ring(world.crate.x, world.crate.y, '#ffd166', 10, 120, 0.6, 4); for (let i = 0; i < 4 + n; i++) schedule(world, 1 + i * 0.6, () => spawnWithElite(world, rnd() < 0.5 ? 'drifter' : 'dart')); break; }
    case 'wormhole': for (let k = 0; k < 6; k++) { const a = k * TAU / 6, x = clamp(p.x + Math.cos(a) * 220, 40, W - 40), y = clamp(p.y + Math.sin(a) * 220, 40, H - 40); fx.ring(x, y, '#c77dff', 6, 50, 1, 3); schedule(world, 1, () => { fx.burst(x, y, '#c77dff', 12, 180, 0.4, 3); spawnWithElite(world, pickType(world), x, y); }, true); } break;
    case 'solarwind': { const a = rand(0, TAU); world.wind = { x: Math.cos(a) * 190, y: Math.sin(a) * 190, life: 10 }; break; }
    case 'blackhole': world.hole = { x: rand(300, W - 300), y: rand(220, H - 220), r: 300, life: 8 }; fx.shake(6); break;
    case 'rift': { const others = ARENAS.filter(a => a.id !== world.arena); const A = others[randInt(0, others.length - 1)]; fx.text(W / 2, H / 2 - 80, `來自${A.name}的生物`, ELEMENTS[A.element].color, 18, 2); for (let k = 0; k < 5; k++) schedule(world, 0.5 + k * 0.4, () => spawnEnemy(world, k === 0 ? A.unique : pickType(world), undefined, undefined, 1, { element: A.element }), true); break; }
    case 'duststorm': for (let k = 0; k < 8; k++) world.pickups.push({ id: world.nextId++, x: rand(80, W - 80), y: rand(80, H - 80), kind: 'dust', life: 15, t: 0 }); break;
    case 'hunter': { const types = ['sniper', 'warden', 'hexer', 'mortar']; const e = spawnEnemy(world, types[randInt(0, types.length - 1)], undefined, undefined, 1, { elite: true, affixes: 2, hunter: true }); e.speed *= 1.2; fx.text(W / 2, H / 2 - 80, `${enemyLabel(e)}獵人 · ${e.affixes.map(a => AFFIXES[a].name).join(' + ')}`, '#ff8c9c', 18, 2.4); break; }
    case 'eclipse': world.eclipse = 8; break;
    case 'shower': for (let k = 0; k < 8; k++) schedule(world, k * 0.5, () => spawnAmbient(world, 'meteor', fx, { silent: k > 0 })); break;
  }
}
function updateEvents(world, dt, fx) {
  if (world.wave >= EVENT_FROM_WAVE && world.scene === 'play' && world.bossWarn <= 0 && world.bosses.length === 0 && !world.mods.daily && !world.event && !world.waveMode) {
    world.eventCd -= dt;
    if (world.eventCd <= 0) { world.eventCd = rand(EVENT_CD[0], EVENT_CD[1]); startEvent(world, pickEvent(world), fx); }
  }
  const ev = world.event; if (!ev) return;
  ev.t -= dt;
  if (ev.id === 'supply' && world.crate) {
    const c = world.crate; c.hitFlash = Math.max(0, c.hitFlash - dt);
    if (!c.alive) { world.crate = null; world.event = null; fx.text(c.x, c.y - 40, '補給被搶走', '#ff5f7a', 20, 1.5); return; }
    if (ev.t <= 0) {
      world.stats.crateHp = c.hp / c.maxHp;
      fx.text(c.x, c.y - 50, `補給箱守住了！${c.hp === c.maxHp ? '（完好無缺）' : ''}`, '#ffd166', 24, 2); fx.burst(c.x, c.y, '#ffd166', 40, 300, 0.7, 4); fx.sfx('wave');
      const kinds = ['heal', 'shield', 'spread', 'rapid'];
      for (let k = 0; k < 3; k++) world.pickups.push({ id: world.nextId++, x: c.x + rand(-60, 60), y: c.y + rand(-40, 40), kind: kinds[randInt(0, 3)], life: 15, t: 0 });
      for (let k = 0; k < 3; k++) world.pickups.push({ id: world.nextId++, x: c.x + rand(-80, 80), y: c.y + rand(-60, 60), kind: 'dust', life: 15, t: 0 });
      world.crate = null;
    }
  }
  if (ev.t <= 0) world.event = null;
}
