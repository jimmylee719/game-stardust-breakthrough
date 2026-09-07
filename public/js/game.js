// 遊戲邏輯核心（權威模擬）。
// 規則：不碰 DOM、Canvas、Audio、window、setTimeout。所有視聽回饋透過 fx 介面通知外界。
// 這個模組未來會原封不動搬到伺服器執行；瀏覽器端只保留渲染與輸入。
import { TAU, rand, randInt, clamp, dist2, angleDiff } from '../../shared/math.js';
import { WORLD, PLAYER_BASE, PLAYER_COLORS, ENEMY_TYPES, BOSS_NAMES, BOSS_EVERY, UPGRADES, sanitizeName } from '../../shared/constants.js';

// ---------- fx 介面（預設全部 no-op，讓邏輯可在無視聽環境執行） ----------
const noop = () => {};
export const NULL_FX = {
  burst: noop, burstDir: noop, ring: noop, muzzle: noop, ghost: noop, text: noop,
  shake: noop, flash: noop, slowmo: noop, hitStop: noop, aberrate: noop, zoom: noop, crossPunch: noop, crossRecoil: noop,
  sfx: noop, beep: noop, noise: noop,
  /** 只對本機玩家生效的效果（多人時其他人的受擊不該震到你的畫面） */
  local: () => NULL_FX,
};

// ---------- 世界 ----------
export function createWorld() {
  return {
    W: WORLD.W, H: WORLD.H,
    scene: 'menu',           // menu | play | pause | upgrade | gameover
    time: 0, wave: 0, waveTimer: 1.5, score: 0, combo: 0, comboTimer: 0,
    players: [], bullets: [], enemies: [], enemyBullets: [], pickups: [],
    boss: null, bossWarn: 0, upgradeOffered: false,
    pendingUpgrades: new Map(),   // playerId -> [UPGRADE, UPGRADE, UPGRADE]
    timers: [],                   // { at, fn } 以世界時間排程，取代 setTimeout
    nextId: 1,
    events: [],                   // 一次性事件（未來給網路廣播用）
  };
}

export function addPlayer(world, { id, name, local = false }) {
  const idx = world.players.length;
  const p = {
    id: id ?? world.nextId++, name: sanitizeName(name), local, color: PLAYER_COLORS[idx % PLAYER_COLORS.length],
    x: world.W / 2 + (idx - 1.5) * 60, y: world.H / 2, vx: 0, vy: 0, angle: 0,
    r: PLAYER_BASE.r, hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.maxHp, dead: false,
    fireCd: 0, fireRate: PLAYER_BASE.fireRate, damage: PLAYER_BASE.damage, spread: PLAYER_BASE.spread,
    dashCd: 0, dashCdMax: PLAYER_BASE.dashCd, dashing: 0, inv: 0, shield: 0, rapid: 0,
    upgrades: {}, drones: [], speedMul: 1, magnetR: PLAYER_BASE.magnetR,
    lifesteal: 0, explosive: 0, pierce: 0, bounce: 0, homing: 0, bulletSize: 1,
    kills: 0,
    input: { ix: 0, iy: 0, angle: 0, fire: false, dash: false },
  };
  world.players.push(p);
  return p;
}

/** 開始一局：重置世界（保留玩家名單與名字），wave 可指定起始波（測試用） */
export function startRun(world, { startWave = 0 } = {}) {
  const roster = world.players.map(p => ({ id: p.id, name: p.name, local: p.local }));
  const fresh = createWorld();
  Object.assign(world, fresh, { players: [] });
  roster.forEach(r => addPlayer(world, r));
  world.wave = startWave;
  world.upgradeOffered = startWave > 0;
  world.scene = 'play';
}

export function togglePause(world) {
  if (world.scene === 'play') world.scene = 'pause';
  else if (world.scene === 'pause') world.scene = 'play';
}

function schedule(world, delay, fn) { world.timers.push({ at: world.time + delay, fn }); }
function alivePlayers(world) { return world.players.filter(p => !p.dead); }
function nearestPlayer(world, x, y) {
  let best = null, bd = Infinity;
  for (const p of alivePlayers(world)) { const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
export function nearestTarget(world, x, y, maxD) {
  let best = null, bd = maxD * maxD;
  for (const e of world.enemies) { const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
  const b = world.boss;
  if (b && !b.entering && b.dying <= 0) { const d = dist2(x, y, b.x, b.y); if (d < bd) { bd = d; best = b; } }
  return best;
}

// ---------- 敵人 ----------
function spawnEnemy(world, type, x, y, scale = 1) {
  const t = ENEMY_TYPES[type];
  if (x === undefined) {
    const side = randInt(0, 3), m = 40;
    if (side === 0) { x = rand(0, world.W); y = -m; }
    else if (side === 1) { x = world.W + m; y = rand(0, world.H); }
    else if (side === 2) { x = rand(0, world.W); y = world.H + m; }
    else { x = -m; y = rand(0, world.H); }
  }
  const nPlayers = Math.max(1, world.players.length);
  const hpMul = (1 + world.wave * 0.08) * (1 + (nPlayers - 1) * 0.35);
  world.enemies.push({
    id: world.nextId++, type, x, y, vx: 0, vy: 0, r: t.r * scale,
    hp: t.hp * hpMul * scale, maxHp: t.hp * hpMul * scale,
    speed: t.speed * (1 + world.wave * 0.02), color: t.color, score: Math.round(t.score * scale),
    kind: t.kind, contact: t.contact, split: t.split && scale === 1,
    shootCd: rand(1, 2.5), wobble: rand(0, TAU), hitFlash: 0, squash: 0,
  });
}

function nextWave(world, fx) {
  world.wave++;
  world.upgradeOffered = false;
  if (world.wave % BOSS_EVERY === 0) { startBossWave(world, fx); return; }
  fx.sfx('wave');
  fx.text(world.W / 2, world.H / 2 - 60, `第 ${world.wave} 波`, '#fff', 36, 1.6);
  const nPlayers = Math.max(1, world.players.length);
  const n = Math.round((4 + world.wave * 2) * (1 + (nPlayers - 1) * 0.5));
  for (let i = 0; i < n; i++) {
    const roll = Math.random();
    let type = 'drifter';
    if (world.wave >= 2 && roll < 0.25) type = 'dart';
    if (world.wave >= 3 && roll > 0.8) type = 'shooter';
    if (world.wave >= 4 && roll > 0.7 && roll <= 0.8) type = 'splitter';
    if (world.wave >= 5 && roll > 0.92) type = 'tank';
    schedule(world, i * 0.35, () => spawnEnemy(world, type));
  }
  if (world.wave % 3 === 0) schedule(world, 0.8, () => spawnEnemy(world, 'tank'));
}

// ---------- Boss ----------
function startBossWave(world, fx) {
  world.bossWarn = 2.6;
  [0, 0.5, 1].forEach(d => schedule(world, d, () => fx.beep(220, 0.35, 'sawtooth', 0.12, -40)));
  fx.shake(6);
  world.enemyBullets.length = 0;
}
function spawnBoss(world, fx) {
  const tier = Math.floor(world.wave / BOSS_EVERY);
  const nPlayers = Math.max(1, world.players.length);
  const hp = 700 * (1 + (tier - 1) * 0.7) * (1 + (nPlayers - 1) * 0.6);
  world.boss = {
    id: world.nextId++, tier, name: BOSS_NAMES[Math.min(tier - 1, BOSS_NAMES.length - 1)],
    x: world.W / 2, y: -120, r: 58, hp, maxHp: hp, phase: 1,
    vx: 0, vy: 0, t: 0, spin: 0, hitFlash: 0,
    entering: true, atk: 'idle', atkT: 1.8, atkIdx: 0, sub: 0, aim: 0, chargeDir: null, chargeT: 0, dying: 0,
    color: '#ff3860',
  };
  fx.sfx('wave');
}
function bossFire(world, x, y, a, spd, r = 6, life = 4) {
  world.enemyBullets.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, life, r, boss: true });
}
function updateBoss(world, dt, fx) {
  const b = world.boss, W = world.W, H = world.H;
  b.t += dt; b.spin += dt * (b.phase === 3 ? 2.5 : 1.2);
  b.hitFlash = Math.max(0, b.hitFlash - dt);

  if (b.dying > 0) {
    b.dying -= dt;
    if (Math.random() < 0.5) { fx.burst(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), Math.random() < 0.5 ? '#fff' : b.color, 8, 200, 0.5, 4); fx.noise(0.1, 0.1); }
    fx.shake(6);
    if (b.dying <= 0) killBoss(world, fx);
    return;
  }
  if (b.entering) {
    b.y += (H * 0.25 - b.y) * Math.min(1, dt * 2.5);
    if (Math.abs(b.y - H * 0.25) < 2) { b.entering = false; fx.text(W / 2, H / 2 - 40, b.name, b.color, 40, 1.8); }
    return;
  }
  const p = nearestPlayer(world, b.x, b.y);
  if (!p) return;

  const frac = b.hp / b.maxHp;
  const wantPhase = frac < 0.33 ? 3 : frac < 0.66 ? 2 : 1;
  if (wantPhase !== b.phase) {
    b.phase = wantPhase;
    b.color = b.phase === 2 ? '#ff8c42' : '#ff3860';
    fx.burst(b.x, b.y, '#fff', 40, 350, 0.8, 4); fx.shake(14); fx.slowmo(0.4);
    fx.ring(b.x, b.y, '#fff', b.r, b.r + 260, 0.5, 5); fx.hitStop(0.15); fx.aberrate(1);
    fx.text(b.x, b.y - b.r - 40, b.phase === 3 ? '狂暴模式！' : '第二階段', '#fff', 26, 1.4);
    world.enemyBullets.length = 0;
    b.atk = 'idle'; b.atkT = 1.2;
  }

  if (b.atk !== 'charge') {
    const targetX = clamp(p.x + Math.sin(b.t * 0.8) * 180, b.r + 20, W - b.r - 20);
    const targetY = H * 0.25 + Math.sin(b.t * 1.3) * 40;
    b.vx += (targetX - b.x) * 1.5 * dt; b.vy += (targetY - b.y) * 1.5 * dt;
    b.vx *= Math.pow(0.1, dt); b.vy *= Math.pow(0.1, dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
  }

  b.atkT -= dt;
  const aimA = Math.atan2(p.y - b.y, p.x - b.x);
  switch (b.atk) {
    case 'idle':
      if (b.atkT <= 0) {
        const pool = b.phase === 1 ? ['ring', 'volley', 'ring', 'charge']
                   : b.phase === 2 ? ['spiral', 'volley', 'charge', 'summon', 'ring']
                   : ['spiral', 'charge', 'volley', 'summon', 'spiral', 'charge'];
        b.atk = pool[b.atkIdx++ % pool.length];
        b.atkT = 0; b.sub = 0;
        if (b.atk === 'charge') { b.atkT = 0.9; b.chargeDir = null; fx.text(b.x, b.y - b.r - 20, '!!', '#ffd166', 30, 0.8); fx.beep(180, 0.5, 'sawtooth', 0.08, 200); }
      }
      break;
    case 'ring':
      if (b.atkT <= 0) {
        const n = 16 + b.tier * 4, off = b.sub * 0.2;
        for (let i = 0; i < n; i++) bossFire(world, b.x, b.y, off + i * TAU / n, 170 + b.tier * 20);
        fx.beep(260, 0.15, 'square', 0.07, -100);
        b.sub++; b.atkT = 0.45;
        if (b.sub >= 3) { b.atk = 'idle'; b.atkT = 1.6 - b.phase * 0.2; }
      }
      break;
    case 'spiral':
      if (b.atkT <= 0) {
        const arms = b.phase === 3 ? 3 : 2;
        for (let k = 0; k < arms; k++) bossFire(world, b.x, b.y, b.spin * 3 + k * TAU / arms, 220, 5, 5);
        b.sub++; b.atkT = 0.06;
        if (b.sub >= 45) { b.atk = 'idle'; b.atkT = 1.4; }
      }
      break;
    case 'volley':
      if (b.atkT <= 0) {
        const spread = b.phase === 1 ? 3 : 5;
        for (let i = 0; i < spread; i++) bossFire(world, b.x + Math.cos(aimA) * b.r, b.y + Math.sin(aimA) * b.r, aimA + (i - (spread - 1) / 2) * 0.18, 340, 6, 3);
        fx.beep(500, 0.1, 'square', 0.06, -300);
        b.sub++; b.atkT = 0.35;
        if (b.sub >= 3) { b.atk = 'idle'; b.atkT = 1.3; }
      }
      break;
    case 'charge':
      if (!b.chargeDir) {
        b.aim = aimA;
        if (b.atkT <= 0) { b.chargeDir = { x: Math.cos(aimA), y: Math.sin(aimA) }; b.chargeT = 0.7; fx.sfx('dash'); fx.shake(8); }
      } else {
        const spd = 800 + b.tier * 80;
        b.x += b.chargeDir.x * spd * dt; b.y += b.chargeDir.y * spd * dt;
        fx.ghost(b.x, b.y, b.r * 0.9, b.color, 0.35);
        b.chargeT -= dt;
        const hitWall = b.x < b.r || b.x > W - b.r || b.y < b.r || b.y > H - b.r;
        if (b.chargeT <= 0 || hitWall) {
          b.x = clamp(b.x, b.r, W - b.r); b.y = clamp(b.y, b.r, H - b.r);
          if (hitWall) { fx.shake(16); fx.burst(b.x, b.y, b.color, 24, 300, 0.6, 4); fx.noise(0.2, 0.2); }
          b.vx = 0; b.vy = 0; b.atk = 'idle'; b.atkT = 1.2;
        }
      }
      break;
    case 'summon':
      if (b.atkT <= 0) {
        const n = 2 + b.tier;
        for (let i = 0; i < n; i++) { const a = i * TAU / n + b.t; spawnEnemy(world, Math.random() < 0.5 ? 'dart' : 'drifter', b.x + Math.cos(a) * (b.r + 30), b.y + Math.sin(a) * (b.r + 30)); }
        fx.burst(b.x, b.y, '#f15bb5', 20, 250, 0.5, 3);
        fx.beep(330, 0.3, 'triangle', 0.08, 300);
        b.atk = 'idle'; b.atkT = 2;
      }
      break;
  }

  for (const q of alivePlayers(world)) {
    if (dist2(b.x, b.y, q.x, q.y) < (b.r + q.r) ** 2) {
      hurtPlayer(world, q, 35, fx);
      const a = Math.atan2(q.y - b.y, q.x - b.x);
      q.vx = Math.cos(a) * 500; q.vy = Math.sin(a) * 500;
    }
  }
}
function damageBoss(world, dmg, x, y, fx) {
  const b = world.boss;
  if (!b || b.entering || b.dying > 0) return;
  b.hp -= dmg; b.hitFlash = 0.06;
  fx.burst(x, y, b.color, 3, 100, 0.3, 2);
  if (b.hp <= 0) { b.hp = 0; b.dying = 1.6; fx.slowmo(1.2); world.enemyBullets.length = 0; fx.sfx('explode'); }
}
function killBoss(world, fx) {
  const b = world.boss;
  const gain = 500 * b.tier;
  world.score += gain; world.combo += 10; world.comboTimer = 3;
  fx.text(b.x, b.y - 20, `BOSS 擊破 +${gain}`, '#ffd166', 34, 2);
  fx.burst(b.x, b.y, '#fff', 80, 500, 1.2, 6); fx.burst(b.x, b.y, b.color, 80, 400, 1.2, 5);
  fx.ring(b.x, b.y, '#fff', b.r, Math.max(world.W, world.H), 0.9, 8); fx.ring(b.x, b.y, b.color, b.r, Math.max(world.W, world.H) * 0.6, 0.7, 5);
  fx.shake(24); fx.flash(0.6); fx.hitStop(0.25); fx.aberrate(1); fx.zoom(1); fx.crossPunch();
  const kinds = ['heal', 'shield', 'spread', 'rapid'];
  for (let i = 0; i < 3; i++) world.pickups.push({ x: b.x + rand(-60, 60), y: b.y + rand(-40, 40), kind: kinds[randInt(0, 3)], life: 15, t: 0 });
  for (const p of world.players) {
    p.maxHp += 20; if (!p.dead) p.hp = Math.min(p.maxHp, p.hp + 40);
    fx.text(p.x, p.y - 40, '最大生命 +20', '#3ddc84', 18, 1.5);
  }
  world.boss = null;
  world.waveTimer = 4;
}

// ---------- 子彈 / 道具 ----------
function spawnBullet(world, p, x, y, a, dmgMul = 1) {
  world.bullets.push({
    owner: p.id, x, y, vx: Math.cos(a) * PLAYER_BASE.bulletSpeed, vy: Math.sin(a) * PLAYER_BASE.bulletSpeed,
    life: PLAYER_BASE.bulletLife, dmg: p.damage * dmgMul,
    pierce: p.pierce, bounce: p.bounce, homing: p.homing, size: p.bulletSize, hit: new Set(),
  });
}
function spawnPickup(world, x, y) {
  const roll = Math.random();
  let kind = null;
  if (roll < 0.10) kind = 'heal';
  else if (roll < 0.17) kind = 'spread';
  else if (roll < 0.24) kind = 'rapid';
  else if (roll < 0.29) kind = 'shield';
  else if (roll < 0.34) kind = 'bomb';
  if (kind) world.pickups.push({ x, y, kind, life: 10, t: 0 });
}
function applyPickup(world, p, kind, fx) {
  fx.sfx('pickup');
  const labels = { heal: '+HP', spread: '散射', rapid: '連射', shield: '護盾', bomb: '炸彈' };
  const colors = { heal: '#3ddc84', spread: '#ffd166', rapid: '#ff8c42', shield: '#4cc9f0', bomb: '#ff3860' };
  fx.text(p.x, p.y - 30, labels[kind], colors[kind], 18);
  switch (kind) {
    case 'heal': p.hp = Math.min(p.maxHp, p.hp + 30); break;
    case 'spread': p.spread = Math.min(5, p.spread + 1); break;
    case 'rapid': p.rapid = 8; break;
    case 'shield': p.shield = Math.min(3, p.shield + 1); break;
    case 'bomb':
      fx.shake(20); fx.flash(0.8); fx.slowmo(0.5);
      for (let i = world.enemies.length - 1; i >= 0; i--) { const o = world.enemies[i]; if (!o) continue; o.hp -= 60; if (o.hp <= 0) killEnemy(world, i, p, fx); }
      damageBoss(world, 120, world.boss?.x ?? 0, world.boss?.y ?? 0, fx);
      world.enemyBullets.length = 0;
      fx.burst(p.x, p.y, '#ff3860', 60, 500, 0.8, 4);
      break;
  }
}

// ---------- 擊殺 / 受傷 ----------
function killEnemy(world, idx, killer, fx) {
  const e = world.enemies[idx];
  if (!e) return;
  world.enemies.splice(idx, 1);
  world.combo++; world.comboTimer = 2.2;
  const mult = 1 + Math.floor(world.combo / 5) * 0.5;
  const gain = Math.round(e.score * mult);
  world.score += gain;
  if (killer) killer.kills++;
  fx.text(e.x, e.y - 10, `+${gain}${mult > 1 ? ' ×' + mult : ''}`, e.color, 14 + Math.min(world.combo, 20) * 0.4);
  const big = e.type === 'tank';
  fx.burst(e.x, e.y, e.color, big ? 40 : 18, big ? 320 : 220, 0.7, big ? 5 : 3);
  fx.burst(e.x, e.y, '#ffffff', 6, 80, 0.3, 2);
  fx.ring(e.x, e.y, '#fff', e.r, e.r + (big ? 110 : 55), 0.28, big ? 4 : 2.5);
  fx.ring(e.x, e.y, e.color, e.r * 0.5, e.r + (big ? 70 : 35), 0.22, 2);
  fx.shake(big ? 12 : 4);
  const lfx = fx.local(killer);
  lfx.hitStop(big ? 0.09 : 0.045); lfx.crossPunch(); lfx.zoom(big ? 1 : 0.4);
  if (big) lfx.aberrate(0.5);
  fx.sfx('explode');
  fx.beep(330 + Math.min(world.combo, 30) * 22, 0.09, 'triangle', 0.06, 200);
  if (e.split) for (let i = 0; i < 3; i++) spawnEnemy(world, 'splitter', e.x + rand(-20, 20), e.y + rand(-20, 20), 0.5);
  spawnPickup(world, e.x, e.y);
  if (big) fx.slowmo(0.35);
  if (killer) {
    if (killer.lifesteal > 0 && !killer.dead) killer.hp = Math.min(killer.maxHp, killer.hp + killer.lifesteal);
    if (killer.explosive > 0 && !e.fromChain) {
      const R = 90;
      fx.burst(e.x, e.y, '#ff8c42', 14, 260, 0.45, 4);
      fx.ghost(e.x, e.y, R, '#ff8c42', 0.25);
      for (let i = world.enemies.length - 1; i >= 0; i--) {
        const o = world.enemies[i];
        if (!o) continue;
        if (dist2(o.x, o.y, e.x, e.y) < (R + o.r) ** 2) { o.hp -= killer.explosive; o.hitFlash = 0.1; if (o.hp <= 0) { o.fromChain = true; killEnemy(world, i, killer, fx); } }
      }
      if (world.boss && dist2(world.boss.x, world.boss.y, e.x, e.y) < (R + world.boss.r) ** 2) damageBoss(world, killer.explosive, e.x, e.y, fx);
    }
  }
}

function hurtPlayer(world, p, dmg, fx) {
  if (p.dead || p.inv > 0) return;
  const lfx = fx.local(p);
  if (p.shield > 0) {
    p.shield--; p.inv = 0.6;
    fx.burst(p.x, p.y, '#4cc9f0', 20, 200, 0.5, 3); fx.beep(600, 0.15, 'sine', 0.08, -300); fx.text(p.x, p.y - 30, '護盾抵擋', '#4cc9f0');
    return;
  }
  p.hp -= dmg; p.inv = 0.8;
  lfx.flash(1); lfx.shake(14); lfx.hitStop(0.08); lfx.aberrate(0.9);
  world.combo = 0;
  fx.burst(p.x, p.y, '#ff5f7a', 16, 200, 0.5, 3);
  fx.ring(p.x, p.y, '#ff5f7a', 10, 90, 0.35, 3);
  fx.sfx('hurt');
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true;
    fx.burst(p.x, p.y, '#ffffff', 50, 300, 1, 4); fx.burst(p.x, p.y, p.color, 30, 250, 0.8, 3);
    fx.shake(24);
    fx.text(p.x, p.y - 40, `${p.name} 陣亡`, '#ff5f7a', 20, 2);
    if (alivePlayers(world).length === 0) { world.scene = 'gameover'; fx.sfx('gameover'); }
  }
}

// ---------- 升級 ----------
function offerUpgrades(world, fx) {
  world.pendingUpgrades.clear();
  for (const p of alivePlayers(world)) {
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
  fx.text(p.x, p.y - 40, `${u.icon} ${u.name}`, '#ffd166', 22, 1.6);
  fx.burst(p.x, p.y, '#ffd166', 20, 200, 0.6, 3);
  fx.sfx('pickup');
  world.pendingUpgrades.delete(playerId);
  if (world.pendingUpgrades.size === 0) { world.scene = 'play'; world.waveTimer = 2.5; }
  return true;
}

// ---------- 主更新 ----------
export function update(world, dt, fx = NULL_FX) {
  if (world.scene !== 'play') return;
  const W = world.W, H = world.H;
  world.time += dt;

  // 排程
  for (let i = world.timers.length - 1; i >= 0; i--) if (world.timers[i].at <= world.time) world.timers.splice(i, 1)[0].fn();

  // 玩家
  for (const p of world.players) {
    if (p.dead) continue;
    const lfx = fx.local(p);
    const inp = p.input;
    let ix = inp.ix, iy = inp.iy;
    const len = Math.hypot(ix, iy) || 1; ix /= len; iy /= len;

    p.dashCd = Math.max(0, p.dashCd - dt);
    if (inp.dash && p.dashCd <= 0 && (ix || iy)) {
      p.dashing = PLAYER_BASE.dashTime; p.dashCd = p.dashCdMax; p.inv = Math.max(p.inv, 0.25);
      p.vx = ix * PLAYER_BASE.dashSpeed; p.vy = iy * PLAYER_BASE.dashSpeed;
      fx.sfx('dash'); fx.burst(p.x, p.y, p.color, 10, 120, 0.4, 2);
    }
    if (p.dashing > 0) {
      p.dashing -= dt;
      fx.ghost(p.x, p.y, 8, p.color, 0.3);
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

    // 射擊
    p.fireCd -= dt;
    if (inp.fire && p.fireCd <= 0) {
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
        if (t) { d.cd = 0.5; spawnBullet(world, p, d.x, d.y, Math.atan2(t.y - d.y, t.x - d.x), 0.6); fx.beep(1200, 0.04, 'square', 0.02, -400); }
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
      if (hit) { b.bounce--; b.life = Math.max(b.life, 0.8); fx.burst(b.x, b.y, '#fff', 3, 80, 0.2, 2); }
    }
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) { world.bullets.splice(i, 1); continue; }
    const hitR = 4 * b.size;
    const boss = world.boss;
    if (boss && !b.hit.has(boss) && dist2(b.x, b.y, boss.x, boss.y) < (boss.r + hitR) ** 2) {
      damageBoss(world, b.dmg, b.x, b.y, fx); fx.sfx('hit');
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
  for (let i = world.enemies.length - 1; i >= 0; i--) {
    const e = world.enemies[i];
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.squash = Math.max(0, e.squash - dt * 9);
    e.wobble += dt * 3;
    const p = nearestPlayer(world, e.x, e.y);
    if (!p) break;
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    let tx = dx / d, ty = dy / d;
    if (e.kind === 'orbit') {
      const radial = d > 260 ? 1 : -1;
      tx = tx * radial * 0.7 + (-dy / d) * 0.7; ty = ty * radial * 0.7 + (dx / d) * 0.7;
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < 500) {
        e.shootCd = rand(1.4, 2.4);
        const a = Math.atan2(dy, dx);
        world.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 3, r: 5 });
        fx.beep(400, 0.1, 'sine', 0.04, -200);
      }
    }
    if (e.type === 'dart') { tx += Math.cos(e.wobble) * 0.5; ty += Math.sin(e.wobble) * 0.5; }
    for (let j = 0; j < world.enemies.length; j++) {
      if (i === j) continue;
      const o = world.enemies[j];
      const ddx = e.x - o.x, ddy = e.y - o.y, dd = Math.hypot(ddx, ddy), min = e.r + o.r;
      if (dd < min && dd > 0) { e.x += ddx / dd * (min - dd) * 4 * dt; e.y += ddy / dd * (min - dd) * 4 * dt; }
    }
    e.vx += (tx * e.speed - e.vx) * Math.min(1, dt * 3);
    e.vy += (ty * e.speed - e.vy) * Math.min(1, dt * 3);
    e.x += e.vx * dt; e.y += e.vy * dt;
    for (const q of alivePlayers(world)) {
      if (dist2(e.x, e.y, q.x, q.y) < (e.r + q.r) ** 2) {
        hurtPlayer(world, q, e.contact, fx);
        const a = Math.atan2(e.y - q.y, e.x - q.x);
        e.vx = Math.cos(a) * 300; e.vy = Math.sin(a) * 300;
        q.vx -= Math.cos(a) * 250; q.vy -= Math.sin(a) * 250;
      }
    }
  }

  // 敵方子彈
  for (let i = world.enemyBullets.length - 1; i >= 0; i--) {
    const b = world.enemyBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0) { world.enemyBullets.splice(i, 1); continue; }
    for (const q of alivePlayers(world)) {
      if (dist2(b.x, b.y, q.x, q.y) < (b.r + q.r) ** 2) { hurtPlayer(world, q, 15, fx); world.enemyBullets.splice(i, 1); break; }
    }
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

  // 連擊
  if (world.comboTimer > 0) { world.comboTimer -= dt; if (world.comboTimer <= 0) world.combo = 0; }

  // Boss
  if (world.bossWarn > 0) { world.bossWarn -= dt; if (world.bossWarn <= 0) spawnBoss(world, fx); }
  if (world.boss) updateBoss(world, dt, fx);

  // 波次
  if (world.enemies.length === 0 && !world.boss && world.bossWarn <= 0 && world.scene === 'play') {
    if (world.wave > 0 && !world.upgradeOffered) { world.upgradeOffered = true; offerUpgrades(world, fx); return; }
    world.waveTimer -= dt;
    if (world.waveTimer <= 0) { nextWave(world, fx); world.waveTimer = 2.5; }
  }
}
