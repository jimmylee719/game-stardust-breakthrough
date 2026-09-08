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
  const { world, p } = fresh({ damage: 1, bigshot: 1 });
  p.x = 200; p.y = 450; const e = enemy(world, 400, 450);
  p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  let stunned = false; for (let i = 0; i < 90 && !stunned; i++) { update(world, 1 / 60, fx); if (e.stun > 0) stunned = true; }
  if (!stunned) fail('震撼彈應命中並僵直');
  // 餘燼另開一局（震撼彈的擊退會把目標推出射程），目標血量夠厚、放近一點
  const w2 = fresh({ firerate: 1, explosive: 1 }); const e2 = enemy(w2.world, 320, 450, 1e6);
  w2.p.x = 200; w2.p.y = 450; w2.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  let burned = false; for (let i = 0; i < 600 && !burned; i++) { update(w2.world, 1 / 60, fx); e2.x = 320; e2.y = 450; e2.vx = e2.vy = 0; if (e2.burn > 0) burned = true; }
  if (!burned) fail('餘燼：連續射擊 10 秒內應至少點燃一次');
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
  // 敵人可能被推到玩家身上而消耗掉護盾，所以看「護盾回充」事件而不只看數值
  if (p.shield < 1 && !texts.includes('護盾回充')) fail('20 次擊殺後應獲得護盾，kills=' + p.kills + ' streak=' + p.killStreak);
  console.log('recharge ok: kills', p.kills, 'shield', p.shield);
}
// 6. 第 20 波 Boss 擊破 → victory；繼續無盡 → play；finishRun → gameover
{
  const { world, p } = fresh({});
  world.wave = WIN_WAVE; world.bossWarn = 0.01; world.waveTimer = 999; Object.assign(p, { hp: 1e6, maxHp: 1e6, damage: 100000 });
  step(world, 5); if (!world.bosses[0]) fail('第 20 波應出現 Boss');
  const boss = world.bosses[0]; boss.entering = false; boss.y = 300; boss.dodgeCd = 1e9; boss.armor = 1;
  p.x = boss.x; p.y = 600; p.input = { ix: 0, iy: 0, angle: -Math.PI / 2, fire: true, dash: false };
  for (let i = 0; i < 60 * 30 && world.scene !== 'victory'; i++) update(world, 1 / 60, fx);
  if (world.scene !== 'victory' || !world.won) fail('擊破第 20 波 Boss 應進入勝利畫面，scene=' + world.scene);
  const s = world.score;
  if (!continueEndless(world) || world.scene !== 'play' || !world.endless) fail('無盡模式切換失敗');
  for (let i = 0; i < 60 * 8; i++) { if (world.scene === 'upgrade') chooseUpgrade(world, 1, 0, fx); update(world, 1 / 60, fx); }   // Boss 後會先給升級
  if (world.wave < WIN_WAVE + 1) fail('無盡模式應繼續下一波，wave=' + world.wave);
  const w2 = fresh({}).world; w2.scene = 'victory'; if (!finishRun(w2) || w2.scene !== 'gameover') fail('finishRun 應進入結算');
  console.log('victory ok: score', s, '→ endless wave', world.wave);
}
// 7. 武器：火焰槍點燃、冰凍光線減速、閃電鏈多目標
{
  const mk = (weapon) => { const world = createWorld(); addPlayer(world, { id: 1, name: 'T', local: true, weapon }); startRun(world); world.timers.length = 0; world.enemies.length = 0; world.waveTimer = 999; world.wave = 1; world.scene = 'play'; return { world, p: world.players[0] }; };
  const f = mk('flame'); f.p.x = 200; f.p.y = 450; const fe = enemy(f.world, 330, 450, 1e6); f.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(f.world, 30); if (!(fe.burn > 0) || fe.hp >= 1e6) fail('火焰槍應造成傷害並點燃');
  const c = mk('frost'); c.p.x = 200; c.p.y = 450; const ce = enemy(c.world, 500, 450, 1e6); c.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(c.world, 30); if (!(ce.slow > 0)) fail('冰凍光線應減速');
  let frozen = false; for (let i = 0; i < 200 && !frozen; i++) { update(c.world, 1 / 60, fx); ce.x = 500; ce.y = 450; if (ce.stun > 0) frozen = true; }
  if (!frozen) fail('連續照射 2 秒應凍結');
  const a = mk('arc'); a.p.x = 200; a.p.y = 450; const t1 = enemy(a.world, 400, 450, 1e6), t2 = enemy(a.world, 520, 500, 1e6), t3 = enemy(a.world, 640, 450, 1e6); a.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(a.world, 10); if (!(t1.hp < 1e6 && t2.hp < 1e6 && t3.hp < 1e6)) fail('閃電鏈應連鎖命中三個目標');
  console.log('weapons ok: flame burn, frost freeze, arc chain');
}
// 8. 敵人搶道具：附近的道具會被吃掉並獲得 Buff
{
  const { world, p } = fresh({});
  world.wave = 5; p.x = 100; p.y = 100; p.magnetR = 0;
  const e = enemy(world, 800, 450, 100); e.speed = 0;   // 不動：一旦決定要吃就在觸碰範圍內
  world.pickups.push({ id: world.nextId++, x: 820, y: 450, kind: 'rapid', life: 30, t: 0 });
  step(world, 60 * 8);
  if (world.pickups.length !== 0 || !(e.buffSpeed > 0 || e.buffRapid > 0)) fail('敵人應吃掉道具並獲得 Buff：pickups=' + world.pickups.length + ' buffSpeed=' + e.buffSpeed);
  console.log('enemy pickup hunt ok');
}
// 9. 流星撞擊敵人與擦彈加分
{
  const { world, p } = fresh({});
  world.wave = 5; p.x = 200; p.y = 800;
  const victim = enemy(world, 800, 450, 50);
  world.enemies.push({ id: world.nextId++, type: 'meteor', kind: 'meteor', ambient: true, x: 500, y: 450, vx: 400, vy: 0, r: 40, hp: 500, maxHp: 500, speed: 400, color: '#ffb070', score: 150, contact: 30, shootCd: 9, wobble: 0, hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: 0, lunge: 0, lungeCd: 9, dodgeCd: 9, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, life: 12 });
  step(world, 90);
  if (world.enemies.includes(victim)) fail('流星撞到的小敵人應被摧毀');
  const s0 = world.score;
  world.enemyBullets.push({ id: world.nextId++, x: p.x + 28, y: p.y - 300, vx: 0, vy: 600, life: 3, r: 5 });   // 距中心 28：不命中（19）但在擦彈範圍（35）內
  step(world, 60);
  if (world.graze < 1 || world.score <= s0) fail('貼身飛過的子彈應算擦彈加分');
  console.log('meteor & graze ok');
}
// 10. 閃現：空白鍵瞬移、過程無敵、有冷卻
{
  const { world, p } = fresh({});
  p.x = 400; p.y = 450; const x0 = p.x;
  p.input = { ix: 1, iy: 0, angle: 0, fire: false, dash: false, blink: true };
  update(world, 1 / 60, fx);
  if (p.x - x0 < 200 || !(p.inv > 0.3) || !(p.blinkCd > 2)) fail(`閃現應瞬移並無敵：dx=${(p.x - x0).toFixed(0)} inv=${p.inv} cd=${p.blinkCd}`);
  const x1 = p.x; update(world, 1 / 60, fx);
  if (p.x - x1 > 60) fail('冷卻中不該再閃現');
  console.log('blink ok: moved', Math.round(p.x - x0), 'px, inv', p.inv.toFixed(2));
}
// 11. 發射者被擊落 → 它的子彈消失；毒區持續扣血（無視無敵）；毀滅攻擊只有安全區安全
{
  const { world, p } = fresh({});
  p.x = 100; p.y = 100;
  const sh = enemy(world, 900, 450, 1);
  world.enemyBullets.push({ id: world.nextId++, owner: sh.id, x: 500, y: 450, vx: 0, vy: 0, life: 9, r: 5 });
  world.enemyBullets.push({ id: world.nextId++, owner: 424242, x: 520, y: 450, vx: 0, vy: 0, life: 9, r: 5 });
  sh.hp = 0; p.pierce = 0; p.input = { ix: 0, iy: 0, angle: Math.atan2(450 - 100, 900 - 100), fire: true, dash: false };
  for (let i = 0; i < 240 && world.enemies.includes(sh); i++) update(world, 1 / 60, fx);
  if (world.enemies.includes(sh)) fail('射手應被擊落');
  if (world.enemyBullets.some(b => b.owner === sh.id) || !world.enemyBullets.some(b => b.owner === 424242)) fail('擊落後只有它自己的子彈該消失');
  p.input.fire = false; p.inv = 5; p.shield = 2; const hp0 = p.hp;
  world.zones.push({ id: world.nextId++, x: p.x, y: p.y, r: 120, life: 9, kind: 'toxic' });
  step(world, 60);
  if (!(p.hp < hp0 - 5) || p.shield !== 2) fail('毒區應無視護盾與無敵持續扣血：hp ' + hp0 + ' → ' + p.hp);
  world.zones.length = 0;
  world.safeZones = [{ id: 1, x: 1200, y: 700, r: 95 }]; world.doom = { t: 0.01, warn: 4, by: 0 };
  p.hp = 80; update(world, 1 / 60, fx);
  if (p.hp !== 1 || world.doom) fail('不在安全區的玩家血量應只剩 1，doom 應結束：hp=' + p.hp);
  world.safeZones = [{ id: 2, x: p.x, y: p.y, r: 95 }]; world.doom = { t: 0.01, warn: 4, by: 0 }; p.hp = 80; update(world, 1 / 60, fx);
  if (p.hp !== 80) fail('安全區內的玩家不該受毀滅攻擊影響');
  console.log('bullet cleanup, toxic drain, doom ok');
}
console.log('PASS');
