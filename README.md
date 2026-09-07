# 星塵突圍 Stardust Breakout

2D 合作生存射擊遊戲。純 HTML5 Canvas + Web Audio，無任何前端依賴。

## 執行

需要 Node.js 18 以上。

```bash
npm start
```

開啟 http://localhost:8765 。網址後加 `?boss` 可直接從 Boss 波開始（測試用）。

## 測試

```bash
npm test                      # 單人無頭模擬 120 秒
node test/sim.js --boss       # 從 Boss 波開始
node test/sim.js --god        # 所有升級拉滿、血量無限，壓力測試連鎖效果
node test/sim.js --players=4  # 四名機器人同場（多人邏輯）
node test/sim.js --verbose    # 印出波次 / Boss 事件
```

## 專案結構

```
shared/          瀏覽器與伺服器共用（純 JS，不碰任何環境）
  math.js          數學工具
  constants.js     世界尺寸、玩家基礎值、敵人 / Boss / 道具 / 升級定義、名字規則
public/          瀏覽器端
  index.html       頁面與選單覆蓋層（名字輸入）
  css/style.css
  js/game.js       ★ 遊戲邏輯核心：不碰 DOM，透過 fx 介面回報視聽事件（未來原封不動搬到伺服器）
  js/render.js     Canvas 渲染、HUD、名牌、升級卡、準星、畫面外箭頭
  js/effects.js    粒子、定格、色差、震動等客戶端視覺回饋（實作 fx 介面）
  js/audio.js      Web Audio 合成音效
  js/input.js      鍵盤滑鼠 → 玩家輸入物件（未來直接序列化送伺服器）
  js/main.js       進入點與主迴圈
server/
  index.js         靜態檔伺服器（下一步：WebSocket 房間伺服器）
test/
  sim.js           無頭模擬測試
legacy/
  index-singlefile.html   拆分前的單檔版本（可直接雙擊開啟）
```

## 架構原則

- **固定世界尺寸 1600×900**：所有玩家看到同一個世界，畫面等比縮放加黑邊，不同螢幕比例下公平。
- **邏輯與呈現分離**：`game.js` 是唯一的權威模擬，可在 Node 執行；渲染、音效、特效只消費它的狀態與 `fx` 事件。
- **玩家是陣列**：敵人追最近的玩家、Boss 鎖定最近的玩家、升級每人各選、擊殺數個別記錄，全員陣亡才結束。
- **沒有 setTimeout**：所有延遲用世界時間排程（`world.timers`），確定性且可在伺服器重播。
- **只對本機的效果**：定格、色差、準星動畫透過 `fx.local(player)` 只對本機玩家觸發，隊友擊殺不會震你的畫面。

## 下一步（多人連線）

1. `server/index.js` 加上 WebSocket 房間：房號、四人上限、名字。
2. 伺服器每秒 30 tick 跑 `game.js` 的 `update()`，客戶端送 `input.js` 產生的輸入物件。
3. 伺服器廣播世界快照與 `fx` 事件；客戶端插值其他玩家與敵人，預測自己的機體。
4. 部署到 Fly.io 東京節點。
