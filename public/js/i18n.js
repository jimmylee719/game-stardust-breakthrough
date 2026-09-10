// 語言：中文為母語字串（程式與伺服器事件都用中文），英文用對照表在顯示時翻譯。
// tr(text)：精確對照 → 樣式規則（含數字）→ 原文。HTML 用 data-i18n / data-i18n-ph 屬性標記。
const KEY = 'stardust_lang';
let lang = 'zh';
try { const q = new URLSearchParams(location.search).get('lang'); lang = (q === 'en' || q === 'zh') ? q : localStorage.getItem(KEY) || ((navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'); } catch {}
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
  '獵鷹': 'Falcon', '黃蜂': 'Wasp', '堡壘': 'Bastion', '母艦': 'Carrier', '劍聖': 'Ronin', '幽靈': 'Wraith', '工程師': 'Engineer', '鳳凰': 'Phoenix', '收割者': 'Reaper',
  '散彈砲': 'Scatter cannon', '飛彈發射器': 'Missile launcher', '毒液砲': 'Venom cannon', '龍息霰彈': 'Dragon breath', '集束飛彈': 'Cluster missiles', '瘟疫': 'Plague',
  '浴火重生': 'Rebirth', '越殺越強': 'Snowball', '浴火重生！': 'Reborn from the ashes!', '瘟疫擴散': 'Plague spreads', '☣ 毒雲': '☣ Venom cloud', '⛶ 全螢幕': '⛶ Fullscreen', '🗗 離開全螢幕': '🗗 Exit fullscreen', 'ℹ️ 關於遊戲': 'ℹ️ About',
  '浴火重生：每局一次，生命歸零時原地復活回滿血並炸出火環（200 火焰傷害、清空周圍敵彈）；衝刺沿路留下火焰；火焰類傷害 +25%；生命 90': 'Rebirth: once per run, when HP hits zero you revive on the spot at full HP and burst a fire ring (200 fire damage, clears nearby enemy shots); dashes leave a fire trail; fire damage +25%; HP 90',
  '收割印記：每次擊殺疊 1 層（上限 25），每層傷害 +2%、速度 +1%；被打到會掉一半印記；技能能量獲得 ×1.5；生命 85、撿不到護盾': 'Harvest marks: every kill adds a stack (max 25), each stack +2% damage and +1% speed; getting hit loses half your stacks; skill energy gain ×1.5; HP 85, cannot pick up shields',
  '一次噴出 6 顆短程霰彈，貼臉全中傷害極高、越遠越散；射速慢，有後座力': 'Fires 6 short-range pellets at once: devastating up close, spreads out with distance; slow fire rate, strong recoil',
  '發射會追蹤的火箭，命中爆炸波及半徑 80 內所有敵人（火焰屬性）；彈速慢、射速慢': 'Fires homing rockets that explode on impact, hitting every enemy within 80 (fire element); slow projectile, slow fire rate',
  '拋射毒液團，命中或落地留下 4 秒毒雲：雲裡的敵人持續中毒、減速，離開後仍會毒 3 秒；對自己人無害': 'Lobs venom globs that leave a 4 s poison cloud on impact: enemies inside are poisoned and slowed, and stay poisoned 3 s after leaving; harmless to your team',
  '霰彈數加倍，每顆霰彈都會點燃敵人並穿透一個目標': 'Doubles the pellet count; every pellet ignites enemies and pierces one target',
  '火箭爆炸後再分裂出 4 枚小火箭各自追蹤': 'Each explosion splits into 4 mini rockets that home on their own',
  '中毒的敵人死亡時在原地留下新的毒雲（會傳染）': 'Poisoned enemies leave a fresh venom cloud when they die (it spreads)',
  '霰彈數 +2': 'Pellets +2', '射速 ×1.8': 'Fire rate ×1.8', '霰彈可穿透': 'Pellets pierce', '霰彈撞牆反彈且射程加倍': 'Pellets ricochet off walls and range doubles', '霰彈飛行中會聚向最近的敵人': 'Pellets curve toward the nearest enemy', '霰彈變大並帶擊退': 'Bigger pellets with knockback',
  '一次多發火箭': 'Multiple rockets per shot', '射速 ×2': 'Fire rate ×2', '爆炸半徑 +30%': 'Blast radius +30%', '火箭撞牆反彈繼續追蹤': 'Rockets bounce off walls and keep homing', '追蹤更靈敏、鎖定範圍更遠': 'Sharper homing, longer lock range', '爆炸傷害 +40%': 'Blast damage +40%',
  '一次多發毒液團': 'Multiple globs per shot', '中毒時間更長': 'Poison lasts longer', '毒液團撞牆反彈': 'Globs bounce off walls', '毒液團會彎向最近的敵人': 'Globs curve toward the nearest enemy', '毒雲半徑 +50%': 'Cloud radius +50%',
  '動能（脈衝砲 / 光刃 / 散彈砲）': 'Kinetic (blaster / blade / scatter)', '火焰（火焰槍 / 飛彈）': 'Fire (flamethrower / missiles)',
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
  [/^(.+) 倒地 (\d+)s$/, (m) => `${m[1]} down ${m[2]}s`],
  [/^(.+)：(\d+) 擊殺$/, (m) => `${m[1]}: ${m[2]} kills`],
  [/^🏆 (.+) 第 (\d+) 名$/, (m) => `🏆 ${tr(m[1])} #${m[2]}`],
  [/^第 (\d+) 名$/, (m) => `#${m[1]}`],
  [/^星塵 \+(\d+)$/, (m) => `Stardust +${m[1]}`],
  [/^含 (\d+) 星塵碎片$/, (m) => `incl. ${m[1]} dust shards`],
  [/^全員出擊（(\d+) 人）$/, (m) => `Launch (${m[1]} players)`],
  [/^散射 ×(\d+)$/, (m) => `Spread ×${m[1]}`],
  [/^連射 (\d+)s$/, (m) => `Rapid ${m[1]}s`],
  [/^護盾 ×(\d+)$/, (m) => `Shield ×${m[1]}`],
  [/^雷射 (\d+)s$/, (m) => `Laser ${m[1]}s`],
  [/^  剩餘 (\d+)$/, (m) => `  ${m[1]} left`],
  [/^毀滅攻擊 (\d+)$/, (m) => `Doomsday ${m[1]}`],
  [/^下一波倒數 (\d+)$/, (m) => `Next wave in ${m[1]}`],
  [/^第 (\d+) 波 清除！$/, (m) => `Wave ${m[1]} cleared!`],
  [/^等待其他玩家選擇強化（(\d+) 人尚未選擇）$/, (m) => `Waiting for others to pick (${m[1]} left)`],
  [/^擊破殲滅者 Ω，撐過 (\d+) 波$/, (m) => `Annihilator Ω destroyed, ${m[1]} waves survived`],
  [/^組合技 (.+)$/, (m) => `Synergy ${m[1].replace(/^(\S+) (.+)$/, (_, i, n) => i + ' ' + tr(n))}`],
  [/^你的最佳：(\d+) 分（第 (\d+) 波）· 全部時間第 (\d+) 名 · 共 (\d+) 局$/, (m) => `Your best: ${m[1]} (wave ${m[2]}) · all-time #${m[3]} · ${m[4]} runs`],
  [/^進化 · (.+)$/, (m) => `Evolution · ${tr(m[1])}`],
  [/^收割印記 ×(\d+)$/, (m) => `Harvest ×${m[1]}`],
  [/^印記流失 → ×(\d+)$/, (m) => `Marks lost → ×${m[1]}`],
  [/^(\d+) 隻 Boss 同時來襲！$/, (m) => `${m[1]} bosses incoming!`],
  [/^見過 (\d+) \/ (\d+) 種敵人（打過就會記錄）$/, (m) => `Seen ${m[1]} / ${m[2]} enemy types (recorded once you fight them)`],
  [/^最高第 (\d+) 波$/, (m) => `Best wave ${m[1]}`],
  [/^最佳第 (\d+) 波$/, (m) => `Best wave ${m[1]}`],
  [/^遭遇過 (\d+) \/ (\d+) 種 Boss$/, (m) => `Met ${m[1]} / ${m[2]} bosses`],
  [/^遇過 (\d+) \/ (\d+) 種隨機事件$/, (m) => `Seen ${m[1]} / ${m[2]} random events`],
  [/^每週任務 · (\S+) 起$/, (m) => `Weekly quests · from ${m[1]}`],
  [/^每日任務每天換一組（(\S+)），每週任務跨局累計（週一重置，本週 (\S+)）。完成直接拿星塵。$/, (m) => `Daily quests change every day (${m[1]}); weekly quests accumulate across runs (reset Monday, this week ${m[2]}). Completing them pays stardust.`],
  [/^第 (\d+) 波$/, (m) => `Wave ${m[1]}`],
  [/^能量不足 (\d+)\/(\d+)$/, (m) => `Not enough energy ${m[1]}/${m[2]}`],
  [/^時間停止 ([\d.]+)$/, (m) => `Time stop ${m[1]}`],
  [/^ · 超載 (\d+)s$/, (m) => ` · Overdrive ${m[1]}s`],
  [/^星塵不足，解鎖 (.+) 需要 (\d+)$/, (m) => `Not enough stardust: ${tr(m[1])} costs ${m[2]}`],
  [/^已解鎖 (\S+) (.+)$/, (m) => `Unlocked ${m[1]} ${tr(m[2])}`],
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
  [/^(.+) 擊破 \+(\d+)$/, (m) => `${tr(m[1])} destroyed +${m[2]}`],
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
import { EXTRA, RULES_EXTRA } from './i18n-extra.js';
Object.assign(EXACT, {
  '遊玩說明': 'How to play', '隱私說明': 'Privacy', '衝刺': 'Dash', '閃現': 'Blink', '衝刺 (Shift)': 'Dash (Shift)', '閃現 (空白鍵)': 'Blink (Space)',
  '複製邀請連結': 'Copy invite link', '從 Boss 戰開始（Boss 挑戰）': 'Start at the boss fight (Boss rush)', '公開房間（會出現在公開房間列表，讓其他玩家加入）': 'Public room (listed so other players can join)',
  '出擊': 'Launch', '等待房主開始…': 'Waiting for the host…', '離開房間': 'Leave room', '重新整理': 'Refresh', '敵人': 'Enemies', '場地': 'Arenas', '事件': 'Events', '屬性相剋': 'Elements',
  '機體（點選出擊用的機體，每台玩法不同）': 'Ships (pick one to fly; each plays differently)', '主武器（每把武器對升級的反應都不同）': 'Main weapon (each reacts differently to upgrades)', '塗裝（純外觀）': 'Skins (cosmetic)', '永久強化（每局開局自動套用）': 'Perks (applied at the start of every run)', '帳號轉移（換裝置繼續累積）': 'Account transfer (continue on another device)',
  '你的進度綁在這台裝置的匿名帳號上。要在另一台裝置繼續，複製下面的轉移碼貼到那邊的「匯入」即可。轉移碼等同帳號密碼，不要公開。': 'Your progress is tied to this device\'s anonymous account. To continue on another device, copy the transfer code below and paste it into "Import" there. The code works like a password — keep it private.',
  '複製': 'Copy', '匯入': 'Import', '貼上另一台裝置的轉移碼': 'Paste the transfer code from another device', '今日排行榜': 'Today\'s leaderboard', '請將手機轉成橫向遊玩': 'Rotate your phone to landscape',
  'WASD / 方向鍵 移動 · 滑鼠 瞄準射擊 · Shift 衝刺 · Esc 選單': 'WASD / arrows move · mouse aims & fires · Shift dash · Esc menu', '單獨出擊（可等朋友加入）': 'Launch solo (friends can still join)',
  '救援中…': 'Reviving…', '靠近 3 秒救援': 'Stay close 3 s to revive', '安全區': 'Safe zone', '進入白色安全區！其他地方會被打到只剩 1 點生命': 'Get into a white safe zone! Everywhere else drops you to 1 HP', '運輸艦': 'Convoy', '🔇 靜音 (M)': '🔇 Muted (M)', '偵測到巨型敵艦接近': 'Massive enemy vessel approaching', '  · 隱形': '  · CLOAKED',
  '選擇一項強化（點擊卡片或按 1 / 2 / 3）': 'Pick an upgrade (click a card or press 1 / 2 / 3)', '突圍成功': 'BREAKOUT!', '無盡模式終結': 'Endless run over', '已離開戰鬥': 'Left the fight', '撤退': 'Retreated', '全員陣亡': 'Squad wiped', '艦艇損毀': 'Ship destroyed',
  '合作排行榜': 'Co-op leaderboard', '今日挑戰': 'Daily challenge', '單人排行榜': 'Solo leaderboard', '合作成績會在隊伍結束時一併結算，你的擊殺數會計入': 'Co-op results are tallied when the team finishes; your kills count',
  '每日挑戰結束 · L 今日排行榜 · 點擊 或 Esc 回到選單': 'Daily challenge over · L today\'s board · click or Esc for menu', '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到大廳': 'Click or Enter to play again · L leaderboard · Esc lobby', '等待房主再開一局 · L 排行榜 · Esc 回到大廳': 'Waiting for the host to restart · L leaderboard · Esc lobby', '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到選單': 'Click or Enter to play again · L leaderboard · Esc menu',
  '暫停': 'Paused', '按 P 繼續': 'Press P to resume', '關於遊戲': 'About the game',
  '這台機體不能用這把武器': 'This ship cannot use that weapon', '母艦靠僚機作戰，不能裝光刃。': 'The Carrier fights with drones and cannot mount the blade.',
  'Boss 挑戰：每一波都只有 Boss（1–6 隻隨機），連續 8 波通關，分數與星塵 ×1.5': 'Boss rush: every wave is bosses only (1–6 at random), clear 8 waves to win, score and stardust ×1.5',
  'Boss 挑戰通關：連續擊破 8 波 Boss': 'Boss rush cleared: 8 boss waves in a row',
  '毒霧隱蔽': 'Hidden in fog', '毒霧 · 互相看不見': 'Fog · no one can see through', '毒霧隱蔽：敵人追蹤不到你': 'Hidden in fog: enemies lose track of you',
  'iPhone / iPad：用 Safari「分享 → 加入主畫面」開啟，才會全螢幕沒有網址列': 'iPhone / iPad: open it via Safari "Share → Add to Home Screen" for full screen without the address bar',
  '目前': 'now', '每日任務': 'Daily quests', '每週任務': 'Weekly quests', '動能（脈衝砲 / 光刃）': 'Kinetic (blaster / blade)', '敵人屬性 × 武器屬性 = 傷害倍率（綠色有效、紅色被抵抗）': 'Enemy element × weapon element = damage multiplier (green effective, red resisted)', '✔ 使用中': '✔ In use',
  '生命': 'HP', '速度': 'Speed', '射速': 'Fire rate', '傷害': 'Damage', '星塵': 'Stardust', '累計': 'total', '進化': 'Evolution', '✔ 裝備中': '✔ Equipped', '✔ 出擊中': '✔ Flying', '劍聖只能使用光刃。': 'Ronin can only use the blade.', '對升級 / 道具的反應：': 'reacts to upgrades / pickups:',
  '尚未遭遇': 'Not encountered yet', '原生生物': 'Native creature', '未挑戰': 'Not attempted', '散射道具': 'Spread pickup', '連射道具': 'Rapid pickup',
  '飛彈雨': 'Missile swarm', '原子彈': 'Nova bomb', '時間停止': 'Time stop', '聖盾脈衝': 'Aegis pulse', '奇異點': 'Singularity', '超載': 'Overdrive',
  '射出 30 枚小型追蹤飛彈，每枚 14 傷害，自動鎖定最近的敵人': 'Fires 30 mini homing missiles (14 dmg each) that lock onto the nearest enemies',
  '1.2 秒引爆倒數後全畫面核爆：敵人 260 傷害、Boss 400，清空所有敵彈': 'After a 1.2 s countdown, a screen-wide blast: 260 dmg to enemies, 400 to bosses, clears all enemy bullets',
  '敵人、敵彈與 Boss 凍結 3.5 秒；凍結中的敵人被打死會碎裂傷到周圍': 'Freezes enemies, bullets and bosses for 3.5 s; frozen enemies shatter and damage their neighbours',
  '全隊 +2 護盾（沒有護盾的機體 +40 生命），把周圍敵人推開並清掉附近敵彈': 'Whole team +2 shield (+40 HP for ships without shields), knocks nearby enemies back and clears nearby bullets',
  '朝瞄準方向放出黑洞吸 4 秒（不會吸自己人），結束時爆炸造成 150 傷害': 'Drops a black hole toward your aim for 4 s (never pulls allies), then detonates for 150 dmg',
  '6 秒：連射、傷害 ×1.5、速度 +30%、衝刺無冷卻': '6 s: rapid fire, damage ×1.5, speed +30%, no dash cooldown',
  '主動技能（擊殺累積能量，按 E / 滑鼠右鍵 / 觸控鈕施放）': 'Active skill (kills build energy; cast with E / right click / touch button)', '使用中': 'Equipped', '已解鎖': 'Unlocked',
  ' · E / 右鍵 施放': ' · E / RMB to cast', '原子彈引爆倒數': 'Nova countdown', '星塵不足': 'Not enough stardust', '目前離線，無法解鎖': 'Offline, cannot unlock',
}, EXTRA);
RULES.push(...RULES_EXTRA);
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
<h3>Run structure</h3><ul><li>An upgrade every 2 waves (always after a boss). Two matching upgrades trigger a <b>synergy</b>. Collect the right upgrades for your weapon and an <b>evolution</b> card appears (one per run).</li><li>Boss every 5 waves; from wave 10 two bosses can show up together. Beat wave 20 for <b>Breakout</b>, then keep going endless.</li><li>Special waves (asteroids, bullet hell, bounty, beacon, convoy), enemy squads (sniper nests, kamikaze rushes, shield walls…), elites with affixes, and random events every 25–40 s from wave 4: supply drops, wormholes, solar wind, black holes, rifts, dust storms, hunters, eclipses, meteor showers. <b>Events and arena hazards hit everyone</b>: solar storms, geysers, ice spikes, toxic pools, EMP rings, pressure zones and black holes hurt enemies too, so use them.</li><li>Every enemy attacks: swarmers explode on contact, tanks lob shells, wardens block from the front, snipers line up 1.4 s shots, mortars mark your landing spot, kamikazes rush you, hexers slow you… Purple dashed lines are lasers, orange rings are mines.</li></ul>
<h3>Weapons, ships, upgrades</h3><ul><li>Nine weapons (blaster, flamethrower, frost beam, arc chain, laser, blade, scatter cannon, missile launcher, venom cannon). The same upgrade does different things per weapon: ricochet makes bullets bounce, but turns flames into fire pools, lets the blade throw a slash wave and doubles pellet range. Synergies also work on non-bullet weapons (Ember ignites on beam / swing hits, Bullet wall boosts reflected beams by 50% and adds an arc target). Check the hangar.</li><li>Nine ships with real playstyles: Wasp blinks every 1.2 s with an explosion, Bastion blocks from the front and shield-bashes, Carrier fights with drones, Ronin is melee only, Wraith has near-infinite blinks but no shields, Engineer drops turrets when dashing, Phoenix is reborn once per run and leaves a fire trail, Reaper grows stronger with every kill (and loses marks when hit).</li></ul>
<h3>Co-op (up to 4)</h3><ul><li>Create a room → share the 4-letter code or invite link → host starts. Public rooms and quick match are on the menu. Stay near a downed teammate 3 s to revive; reconnect within 15 s after a drop.</li></ul>
<h3>Progression</h3><ul><li>Runs earn <b>stardust</b> to unlock ships, weapons, skins and perks. Daily quests, weekly quests and achievements pay extra dust. The daily challenge uses the same seed for everyone, once per day.</li></ul>`,
  about: `<h3>What is this game</h3>
<p><b>Stardust Breakout (星塵突圍)</b> is a free neon 2D co-op space shooter that runs right in your browser, made by <b>Vanture Co., Ltd.</b> No download, no sign-up, no ads; playable on desktop and phones, with up to 4 players in co-op.</p>
<h3>Features</h3>
<ul>
<li><b>Six arenas</b>: Deep space, Inferno, Mercury, Venom, Abyss and Glacier, each with its own hazards (void rifts, lava, solar storms, toxic fog, currents, blizzards) and native creatures; elemental affinities change damage.</li>
<li><b>Nine ships</b>: Falcon, Wasp, Bastion, Carrier, Ronin, Wraith, Engineer, Phoenix and Reaper, each with a distinct mechanic (blink strikes, front shield, drone fleet, pure melee, endless blinks, turrets, rebirth, snowballing marks).</li>
<li><b>Nine weapons</b>: Blaster, Flamethrower, Frost beam, Arc chain, Laser, Blade, Scatter cannon, Missile launcher and Venom cannon; the same upgrade behaves differently on each weapon, and meeting the requirements unlocks a weapon evolution.</li>
<li><b>Six active skills</b>: Missile rain, Nuke, Time stop, Aegis pulse, Singularity and Overdrive, charged by kills.</li>
<li><b>Every enemy attacks</b> and telegraphs its skills with a warning mark; elites carry affixes, four boss types, and random events (supply drops, wormholes, black holes, eclipses, meteor showers…) plus arena hazards hit everyone, enemies included.</li>
<li><b>Boss rush</b> (bosses only, 1–6 at random, 8 waves, ×1.5 rewards), <b>daily challenge</b> (same rules worldwide) and <b>global leaderboards</b> (solo / co-op / daily, all-time / weekly).</li>
<li><b>Meta progression</b>: stardust unlocks ships, weapons, skills, skins and permanent perks; daily and weekly quests, achievements and a codex.</li>
</ul>
<h3>FAQ</h3>
<p><b>Do I need to download or sign up?</b> No, open the URL and play. Progress is tied to an anonymous browser account; move it to another device with the transfer code in the hangar.</p>
<p><b>Does it work on mobile?</b> Yes, in landscape: drag the left half to move, the right half to aim and fire. On iPhone use Safari “Add to Home Screen” for full screen.</p>
<p><b>How do I play with friends?</b> Create a room, share the 4-letter code or invite link, and the host launches; or use public rooms and quick match.</p>
<p><b>What data is collected?</b> Only an anonymous ID and anonymous play events (wave reached, upgrades picked). No names, emails, ads or tracking cookies. See the privacy note.</p>
<h3>Tech</h3>
<p>Pure HTML5 Canvas 2D + Web Audio, server-authoritative 30 Hz simulation over WebSocket, installable as a PWA.</p>`,
  privacy: `<ul><li>This is a game made for fun. <b>No sign-up, and we never collect names, emails, phone numbers or any personal data.</b></li><li>On first visit an anonymous random ID is generated in your browser to store scores, dust and unlocks. Clearing browser data means a fresh identity; we cannot link it to a person.</li><li>Your pilot callsign is only shown on leaderboards and above your ship.</li><li>To balance the game we log <b>anonymous play events</b> (wave reached, upgrades chosen, ship used, phone or desktop). They are tied only to the anonymous ID, contain nothing identifying, and are never shared.</li><li>No ads, no tracking cookies, no third-party analytics.</li></ul>`,
};
export function registerZhHtml(id, html) { ZH_HTML[id] = html; }
