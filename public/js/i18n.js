// 語言：中文為母語字串（程式與伺服器事件都用中文），英文用對照表在顯示時翻譯。
// tr(text)：精確對照 → 樣式規則（含數字）→ 原文。HTML 用 data-i18n / data-i18n-ph 屬性標記。
const KEY = 'stardust_lang';
let lang = 'zh';
try { lang = localStorage.getItem(KEY) || ((navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch {}
const listeners = new Set();
export function getLang() { return lang; }
export function setLang(l) { lang = l === 'en' ? 'en' : 'zh'; try { localStorage.setItem(KEY, lang); } catch {} applyDom(); for (const f of listeners) f(lang); }
export function onLangChange(f) { listeners.add(f); }

const EXACT = {
  // 選單 / UI
  '星塵突圍': 'Stardust Breakout', '飛行員代號': 'Pilot callsign', '輸入你的名字': 'Enter your name', '單人出擊': 'Solo run', 'Boss 挑戰': 'Boss rush', '📅 每日挑戰': '📅 Daily', '每日挑戰': 'Daily challenge',
  '與朋友連線（最多 4 人）': 'Play with friends (up to 4)', '建立房間': 'Create room', '房號': 'Code', '加入': 'Join', '🏆 全球排行榜': '🏆 Leaderboard', '📖 遊玩說明': '📖 How to play', '🔒 隱私說明': '🔒 Privacy', '⚙️ 設定': '⚙️ Settings', '設定': 'Settings',
  '🎯 任務': '🎯 Quests', '🏅 成就': '🏅 Achievements', '📚 圖鑑': '📚 Codex', '🌐 公開房間': '🌐 Public rooms', '⚡ 快速配對': '⚡ Quick match', '選擇場地': 'Arena', '機庫': 'Hangar',
  '關閉': 'Close', '繼續': 'Resume', '暫停': 'Paused', '離開遊戲回到首頁': 'Leave to menu', '單人模式已暫停': 'Solo game paused', '多人模式不會暫停，隊友仍在戰鬥': 'Co-op never pauses, your team is still fighting', '選單': 'Menu',
  '全球排行榜': 'Global leaderboard', '單人': 'Solo', '合作': 'Co-op', '每日': 'Daily', '全部': 'All time', '本週': 'This week', '載入中…': 'Loading…',
  '自動瞄準': 'Auto-aim', '自動射擊': 'Auto-fire', '音樂音量': 'Music volume', '音效': 'Sound effects', '語言': 'Language', '手機預設開啟；電腦開了之後不按滑鼠也會自動瞄準最近的敵人': 'On by default on phones. On desktop it aims at the nearest enemy when you are not aiming',
  '開啟後不用按住射擊鍵': 'Fire without holding the button', '背景音樂用程式即時合成，不需要下載': 'Music is synthesized live, nothing to download',
  '無盡': 'Endless', '武器進化': 'Weapon evolution', '[0] 放棄升級 +20 HP': '[0] Skip upgrade, +20 HP', '已達上限（最後一級）': 'Max level (last rank)',
  '存活': 'Survived', '擊殺': 'Kills', '造成傷害': 'Damage dealt', '承受傷害': 'Damage taken', '最高連擊': 'Best combo', '擦彈': 'Grazes', '閃現': 'Blinks', '道具': 'Pickups', '事件': 'Events',
  '衝刺 (Shift)': 'Dash (Shift)', '閃現 (空白鍵)': 'Blink (Space)', '🔇 靜音 (M)': '🔇 Muted (M)', '按 P 繼續': 'Press P to resume',
  '艦艇損毀': 'Ship destroyed', '全員陣亡': 'Squad wiped', '撤退': 'Retreat', '已離開戰鬥': 'Left the fight', '突圍成功': 'Breakout!', '無盡模式終結': 'Endless run over',
  '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到選單': 'Click or Enter to retry · L leaderboard · Esc menu', '每日挑戰結束 · L 今日排行榜 · 點擊 或 Esc 回到選單': 'Daily done · L today\'s board · Click or Esc for menu',
  '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到大廳': 'Click or Enter to play again · L board · Esc lobby', '等待房主再開一局 · L 排行榜 · Esc 回到大廳': 'Waiting for host · L board · Esc lobby',
  'Enter 繼續無盡模式（敵人持續變強） · Esc 結束並結算': 'Enter for endless mode (enemies keep scaling) · Esc to finish', '等待房主決定：繼續無盡模式或結算': 'Waiting for host: endless or finish',
  '合作成績會在隊伍結束時一併結算，你的擊殺數會計入': 'Co-op score is recorded when the team finishes; your kills count', '合作排行榜': 'Co-op board', '今日挑戰': 'Today\'s challenge', '單人排行榜': 'Solo board',
  '⚠ WARNING ⚠': '⚠ WARNING ⚠', '偵測到巨型敵艦接近': 'Massive hostile ship approaching', '隱形': 'cloaked', '選擇一項強化（點擊卡片或按 1 / 2 / 3）': 'Pick one upgrade (click a card or press 1 / 2 / 3)',
  '安全區': 'SAFE', '進入白色安全區！其他地方會被打到只剩 1 點生命': 'Get into a white safe zone! Everywhere else drops you to 1 HP', '☣ 生化毒物': '☣ Toxic', '🌋 熔岩': '🌋 Lava', '減速咒印': 'Slow hex', '深海壓力': 'Pressure', '重力井': 'Gravity well', '補給箱': 'Supply crate',
  '飛碟母艦': 'UFO mothership', '懸賞目標': 'Bounty', '🎯 追獵者': '🎯 Hunter', '運輸艦': 'Convoy', '救援中…': 'Reviving…', '靠近 3 秒救援': 'Stay 3 s to revive',
  // 場地
  '深空': 'Deep space', '火焰星球': 'Inferno', '水星': 'Mercury', '毒物星': 'Venom', '深海': 'Abyss', '冰封星': 'Glacier',
  // 事件
  '補給空投': 'Supply drop', '蟲洞': 'Wormhole', '太陽風': 'Solar wind', '黑洞': 'Black hole', '時空裂縫': 'Rift', '星塵風暴': 'Dust storm', '追獵者': 'Hunter', '日蝕': 'Eclipse', '流星雨': 'Meteor shower',
  // 武器 / 進化 / 機體
  '脈衝砲': 'Blaster', '火焰槍': 'Flamethrower', '冰凍光線': 'Frost beam', '閃電鏈': 'Arc chain', '雷射砲': 'Laser', '光刃': 'Blade',
  '殲星機砲': 'Railgun', '地獄噴發': 'Hellfire', '絕對零度': 'Absolute zero', '雷暴': 'Thunderstorm', '太陽炮': 'Solar lance', '幻影劍舞': 'Phantom dance',
  '獵鷹': 'Falcon', '黃蜂': 'Wasp', '堡壘': 'Bastion', '母艦': 'Carrier', '劍聖': 'Ronin', '幽靈': 'Wraith', '工程師': 'Engineer',
  // 升級
  '強化彈頭': 'Heavy rounds', '高速裝填': 'Fast reload', '穿甲彈': 'Piercing', '反彈彈': 'Ricochet', '追蹤導引': 'Homing', '無人僚機': 'Drone', '汲血核心': 'Lifesteal', '連鎖爆裂': 'Chain blast', '裝甲強化': 'Armor', '推進器': 'Thrusters', '衝刺冷卻': 'Dash cooldown', '牽引光束': 'Tractor beam', '巨型彈體': 'Big shot',
  // 敵人
  '蟲群': 'Swarmer', '飛鏢': 'Dart', '重裝': 'Tank', '射手': 'Shooter', '分裂體': 'Splitter', '小行星': 'Asteroid', '護盾兵': 'Warden', '狙擊手': 'Sniper', '迫擊砲': 'Mortar', '自爆蟲': 'Kamikaze', '咒術師': 'Hexer', '虛空哨兵': 'Void sentinel', '餘燼': 'Ember', '脈衝體': 'Pulsar', '孢子母體': 'Spore mother', '燈籠魚': 'Angler', '霜噬': 'Frostbite', '雷射兵': 'Lancer', '流星': 'Meteor', '飛碟': 'UFO',
  '相位': 'phased', '盾擋': 'blocked', '凍結': 'Frozen', '碎裂': 'Shatter', '蓄滿': 'Charged', '格擋': 'Parry', '中毒': 'Poisoned', '燒傷': 'Burning', '凍住了！': 'Frozen!', '護盾抵擋': 'Shield absorbed', '護盾回充': 'Shield recharged', '吸血': 'Drain', '易爆！': 'Volatile!', '虛空裂隙': 'Void rift', '殘影': 'Afterimage', 'EMP': 'EMP', '砲塔部署': 'Turret deployed', '現形！': 'Revealed!', '狂暴模式！': 'ENRAGED!', '第二階段': 'Phase 2', '雷射充能': 'Laser charging', '流星來襲': 'Incoming meteor', '不明飛行物': 'Unidentified object', '母艦召喚飛碟': 'Mothership calls UFOs',
  '⚠ 飛碟軍團接近 ⚠': '⚠ UFO fleet approaching ⚠', '安全區內，平安度過': 'Safe inside the zone', '被毀滅波擊中！只剩 1 點生命': 'Hit by the doom wave! 1 HP left', '生化毒物投放': 'Toxic payload dropped', '偵測到兩艘巨型敵艦！': 'Two massive hostile ships detected!', '懸賞達成！': 'Bounty claimed!', '流星擊碎！': 'Meteor shattered!', '飛碟擊落！': 'UFO down!',
  '虛空裂隙開啟': 'Void rift opens', '熔岩浮出': 'Lava surfacing', '太陽風暴接近': 'Solar storm incoming', '毒霧潮': 'Toxic tide', '洋流': 'Current', '深海壓力區': 'Pressure zone', '暴風雪': 'Blizzard', '減速咒印': 'Slow hex', '補給箱守住了！': 'Crate defended!', '補給箱守住了！（完好無缺）': 'Crate defended! (untouched)', '補給被搶走': 'Crate lost', '補給箱被搶走了！': 'The crate was taken!', '信標被摧毀！': 'Beacon destroyed!', '運輸艦被擊沉！': 'Convoy sunk!',
  '放棄升級 +20 HP': 'Skipped upgrade, +20 HP', '這台機體用不了護盾 → +15 HP': 'This ship can\'t use shields → +15 HP', '星塵 +15': 'Dust +15', '被吸過去了': 'Pulled in', '蓄電中 · 射程內無目標': 'Charging · no target in range', '蓄滿 ×2': 'Charged ×2',
  '敵人回復': 'Enemy healed', '敵人裝甲': 'Enemy armored', '敵人散射': 'Enemy spread', '敵人狂暴': 'Enemy frenzy', '敵人自爆！': 'Enemy self-destruct!', '敵人雷射': 'Enemy laser', 'Boss 回復': 'Boss healed', 'Boss 引爆炸彈！': 'Boss detonates a bomb!', 'Boss 強化': 'Boss empowered', '偵測到夾擊隊形': 'Pincer formation detected', '救援成功': 'Rescued',
  '護盾': 'Shielded', '易爆': 'Volatile', '疾速': 'Hasted', '相位 ': 'Phasing', '分裂': 'Splitting', '再生': 'Regen', '指揮官': 'Commander', '荊棘': 'Thorns',
};
const RULES = [
  [/^第 (\d+) 波$/, (m) => `Wave ${m[1]}`],
  [/^第 (\d+) 波 · (.+)$/, (m) => `Wave ${m[1]} · ${tr(m[2])}`],
  [/^第 (\d+) 波 清除！$/, (m) => `Wave ${m[1]} cleared!`],
  [/^無傷清波 \+(\d+)$/, (m) => `Flawless wave +${m[1]}`],
  [/^撐到第 (\d+) 波 · 最高分 (\d+)(.*)$/, (m) => `Reached wave ${m[1]} · best ${m[2]}${m[3].includes('新紀錄') ? '  🏆 New record!' : ''}`],
  [/^被「(.+)」擊落$/, (m) => `Destroyed by ${tr(m[1])}`],
  [/^最長無傷 (\d+) 秒$/, (m) => `Longest no-hit ${m[1]} s`],
  [/^格擋 (\d+)$/, (m) => `${m[1]} parries`],
  [/^格擋 ×(\d+)$/, (m) => `Parry ×${m[1]}`],
  [/^敵方小隊：(.+)$/, (m) => `Enemy squad: ${tr(m[1])}`],
  [/^(.+) 成功 \+(\d+)$/, (m) => `${tr(m[1])} success +${m[2]}`],
  [/^(.+) 失敗$/, (m) => `${tr(m[1])} failed`],
  [/^(.+) 擊破 \+(\d+)$/, (m) => `${m[1]} destroyed +${m[2]}`],
  [/^組合技 (.+)！$/, (m) => `Synergy ${m[1]}!`],
  [/^武器進化 (.+)！$/, (m) => `Weapon evolved: ${tr(m[1].replace(/^\S+ /, ''))}!`],
  [/^效果拔群 ×([\d.]+)$/, (m) => `Super effective ×${m[1]}`],
  [/^抗性 ×([\d.]+)$/, (m) => `Resisted ×${m[1]}`],
  [/^蓄電釋放 ×([\d.]+)$/, (m) => `Discharge ×${m[1]}`],
  [/^擦彈 \+(\d+)$/, (m) => `Graze +${m[1]}`],
  [/^(.+) 倒地！靠近救援$/, (m) => `${m[1]} is down! Get close to revive`],
  [/^(.+) 陣亡$/, (m) => `${m[1]} destroyed`],
  [/^(.+) 復活！$/, (m) => `${m[1]} revived!`],
  [/^(.+) 加入戰鬥$/, (m) => `${m[1]} joined the fight`],
  [/^(.+) 離開了隊伍$/, (m) => `${m[1]} left the team`],
  [/^(.+) 重新連線$/, (m) => `${m[1]} reconnected`],
  [/^(.+) 倒地 (\d+)s$/, (m) => `${m[1]} down ${m[2]}s`],
  [/^下一波倒數 (\d+)$/, (m) => `Next wave in ${m[1]}`],
  [/^最高 (\d+)$/, (m) => `Best ${m[1]}`],
  [/^毀滅攻擊 (\d+)$/, (m) => `DOOM ${m[1]}`],
  [/^太陽風暴 (\d+)$/, (m) => `Solar storm ${m[1]}`],
  [/^母艦充能毀滅攻擊！進入安全區（(\d+) 個）$/, (m) => `Mothership charging DOOM! Get into a safe zone (${m[1]})`],
  [/^母艦擊沉！\+(\d+)$/, (m) => `Mothership sunk! +${m[1]}`],
  [/^追獵者殲滅 \+(\d+)$/, (m) => `Hunter eliminated +${m[1]}`],
  [/^等待其他玩家選擇強化（(\d+) 人尚未選擇）$/, (m) => `Waiting for others to pick (${m[1]} left)`],
  [/^散射 ×(\d+)$/, (m) => `Spread ×${m[1]}`], [/^連射 (\d+)s$/, (m) => `Rapid ${m[1]}s`], [/^護盾 ×(\d+)$/, (m) => `Shield ×${m[1]}`], [/^雷射 (\d+)s$/, (m) => `Laser ${m[1]}s`],
  [/^最大生命 \+20$/, () => 'Max HP +20'], [/^突圍成功 \+(\d+)$/, (m) => `Breakout +${m[1]}`], [/^擊破殲滅者 Ω，撐過 (\d+) 波$/, (m) => `Annihilator Ω destroyed, ${m[1]} waves survived`],
  [/^(.+)：(\d+) 擊殺$/, (m) => `${m[1]}: ${m[2]} kills`],
  [/^來自(.+)的生物$/, (m) => `Creatures from ${tr(m[1])}`],
  [/^(.+)獵人 · (.+)$/, (m) => `${tr(m[1])} hunter · ${m[2].split(' + ').map(tr).join(' + ')}`],
  [/^(.+)自爆$/, (m) => `${tr(m[1])} blast`],
  [/^EMP：2 秒不能衝刺 \/ 閃現$/, () => 'EMP: no dash / blink for 2 s'],
  [/^成就解鎖 (.+)$/, (m) => `Achievement: ${m[1]}`],
  [/^任務完成 (.+)$/, (m) => `Quest complete: ${m[1]}`],
  [/^(.+)（目前：(.+)）$/, (m) => `${tr(m[1])} (now: ${tr(m[2])})`],
];
/** 翻譯一段顯示文字（中文 → 目前語言） */
export function tr(text) {
  if (lang === 'zh' || text == null) return text;
  const s = String(text);
  if (EXACT[s] !== undefined) return EXACT[s];
  for (const [re, fn] of RULES) { const m = s.match(re); if (m) return fn(m); }
  return s;
}
/** 翻譯 HTML：data-i18n（內容，原文放在屬性值裡）、data-i18n-ph（placeholder） */
export function applyDom() {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll('[data-i18n]')) { const src = el.dataset.i18n || el.textContent; el.dataset.i18n = src; el.textContent = tr(src); }
  for (const el of document.querySelectorAll('[data-i18n-ph]')) { const src = el.dataset.i18nPh; el.placeholder = tr(src); }
  for (const el of document.querySelectorAll('[data-i18n-html]')) { const src = el.dataset.i18nHtml; if (lang === 'en' && EN_HTML[src]) el.innerHTML = EN_HTML[src]; else if (ZH_HTML[src]) el.innerHTML = ZH_HTML[src]; }
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hant';
}
/** 大段說明文字（遊玩說明 / 隱私）兩種語言各一份 */
const ZH_HTML = {};
const EN_HTML = {
  help: `<h3>Controls</h3><ul><li><b>Desktop</b>: WASD / arrows move · mouse aims · left button fires · Shift dash · <b>Space blink</b> (teleport, invulnerable, 3 s cooldown) · Esc menu · M mute · upgrades with 1 / 2 / 3 or click, 0 skips (+20 HP)</li><li><b>Phone</b>: landscape. Drag left half = move; drag right half = aim & fire; auto-aim at the nearest enemy when not aiming; bottom-right buttons dash / blink; top-right ☰ menu. Auto-aim / auto-fire can be toggled in Settings.</li></ul>
<h3>Arenas & elements</h3><ul><li>Six arenas, each with its own hazards and native creatures: Deep space (void rifts), Inferno (lava, fire geysers), Mercury (gravity wells, solar storms), Venom (drifting toxic tides), Abyss (drag, currents, pressure), Glacier (slippery ice, blizzards, ice spikes).</li><li>Every weapon has an element and every creature has an affinity: frost hurts fire creatures, fire hurts ice and toxic, lightning wrecks water creatures, kinetic rounds (blaster / blade) punch through plasma, lasers cut void. Super-effective hits show ×1.5+.</li></ul>
<h3>Run structure</h3><ul><li>An upgrade every 2 waves (always after a boss). Two matching upgrades trigger a <b>synergy</b>. Collect the right upgrades for your weapon and an <b>evolution</b> card appears (one per run).</li><li>Boss every 5 waves; from wave 10 two bosses can show up together. Beat wave 20 for <b>Breakout</b>, then keep going endless.</li><li>Special waves (asteroids, bullet hell, bounty, beacon, convoy), enemy squads (sniper nests, kamikaze rushes, shield walls…), elites with affixes, and random events from wave 4: supply drops, wormholes, solar wind, black holes, rifts, dust storms, hunters, eclipses, meteor showers.</li><li>Every enemy attacks: swarmers explode on contact, tanks lob shells, wardens block from the front, snipers line up 1.4 s shots, mortars mark your landing spot, kamikazes rush you, hexers slow you… Purple dashed lines are lasers, orange rings are mines.</li></ul>
<h3>Weapons, ships, upgrades</h3><ul><li>Six weapons (blaster, flamethrower, frost beam, arc chain, laser, blade). The same upgrade does different things per weapon: ricochet makes bullets bounce, but turns flames into fire pools and lets the blade throw a slash wave. Check the hangar.</li><li>Seven ships with real playstyles: Wasp blinks every 1.2 s with an explosion, Bastion blocks from the front and shield-bashes, Carrier fights with drones, Ronin is melee only, Wraith has near-infinite blinks but no shields, Engineer drops turrets when dashing.</li></ul>
<h3>Co-op (up to 4)</h3><ul><li>Create a room → share the 4-letter code or invite link → host starts. Public rooms and quick match are on the menu. Stay near a downed teammate 3 s to revive; reconnect within 15 s after a drop.</li></ul>
<h3>Progression</h3><ul><li>Runs earn <b>stardust</b> to unlock ships, weapons, skins and perks. Daily quests, weekly quests and achievements pay extra dust. The daily challenge uses the same seed for everyone, once per day.</li></ul>`,
  privacy: `<ul><li>This is a game made for fun. <b>No sign-up, and we never collect names, emails, phone numbers or any personal data.</b></li><li>On first visit an anonymous random ID is generated in your browser to store scores, dust and unlocks. Clearing browser data means a fresh identity; we cannot link it to a person.</li><li>Your pilot callsign is only shown on leaderboards and above your ship.</li><li>To balance the game we log <b>anonymous play events</b> (wave reached, upgrades chosen, ship used, phone or desktop). They are tied only to the anonymous ID, contain nothing identifying, and are never shared.</li><li>No ads, no tracking cookies, no third-party analytics.</li></ul>`,
};
export function registerZhHtml(id, html) { ZH_HTML[id] = html; }
