// 匿名帳號與排行榜（客戶端）。
// 首次進站自動向伺服器註冊一組 id + secret，存在 localStorage；不需要密碼或信箱。
// 名字改了就同步到伺服器。單人成績由這裡上傳；合作成績由伺服器自己記錄。
const KEY = 'stardust_acct';
let acct = null;
let pending = null;   // 進行中的 ensureAccount，上傳成績前先等它
try { acct = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

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
      await api('/api/rename', { method: 'POST', body: JSON.stringify({ id: acct.id, secret: acct.secret, name }) });
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
export function accountCredentials() { return acct ? { id: acct.id, secret: acct.secret } : null; }

/** 上傳單人成績，回傳 {rank} 或 null */
export async function submitSoloRun(score, wave, name) {
  if (score <= 0) return null;
  if (pending) await pending;
  if (!acct) await ensureAccount(name || localStorage.getItem('stardust_name') || '');
  if (!acct) return null;
  const post = () => api('/api/runs', { method: 'POST', body: JSON.stringify({ id: acct.id, secret: acct.secret, score, wave }) });
  try { return await post(); }
  catch (e) {
    // 帳號失效（例如伺服器換了資料庫）→ 重新註冊後再試一次
    if (/unauthorized/.test(e.message)) { acct = null; localStorage.removeItem(KEY); await ensureAccount(name || acct?.name || ''); if (acct) { try { return await post(); } catch {} } }
    console.warn('submit failed:', e.message); return null;
  }
}
export async function fetchLeaderboard(mode = 'solo', period = 'all') {
  return api(`/api/leaderboard?mode=${mode}&period=${period}`);
}
export async function fetchMe() {
  if (pending) await pending;
  if (!acct) return null;
  try { return await api(`/api/me?id=${encodeURIComponent(acct.id)}&secret=${encodeURIComponent(acct.secret)}`); } catch { return null; }
}
