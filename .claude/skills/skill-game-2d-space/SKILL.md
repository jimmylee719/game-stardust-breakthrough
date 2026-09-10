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

- 主動技能：`SKILLS / skillById / skillUnlocked / ENERGY`（constants），玩家 `p.skill / energy / overdrive / novaT / skillHeld`；輸入協定多一個 `skill`（E / Q / 右鍵 `mouse.skillClick` / 觸控 `touchLayout().skill`），**施放在 `update()` 玩家迴圈的 `castSkill`（不在 `stepPlayer`，預測不會跑到）**，按下邊緣觸發（`skillHeld`）。能量：`killEnemy` +perKill（菁英 +perElite）、`killBoss` 全隊 +perBoss、被動 passive/s。時間停止 = `world.chrono`（敵人每 tick 補 `e.stun`、敵彈迴圈直接 continue、Boss `slow`）；奇異點 = `world.hole.skill`（不拉玩家、結束 `blastHole`）；超載 = `p.overdrive`（`hitEnemy` ×1.5、`stepPlayer` 速度 ×1.3、`dashCd = 0`）。解鎖 id `skill:<id>`（db.js `priceOf`），join 帶 `skill` 由 `skillUnlocked` 驗證。
- 敵人技能預警：`WARN[type]` → `e.warn`（0 / 1 黃 ! / 2 紅 !!），在敵人主迴圈開頭算（自爆蟲在 BEHAVE 內設）；快照 `warn`，render 畫在頭上。新敵種有技能就補一條 `WARN`。
- 背景圖：`public/img/bg-<arena>.webp`（AI 生成，2048×1152，SW 有快取），render 的 `bgFor(id)` 懶載入、`drawCover` 鋪滿整個畫布（含黑邊）後再壓 0.5 的場地漸層 + 0.22 暗色；像素風主題略過。首頁選場地時 main.js 會設 `world.arena` 讓背景預覽。要換圖只要換檔案。
- 安全區 / 手機：render `resize()` 用 `visualViewport` 與 CSS 變數 `--sat/--sar/--sab/--sal`（`env(safe-area-inset-*)`）算 `insets`（export 自 input.js），世界矩形置中在扣掉 inset 的區域；`touchLayout` 也用 insets。canvas `position: fixed; height: 100dvh`。
- 面板縮放：`fitPanel(overlay)` 通用（首頁一律、機庫只在 ≥ 900px），機庫 HTML 是 `.fitbox > .panel.hangar > .hcols > .col × 4`，欄高要接近（目前約 600–700px）才不會縮太小；新增機庫區塊時放到最矮的欄。
- 場地：`ARENAS`（6 個，`arenaById`），`startRun({arena})` → `world.arena`；危險在 game.js 的 `updateArena`（zones kind: lava / geyser / rift / fog / pressure / spike / emp / hex / fire，`world.wells / flare / blizzard / wind / drag`），區域效果在 `updateZones`。render 的背景與星色讀 `ARENAS[].bg/star`，`drawArenaBackdrop / drawHazards / drawWeather`。
- 屬性：`ELEMENTS / AFFINITY / affinity(enemyEl, weaponEl) / WEAPON_ELEMENT`；敵人 `e.element` 在 `spawnEnemy` 依場地 `elements` 抽（`ENEMY_TYPES[].element` 固定者優先）。**對敵人造成傷害一律走 `hitEnemy(world, e, dmg, {by, x, y, element}, fx)`**（相剋、相位、精英護盾、護盾兵正面盾、統計），呼叫端再檢查 `hp <= 0 → killEnemy`。
- 敵人 AI：新 kind 的行為在 `BEHAVE[kind]`（warden / sniper / mortar / kamikaze / hexer / sentinel / pulsar / spore / angler），回傳 `{tx, ty, steer}` 或 `'dead'`；chase 型的額外攻擊（蟲群衝撞、重裝砲、分裂體酸液、霜噬冰刺）在 chase 分支。精英詞綴 `AFFIXES`（`e.affixes`，計時在敵人迴圈頂端）。**敵人迴圈頂端要 `if (!e) continue`**（自爆會縮短陣列）。難度門檻用 `threat(world)`（波數 + 2×(人數-1)），敵方攻擊倍率 `dmgMul(world)` 在 `hurtPlayer` 內套用；`hurtPlayer(world, p, dmg, fx, src)` 的 `src {x, y, by, vamp}` 給正面盾與死亡畫面用。
- 隨機事件：`EVENTS`，`startEvent(world, id, fx)`（export）/ `updateEvents`，`world.event / crate / hole / wind / eclipse / dustBonus`；補給箱走 beacon 的碰撞路徑（`const beacon = world.beacon || world.crate`）。小隊主題 `SQUADS` → `world.waveTheme`。
- 武器：每把武器一個 `fireXxx(world, p, inp, dt, fx, lfx)`，升級 / 道具的差異寫在裡面（對照表 `WEAPON_MODS` 只是文字，改行為要改函式）；光束用 `beamSegments`（反彈）與 `bendAim`（追蹤）；`p.beam / beamW` 給 render；光刃 `fireBlade`（`p.swingT / swingDir`）。進化 `EVOLUTIONS / evolutionFor`，`offerUpgrades` 塞 `evoCard`，`chooseUpgrade(idx = -1)` = 放棄升級 +20 HP；snapshot 的 pending 用 `evo:<id>`。
- 機體特性靠 `p.flags`（adapt / blinkStrike / noShield / frontShield / shieldBash / droneBoost / meleeOnly / bladeMaster / dashSlash / killResetBlink / turrets），`stepPlayer` 與武器函式讀它；`predict.js` 的 st 要有 `flags / syn / dashHits / turrets`。
- 太陽風暴：`world.flare = {x, sx, dir, w, t, speed, hit}`，以畫面外太陽 `(sx, H/2)` 為圓心的弧（半徑 `|x − sx|`），伺服器判定與 render 同一半徑。
- 排程：`schedule(world, delay, fn, spawn)` — 只有 `spawn = true`（生怪）的排程會讓 `spawnPending()` 為真，波次清除 / 模式完成只看它（武器 / 音效排程不算）。敵人主迴圈是「拍名單 + indexOf」身分制，中途移除低索引敵人不會重跑或漏掉。
- 統計 `world.stats`（`freshStats`；snapshot 只在 gameover / 每 30 tick 送），死亡畫面與 `shared/meta.js` 的成就 / 任務都只看它；`runSummary(world, ctx)` → `POST /api/meta/run` → 伺服器 `applyRun`（players.meta JSONB）。成就 / 任務規則只改 `shared/meta.js`。
- 公開房：`room.public / room.arena`，訊息 `arena / public`，`GET /api/rooms`、`POST /api/quickmatch`（只列 `scene === 'lobby'` 的房；沒房就開一間 `quick` 房，空的 quick 房會被下一個人重用，60 秒後清）。join 時 `room.pendingJoins` 先佔名額。
- 伺服器防護（server/index.js 頂部）：`allowPost(ip)` 每 10 秒 `RATE_LIMIT` 次 POST；`withAccountLock(id, fn)` 同帳號 meta 讀改寫排隊；`META_MIN_GAP`；`credsOf(req, url)`（POST body 或 GET query）；`SEC` 標頭；`tickRoom` try/catch → 出錯銷毀該房；離線玩家用 `offlineAtMs` 牆鐘在任何場景清。合作局的成就 / 任務在 `recordCoopRun` 用 `runSummary(room.world)` 算，`result.metaBy[acctId]` 回給客戶端 `announceMeta`；`/api/meta/run` 拒收 `coop: true`。`/api/runs` 分數上限 `600 × (wave+2)²`、`dustBonus ≤ 150`。測試環境用 `META_MIN_GAP_MS=0`、`RATE_LIMIT=1000`（test/api.js）。
- 客戶端：`i18n.js`（`tr()` 精確表 + 規則；HTML 用 `data-i18n / data-i18n-ph / data-i18n-html`；浮字在 effects.js 的 `floatText` 翻譯）、`audio.js` 的音樂（`setMood`，master / sfx / music 三個 gain）、`input.js` 的 `opts.autoAim / autoFire`（null = 依裝置）、PWA（`manifest.json`、`sw.js` 由伺服器注入 `BUILD_ID`、`scripts/make-icons.cjs` 產圖示）。
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
- CSS 入場動畫 `animation-fill-mode: both` 會**永久覆蓋 inline transform**：JS 縮放要套在另一層（首頁 `.fitbox` 用 `zoom`），不要和動畫同一個元素。預覽窗格不會觸發真的 resize 事件、rAF 會被節流：驗證縮放要 `dispatchEvent(new Event('resize'))`，驗證模擬要手動 `update()`。
- 大補丁的 `rep()` 一失敗就 exit，但前面的檔已寫入：重跑前把已套用的 `rep(` 改成 `false && rep(`，或一開始就一檔一個 rep 並先 `grep` 確認錨點（含空白數量：constants 的對齊空白常和 `cut` 顯示不同）。
- Bash 裡的 `\`` 反引號和 `$` 在雙引號字串內會被展開（README 的 `code` 標記被吃掉過）：含這些字元的內容一律走 `.cjs` 檔或 Write 工具。

## 7. 遊玩說明（給使用者 / README 用）

- 電腦：WASD 移動、滑鼠瞄準、左鍵射擊、Shift 衝刺、Esc 選單、M 靜音、升級用 1/2/3 或點卡片、結算畫面 L 看排行榜、Enter 再來一局。
- 手機：橫向；左半螢幕拖曳移動，右半螢幕拖曳瞄準開火（不按就自動瞄準最近敵人），右下衝刺鈕，右上 ☰ 選單。
- 多人：輸入名字 → 建立房間 → 分享 4 碼房號或 `?room=CODE` 邀請連結 → 房主「全員出擊」（可勾 Boss 挑戰）。看到紫色虛線就離開那條線；橘色地雷靠近會炸；懸賞目標要在 25 秒內追殺。

## 8. 產品決策（使用者已定，不要再問）

- 視覺鎖定霓虹，不做主題切換、不上傳圖檔。
- 抒壓小遊戲：不做登入、不做名字髒話過濾。
- **不做結算分享圖**。
- **不放廣告**（永遠）；首頁與隱私頁底部固定「© 凡圖有限公司 Vanture Co., Ltd. · getvanture.com」。
- 難度不分等級：只有一條越來越狠的曲線（敵人更聰明、更多、更快、更痛），多人時整體再加重；遊戲目的是挑戰與體驗，不是讓人破關。
- 每個敵人都要有攻擊方式，不做只會飄的敵人；新敵人要精美且聰明。
- 六個場地全部免費；武器對升級的反應必須不同；機體必須有玩法差異（不是數值差）。
- 音樂：使用者擁有版權的四首曲目放在 `public/music/`（veins-1/2 = 選單 / 結算，pursuit-1/2 = 戰鬥 / Boss），`audio.js` 的 `TRACKS / switchPool` 交叉淡出，合成器只當載入失敗的備援；整體小聲。mp3 不進 service worker 快取；伺服器靜態檔支援 Range（iOS Safari 必要）。使用者桌面「新作品」資料夾另有 5 首（Golden Horizons、Neon Reverie、Eternal Drift）**沒有**授權給遊戲，不要放進去。
- 手把支援先欠著（使用者要求提醒）。
- 美術：目前仍是向量圖；使用者問過可以用哪個生圖 skill / connector，可選：本工作區的 Hugging Face 生圖工具（`gr1_z_image_turbo_generate`）、Canva / Adobe / Figma 連接器；若要導入圖片素材需先改「不上傳圖檔」的決策。
- 每日挑戰只在單機跑（伺服器多房共用亂數，固定種子會互相干擾）。
- 之後的調整依儀表板數據（流失波次、回訪率、機體平均波次）決定，不憑感覺加內容。

## 9. 成長路線

2026-09-09 第二輪（全部完成）：場地 ×6 + 屬性相剋、敵人全攻擊 + 新敵種 + 詞綴 + 小隊、單一難度曲線、隨機事件 ×9、武器差異化 + 光刃 + 進化 ×6、機體玩法差異 ×7、死亡畫面、任務 / 成就 / 圖鑑、公開房 + 快速配對、PWA、設定（自動瞄準 / 射擊、音量、語言）、音樂、英文化、行事曆週榜、版權頁尾。
欠著：手把支援；美術素材：使用者已接 Canva 與 Hugging Face，計畫每天改一點，建議順序 = 場地背景圖 → 首頁 Logo / 機庫卡圖 → 敵人與船的精靈圖。

### 第一輪（2026-09-07）

1. ✅ 局外成長（星塵 + 機庫）+ 每日挑戰
2. ~~結算一鍵分享圖~~（使用者決定不做）
3. ✅ 機體選擇（4 種起始機）
4. ✅ 升級協同（7 組組合技）、20 波通關 + 無盡模式
5. ✅ 遊玩事件記錄 + `/admin.html` 儀表板（`ADMIN_KEY`）

下一輪先看儀表板的流失波次與機體表現再決定調什麼；使用者已明確不做分享圖。

其他候選：背景音樂、MessagePack 壓縮快照、手動部署避免清房、付費外觀（`themes.js` 的重映射機制已保留）。

### 第三輪（2026-09-09 下午起）：全系統 Bug 稽核

- 已修（commit `3b72747`）：首頁改兩欄 + `.fitbox` 用 `zoom` 縮放（CSS 入場動畫 `fill-mode: both` 會永久覆蓋 inline transform，縮放一定要放在另一層）；太陽風暴改成以畫面外太陽（`flare.sx`）為圓心的弧形帶，伺服器判定與畫面同一半徑；核心邏輯約 45 處（`schedule(world, d, fn, spawn)` 只有生怪排程算波次未清、敵人主迴圈改「拍名單 + indexOf」身分制、燃燒記 `burnBy`、射速升級對火焰 / 冰凍 / 雷射有效、輸入額度防灌雙倍輸入、AI 冷卻用 dt…）；客戶端（僚機 / 砲塔子彈 `ELEMENTS['kinetic']` 崩潰、frame loop try/catch、localStorage 防呆、音訊曲目快取）。
- 2026-09-10：六張場地背景圖（Hugging Face Z-Image，prompt 強調 dark / low contrast）、機庫四欄不捲動、手機安全區 + dvh、死亡畫面間距、第 7 波難度門檻錯開。美術下一步：首頁 Logo / 機庫卡圖 → 精靈圖。
- 2026-09-09 下午已完成：主動技能 ×6 + 能量、敵人技能預警、移除雷射道具、伺服器防護全部（見第 4 節）、英文字典。**仍欠：手把支援、美術素材。**
- ~~未修（先做）~~：伺服器安全與崩潰（`decodeURIComponent` 未 try/catch、tick 無 try/catch、無速率限制、分數 / 成就全信客戶端、`/api/stats` Host 偽造、密鑰在 query string、join TOCTOU、gameover 房列在公開房、stats 每 tick 全量廣播、db 檔案非原子寫入）；`i18n-extra.js` 英文字典（421 條，目前佔位）；README / 本檔規格補寫。細節在記憶 `stardust-pending-audit`。
