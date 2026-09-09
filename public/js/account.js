// 匿名帳號、排行榜、星塵與永久強化、每日挑戰（客戶端）。
// 首次進站自動向伺服器註冊一組 id + secret，存在 localStorage；不需要密碼或信箱。
// 名字改了就同步到伺服器。單人 / 每日成績由這裡上傳；合作成績由伺服器自己記錄。
const KEY = 'stardust_acct';
let acct = null;
let pending = null;   // 進行中的 ensureAccount，上傳成績前先等它
try { acct = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}

/** 本機快取的個人檔（星塵、永久強化），開局時直接用，背景再更新 */
export const profile = { dust: 0, dustTotal: 0, unlocks: [] };
try { Object.assign(profile, JSON.parse(localStorage.getItem('stardust_profile') || '{}')); } catch {}
function cacheProfile() { try { localStorage.setItem('stardust_profile', JSON.stringify(profile)); } catch {} }

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
const creds = () => ({ id: acct.id, secret: acct.secret });

/** 確保有帳號且名字同步；回傳 {id, secret, name}，失敗（離線）回傳 null */
export function ensureAccount(name) {
  pending = ensureAccountNow(name).finally(() => { pending = null; });
  return pending;
}
async function ensureAccountNow(name) {
  try {
    if (!acct) {
      acct = await api('/api/register', { method: 'POST', body: JSON.stringify({ name }) });
      localStorage.setItem(KEY, JSON.stringify(acct));
    } else if (name && acct.name !== name) {
      await api('/api/rename', { method: 'POST', body: JSON.stringify({ ...creds(), name }) });
      acct.name = name; localStorage.setItem(KEY, JSON.stringify(acct));
    }
    return acct;
  } catch (e) {
    // 帳號被清掉（例如換了資料庫）→ 重新註冊一次
    if (acct && /unauthorized/.test(e.message)) { acct = null; localStorage.removeItem(KEY); return ensureAccountNow(name); }
    console.warn('account unavailable:', e.message);
    return null;
  }
}
export function getAccount() { return acct; }
export function accountCredentials() { return acct ? creds() : null; }
/** 帳號轉移碼：把匿名帳號帶到另一台裝置（碼本身就是登入憑證，請勿公開） */
export function exportCode() { return acct ? `SD1-${acct.id}-${acct.secret}` : ''; }
export async function importCode(code) {
  const m = String(code || '').trim().match(/^SD1-([A-Za-z0-9_-]+)-([A-Za-z0-9_-]+)$/);
  if (!m) throw new Error('轉移碼格式不對');
  const me = await api(`/api/me?id=${encodeURIComponent(m[1])}&secret=${encodeURIComponent(m[2])}`);
  acct = { id: m[1], secret: m[2], name: me.name }; localStorage.setItem(KEY, JSON.stringify(acct));
  Object.assign(profile, { dust: me.dust, dustTotal: me.dustTotal, unlocks: me.unlocks }); cacheProfile();
  return me;
}
async function ready(name) {
  if (pending) await pending;
  if (!acct) await ensureAccount(name || localStorage.getItem('stardust_name') || '');
  return !!acct;
}

/** 上傳單人 / 每日成績。回傳 {rank, dust, total} 或 null。任何分數都會拿到星塵。 */
export async function submitRun(score, wave, { mode = 'solo', day = null, name } = {}) {
  if (!(await ready(name))) return null;
  const post = () => api('/api/runs', { method: 'POST', body: JSON.stringify({ ...creds(), score, wave, mode, day }) });
  try {
    const r = await post();
    if (typeof r.total === 'number') { profile.dust = r.total; profile.dustTotal += r.dust || 0; cacheProfile(); }
    return r;
  } catch (e) {
    // 帳號失效（例如伺服器換了資料庫）→ 重新註冊後再試一次
    if (/unauthorized/.test(e.message)) { acct = null; localStorage.removeItem(KEY); await ensureAccount(name || ''); if (acct) { try { return await post(); } catch {} } }
    console.warn('submit failed:', e.message); return null;
  }
}
export const submitSoloRun = (score, wave, name) => submitRun(score, wave, { mode: 'solo', name });

export async function fetchLeaderboard(mode = 'solo', period = 'all') {
  return api(`/api/leaderboard?mode=${mode}&period=${period}`);
}
/** 個人統計 + 星塵與永久強化（同步進 profile 快取） */
export async function fetchMe() {
  if (pending) await pending;
  if (!acct) return null;
  try {
    const me = await api(`/api/me?id=${encodeURIComponent(acct.id)}&secret=${encodeURIComponent(acct.secret)}`);
    Object.assign(profile, { dust: me.dust, dustTotal: me.dustTotal, unlocks: me.unlocks }); cacheProfile();
    return me;
  } catch { return null; }
}
/** 購買永久強化；成功回傳 {dust, unlocks}，失敗丟出錯誤訊息 */
export async function buyPerk(perkId) {
  if (!(await ready())) throw new Error('offline');
  const r = await api('/api/perks/buy', { method: 'POST', body: JSON.stringify({ ...creds(), perk: perkId }) });
  Object.assign(profile, { dust: r.dust, unlocks: r.unlocks }); cacheProfile();
  return r;
}
/** 成就 / 任務 / 圖鑑進度（伺服器 meta） */
export async function fetchMeta() {
  if (pending) await pending;
  if (!acct) return null;
  try { const m = await api(`/api/meta?id=${encodeURIComponent(acct.id)}&secret=${encodeURIComponent(acct.secret)}`); profile.meta = m.meta; cacheProfile(); return m; } catch { return null; }
}
/** 一局結束：送統計摘要給伺服器算任務與成就；回傳 {ach, quests, dust, meta} 或 null */
export async function reportRun(summary) {
  if (!(await ready())) return null;
  try { const r = await api('/api/meta/run', { method: 'POST', body: JSON.stringify({ ...creds(), run: summary }) }); if (r.meta) profile.meta = r.meta; if (typeof r.total === 'number') profile.dust = r.total; if (r.dust) profile.dustTotal += r.dust; cacheProfile(); return r; } catch (e) { console.warn('report failed:', e.message); return null; }
}
export async function fetchRooms() { return api('/api/rooms'); }
export async function quickMatch() { return api('/api/quickmatch', { method: 'POST', body: '{}' }); }
/** 今天的每日挑戰狀態：{key, seed, mods[], started, run} */
export async function fetchDaily() {
  if (pending) await pending;
  const q = acct ? `?id=${encodeURIComponent(acct.id)}&secret=${encodeURIComponent(acct.secret)}` : '';
  return api('/api/daily' + q);
}
/** 開始每日挑戰（用掉今天的機會）；回傳 {key, seed, mods[]}，已玩過則丟錯 */
export async function startDaily() {
  if (!(await ready())) throw new Error('offline');
  return api('/api/daily/start', { method: 'POST', body: JSON.stringify(creds()) });
}
