// 組合技與通關規則的無頭測試：直接操作世界狀態驗證每一組組合技的效果，以及第 20 波勝利 → 無盡模式。
import { createWorld, addPlayer, startRun, update, chooseUpgrade, continueEndless, finishRun, NULL_FX } from '../public/js/game.js';
import { UPGRADES, SYNERGIES, activeSynergies, synergyIfPicked, WIN_WAVE, affinity, EVOLUTIONS } from '../shared/constants.js';
import { startEvent } from '../public/js/game.js';

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
const enemy = (world, x, y, hp = 1000, extra = {}) => { world.enemies.push({ id: world.nextId++, type: 'drifter', x, y, vx: 0, vy: 0, r: 20, hp, maxHp: hp, speed: 0, color: '#f00', score: 10, kind: 'chase', contact: 0, shootCd: 9, wobble: 0, hitFlash: 0, squash: 0, rot: 0, rotV: 0, tier: 0, flank: 0, lunge: 0, lungeCd: 9, dodgeCd: 9, mineCd: 9, laserCd: 9, laserId: null, blinkCd: 9, blinkFlash: 0, element: 'neutral', affixes: [], shieldHp: 0, phaseT: 0, atkCd: 9, lungeCd2: 9, ...extra }); return world.enemies[world.enemies.length - 1]; };
const mk = (o = {}) => { const world = createWorld(); addPlayer(world, { id: 1, name: 'T', local: true, ...o }); startRun(world, { arena: o.arena || 'space' }); world.timers.length = 0; world.enemies.length = 0; world.waveTimer = 999; world.wave = o.wave || 1; world.scene = 'play'; world.hazardCd = 999; world.eventCd = 999; world.ambientCd = 999; return { world, p: world.players[0] }; };
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
// 12. 屬性相剋：火焰生物吃冰 ×1.6、吃火 ×0.5；相剋文字只出現一次
{
  if (affinity('fire', 'ice') !== 1.6 || affinity('fire', 'fire') !== 0.5 || affinity('neutral', 'fire') !== 1 || affinity('water', 'plasma') !== 1.8) fail('AFFINITY 表錯了');
  const a = mk({ weapon: 'frost' }); a.p.x = 200; a.p.y = 450; const fe = enemy(a.world, 500, 450, 1e6, { element: 'fire' }); a.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(a.world, 60); const frostDmg = 1e6 - fe.hp;
  const b = mk({ weapon: 'flame' }); b.p.x = 200; b.p.y = 450; const fe2 = enemy(b.world, 320, 450, 1e6, { element: 'fire' }); b.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(b.world, 60); const flameDmg = 1e6 - fe2.hp;
  if (!(frostDmg > 0) || !(flameDmg > 0)) fail('兩種武器都該造成傷害');
  if (fe2.burn > 0) fail('火焰生物不該被點燃');
  if (!texts.some(t => t.includes('效果拔群'))) fail('相剋應提示效果拔群');
  console.log('affinity ok: frost→fire', Math.round(frostDmg), 'flame→fire', Math.round(flameDmg));
}
// 13. 護盾兵正面盾擋子彈、背後打得到；相位免疫
{
  const { world, p } = mk({});
  p.x = 200; p.y = 450; const w = enemy(world, 500, 450, 1e6, { type: 'warden', kind: 'warden', shieldUp: true, fx: -1, fy: 0 });
  p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false }; p.pierce = 0;
  step(world, 90); if (w.hp < 1e6) fail('護盾兵正面不該吃到子彈傷害 hp=' + w.hp);
  w.fx = 1; w.fy = 0; step(world, 30); if (w.hp >= 1e6) fail('從背後應該打得到護盾兵');
  const ph = enemy(world, 500, 450, 1e6, { phaseT: 5 }); w.hp = -1; step(world, 60); if (ph.hp < 1e6) fail('相位中的敵人不該被擊中');
  console.log('warden shield & phasing ok');
}
// 14. 光刃：揮擊命中、格擋子彈、劍聖回血
{
  const { world, p } = mk({ ship: 'ronin' });
  if (p.weapon !== 'blade' || !p.flags.meleeOnly) fail('劍聖應只能用光刃');
  p.x = 400; p.y = 450; p.hp = 50; const e = enemy(world, 470, 450, 1e6);
  world.enemyBullets.push({ id: world.nextId++, x: 460, y: 440, vx: -200, vy: 0, life: 5, r: 5 });
  p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  step(world, 5);
  if (e.hp >= 1e6) fail('光刃應命中');
  if (world.enemyBullets.length !== 0) fail('光刃應格擋扇形內的子彈');
  if (!(p.hp > 50)) fail('劍聖命中 / 格擋應回血 hp=' + p.hp);
  if (world.stats.parries < 1 || world.stats.swings < 1) fail('統計應記錄格擋與揮擊');
  console.log('blade ok: enemy hp', Math.round(e.hp), 'parries', world.stats.parries, 'hp', p.hp);
}
// 15. 自爆蟲貼身自爆會炸到其他敵人；蟲群撞玩家會爆碎片
{
  const { world, p } = mk({ wave: 4 });
  p.x = 800; p.y = 450; p.inv = 0; p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false };
  const victim = enemy(world, 860, 450, 50);
  const k = enemy(world, 830, 450, 10, { type: 'kamikaze', kind: 'kamikaze', speed: 260 });
  step(world, 3);
  if (world.enemies.includes(k)) fail('自爆蟲貼身應自爆消失');
  if (world.enemies.includes(victim)) fail('自爆應炸死旁邊的敵人');
  if (world.stats.kamiKills < 1 || p.hp >= 100) fail('自爆應傷到玩家並記錄 kamiKills');
  const d = enemy(world, p.x + 30, p.y, 22, { type: 'drifter' }); p.inv = 0; step(world, 2);
  if (world.enemies.includes(d) || !world.enemyBullets.some(b => b.kind === 'shard')) fail('蟲群撞上玩家應炸成碎片');
  console.log('kamikaze & swarmer ok');
}
// 16. 武器進化卡：湊齊條件後升級選單出現進化卡，選了 evolved 生效；放棄升級回 20 HP
{
  const { world, p } = fresh({ pierce: 2, firerate: 2 });
  const evo = EVOLUTIONS.find(e => e.weapon === 'blaster');
  world.wave = 2; world.upgradeOffered = false; world.waveTimer = 0.01; world.enemies.length = 0; world.timers.length = 0;
  update(world, 1 / 60, fx);
  if (world.scene !== 'upgrade') fail('清波後應進升級 scene=' + world.scene);
  const cards = world.pendingUpgrades.get(1);
  if (!cards[0].evo || cards[0].evo.id !== evo.id) fail('第一張應是進化卡：' + cards.map(c => c.id).join(','));
  chooseUpgrade(world, 1, 0, fx);
  if (p.evolved !== 'railgun' || world.stats.evolved !== 'railgun' || world.scene !== 'play') fail('選進化卡應設定 evolved');
  p.x = 200; p.y = 450; enemy(world, 500, 450, 1e6); p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false }; world.waveTimer = 999;
  step(world, 20); if (!world.bullets.some(b => b.rail)) fail('殲星機砲應射出磁軌彈');
  const w2 = fresh({}); w2.world.pendingUpgrades.set(1, [UPGRADES[0]]); w2.world.scene = 'upgrade'; w2.p.hp = 40;
  if (!chooseUpgrade(w2.world, 1, -1, fx) || w2.p.hp !== 60 || w2.world.scene !== 'play') fail('放棄升級應回 20 HP');
  console.log('evolution & skip ok');
}
// 17. 機體特性：幽靈擊殺重置閃現、黃蜂閃現落點爆炸、工程師衝刺放砲塔、堡壘正面盾擋子彈
{
  const w = mk({ ship: 'wraith' }); w.p.x = 200; w.p.y = 450; w.p.blinkCd = 0.5; const e = enemy(w.world, 300, 450, 1); w.p.input = { ix: 0, iy: 0, angle: 0, fire: true, dash: false };
  for (let i = 0; i < 60 && w.world.enemies.includes(e); i++) update(w.world, 1 / 60, fx); if (w.p.blinkCd !== 0) fail('幽靈擊殺應重置閃現');
  const a = mk({ ship: 'wasp' }); a.p.x = 200; a.p.y = 450; const t = enemy(a.world, 460, 450, 1e6); a.p.input = { ix: 1, iy: 0, angle: 0, fire: false, dash: false, blink: true }; update(a.world, 1 / 60, fx); if (t.hp >= 1e6) fail('黃蜂閃現落點應爆炸傷敵');
  const g = mk({ ship: 'engineer' }); g.p.x = 200; g.p.y = 450; g.p.input = { ix: 1, iy: 0, angle: 0, fire: false, dash: true }; update(g.world, 1 / 60, fx); if (g.p.turrets.length !== 1) fail('工程師衝刺應放砲塔'); enemy(g.world, 400, 450, 1e6); g.p.input.dash = false; step(g.world, 40); if (!g.world.bullets.length && g.world.enemies[0].hp >= 1e6) fail('砲塔應開火');
  const b = mk({ ship: 'bastion' }); b.p.x = 400; b.p.y = 450; b.p.angle = 0; b.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; const hp0 = b.p.hp;
  b.world.enemyBullets.push({ id: b.world.nextId++, x: 470, y: 450, vx: -400, vy: 0, life: 3, r: 5 }); step(b.world, 30); if (b.p.hp !== hp0) fail('堡壘正面盾應擋住正面子彈');
  b.world.enemyBullets.push({ id: b.world.nextId++, x: 330, y: 450, vx: 400, vy: 0, life: 3, r: 5 }); b.p.inv = 0; step(b.world, 30); if (b.p.hp === hp0) fail('背後的子彈應打得到堡壘');
  console.log('ship traits ok');
}
// 18. 場地：熔岩池扣血、冰面滑行、深海阻力；事件：補給箱與黑洞
{
  const L = mk({ arena: 'inferno' }); L.p.x = 400; L.p.y = 450; L.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; L.world.zones.push({ id: 1, x: 400, y: 450, r: 90, life: 9, kind: 'lava' }); const h0 = L.p.hp; step(L.world, 60); if (!(L.p.hp < h0)) fail('熔岩應扣血');
  const G = mk({ arena: 'glacier' }); G.p.x = 400; G.p.y = 450; G.p.vx = 300; G.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; step(G.world, 30); const S = mk({ arena: 'space' }); S.p.x = 400; S.p.y = 450; S.p.vx = 300; S.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; step(S.world, 30);
  if (!(G.p.vx > S.p.vx + 50)) fail(`冰面應更滑：glacier vx ${G.p.vx.toFixed(0)} vs space ${S.p.vx.toFixed(0)}`);
  const A = mk({ arena: 'abyss' }); if (A.world.drag !== 0.85) fail('深海應有阻力');
  const E = mk({ wave: 5 }); E.p.x = 400; E.p.y = 450; E.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false };
  startEvent(E.world, 'supply', fx); if (!E.world.crate || !E.world.event) fail('補給事件應建立補給箱'); E.world.timers.length = 0; E.world.event.t = 0.01; update(E.world, 1 / 60, fx);
  if (E.world.crate || !E.world.pickups.some(k => k.kind === 'dust')) fail('守住補給箱應掉星塵碎片'); if (E.world.stats.crateHp !== 1) fail('完好守住應記錄 crateHp=1');
  startEvent(E.world, 'blackhole', fx); const v = enemy(E.world, E.world.hole.x + 20, E.world.hole.y, 100); step(E.world, 5); if (E.world.enemies.includes(v)) fail('黑洞中心的敵人應被撕碎');
  console.log('arena hazards & events ok');
}
// 19. 狙擊手瞄準後開火並換位；迫擊砲落點標記會爆炸
{
  const { world, p } = mk({ wave: 8 });
  p.x = 200; p.y = 450; p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false };
  const s = enemy(world, 800, 450, 30, { type: 'sniper', kind: 'sniper', speed: 0, atkCd: 0, dodgeCd: 9 });
  let fired = false; for (let i = 0; i < 60 * 3 && !fired; i++) { update(world, 1 / 60, fx); if (world.enemyBullets.some(b => b.kind === 'snipe')) fired = true; }
  if (!fired || (s.x === 800 && s.y === 450)) fail('狙擊手應瞄準後開火並換位');
  world.enemyBullets.length = 0;
  const m = enemy(world, 700, 450, 55, { type: 'mortar', kind: 'mortar', speed: 0, atkCd: 0 });
  let marked = false, exploded = false; for (let i = 0; i < 60 * 3; i++) { update(world, 1 / 60, fx); if (world.enemyBullets.some(b => b.kind === 'mark')) marked = true; if (marked && world.enemyBullets.some(b => b.kind === 'shard')) { exploded = true; break; } }
  if (!marked || !exploded) fail('迫擊砲應先標記再爆炸');
  console.log('sniper & mortar ok');
}
// 20. 太陽風暴是以畫面外太陽為圓心的弧形帶：中線玩家先中、偏離中線的玩家晚一點才中；同一玩家只中一次
{
  const { world, p } = mk({ arena: 'mercury', wave: 3 });
  addPlayer(world, { id: 2, name: 'U', local: false }); const q = world.players[1];
  for (const z of [p, q]) { z.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; z.inv = 0; z.shield = 0; z.x = 500; }
  p.y = world.H / 2; q.y = world.H / 2 + 300; const hp0 = p.hp, hq0 = q.hp;
  world.flare = { x: -60, sx: -760, dir: 1, w: 90, t: 0, speed: 280, hit: [] };
  let hitP = null, hitQ = null;
  for (let i = 0; i < 60 * 4 && (hitP === null || hitQ === null); i++) { update(world, 1 / 60, fx); if (hitP === null && p.hp < hp0) hitP = world.flare.x; if (hitQ === null && q.hp < hq0) hitQ = world.flare.x; }
  if (hitP === null || hitQ === null) fail('弧形太陽風暴應打到兩位玩家');
  if (!(hitQ > hitP + 20)) fail(`偏離中線的玩家應比中線玩家晚中（弧形）：mid ${hitP.toFixed(0)} off ${hitQ.toFixed(0)}`);
  step(world, 30); if (world.flare && world.flare.hit.length !== 2) fail('每位玩家只該被打一次');
  console.log('solar flare arc ok', Math.round(hitP), Math.round(hitQ));
}
// 21. 主動技能：能量施放（飛彈雨 / 原子彈 / 時間停止）與敵人技能預警
{
  const A = mk({ wave: 3 }); A.p.x = 400; A.p.y = 450; A.p.energy = 100; A.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false, skill: true };
  enemy(A.world, 800, 450, 500); step(A.world, 20);
  if (!(A.p.energy < 50)) fail('施放飛彈雨應扣能量'); if (!A.world.bullets.some(b => b.missile)) fail('飛彈雨應射出追蹤飛彈');
  A.p.input.skill = false; step(A.world, 5); A.p.energy = 100; A.p.input.skill = true; step(A.world, 2); const e1 = A.p.energy; step(A.world, 5); if (A.p.energy < e1 - 5) fail('按住不放不該連續施放');
  const N = mk({ wave: 3 }); N.p.skill = 'nova'; N.p.energy = 100; N.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false, skill: true };
  const v = enemy(N.world, 900, 200, 200); step(N.world, 1); if (!(N.p.novaT > 0)) fail('原子彈應開始倒數'); step(N.world, 90); if (N.world.enemies.includes(v)) fail('原子彈應炸死全畫面敵人');
  const C = mk({ wave: 3 }); C.p.skill = 'chrono'; C.p.energy = 100; C.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false, skill: true };
  const m = enemy(C.world, 800, 450, 500, { speed: 200 }); step(C.world, 30); if (!(C.world.chrono > 0)) fail('時間停止應啟動'); if (Math.abs(m.x - 800) > 5) fail(`時間停止中敵人不該移動 ${m.x}`);
  const S = mk({ wave: 8 }); S.p.x = 200; S.p.y = 450; S.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false };
  const sn = enemy(S.world, 800, 450, 30, { type: 'sniper', kind: 'sniper', speed: 0, atkCd: 0, dodgeCd: 9 }); step(S.world, 10); if (sn.warn !== 2) fail(`瞄準中的狙擊手應顯示紅色預警，實際 ${sn.warn}`);
  console.log('skills & warn ok');
}
// 22. 區域效果都要真的有作用（不是只有畫面）：毒霧讓敵人鎖不到玩家、玩家自動瞄準鎖不到敵人；咒印減速；壓力區拉；EMP 環；火柱噴發
{
  const F = mk({ arena: 'venom', wave: 3 }); F.p.x = 400; F.p.y = 450; F.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false };
  F.world.zones.push({ id: 1, x: 400, y: 450, r: 170, life: 9, kind: 'fog' });
  const far = enemy(F.world, 900, 450, 500, { type: 'shooter', kind: 'orbit', speed: 0, shootCd: 0, atkCd: 0 }); step(F.world, 3);
  if (!F.p.fog) fail('霧裡的玩家應被標記 fog');
  const { nearestTarget: NT } = await import('../public/js/game.js');
  F.world.zones.push({ id: 2, x: 900, y: 450, r: 120, life: 9, kind: 'fog' }); step(F.world, 2); if (!far.fog) fail('霧裡的敵人應被標記 fog'); if (NT(F.world, 400, 450, 2000) === far) fail('霧裡的敵人不該被自動鎖定');
  const Hx = mk({ wave: 3 }); Hx.p.x = 400; Hx.p.y = 450; Hx.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; Hx.world.zones.push({ id: 1, x: 400, y: 450, r: 110, life: 6, kind: 'hex' }); step(Hx.world, 2); if (!(Hx.p.hexed > 0)) fail('咒印應減速');
  const Pz = mk({ arena: 'abyss', wave: 3 }); Pz.p.x = 500; Pz.p.y = 450; Pz.p.vx = 0; Pz.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; Pz.world.zones.push({ id: 1, x: 400, y: 450, r: 200, life: 7, kind: 'pressure' }); step(Pz.world, 5); if (!(Pz.p.vx < 0)) fail('壓力區應把玩家往中心拉');
  const Em = mk({ arena: 'mercury', wave: 3 }); Em.p.x = 400; Em.p.y = 450; Em.p.inv = 0; Em.p.shield = 0; Em.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; Em.world.zones.push({ id: 1, x: 300, y: 450, r: 10, grow: 420, life: 1.1, kind: 'emp', hit: [] }); step(Em.world, 30); if (!(Em.p.emp > 0)) fail('EMP 環掃過應讓玩家 EMP');
  const Gy = mk({ arena: 'inferno', wave: 3 }); Gy.p.x = 400; Gy.p.y = 450; Gy.p.inv = 0; Gy.p.shield = 0; Gy.p.input = { ix: 0, iy: 0, angle: 0, fire: false, dash: false }; const h0 = Gy.p.hp; Gy.world.zones.push({ id: 1, x: 400, y: 450, r: 70, life: 1.6, kind: 'geyser', fired: false }); step(Gy.world, 90); if (!(Gy.p.hp < h0)) fail('火柱噴發應造成傷害');
  console.log('zone effects ok');
}
console.log('PASS');
