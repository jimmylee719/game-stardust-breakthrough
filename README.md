# 星塵突圍 Stardust Breakout

2D 合作生存射擊遊戲。純 HTML5 Canvas + Web Audio，無任何前端依賴。

**線上版：https://game-stardust-breakthrough-production.up.railway.app**（Railway，新加坡節點，最多 4 人一房）

## 執行

需要 Node.js 18 以上。

```bash
npm start
```

開啟 http://localhost:8765 。網址後加 `?boss` 可直接從 Boss 波開始（測試用）。

## 多人連線（最多 4 人）

1. 一位玩家輸入名字後按「建立房間」，取得 4 碼房號與邀請連結。
2. 其他玩家在選單輸入房號按「加入」，或直接開邀請連結（`?room=房號`）自動加入。
3. 大廳顯示所有人的名字，房主按「全員出擊」開始；遊戲中每個人頭上都有名牌與小血條。
4. 全員陣亡後房主按 Enter 或點擊可再來一局，Esc 離開房間。

同一台電腦開兩個分頁就能測試。要和其他電腦連線，請把伺服器部署到網路上（見下方「下一步」），或在同一區網內用你的內網 IP（例如 `http://192.168.1.10:8765`）。

## 測試

```bash
npm test                      # 無頭模擬 + WebSocket 端對端測試
node test/net.js              # 起伺服器、兩個客戶端進同房、房主開始、驗證彼此可見
node test/sim.js              # 單人無頭模擬 120 秒
node test/sim.js --boss       # 從 Boss 波開始
node test/sim.js --god        # 所有升級拉滿、血量無限，壓力測試連鎖效果
node test/sim.js --players=4  # 四名機器人同場（多人邏輯）
node test/sim.js --verbose    # 印出波次 / Boss 事件
```

## 專案結構

```
shared/          瀏覽器與伺服器共用（純 JS，不碰任何環境）
  math.js          數學工具
  constants.js     世界尺寸、tick 頻率、玩家基礎值、敵人 / Boss / 道具 / 升級定義、名字規則
  snapshot.js      世界快照序列化（伺服器）與插值還原（客戶端）
public/          瀏覽器端
  index.html       頁面與選單覆蓋層（名字輸入）
  css/style.css
  js/game.js       ★ 遊戲邏輯核心：不碰 DOM，透過 fx 介面回報視聽事件（未來原封不動搬到伺服器）
  js/render.js     Canvas 渲染、HUD、名牌、升級卡、準星、畫面外箭頭
  js/effects.js    粒子、定格、色差、震動等客戶端視覺回饋（實作 fx 介面）
  js/audio.js      Web Audio 合成音效
  js/input.js      鍵盤滑鼠 → 玩家輸入物件（連線時直接序列化送伺服器）
  js/net.js        WebSocket 客戶端：送輸入、收快照做插值、播放 fx 事件
  js/main.js       進入點與主迴圈（solo / online 兩種模式）
server/
  index.js         靜態檔 + WebSocket 房間伺服器：每房一個權威 world，30 tick 廣播快照
test/
  sim.js           無頭模擬測試
  net.js           WebSocket 端對端測試
legacy/
  index-singlefile.html   拆分前的單檔版本（可直接雙擊開啟）
```

## 架構原則

- **固定世界尺寸 1600×900**：所有玩家看到同一個世界，畫面等比縮放加黑邊，不同螢幕比例下公平。
- **邏輯與呈現分離**：`game.js` 是唯一的權威模擬，可在 Node 執行；渲染、音效、特效只消費它的狀態與 `fx` 事件。
- **玩家是陣列**：敵人追最近的玩家、Boss 鎖定最近的玩家、升級每人各選、擊殺數個別記錄，全員陣亡才結束。
- **沒有 setTimeout**：所有延遲用世界時間排程（`world.timers`），確定性且可在伺服器重播。
- **只對本機的效果**：定格、色差、準星動畫透過 `fx.local(player)` 只對本機玩家觸發，隊友擊殺不會震你的畫面。

## 部署到 Railway

專案已附 `railway.json`（Nixpacks 建置、`npm start` 啟動、`/health` 健康檢查、失敗自動重啟），
伺服器讀取 `PORT` 環境變數並綁定 0.0.0.0，WebSocket 每 25 秒 ping 保活。

1. 到 https://railway.com 用 GitHub 登入。
2. New Project → Deploy from GitHub repo → 選 `game-stardust-breakthrough`。
3. 等建置完成後，到 Service → Settings → Networking → Generate Domain，取得 `https://xxx.up.railway.app`。
4. Settings → Region 建議選 Singapore（台灣延遲最低）。
5. 開網址、建立房間，把邀請連結傳給朋友。

瀏覽器端會自動依 https 使用 wss，不需任何設定。之後每次 push 到 main，Railway 會自動重新部署。

也附了 `Dockerfile`，可原封不動部署到 Fly.io、Google Cloud Run、Koyeb 或自架 VPS。

## 網路架構

- **伺服器權威**：每個房間持有一個 `world`，伺服器以 30 tick 跑 `game.js` 的 `update()`。客戶端只送 `{ix, iy, angle, fire, dash}`，不送任何結果，無法作弊。
- **快照 + 插值**：每 tick 廣播 `snapshot.js` 產生的世界快照；客戶端保留前後兩份快照，落後兩個 tick（約 66 毫秒）做線性插值，畫面平滑。
- **fx 事件**：伺服器端的 `fx` 把每次呼叫記成 `[名稱, 玩家id 或 null, 參數]` 隨快照送出；客戶端只播放全域事件與自己的事件（別人的擊殺不會震你的畫面）。
- **協定**：JSON。客戶端 → `join / input / start / upgrade / leave`；伺服器 → `welcome / lobby / started / snap / error`。

## 下一步

1. 客戶端預測自己的機體（消除 66 毫秒的操作延遲感）。
2. 玩家死亡改成倒地可被救起；斷線 10 秒內可用同 id 重連。
3. 部署到 Fly.io 東京節點（`PORT` 環境變數已支援，`/health` 端點已提供）。
4. 快照改二進位（MessagePack）以縮小頻寬。
