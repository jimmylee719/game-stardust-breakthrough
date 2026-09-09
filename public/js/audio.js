// 音效與音樂：全部用 Web Audio 即時合成，無外部檔案。只在瀏覽器執行。
// 音樂是程式化的合成器風（synthwave）：低音琶音 + 和弦墊 + 稀疏主旋律 + 鼓；情境（選單 / 戰鬥 / Boss / 結算）切換速度與調性。
// 整體音量刻意小（有聽到就好）。
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let actx = null, master = null, sfxGain = null, musicGain = null;
const settings = {
  muted: localStorage.getItem('stardust_muted') === '1',
  music: Number(localStorage.getItem('stardust_music') ?? 35),   // 0–100
  sfx: localStorage.getItem('stardust_sfx') !== '0',
};

export function ensureAudio() {
  if (!AudioCtx) return;
  if (!actx) {
    actx = new AudioCtx();
    master = actx.createGain(); master.gain.value = settings.muted ? 0 : 1; master.connect(actx.destination);
    sfxGain = actx.createGain(); sfxGain.gain.value = settings.sfx ? 1 : 0; sfxGain.connect(master);
    musicGain = actx.createGain(); musicGain.gain.value = musicLevel(); musicGain.connect(master);
    startMusic();
  }
  if (actx.state === 'suspended') actx.resume();
}
const musicLevel = () => (settings.music / 100) * 0.16;   // 100% 也只有 0.16
export function isMuted() { return settings.muted; }
export function toggleMute() { settings.muted = !settings.muted; localStorage.setItem('stardust_muted', settings.muted ? '1' : '0'); if (master) master.gain.setTargetAtTime(settings.muted ? 0 : 1, actx.currentTime, 0.05); return settings.muted; }
export function getMusicVolume() { return settings.music; }
export function setMusicVolume(v) { settings.music = Math.max(0, Math.min(100, Number(v) || 0)); localStorage.setItem('stardust_music', String(settings.music)); if (musicGain) musicGain.gain.setTargetAtTime(musicLevel(), actx.currentTime, 0.1); }
export function getSfxEnabled() { return settings.sfx; }
export function setSfxEnabled(on) { settings.sfx = !!on; localStorage.setItem('stardust_sfx', on ? '1' : '0'); if (sfxGain) sfxGain.gain.setTargetAtTime(on ? 1 : 0, actx.currentTime, 0.05); }

export function beep(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (!actx || settings.muted || !settings.sfx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, actx.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), actx.currentTime + dur);
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(sfxGain);
  o.start(); o.stop(actx.currentTime + dur);
}
let noiseBuf = null;
export function noise(dur, vol = 0.15) {
  if (!actx || settings.muted || !settings.sfx) return;
  if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = actx.createBufferSource(), g = actx.createGain();
  s.buffer = noiseBuf; g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  s.connect(g).connect(sfxGain); s.start(); s.stop(actx.currentTime + dur);
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

// ---------- 音樂 ----------
// 情境：menu（慢、明亮）、play（中速）、boss（快、小調、鼓更重）、over（極慢、只剩墊音）
let mood = 'menu';
let nextStep = 0, stepIdx = 0, timer = null, bar = 0;
const N = n => 440 * Math.pow(2, (n - 69) / 12);   // MIDI → Hz
// 和弦進行（MIDI 根音）：明亮 vs 小調
const PROG = { bright: [[45, 'm'], [50, 'M'], [52, 'M'], [43, 'M']], dark: [[45, 'm'], [41, 'M'], [43, 'M'], [40, 'm']] };
const CHORD = { M: [0, 4, 7, 11], m: [0, 3, 7, 10] };
function tempo() { return mood === 'boss' ? 132 : mood === 'play' ? 116 : mood === 'over' ? 70 : 96; }
function osc(type, freq, t0, dur, vol, dest, opts = {}) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (opts.detune) o.detune.value = opts.detune;
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = o;
  if (opts.lp) { const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; f.Q.value = opts.q || 1; o.connect(f); node = f; }
  node.connect(g).connect(dest);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function kick(t0, vol) { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + 0.12); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25); o.connect(g).connect(musicGain); o.start(t0); o.stop(t0 + 0.3); }
function hat(t0, vol) { if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(); s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 6000; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05); s.connect(f).connect(g).connect(musicGain); s.start(t0); s.stop(t0 + 0.08); }
function scheduleStep(t0, step) {
  const spb = 60 / tempo(), s16 = spb / 4;
  const prog = mood === 'boss' ? PROG.dark : PROG.bright;
  const [root, q] = prog[bar % prog.length];
  const chord = CHORD[q];
  const dark = mood === 'boss', quiet = mood === 'over' || mood === 'menu';
  // 低音琶音：每 16 分音符
  if (!quiet || step % 2 === 0) { const arp = [0, 7, 12, 7, 0, 7, 12, 19][step % 8]; osc('sawtooth', N(root - 12 + arp), t0, s16 * 0.9, dark ? 0.09 : 0.07, musicGain, { lp: dark ? 1400 : 900, q: 3 }); }
  // 和弦墊：每小節開頭，兩個失諧鋸齒
  if (step === 0) for (const iv of chord) { osc('sawtooth', N(root + iv), t0, spb * 4, 0.028, musicGain, { lp: 700, attack: 0.4, detune: -7 }); osc('sawtooth', N(root + iv), t0, spb * 4, 0.028, musicGain, { lp: 700, attack: 0.4, detune: 7 }); }
  // 主旋律：稀疏、五聲音階；戰鬥時更密
  if (!quiet && ((step % 4 === 2 && Math.random() < 0.55) || (dark && step % 8 === 6))) { const scale = [0, 2, 4, 7, 9, 12, 14]; osc('square', N(root + 12 + scale[Math.floor(Math.random() * scale.length)]), t0, s16 * 2.5, 0.035, musicGain, { lp: 2400, slide: 1.0 }); }
  if (mood === 'menu' && step % 8 === 0 && Math.random() < 0.5) osc('triangle', N(root + 24 + chord[Math.floor(Math.random() * 4)]), t0, spb * 1.5, 0.03, musicGain, { attack: 0.2 });
  // 鼓：四拍 kick、反拍 hat；Boss 加 8 分音符 kick
  if (!quiet) { if (step % 4 === 0 || (dark && step % 4 === 2)) kick(t0, dark ? 0.35 : 0.25); if (step % 4 === 2 || (dark && step % 2 === 0)) hat(t0, dark ? 0.06 : 0.04); }
  else if (mood === 'menu' && step % 8 === 0) kick(t0, 0.12);
}
function tick() {
  if (!actx || actx.state !== 'running') return;
  const spb = 60 / tempo(), s16 = spb / 4;
  while (nextStep < actx.currentTime + 0.25) {
    scheduleStep(nextStep, stepIdx);
    stepIdx = (stepIdx + 1) % 16; if (stepIdx === 0) bar++;
    nextStep += s16;
  }
}
export function startMusic() {
  if (!actx || timer) return;
  nextStep = actx.currentTime + 0.1; stepIdx = 0; bar = 0;
  timer = setInterval(tick, 100);
}
/** 由主迴圈依場景呼叫：'menu' | 'play' | 'boss' | 'over' */
export function setMood(m) { if (m !== mood) { mood = m; } }
export function getMood() { return mood; }
