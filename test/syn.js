// 組合技與通關規則的無頭測試：直接操作世界狀態驗證每一組組合技的效果，以及第 20 波勝利 → 無盡模式。
import { createWorld, addPlayer, startRun, update, chooseUpgrade, continueEndless, finishRun, NULL_FX } from '../public/js/game.js';
import { UPGRADES, SYNERGIES, activeSynergies, synergyIfPicked, WIN_WAVE } from '../shared/constants.js';

const fail = msg => { console.error('FAIL:', msg); process.exit(1); };
const texts = [];
const fx = { ...NULL_FX, text: (x, y, t) => texts.push(t), local: () => fx };
const up = id => UPGRADES.find(u => u.id === id);

function fresh(upgrades) {
  const world = createWorld();
  const p = addPlayer(world, { id: 1, name: 'T', local: true });
  startRun(world);
  world.timers.length = 0; world.enemies.length = 0; world.waveTimer = 999; world.wave = 1;
  for (const [id, lv] of Object.entries(upgrades)) for (let i = 0; i < lv; i++) { world.pendingUpgrades.set(1, [up(id)]); chooseUpgrade(world, 1, 0, fx); }
  world.scene = 'play';
  return { world, p: world.players[0] };
}
const enemy = (world, x, y, hp = 1000) => { world.enemies.push({ id: world.nextId++, type: 'drifter', x, y, vx: 0, vy: 0, r: 20, hp, maxHp: hp, speed: 0, color: '#f00', score: 10, kind: 'chase', contact: 0, shootCd: 9, wobble: 0, hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: 0, lunge: 0, lungeCd: 9, dodgeCd: 9, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0 }); return world.enemies[world.enemies.length - 1]; };
const step = (world, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) update(world, dt, fx); };

// 1. 啟動條件與升級卡提示
{
  const { p } = fresh({ pierce: 1, bounce: 1, lifesteal: 1, explosive: 1 });
  if (!p.syn.wall || !p.syn.vamp) fail('pierce+bounce / lifesteal+explosive 應啟動彈幕牆與吸血爆裂：' + JSON.stringify(p.syn));
  if (!texts.some(t => t.includes('彈幕牆'))) fail('啟動時應宣告組合技');
  const hint = synergyIfPicked({ homing: 1 }, 'drone');
  if (hint.length !== 1 || hint[0].id !== 'swarm') fail('升級卡提示錯誤 ' + JSON.stringify(hint));
  if (synergyIfPicked({ homing: 1, drone: 1 }, 'drone').length) fail('已啟動的組合技不該再提示');
  if (activeSynergies({}).length) fail('沒升級不該有組合技');
  console.log('synergy activation ok:', Object.keys(p.syn).join(','), '| all defined:', SYNERGIES.length);
}
// 2. 彈幕牆：反彈時分裂
{
  const { world, p } = fresh({ pierce: 1, bounce: 1 });
  p.x = 100; p.y = 450; p.input = { ix: 0, iy: 0, angle: Math.PI, fire: true, dash: false };
  step(world, 6); p.input.fire = false;
  const before = world.bullets.length;
  step(world, 30);
  if (world.bullets.length <= before) fail(`反彈後子彈應分裂：${before} → ${world.bullets.length}`);
  console.log('wall split ok:', before, '→', world.bullets.length);
}
// 3. 震撼彈：命中僵直；餘燼：燃燒
{
  const { world, p } = fresh({ damage: 1, bigshot: 1, firerate: 1, explosive: 1 });
  p.x = 200; p.y = 450; const e = enemy(world, 400, 450);
  p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(world, 90);
  if (!(e.stun > 0 || e.hp < 1000)) fail('震撼彈應命中並僵直');
  let burned = false; for (let i = 0; i < 300 && !burned; i++) { update(world, 1 / 60, fx); if (e.burn > 0) burned = true; }
  if (!burned) fail('餘燼：連續射擊 5 秒內應至少點燃一次');
  console.log('shock & ember ok');
}
// 4. 幽靈衝刺：衝刺穿過造成傷害
{
  const { world, p } = fresh({ dash: 1, speed: 1 });
  p.x = 300; p.y = 450; const e = enemy(world, 420, 450);
  p.input = { ix: 1, iy: 0, angle: 0, fire: false, dash: true };
  step(world, 20);
  if (e.hp >= 1000) fail('幽靈衝刺應對穿過的敵人造成傷害');
  console.log('ghost dash ok: enemy hp', Math.round(e.hp));
}
// 5. 護盾回充：20 次擊殺得一層護盾
{
  const { world, p } = fresh({ maxhp: 1, lifesteal: 1 });
  p.x = 200; p.y = 450; p.shield = 0;
  for (let k = 0; k < 20; k++) enemy(world, 500 + k * 20, 450, 1);
  p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false }; p.pierce = 30;
  step(world, 420);
  if (p.shield < 1) fail('20 次擊殺後應獲得護盾，kills=' + p.kills + ' streak=' + p.killStreak + ' syn=' + JSON.stringify(p.syn) + ' shield=' + p.shield + ' hp=' + p.hp);
  console.log('recharge ok: kills', p.kills, 'shield', p.shield);
}
// 6. 第 20 波 Boss 擊破 → victory；繼續無盡 → play；finishRun → gameover
{
  const { world, p } = fresh({});
  world.wave = WIN_WAVE; world.bossWarn = 0.01; world.waveTimer = 999; Object.assign(p, { hp: 1e6, maxHp: 1e6, damage: 100000 });
  step(world, 5); if (!world.boss) fail('第 20 波應出現 Boss');
  world.boss.entering = false; world.boss.y = 300;
  p.x = world.boss.x; p.y = 600; p.input = { ix: 0, iy: 0, angle: -Math.PI / 2, fire: true, dash: false };
  for (let i = 0; i < 60 * 30 && world.scene !== 'victory'; i++) update(world, 1 / 60, fx);
  if (world.scene !== 'victory' || !world.won) fail('擊破第 20 波 Boss 應進入勝利畫面，scene=' + world.scene);
  const s = world.score;
  if (!continueEndless(world) || world.scene !== 'play' || !world.endless) fail('無盡模式切換失敗');
  for (let i = 0; i < 60 * 8; i++) { if (world.scene === 'upgrade') chooseUpgrade(world, 1, 0, fx); update(world, 1 / 60, fx); }   // Boss 後會先給升級
  if (world.wave < WIN_WAVE + 1) fail('無盡模式應繼續下一波，wave=' + world.wave);
  const w2 = fresh({}).world; w2.scene = 'victory'; if (!finishRun(w2) || w2.scene !== 'gameover') fail('finishRun 應進入結算');
  console.log('victory ok: score', s, '→ endless wave', world.wave);
}
console.log('PASS');
