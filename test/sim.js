// 無頭模擬測試：直接匯入遊戲邏輯在 Node 跑，不需要瀏覽器。
// 用法：node test/sim.js [--boss] [--wave=N] [--god] [--players=4] [--seconds=120] [--verbose]
import { createWorld, addPlayer, startRun, update, chooseUpgrade, continueEndless, NULL_FX } from '../public/js/game.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const nPlayers = Number(args.players) || 1;
const seconds = Number(args.seconds) || 120;

const log = [];
const fx = { ...NULL_FX, text: (x, y, t) => log.push(`[t=${world.time.toFixed(1)}s] ${t}`), local: () => fx };
const world = createWorld();
for (let i = 0; i < nPlayers; i++) addPlayer(world, { id: i + 1, name: `Bot${i + 1}`, local: i === 0 });
startRun(world, { startWave: args.boss ? 4 : Number(args.wave) || 0 });
if (args.god) for (const p of world.players) Object.assign(p, { pierce: 3, bounce: 2, homing: 3, explosive: 60, lifesteal: 6, bulletSize: 2, maxHp: 1e6, hp: 1e6 }) && [0, 1, 2].forEach(i => p.drones.push({ a: i, cd: 0, x: p.x, y: p.y }));

const dt = 1 / 60;
let victories = 0;
let frames = 0, crashed = null, lasersSeen = 0, minesSeen = 0, laserFired = 0;
try {
  for (let f = 0; f < seconds * 60; f++) {
    frames = f;
    if (world.scene === 'upgrade') { for (const p of world.players) chooseUpgrade(world, p.id, f % 3, fx); }
    if (world.scene === 'gameover') break;
    if (world.scene === 'victory') { victories++; if (args.endless) continueEndless(world); else break; }
    for (const p of world.players) {
      const tgt = world.boss && !world.boss.entering ? world.boss : world.enemies[0] || { x: world.W / 2, y: 180 };
      const ph = Math.floor(f / 90 + p.id) % 4;
      p.input = { ix: [1, 0, -1, 0][ph], iy: [0, 1, 0, -1][ph], angle: Math.atan2(tgt.y - p.y, tgt.x - p.x), fire: true, dash: false };
    }
    update(world, dt, fx);
    lasersSeen = Math.max(lasersSeen, world.lasers.length); if (world.lasers.some(L => L.phase === 'fire')) laserFired++;
    minesSeen = Math.max(minesSeen, world.enemyBullets.filter(b => b.kind === 'mine').length);
  }
} catch (e) { crashed = e; }

const summary = {
  players: nPlayers, simulatedSeconds: +(frames / 60).toFixed(1), finalScene: world.scene, wave: world.wave, score: world.score,
  bossKills: log.filter(l => l.includes('BOSS 擊破')).length,
  upgradesPicked: world.players.map(p => Object.values(p.upgrades).reduce((a, b) => a + b, 0)),
  won: world.won, endless: world.endless, victories, synergies: world.players.map(p => Object.keys(p.syn)),
  maxLasers: lasersSeen, laserFireFrames: laserFired, maxMines: minesSeen,
};
console.log(JSON.stringify(summary));
if (args.verbose) console.log(log.filter(l => /波|BOSS|階段|狂暴|陣亡|殲滅者/.test(l)).join('\n'));
if (crashed) { console.error('CRASH at', world.time.toFixed(2), crashed); process.exit(1); }
