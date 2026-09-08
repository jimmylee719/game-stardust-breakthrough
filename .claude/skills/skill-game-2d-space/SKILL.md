---
name: skill-game-2d-space
description: >-
  星塵突圍 Stardust Breakout（2D 霓虹風合作太空射擊）的完整開發、建置、測試、部署與遊玩手冊。
  當任務涉及這款遊戲（或以它為模板的任何 HTML5 Canvas 多人 2D 遊戲）的：新增敵人 / Boss 招式 / 波次玩法 /
  升級 / 道具、調難度、打擊感、觸控、WebSocket 房間與客戶端預測、匿名帳號與排行榜、Railway 部署與
  PostgreSQL、無頭測試，或使用者說「照星塵突圍的方式做一個 2D 遊戲」時，務必使用本 skill。
  Full playbook for building, testing, deploying and playing the Stardust Breakout 2D co-op shooter.
---

# 星塵突圍 Stardust Breakout — 2D 太空射擊開發手冊

- 專案：`C:\Users\jimmy\Desktop\game-test`（GitHub `jimmylee719/game-stardust-breakthrough`，main 分支）
- 線上：https://game-stardust-breakthrough-production.up.railway.app （Railway Hobby，新加坡節點，Postgres）
- 技術：純 HTML5 Canvas 2D + Web Audio 合成音效 + Node 22 `http` + `ws`，零前端框架、零圖檔。ES modules。
- 定位：抒壓小遊戲，未來可商業化。**視覺風格鎖定霓虹**（深空底、強光暈、程式繪製向量圖形），不要再提供主題切換。

---

## 1. 架構鐵則（改任何東西前先讀）

1. **`public/js/game.js` 是唯一的遊戲邏輯，且必須無環境相依**：不碰 DOM、Canvas、Audio、`window`、`setTimeout`、`performance`。同一份程式在瀏覽器（單機）和 Node 伺服器（多人）執行。
   - 視聽回饋一律透過 `fx` 介面（`burst / ring / text / shake / slowmo / hitStop / aberrate / sfx / beep / noise …`）。預設 `NULL_FX` 全部 no-op。
   - 只對某位玩家生效的效果用 `fx.local(player).xxx()`（本機才播；伺服器端會錄成帶 pid 的事件）。
   - 延遲動作用 `schedule(world, delay, fn)`（世界時間），不用 setTimeout。
2. **所有平衡數值集中在 `shared/constants.js`**：`PLAYER_BASE`、`ENEMY_TYPES`、`DIFFICULTY`、`AI`、`BOSS_*`、`UPGRADE_EVERY_WAVES`、`WAVE_MODES`、`MODE_SCHEDULE`、`UPGRADES`、`PICKUP_STYLE`、`MIN_RUN_SCORE`。調難度只改這裡。
3. **伺服器權威**：`server/index.js` 每房一個 `world`，30 Hz 跑 `update()`，每 tick 廣播 `shared/snapshot.js` 的 `snapshotWorld()` + fx 事件；客戶端只送輸入 `{seq, ix, iy, angle, fire, dash}`。
4. **新增任何會被看到的狀態，要同時改四處**：`game.js`（邏輯）→ `snapshot.js`（`snapshotWorld` 序列化 + `applySnapshot` 還原/插值）→ `render.js`（繪製）→ `test/sim.js` 或 `test/net.js`（驗證）。漏掉 snapshot 的話單機看得到、多人看不到。
5. **`stepPlayer()` 是純函式**（只改 `p`），伺服器模擬與 `predict.js` 客戶端預測共用；改移動手感只能改它。
6. 固定邏輯世界 **1600×900**，等比縮放加黑邊；所有座標用世界座標，螢幕座標只在 `input.js` / 觸控按鈕與 `render.js` 的 `view` 轉換。

## 2. 檔案地圖

| 檔案 | 責任 |
|---|---|
| `shared/math.js` | `TAU rand randInt clamp dist2 lerp angleDiff` |
| `shared/constants.js` | 全部數值：`PLAYER_BASE ENEMY_TYPES DIFFICULTY AI BOSS_* WAVE_MODES MODE_SCHEDULE UPGRADES SYNERGIES SHIPS PERKS WIN_WAVE MIN_RUN_SCORE`，以及 `applyShip applyPerks activeSynergies synergyIfPicked dustFor sanitizeName` |
| `shared/snapshot.js` | 快照序列化與雙快照插值（`INTERP_DELAY` 兩個 tick） |
| `shared/daily.js` | 每日挑戰：`dayKey()`（台灣時間）、`dailyChallenge(key)` 由種子選兩個規則 |
| `shared/math.js` 的 `seedRandom` | 可換種子的亂數；`game.js` 一律用 `rnd()/rand()`，**不要直接呼叫 `Math.random`**（每日挑戰要固定種子） |
| `public/js/game.js` | 世界、玩家、敵人 AI、Boss 狀態機、波次模式、雷射、道具、擊殺 / 受傷 / 倒地救援、升級、`abandonRun` |
| `public/js/render.js` | 所有繪製；`themedContext` Proxy 包裝 canvas context |
| `public/js/effects.js` | 粒子、浮字、震動、慢動作、定格、色差；**震動與慢動作以真實時間衰減**（`decayEffects`） |
| `public/js/input.js` | 鍵鼠 + 觸控雙搖桿（自動瞄準 / 自動開火）、`buildInput()` |
| `public/js/net.js` / `predict.js` | 連線、重連、事件播放；客戶端預測與和解 |
| `public/js/account.js` | 匿名帳號（localStorage id+secret）、`profile` 快取（星塵 / 解鎖）、`submitRun`（solo / daily）、`buyPerk`、`fetchDaily` / `startDaily`、排行榜 |
| `public/js/main.js` | 選單（單人 / Boss / 每日 / 機庫 / 遊玩說明 / 隱私說明 彈出頁）、大廳、Esc 選單與 `leaveGame`、勝利畫面 `victoryChoice`、排行榜 UI、主迴圈；`window.__dbg()` 給自動化用 |
| `server/index.js` | 靜態檔、`/health`、REST API（register / rename / runs / runs/delete / leaderboard / me / perks/buy / daily / daily/start / events / stats）、WS 房間（4 碼房號、最多 4 人、中途加入、token 重連、離隊、endless / finish） |
| `server/db.js` | `DATABASE_URL` → PostgreSQL；否則 JSON 檔（`DATA_DIR`）；含 `events` 表 |
| `server/stats.js` / `public/admin.html` / `public/js/analytics.js` | 事件聚合（純函式）、儀表板（需 `ADMIN_KEY`）、客戶端批次上報（sendBeacon） |
| `test/sim.js` `syn.js` `net.js` `api.js` | 無頭模擬、組合技 / 通關規則、WS 端對端、REST + 合作成績 |

## 3. 開發流程（照做）

```bash
npm start                    # http://localhost:8765 （本機開 /admin.html 不需要金鑰）
npm test                     # sim + syn + net + api 全跑，每套最後一行要 PASS
node test/sim.js --wave=8 --god --seconds=120 --verbose   # 指定波、無敵、看波次日誌與雷射/地雷統計
node test/sim.js --wave=19 --god --endless               # 打到第 20 波 Boss 通關後繼續無盡
node test/sim.js --players=3 --seconds=150               # 多人平衡
node test/syn.js                                         # 七組組合技效果與通關規則
```

**測試要能擋住 commit**：`npm test | grep PASS` 只要有輸出就是 exit 0，曾因此把失敗的測試推上線。正確寫法：

```bash
npm test > "$TEMP/t.out" 2>&1; grep -E "PASS|FAIL|CRASH" "$TEMP/t.out"; if grep -q "FAIL\|CRASH" "$TEMP/t.out"; then exit 1; fi
```

新功能的順序：**constants → game.js → snapshot.js → render.js → 測試 → README + 本 skill → commit → push（自動部署）→ 等線上檔案出現新字串再 curl `/health`**。
本 skill 有兩份必須一起改：專案內 `.claude/skills/skill-game-2d-space/SKILL.md`（進 git）與 `~/.claude/skills/skill-game-2d-space/SKILL.md`（全域），改完 `diff` 確認一致。
等部署的寫法：`until curl -s URL/shared/constants.js | grep -a -q "新字串"; do sleep 15; done`，放 `run_in_background`。

瀏覽器驗證用 `.claude/launch.json` 的 `stardust` 預覽伺服器，再用 `window.__dbg()` 直接塞敵人 / 改 `world` 狀態截圖；
按鈕用 `document.getElementById('solo').click()`，鍵盤用 `window.dispatchEvent(new KeyboardEvent('keydown', {code:'Escape'}))`。
預覽面板隱藏時 `requestAnimationFrame` 會被節流，時間相關的觀察以 Node 無頭測試為準。

## 4. 目前的玩法規格（改動時保持一致）

- 效能：`themes.js` 的 `themedContext` 在恆等主題時直接回傳原生 context（Proxy 是掉幀主因）；`effects.js` 的 `trackFrame` 自動切 `vfx.lowQ`，render 依此關光暈；粒子上限 600。
- 閃電鏈沒目標時按住會蓄電（`p.arcCharge` 0–1.5，傷害最多 ×2），機頭 `fx.bolt` 噼啪 + render 的蓄電環；首頁動畫全在 style.css 的「首頁動畫」段（`prefers-reduced-motion` 會關）。
- 閃現：`PLAYER_BASE.blinkDist/blinkCd/blinkInv`，`stepPlayer` 內處理（`inp.blink`），輸入協定 `{ix,iy,angle,fire,dash,blink}`，`predict.js` FIELDS 含 `blinkCd/blinkCdMax`；觸控 `touchLayout().blink`。
- 塗裝：`SKINS`（`skin:<id>` 解鎖），render 的 `drawPlayers` 用 `skinById`；join 帶 `skin` 由 `skinUnlocked` 驗證。
- 敵人子彈都帶 `owner`，`killEnemy` 會清掉該 owner 的子彈。
- 毒區 `world.zones`（`drainPlayer` 無視護盾 / 無敵）、飛碟軍團 `spawnFleet` + 母艦 `kind: 'mothership'`，毀滅攻擊 `startDoom / fireDoom`（`world.safeZones`, `world.doom`）；常數在 `AMBIENT`。圍攻用 `e.slot / e.encT`；敵人閃現 `enemyBlink`（`ENEMY_BLINK_FROM_WAVE`）。
- 手感：`effects.js` 的 `slowmo` 是 no-op、`hitStop` 只接受 ≥ 0.2 s（Boss 擊破）。**不要再加慢動作**（玩家明確回饋）。
- 主武器：`WEAPONS`（blaster / flame / frost / arc，`WEAPON_STATS`），發射邏輯在 `update()` 的「射擊：依主武器分派」；`p.weaponOn` 給連續武器渲染；閃電走 `fx.bolt(points)`；伺服器 join 用 `weaponUnlocked` 驗證，解鎖 id `weapon:<id>`。
- 玩家：HP 100、傷害 8、射速 0.16 s、衝刺 1.2 s 冷卻。每 2 波三選一升級（Boss 後必給），13 種升級（傷害 +20%、射速 +10%、穿甲、反彈、追蹤、僚機、汲血、連鎖爆裂、裝甲、推進、衝刺冷卻、牽引、巨型彈體）。
- 道具：+HP、散射、連射、護盾、炸彈（震動 / 慢動作 0.6 秒）、雷射（5 秒貫穿光束，每秒 傷害×7）。
- 敵人：drifter / dart / tank / shooter / splitter / rock / **lancer（雷射兵）** / **bounty（懸賞目標）**。精英第 4 波起（1.5 倍體型、3 倍血、必掉道具）。
- 敵人 AI（`AI` 常數）：追擊者側面包抄；飛鏢突進；射手風箏 + 第 5 波預判射擊 + 第 6 波閃避子彈 + 第 8 波佈雷；雷射兵預警 1.1 s（前 70% 追蹤）→ 0.35 s 貫穿雷射；懸賞目標逃跑、閃現、還擊；第 6 波起 50% 夾擊隊形。
- Boss：**`world.bosses` 是陣列**（沒有 `world.boss` 了），`BOSS_KINDS` 四種（annihilator / hive / phantom / titan），`makeBoss / spawnBoss / bossBrain（閃避、搶道具）/ updateBoss(world, b) / damageBoss(world, b, …) / killBoss(world, b)`；第 10 波起 `BOSS_DOUBLE_CHANCE` 雙 Boss（slot -1 / +1），第 20 波固定殲滅者 Ω。招式池在 `updateBoss` 的 `pools`。幽影 `b.cloak` 隱形（被打會縮短），星隕 `armor 0.7`。
- 環境單位：`spawnAmbient(world, 'meteor'|'ufo')`，`e.ambient = true` 不算波次（`waveEnemies()`），`AMBIENT` 常數；飛碟子彈 `ufo: true` 會打敵人與 Boss。
- 敵人搶道具：`e.wantPickup`，吃到依 kind 給 Buff（`buffSpeed / buffRapid / buffSpread / armored`），`DIFFICULTY.pickupHuntFromWave`。追擊者閃避 `chaserDodgeFromWave`。
- 無傷清波 `world.waveDamaged`（`hurtPlayer` 設）、擦彈 `world.graze`。
- 特殊波：3 小行星帶、4 彈幕求生、6 懸賞獵殺、8 護送運輸艦、9 防衛信標、12 小行星帶；10 波後 40% 隨機。
- 合作：倒地 30 s、靠近 3 s 救援；斷線 15 s 內重連；中途加入；Esc 離開 = 單人立即結算上傳、多人離隊（擊殺仍計入隊伍成績）。
- 排行榜：單人（客戶端回報）、合作（伺服器記錄）、每日（今日榜）、全部 / 本週；`MIN_RUN_SCORE = 10`；玩家可刪自己的單人成績。
- 組合技：`SYNERGIES`（7 組，`needs` 兩個升級 id），`chooseUpgrade` 後用 `activeSynergies` 更新 `p.syn`，效果散在 game.js 依 `p.syn.<id>` 判斷；升級卡提示用 `synergyIfPicked`。通關：`WIN_WAVE = 20`，`killBoss` 內 `world.won` → scene `victory`（每日直接 gameover）；`continueEndless` / `finishRun`，伺服器訊息 `endless` / `finish`（房主）。`inProgress` 要包含 `victory`。
- 機體：`SHIPS`（falcon / wasp / bastion / carrier），`applyShip` 在 `addPlayer` 內、永久強化之前套用；客戶端 join 帶 `ship`，伺服器用 `shipUnlocked(ship, unlocks)` 驗證後才建玩家（join 改成先 `await db.auth`）；解鎖走 `/api/perks/buy` 的 `ship:<id>`；`render.js` 的 `shipPath(ship)` 畫船身。
- 選單 UI：首頁面板  由  依視窗整塊縮放（不捲動、不出現捲軸）；任何裝置按出擊都 （手機另鎖橫向），右上 ⛶ 切換全螢幕； margin 0 才會等高（ 有 margin-top 會把同列按鈕拉高）。單人出擊與 Boss 挑戰等寬；底部只有「📖 遊玩說明」「🔒 隱私說明」兩個按鈕，各自彈出 `.panel.doc`（右上 `.x` 關閉、Esc 也關）。隱私說明承諾：不需註冊、不收個資、只有匿名編號與匿名遊玩事件、無廣告 / 追蹤 Cookie / 第三方分析——**新增任何收集行為前要先改這段文字**。
- 帳號轉移碼：`exportCode()` = `SD1-<id>-<secret>`，`importCode()` 用 `/api/me` 驗證後覆蓋 localStorage；碼等同密碼。
- 遊玩事件（`analytics.js` → `POST /api/events`，白名單 `EVENT_NAMES`）：`session{device}`、`run_start{mode,ship,wave0}`、`run_end{mode,ship,wave,score,reason: dead|abandon|victory|endless|left,dur,kills,ups,syn}`、`upgrade{id,wave}`；伺服器記 `room{kind}`、合作局 `run_start/run_end`、`perk_buy`、`daily_start`。儀表板 `/admin.html` 讀 `GET /api/stats?key=&days=`。
- 局外成長：星塵 = `dustFor(score, wave, unlocks)`（分數/25 + 波×5，上限 2000，任何分數都給）；機庫 `PERKS`（7 種永久強化，`applyPerks` 在 `addPlayer` 套用，伺服器在 join 時依帳號套用）；每日挑戰 `DAILY_MODS`（`world.mods` 由 `startRun({mods})` 設定，只在單機模式跑，伺服器房間不做每日）。一天一次由伺服器用 `players.daily_started` + 當日 runs 記錄擋。

## 5. 部署與資料

- Railway：`railway.json`（Nixpacks）、`/health` 健康檢查、Node 22 pinned（`.nvmrc` + `engines`）、綁 `0.0.0.0`、WS 每 25 s ping。也有 `Dockerfile`。
- **每次 push main 會自動重新部署並清掉所有進行中的房間**——要驗證線上多人時先部署再測；商業化前改成手動部署或維護時段。
- Postgres：Railway 專案 `+ New → Database → Add PostgreSQL`，自動注入 `DATABASE_URL`；`/health` 的 `db` 由 `file` 變 `postgres` 即成功，資料表與新欄位由 `db.js` 的 `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` 自動建立（加欄位就寫在那裡）。
- 環境變數：`PORT`（Railway 自動）、`DATABASE_URL`、`DATA_DIR`（JSON 檔位置，測試用暫存目錄隔離）、`ADMIN_KEY`（**已在 Railway 設好**，儀表板 https://game-stardust-breakthrough-production.up.railway.app/admin.html 載入成功；沒設定時只有 localhost 能看 `/api/stats`）。
- 線上驗證指令：
  ```bash
  curl -s https://game-stardust-breakthrough-production.up.railway.app/health
  ```

## 6. 已踩過的坑（不要再踩）

- Bash heredoc 與 `$`、反引號在雙引號內會被展開 → **patch 一律寫成 `.cjs` 檔用 node 跑**，且用 `s.replace(a, () => b)`（函式替換），否則替換字串裡的 `$'`、`$&` 會被當成特殊樣式把檔案炸掉。
- `git checkout` 還原檔案會變成 CRLF（`core.autocrlf=true`），之後字串比對會失敗：`sed -i 's/\r$//' file` 先正規化。
- `grep` 把 `constants.js` 當二進位（`sanitizeName` 內含控制字元）→ 用 `grep -a`。
- 伺服器 `startRun` 會重建玩家物件：連線處理要用 `current()` 依 id 重新找玩家，不要抓舊參考。
- 慢動作若用遊戲時間衰減會自我拉長；震動 / 慢動作要在 `decayEffects(rawDt)` 用真實時間衰減。
- 高射速下定格會疊加：小定格用 `hitStop(sec, true)` 帶 0.15 s 冷卻。
- 連鎖爆炸會在迴圈中移除敵人：反向迭代且 `if (!o) continue`。
- 觸控：`touchstart` 時清掉 `e.touches` 裡已不存在的手指，避免搖桿卡住。
- 測試機器人要對移動中的敵人**預判射擊**，否則零分局不會被記錄，合作成績測試會等到逾時。
- 事件名稱要在 `server/index.js` 的 `EVENT_NAMES` 白名單，新增事件記得同步加；`computeStats` 在 `server/stats.js` 用 JS 聚合，Postgres 與 JSON 檔共用。
- 我方在正式榜留過測試資料：線上驗證用能刪除的帳號，或先在本機 `DATA_DIR` 隔離。
- 無頭測試要**看事件不要看時機**：敵人會被互推到玩家身上吃掉護盾、震撼彈擊退會把目標推出射程，靠幀數等結果會偶發失敗；改成檢查 `fx.text` 收到的事件、把目標固定住或放在射程內。連跑 5 次確認穩定再 commit。
- Bash 裡的 `\`` 反引號和 `$` 在雙引號字串內會被展開（README 的 `code` 標記被吃掉過）：含這些字元的內容一律走 `.cjs` 檔或 Write 工具。

## 7. 遊玩說明（給使用者 / README 用）

- 電腦：WASD 移動、滑鼠瞄準、左鍵射擊、Shift 衝刺、Esc 選單、M 靜音、升級用 1/2/3 或點卡片、結算畫面 L 看排行榜、Enter 再來一局。
- 手機：橫向；左半螢幕拖曳移動，右半螢幕拖曳瞄準開火（不按就自動瞄準最近敵人），右下衝刺鈕，右上 ☰ 選單。
- 多人：輸入名字 → 建立房間 → 分享 4 碼房號或 `?room=CODE` 邀請連結 → 房主「全員出擊」（可勾 Boss 挑戰）。看到紫色虛線就離開那條線；橘色地雷靠近會炸；懸賞目標要在 25 秒內追殺。

## 8. 產品決策（使用者已定，不要再問）

- 視覺鎖定霓虹，不做主題切換、不上傳圖檔。
- 抒壓小遊戲：不做登入、不做名字髒話過濾。
- **不做結算分享圖**。
- 每日挑戰只在單機跑（伺服器多房共用亂數，固定種子會互相干擾）。
- 之後的調整依儀表板數據（流失波次、回訪率、機體平均波次）決定，不憑感覺加內容。

## 9. 成長路線（已全部完成，2026-09-07）

1. ✅ 局外成長（星塵 + 機庫）+ 每日挑戰
2. ~~結算一鍵分享圖~~（使用者決定不做）
3. ✅ 機體選擇（4 種起始機）
4. ✅ 升級協同（7 組組合技）、20 波通關 + 無盡模式
5. ✅ 遊玩事件記錄 + `/admin.html` 儀表板（`ADMIN_KEY`）

下一輪先看儀表板的流失波次與機體表現再決定調什麼；使用者已明確不做分享圖。

其他候選：背景音樂、MessagePack 壓縮快照、手動部署避免清房、付費外觀（`themes.js` 的重映射機制已保留）。
