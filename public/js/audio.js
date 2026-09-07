// 音效：全部用 Web Audio 即時合成，無外部檔案。只在瀏覽器執行。
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null;
const settings = { muted: localStorage.getItem('stardust_muted') === '1' };

export function ensureAudio() {
  if (!AudioCtx) return;
  if (!actx) actx = new AudioCtx();
  if (actx.state === 'suspended') actx.resume();
}
export function isMuted() { return settings.muted; }
export function toggleMute() { settings.muted = !settings.muted; localStorage.setItem('stardust_muted', settings.muted ? '1' : '0'); return settings.muted; }

export function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (!actx || settings.muted) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, actx.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), actx.currentTime + dur);
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur);
}
export function noise(dur, vol = 0.15) {
  if (!actx || settings.muted) return;
  const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = actx.createBufferSource(), g = actx.createGain();
  s.buffer = buf; g.gain.value = vol;
  s.connect(g).connect(actx.destination); s.start();
}
export const sfx = {
  shoot: () => beep(880, 0.06, 'square', 0.04, -500),
  hit: () => beep(220, 0.08, 'sawtooth', 0.05, -100),
  explode: () => { noise(0.25, 0.2); beep(90, 0.3, 'sawtooth', 0.1, -60); },
  hurt: () => { noise(0.3, 0.3); beep(140, 0.4, 'square', 0.12, -100); },
  pickup: () => { beep(660, 0.08, 'sine', 0.08); setTimeout(() => beep(990, 0.12, 'sine', 0.08), 70); },
  wave: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'triangle', 0.07), i * 90)); },
  dash: () => beep(300, 0.15, 'sine', 0.06, 600),
  gameover: () => { [440, 370, 311, 220].forEach((f, i) => setTimeout(() => beep(f, 0.35, 'triangle', 0.1), i * 220)); },
};
