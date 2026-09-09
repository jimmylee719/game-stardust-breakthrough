// 世界快照：伺服器每 tick 把世界壓成可 JSON 化的物件；客戶端還原並做插值。
import { UPGRADES, EVOLUTIONS } from './constants.js';
import { angleDiff, lerp } from './math.js';

const r1 = v => Math.round(v * 10) / 10;

export function snapshotWorld(world) {
  return {
    scene: world.scene, time: r1(world.time), wave: world.wave, waveTimer: r1(world.waveTimer),
    score: world.score, combo: world.combo, comboTimer: r1(world.comboTimer), bossWarn: r1(world.bossWarn),
    waveMode: world.waveMode, modeTimer: r1(world.modeTimer), abandoned: world.abandoned || undefined, won: world.won || undefined, endless: world.endless || undefined,
    arena: world.arena, waveTheme: world.waveTheme || undefined, event: world.event ? { id: world.event.id, t: r1(world.event.t) } : null, dustBonus: world.dustBonus || undefined,
    crate: world.crate ? { kind: 'crate', x: world.crate.x, y: world.crate.y, r: world.crate.r, hp: Math.round(world.crate.hp), maxHp: world.crate.maxHp, hitFlash: world.crate.hitFlash > 0 ? 1 : 0, alive: world.crate.alive } : null,
    hole: world.hole ? { x: world.hole.x, y: world.hole.y, r: world.hole.r, life: r1(world.hole.life) } : null,
    wells: world.wells.map(w => ({ id: w.id, x: w.x, y: w.y, r: w.r, life: r1(w.life) })),
    drag: world.drag !== 1 ? world.drag : undefined, flare: world.flare ? { x: r1(world.flare.x), sx: world.flare.sx, w: world.flare.w, t: r1(world.flare.t), dir: world.flare.dir } : null,
    blizzard: world.blizzard > 0 ? r1(world.blizzard) : undefined, wind: world.wind ? { x: r1(world.wind.x), y: r1(world.wind.y) } : null, eclipse: world.eclipse > 0 ? r1(world.eclipse) : undefined,
    stats: world.stats,
    beacon: world.beacon ? { x: r1(world.beacon.x), y: r1(world.beacon.y), r: world.beacon.r, hp: Math.round(world.beacon.hp), maxHp: world.beacon.maxHp, hitFlash: world.beacon.hitFlash > 0 ? 1 : 0, alive: world.beacon.alive, kind: world.beacon.kind } : null,
    zones: world.zones.map(z => ({ id: z.id, x: r1(z.x), y: r1(z.y), r: r1(z.r), life: r1(z.life), kind: z.kind, fired: z.fired || undefined })), safeZones: world.safeZones.map(z => ({ id: z.id, x: z.x, y: z.y, r: z.r })), doom: world.doom ? { t: r1(world.doom.t), warn: world.doom.warn } : null,
    lasers: world.lasers.map(L => ({ id: L.id, x: r1(L.x), y: r1(L.y), angle: r1(L.angle * 100) / 100, phase: L.phase, t: r1(L.t), warn: L.warn, len: L.len, w: L.w, boss: L.boss, color: L.color })),
    players: world.players.map(p => ({
      id: p.id, name: p.name, color: p.color, x: r1(p.x), y: r1(p.y), vx: r1(p.vx), vy: r1(p.vy), angle: r1(p.angle * 100) / 100,
      r: p.r, hp: Math.round(p.hp), maxHp: p.maxHp, dead: p.dead, downed: p.downed, downTimer: r1(p.downTimer), reviveProgress: r1(p.reviveProgress), offline: p.offline,
      shield: p.shield, rapid: r1(p.rapid), spread: p.spread, laser: r1(p.laser), laserOn: p.laserOn || undefined, ship: p.ship, syn: Object.keys(p.syn), weapon: p.weapon, weaponOn: p.weaponOn || undefined, arcCharge: p.arcCharge ? r1(p.arcCharge) : undefined, skin: p.skin, blinkCd: r1(p.blinkCd), blinkCdMax: p.blinkCdMax, blinkFlash: p.blinkFlash > 0 ? 1 : undefined,
      beam: p.beam || undefined, beamW: p.beam ? r1(p.beamW) : undefined, swingT: p.swingT > 0 ? r1(p.swingT) : undefined, swingDir: p.swingDir || undefined, turrets: p.turrets && p.turrets.length ? p.turrets.map(t => ({ x: r1(t.x), y: r1(t.y), a: r1(t.a * 100) / 100, life: r1(t.life) })) : undefined,
      evolved: p.evolved || undefined, emp: p.emp > 0 ? r1(p.emp) : undefined, frozen: p.frozen > 0 ? r1(p.frozen) : undefined, hexed: p.hexed > 0 ? 1 : undefined, fs: p.flags && p.flags.frontShield ? 1 : undefined, sb: p.flags && p.flags.shieldBash ? 1 : undefined, speedMul: p.speedMul !== 1 ? r1(p.speedMul * 100) / 100 : undefined, bs: p.bulletSize !== 1 ? r1(p.bulletSize * 100) / 100 : undefined, fa: p.weaponOn && p.weapon === 'flame' ? r1(p.fa * 100) / 100 : undefined, fr: p.fr ? Math.round(p.fr) : undefined, fc: p.fc ? r1(p.fc * 100) / 100 : undefined,
      dashCd: r1(p.dashCd), dashCdMax: r1(p.dashCdMax), dashing: r1(p.dashing), inv: r1(p.inv), seq: p.lastSeq, kills: p.kills, upgrades: p.upgrades,
      drones: p.drones.map(d => ({ x: r1(d.x ?? p.x), y: r1(d.y ?? p.y), a: r1(d.a) })),
    })),
    bullets: world.bullets.map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), size: b.size, homing: b.homing, burn: b.burn || undefined, rail: b.rail || undefined, slash: b.slash || undefined, element: b.element || undefined })),
    enemies: world.enemies.map(e => ({ id: e.id, type: e.type, x: r1(e.x), y: r1(e.y), vx: r1(e.vx), vy: r1(e.vy), r: e.r, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), color: e.color, hitFlash: e.hitFlash > 0 ? 1 : 0, ambient: e.ambient || undefined, ally: e.ally || undefined, life: e.ambient ? r1(e.life) : undefined, buffed: (e.buffSpeed > 0 || e.buffRapid > 0 || e.buffSpread > 0 || e.armored) ? 1 : undefined, burn: e.burn > 0 ? 1 : undefined, stun: e.stun > 0 ? 1 : undefined, slow: e.slow > 0 ? 1 : undefined, squash: r1(e.squash), wobble: r1(e.wobble), rot: r1(e.rot), elite: e.elite || undefined, tier: e.tier || undefined, lunge: e.lunge > 0 ? 1 : undefined, blinkFlash: e.blinkFlash > 0 ? 1 : undefined,
      element: e.element && e.element !== 'neutral' ? e.element : undefined, affixes: e.affixes && e.affixes.length ? e.affixes : undefined, sh: e.shieldHp > 0 ? 1 : undefined, ph: e.phaseT > 0 ? 1 : undefined, aimT: e.aimT > 0 ? r1(e.aimT) : undefined, aimA: e.aimT > 0 ? r1(e.aimA * 100) / 100 : undefined, fx: e.kind === 'warden' ? r1(e.fx * 100) / 100 : undefined, fy: e.kind === 'warden' ? r1(e.fy * 100) / 100 : undefined, lure: e.lure || undefined, hunter: e.hunter || undefined, cmd: e.cmdT > 0 ? 1 : undefined })),
    enemyBullets: world.enemyBullets.map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: r1(b.vx), vy: r1(b.vy), r: b.r, boss: !!b.boss, homing: b.homing ? 1 : undefined, wall: b.wall || undefined, kind: b.kind, ufo: b.ufo || undefined, life: b.kind === 'mine' || b.kind === 'mark' ? r1(b.life) : undefined })),
    pickups: world.pickups.map(k => ({ id: k.id, x: r1(k.x), y: r1(k.y), kind: k.kind, life: r1(k.life), t: r1(k.t) })),
    bosses: world.bosses.map(b => ({ id: b.id, kind: b.kind, name: b.name, x: r1(b.x), y: r1(b.y), r: b.r, hp: Math.round(b.hp), maxHp: Math.round(b.maxHp), phase: b.phase, color: b.color, spin: r1(b.spin), hitFlash: b.hitFlash > 0 ? 1 : 0, atk: b.atk, charging: !!b.chargeDir, aim: r1(b.aim * 100) / 100, entering: b.entering, dying: b.dying > 0, cloak: b.cloak > 0 ? r1(b.cloak) : undefined, buff: b.buff > 0 ? 1 : undefined })),
    graze: world.graze,
    pending: Object.fromEntries([...world.pendingUpgrades.entries()].map(([pid, list]) => [pid, list.map(u => u.id)])),
  };
}

function lerpAngle(a, b, t) { return a + angleDiff(b, a) * t; }
function lerpList(prevList, currList, t, angleKey) {
  const prevById = new Map(prevList.map(o => [o.id, o]));
  return currList.map(c => {
    const p = prevById.get(c.id);
    if (!p) return { ...c };
    const o = { ...c, x: lerp(p.x, c.x, t), y: lerp(p.y, c.y, t) };
    if (angleKey && p[angleKey] !== undefined) o[angleKey] = lerpAngle(p[angleKey], c[angleKey], t);
    return o;
  });
}

/**
 * 把兩份快照插值後套用到客戶端的 world 物件（渲染用）。
 * t 在 0..1 之間；prev 可為 null（直接用 curr）。
 */
export function applySnapshot(world, prev, curr, t) {
  const s = curr;
  Object.assign(world, { scene: s.scene, time: s.time, wave: s.wave, waveTimer: s.waveTimer, score: s.score, combo: s.combo, comboTimer: s.comboTimer, bossWarn: s.bossWarn, waveMode: s.waveMode, modeTimer: s.modeTimer, abandoned: !!s.abandoned, won: !!s.won, endless: !!s.endless,
    arena: s.arena || 'space', waveTheme: s.waveTheme || null, event: s.event || null, dustBonus: s.dustBonus || 0, crate: s.crate || null, hole: s.hole || null, wells: s.wells || [], flare: s.flare || null, drag: s.drag || 1, blizzard: s.blizzard || 0, wind: s.wind || null, eclipse: s.eclipse || 0 });
  if (s.stats) world.stats = s.stats;
  world.beacon = s.beacon && prev && prev.beacon ? { ...s.beacon, x: lerp(prev.beacon.x, s.beacon.x, t), y: lerp(prev.beacon.y, s.beacon.y, t) } : s.beacon;
  world.zones = (s.zones || []).slice(); world.safeZones = (s.safeZones || []).slice(); world.doom = s.doom || null;
  world.lasers = prev ? lerpList(prev.lasers || [], s.lasers || [], t, 'angle') : (s.lasers || []).slice();
  if (!prev) {
    world.players = s.players.map(p => ({ ...p })); world.bullets = s.bullets.slice(); world.enemies = s.enemies.map(e => ({ ...e }));
    world.enemyBullets = s.enemyBullets.slice(); world.pickups = s.pickups.slice(); world.bosses = (s.bosses || []).map(b => ({ ...b }));
  } else {
    world.players = lerpList(prev.players, s.players, t, 'angle').map(p => {
      const pp = prev.players.find(q => q.id === p.id);
      if (pp) p.drones = p.drones.map((d, i) => pp.drones[i] ? { x: lerp(pp.drones[i].x, d.x, t), y: lerp(pp.drones[i].y, d.y, t), a: d.a } : d);
      return p;
    });
    world.bullets = lerpList(prev.bullets, s.bullets, t);
    world.enemies = lerpList(prev.enemies, s.enemies, t);
    world.enemyBullets = lerpList(prev.enemyBullets, s.enemyBullets, t);
    world.pickups = lerpList(prev.pickups, s.pickups, t);
    world.bosses = lerpList(prev.bosses || [], s.bosses || [], t);
  }
  // 渲染端需要的衍生欄位
  for (const p of world.players) if (Array.isArray(p.syn)) p.syn = Object.fromEntries(p.syn.map(id => [id, true]));
  for (const b of world.bosses) b.chargeDir = b.charging ? {} : null;
  world.graze = s.graze || 0;
  const cardOf = id => { if (id.startsWith('evo:')) { const evo = EVOLUTIONS.find(e => e.id === id.slice(4)); return evo ? { id, icon: evo.icon, name: '進化 · ' + evo.name, max: 1, evo, desc: () => evo.desc } : null; } return UPGRADES.find(u => u.id === id); };
  world.pendingUpgrades = new Map(Object.entries(s.pending).map(([pid, ids]) => [Number(pid), ids.map(cardOf).filter(Boolean)]));
}
