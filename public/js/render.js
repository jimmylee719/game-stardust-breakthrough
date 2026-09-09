// 渲染：把世界狀態與特效畫到 Canvas。固定 1600x900 邏輯座標，等比縮放到視窗並加黑邊。
import { TAU, rand, randInt, clamp } from '../../shared/math.js';
import { PICKUP_STYLE, UPGRADES, WAVE_MODES, REVIVE_TIME, SYNERGIES, synergyIfPicked, WIN_WAVE, WEAPON_STATS, skinById, arenaById, ELEMENTS, AFFIXES, EVENTS, EVOLUTIONS, ENEMY_TYPES, shipById, weaponById } from '../../shared/constants.js';
import { tr } from './i18n.js';
import { nearestTarget } from './game.js';
import { vfx, particles, floatTexts, bolts } from './effects.js';
import { themedContext, getTheme, onThemeChange } from './themes.js';
import { touch, touchLayout } from './input.js';

export function createRenderer(canvas, world) {
  const raw = canvas.getContext('2d');
  const ctx = themedContext(raw);   // 顏色 / 光暈 / 線寬 / 字型都經過主題重映射
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cw: 0, ch: 0 };
  const W = world.W, H = world.H;
  let stars = [];

  function resize() {
    const T = getTheme();
    view.dpr = T.pixelScale || Math.min(window.devicePixelRatio || 1, 2);   // 像素風：降低內部解析度
    raw.imageSmoothingEnabled = !T.pixelScale;
    view.cw = window.innerWidth; view.ch = window.innerHeight;
    canvas.width = view.cw * view.dpr; canvas.height = view.ch * view.dpr;
    view.scale = Math.min(view.cw / W, view.ch / H);
    view.ox = (view.cw - W * view.scale) / 2;
    view.oy = (view.ch - H * view.scale) / 2;
  }
  function toWorld(sx, sy) { return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale }; }
  function applyView() { ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.ox * view.dpr, view.oy * view.dpr); }
  function makeStars() { stars = []; for (let i = 0; i < 160; i++) stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.2, 1), tw: rand(0, TAU) }); }
  makeStars();

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrapText(text, cx, y, maxW, lh) {
    let line = '', lines = [];
    for (const ch of text) { const t = line + ch; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = ch; } else line = t; }
    if (line) lines.push(line);
    lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  }

  /** 每幀由 main 呼叫：更新星空（跟著本機玩家速度視差） */
  function updateStars(dt, p) {
    const vx = p?.vx || 0, vy = p?.vy || 0;
    for (const s of stars) {
      s.y += s.z * 18 * dt + vy * 0.02 * s.z * dt; s.x -= vx * 0.02 * s.z * dt;
      if (s.y > H) { s.y = 0; s.x = rand(0, W); } if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
    }
  }

  // ---------- 主繪製 ----------
  function draw(ui) {
    const { time, mouse, me, best, muted } = ui;
    // 清整個畫布（含黑邊）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const T = getTheme();
    raw.fillStyle = T.letterbox; raw.fillRect(0, 0, canvas.width, canvas.height);
    applyView();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    const A = arenaById(world.scene === 'menu' ? (ui.arena || 'space') : world.arena);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, A.bg[0]); bg.addColorStop(1, A.bg[1]);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    drawArenaBackdrop(A, time);

    if (vfx.shake > 0.3) ctx.translate(rand(-vfx.shake, vfx.shake), rand(-vfx.shake, vfx.shake));
    if (vfx.zoom > 0 && me) { const z = 1 + vfx.zoom * 0.018; ctx.translate(me.x, me.y); ctx.scale(z, z); ctx.translate(-me.x, -me.y); }

    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + s.tw);
      raw.fillStyle = `rgba(${A.star},${(0.25 + 0.6 * tw) * s.z})`;
      ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2);
    }

    if (world.scene === 'menu') { drawMenuBackdrop(time); ctx.restore(); drawReticle(ui); return; }

    drawParticles();
    drawZones(time);
    drawHazards(time);
    if (world.beacon) drawBeacon(time);
    if (world.crate) drawCrate(world.crate, time);
    drawPickups();
    drawEnemies();
    for (const b of world.bosses) drawBoss(b, time);
    drawLasers(time);
    drawBullets();
    drawPlayers(time);
    drawFloatTexts();
    drawWeather(time, me);
    ctx.restore();

    // 色差分離：把畫布自身左右偏移後用 screen 疊回
    if (vfx.aberr > 0.02) {
      const off = vfx.aberr * 6;
      const dx = -view.ox / view.scale, dy = -view.oy / view.scale, dw = canvas.width / (view.dpr * view.scale), dh = canvas.height / (view.dpr * view.scale);
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = vfx.aberr * 0.45;
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx - off, dy, dw, dh);
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx + off, dy, dw, dh);
      ctx.restore();
    }
    if (vfx.flash > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(255,0,60,0)'); g.addColorStop(1, `rgba(255,0,60,${vfx.flash * 0.5})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    if (world.scene === 'play' || world.scene === 'pause') drawOffscreenArrows(time, me);
    drawHUD(me, best, muted);
    drawBossHUD(time);
    if (world.scene === 'upgrade') drawUpgrade(time, mouse, me);
    if (world.scene === 'pause') drawOverlay('暫停', '按 P 繼續');
    if (world.scene === 'gameover') drawGameOver(time, best, ui);
    if (world.scene === 'victory') drawVictory(time, ui);
    if (touch.active) drawTouchControls(ui); else drawReticle(ui);
  }

  function drawParticles() {
    for (const b of bolts) {
      const a = b.life / b.maxLife;
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 16; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < b.pts.length - 1; i++) {
        const p0 = b.pts[i], p1 = b.pts[i + 1]; ctx.moveTo(p0.x, p0.y);
        const n = 6; for (let k = 1; k <= n; k++) { const t = k / n, jx = (rand(-1, 1)) * 10 * (k < n ? 1 : 0), jy = rand(-1, 1) * 10 * (k < n ? 1 : 0); ctx.lineTo(p0.x + (p1.x - p0.x) * t + jx, p0.y + (p1.y - p0.y) * t + jy); }
      }
      ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.shadowBlur = 0; ctx.stroke();
      ctx.restore();
    }
    for (const q of particles) {
      const a = q.life / q.maxLife;
      if (q.ring) {
        const t = 1 - a, ease = 1 - (1 - t) * (1 - t);
        ctx.globalAlpha = a; ctx.strokeStyle = q.color; ctx.lineWidth = q.width * a + 0.5;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r0 + (q.r1 - q.r0) * ease, 0, TAU); ctx.stroke();
        continue;
      }
      if (q.streak) {
        ctx.globalAlpha = a; ctx.strokeStyle = q.color; ctx.lineWidth = q.size * a + 0.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = q.ghost ? a * 0.4 : a;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (q.ghost ? 1 : a + 0.3), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawPickups() {
    for (const k of world.pickups) {
      const st = PICKUP_STYLE[k.kind];
      const pulse = 1 + Math.sin(k.t * 6) * 0.15;
      ctx.globalAlpha = k.life < 2 ? (Math.sin(k.t * 20) > 0 ? 1 : 0.3) : 1;
      ctx.shadowColor = st.color; ctx.shadowBlur = 16; ctx.strokeStyle = st.color; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = k.t * 1.5 + i * TAU / 6, r = 11 * pulse; ctx.lineTo(k.x + Math.cos(a) * r, k.y + Math.sin(a) * r); }
      ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = st.color; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(st.label, k.x, k.y);
      ctx.globalAlpha = 1;
    }
  }
  function drawEnemies() {
    for (const e of world.enemies) {
      ctx.save(); ctx.translate(e.x, e.y);
      ctx.shadowColor = e.color; ctx.shadowBlur = vfx.lowQ || world.enemies.length > 40 ? 0 : 14;
      ctx.strokeStyle = e.hitFlash > 0 ? '#fff' : e.burn ? '#ff8c42' : e.stun ? '#ffffff' : e.slow ? '#b8ffff' : e.color; ctx.lineWidth = 2.5;
      if (e.slow && !e.burn) ctx.shadowColor = '#b8ffff';
      if (e.burn) ctx.shadowColor = '#ff8c42';
      ctx.fillStyle = e.hitFlash > 0 ? 'rgba(255,255,255,.6)' : e.color + '33';
      ctx.rotate(e.type === 'rock' ? e.rot : Math.atan2(e.vy, e.vx));
      if (e.squash > 0) ctx.scale(1 - e.squash * 0.18, 1 + e.squash * 0.28);
      if (e.elite) {
        // 精英：金色虛線光環
        ctx.save(); ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 24; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.arc(0, 0, e.r + 8, 0, TAU); ctx.stroke(); ctx.restore();
        ctx.lineWidth = 3;
      }
      ctx.beginPath();
      if (e.type === 'rock') { const n = 9; for (let i = 0; i < n; i++) { const a = i * TAU / n; const rr = e.r * (0.75 + 0.25 * Math.abs(Math.sin(i * 2.7 + e.id))); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
      else if (e.type === 'drifter') { for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + e.wobble * 0.3; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } }
      else if (e.type === 'dart') { ctx.moveTo(e.r * 1.5, 0); ctx.lineTo(-e.r, e.r * 0.8); ctx.lineTo(-e.r * 0.4, 0); ctx.lineTo(-e.r, -e.r * 0.8); }
      else if (e.type === 'tank') { for (let i = 0; i < 8; i++) { const a = i * TAU / 8, r = i % 2 ? e.r : e.r * 0.8; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } }
      else if (e.type === 'shooter') { ctx.arc(0, 0, e.r, 0, TAU); ctx.moveTo(e.r * 0.5, 0); ctx.arc(0, 0, e.r * 0.5, 0, TAU); }
      else if (e.type === 'lancer') { ctx.moveTo(e.r * 1.6, 0); ctx.lineTo(0, e.r * 0.55); ctx.lineTo(-e.r, 0); ctx.lineTo(0, -e.r * 0.55); ctx.closePath(); ctx.moveTo(e.r * 0.5, 0); ctx.arc(e.r * 0.2, 0, e.r * 0.3, 0, TAU); }
      else if (e.type === 'bounty') { for (let i = 0; i < 12; i++) { const a = i * TAU / 12 + e.wobble * 0.5, rr = i % 2 ? e.r : e.r * 0.55; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
      else if (e.type === 'meteor') { const n = 10; for (let i = 0; i < n; i++) { const a = i * TAU / n; const rr = e.r * (0.7 + 0.3 * Math.abs(Math.sin(i * 1.9 + e.id))); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
      else if (e.type === 'ufo') { ctx.rotate(-Math.atan2(e.vy, e.vx)); ctx.ellipse(0, 4, e.r * 1.4, e.r * 0.5, 0, 0, TAU); ctx.moveTo(e.r * 0.6, -2); ctx.arc(0, -2, e.r * 0.6, Math.PI, 0); }
      else if (e.type === 'mothership') { ctx.rotate(-Math.atan2(e.vy, e.vx)); ctx.ellipse(0, 10, e.r * 1.5, e.r * 0.45, 0, 0, TAU); ctx.moveTo(e.r * 0.75, 0); ctx.arc(0, 0, e.r * 0.75, Math.PI, 0); ctx.moveTo(e.r * 0.35, -e.r * 0.3); ctx.arc(0, -e.r * 0.3, e.r * 0.35, 0, TAU); }
      else if (e.type === 'warden') { ctx.rotate(-Math.atan2(e.vy, e.vx)); ctx.rotate(Math.atan2(e.fy ?? 0, e.fx ?? 1)); ctx.moveTo(e.r * 0.6, -e.r * 0.9); ctx.lineTo(-e.r * 0.8, -e.r * 0.6); ctx.lineTo(-e.r * 0.8, e.r * 0.6); ctx.lineTo(e.r * 0.6, e.r * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.strokeStyle = e.hitFlash > 0 ? '#fff' : '#4cc9f0'; ctx.lineWidth = 4; ctx.shadowColor = '#4cc9f0'; ctx.arc(0, 0, e.r + 8, -1.05, 1.05); }
      else if (e.type === 'sniper') { ctx.moveTo(e.r * 1.9, 0); ctx.lineTo(-e.r * 0.6, e.r * 0.7); ctx.lineTo(-e.r * 0.3, 0); ctx.lineTo(-e.r * 0.6, -e.r * 0.7); ctx.closePath(); ctx.moveTo(e.r * 0.4, 0); ctx.arc(0, 0, e.r * 0.4, 0, TAU); }
      else if (e.type === 'mortar') { for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } ctx.closePath(); ctx.moveTo(e.r * 0.45, 0); ctx.arc(0, 0, e.r * 0.45, 0, TAU); ctx.moveTo(0, -e.r * 0.45); ctx.lineTo(0, -e.r * 1.3); }
      else if (e.type === 'kamikaze' || e.type === 'ember') { for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + e.wobble, rr = i % 2 ? e.r * 1.4 : e.r * 0.7; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } }
      else if (e.type === 'hexer') { for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + e.wobble * 0.4; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } ctx.closePath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + Math.PI + e.wobble * 0.4; ctx.lineTo(Math.cos(a) * e.r * 0.8, Math.sin(a) * e.r * 0.8); } }
      else if (e.type === 'sentinel') { ctx.rotate(-Math.atan2(e.vy, e.vx) + e.wobble); ctx.moveTo(0, -e.r); ctx.lineTo(e.r * 0.5, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r * 0.5, 0); ctx.closePath(); ctx.moveTo(e.r * 0.25, 0); ctx.arc(0, 0, e.r * 0.25, 0, TAU); }
      else if (e.type === 'pulsar') { ctx.rotate(-Math.atan2(e.vy, e.vx)); ctx.arc(0, 0, e.r, 0, TAU); for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + e.wobble; ctx.moveTo(Math.cos(a) * e.r * 0.5, Math.sin(a) * e.r * 0.5); ctx.lineTo(Math.cos(a) * e.r * 1.35, Math.sin(a) * e.r * 1.35); } }
      else if (e.type === 'spore') { ctx.rotate(-Math.atan2(e.vy, e.vx)); for (let i = 0; i < 10; i++) { const a = i * TAU / 10, rr = e.r * (0.8 + 0.2 * Math.sin(e.wobble * 2 + i * 2)); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3 + e.wobble * 0.5; ctx.moveTo(Math.cos(a) * e.r * 0.5 + 4, Math.sin(a) * e.r * 0.5); ctx.arc(Math.cos(a) * e.r * 0.5, Math.sin(a) * e.r * 0.5, 4, 0, TAU); } }
      else if (e.type === 'angler') { ctx.moveTo(e.r * 1.3, 0); ctx.lineTo(e.r * 0.2, -e.r * 0.8); ctx.lineTo(-e.r, -e.r * 0.5); ctx.lineTo(-e.r * 1.4, 0); ctx.lineTo(-e.r, e.r * 0.5); ctx.lineTo(e.r * 0.2, e.r * 0.8); ctx.closePath(); ctx.moveTo(e.r * 0.3, -e.r * 0.8); ctx.lineTo(e.r * 0.9, -e.r * 1.5); }
      else if (e.type === 'frostbite') { ctx.moveTo(e.r * 1.5, 0); ctx.lineTo(0, e.r * 0.5); ctx.lineTo(-e.r, e.r * 0.9); ctx.lineTo(-e.r * 0.5, 0); ctx.lineTo(-e.r, -e.r * 0.9); ctx.lineTo(0, -e.r * 0.5); }
      else { for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + Math.PI / 4; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      if (e.type === 'angler') { ctx.rotate(-Math.atan2(e.vy, e.vx)); const lx = Math.cos(Math.atan2(e.vy, e.vx)) * e.r * 0.9 + 0, ly = -e.r * 1.5; ctx.fillStyle = '#fff'; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(e.r * 0.9, -e.r * 1.5, 6 + Math.sin(e.wobble * 3) * 2, 0, TAU); ctx.fill(); }
      if (e.type === 'bounty') { ctx.rotate(-Math.atan2(e.vy, e.vx)); ctx.shadowBlur = 0; ctx.fillStyle = '#1a1200'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1); }
      ctx.restore();
      if (e.ph) { ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#c77dff'; ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, TAU); ctx.stroke(); ctx.restore(); }
      if (e.sh) { ctx.save(); ctx.strokeStyle = '#4cc9f0'; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 12; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 11, 0, TAU); ctx.stroke(); ctx.restore(); }
      if (e.element && ELEMENTS[e.element]) { ctx.save(); ctx.globalAlpha = 0.85; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0; ctx.fillStyle = ELEMENTS[e.element].color; ctx.fillText(ELEMENTS[e.element].icon, e.x + e.r + 8, e.y - e.r - 4); ctx.restore(); }
      if (e.affixes && e.affixes.length) { ctx.save(); ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.shadowBlur = 0; ctx.fillStyle = '#ffd166'; ctx.fillText(e.affixes.map(a => (AFFIXES[a] || {}).name || a).join(' · '), e.x, e.y - e.r - (e.hunter ? 28 : 16)); ctx.restore(); }
      if (e.hunter) { ctx.save(); ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ff8c9c'; ctx.shadowColor = '#ff8c9c'; ctx.shadowBlur = 10; ctx.fillText('🎯 追獵者', e.x, e.y - e.r - 14); ctx.restore(); }
      if (e.cmd) { ctx.save(); ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 4, 0, TAU); ctx.stroke(); ctx.restore(); }
      if (e.aimT > 0 && e.aimA !== undefined) { ctx.save(); const k = 1 - e.aimT / 1.4; ctx.globalAlpha = 0.3 + 0.6 * k; ctx.strokeStyle = '#ff8c9c'; ctx.shadowColor = '#ff8c9c'; ctx.shadowBlur = 6; ctx.lineWidth = 1 + k * 2; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -performance.now() / 4; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.aimA) * 1400, e.y + Math.sin(e.aimA) * 1400); ctx.stroke(); ctx.setLineDash([]); ctx.restore(); }
      if (e.blinkFlash) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 14, 0, TAU); ctx.stroke(); }
      if (e.buffed) { ctx.strokeStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.shadowBlur = 0; }
      if (e.type === 'mothership') { ctx.fillStyle = '#ffd166'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('飛碟母艦', e.x, e.y - e.r - 14); for (let k = 0; k < 7; k++) { ctx.fillStyle = k % 2 ? '#ff3860' : '#90f1a8'; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 150 + k); ctx.beginPath(); ctx.arc(e.x - e.r * 1.2 + k * e.r * 0.4, e.y + 12, 4, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
      if (e.type === 'ufo') { ctx.fillStyle = e.ally ? '#f15bb5' : '#90f1a8'; for (let k = 0; k < 4; k++) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(performance.now() / 120 + k); ctx.beginPath(); ctx.arc(e.x - e.r + k * e.r * 0.66, e.y + 6, 3, 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
      if (e.type === 'bounty') { ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('懸賞目標', e.x, e.y - e.r - 14); }
      if (e.maxHp >= 60 && e.hp < e.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2, 4);
        ctx.fillStyle = e.color; ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2 * (e.hp / e.maxHp), 4);
      }
    }
  }
  function drawBoss(b, time) {
    const flash = b.hitFlash > 0, col = flash ? '#fff' : b.color;
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.cloak > 0) {
      // 隱形：只看得到空氣中的擾動（抖動的淡弧線與微粒）
      ctx.globalAlpha = 0.18 + (flash ? 0.4 : 0);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.shadowBlur = 0;
      for (let i = 0; i < 5; i++) { const a0 = time * (1.5 + i * 0.7) + i, rr = b.r * (0.6 + i * 0.12) + Math.sin(time * 9 + i) * 6; ctx.beginPath(); ctx.arc(rand(-3, 3), rand(-3, 3), rr, a0, a0 + 0.9); ctx.stroke(); }
      ctx.fillStyle = '#fff'; for (let i = 0; i < 10; i++) { const a = time * 3 + i * TAU / 10, rr = b.r * 0.85; ctx.fillRect(Math.cos(a) * rr + rand(-8, 8), Math.sin(a) * rr + rand(-8, 8), 2, 2); }
      ctx.restore(); return;
    }
    if (b.buff) { ctx.strokeStyle = 'rgba(255,209,102,.6)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.arc(0, 0, b.r + 16, time * 2, time * 2 + TAU); ctx.stroke(); ctx.setLineDash([]); }
    ctx.shadowColor = b.color; ctx.shadowBlur = 30;
    if (b.kind === 'hive') {
      // 蜂巢母艦：大六邊形 + 蜂巢格
      ctx.save(); ctx.rotate(b.spin * 0.3); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.fillStyle = b.color + '22';
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * b.r, Math.sin(a) * b.r); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.5; for (let q = -1; q <= 1; q++) for (let r = -1; r <= 1; r++) { if (Math.abs(q + r) > 1) continue; const cx = (q + r * 0.5) * b.r * 0.55, cy = r * b.r * 0.48; ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; ctx.lineTo(cx + Math.cos(a) * b.r * 0.26, cy + Math.sin(a) * b.r * 0.26); } ctx.closePath(); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = flash ? '#fff' : b.color; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + b.spin * 0.3; ctx.beginPath(); ctx.arc(Math.cos(a) * b.r * 0.55 * 0.9, Math.sin(a) * b.r * 0.5, 5 + Math.sin(time * 6 + i) * 2, 0, TAU); ctx.fill(); }
    } else if (b.kind === 'phantom') {
      // 幽影：細長刀鋒狀，雙翼
      const tgt0 = world.players.find(p => !p.dead) || { x: W / 2, y: H }; const fa = Math.atan2(tgt0.y - b.y, tgt0.x - b.x);
      ctx.save(); ctx.rotate(fa); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.fillStyle = b.color + '33';
      ctx.beginPath(); ctx.moveTo(b.r * 1.2, 0); ctx.lineTo(0, b.r * 0.35); ctx.lineTo(-b.r * 0.6, b.r); ctx.lineTo(-b.r * 0.3, 0); ctx.lineTo(-b.r * 0.6, -b.r); ctx.lineTo(0, -b.r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = b.phase === 3 ? '#ff3860' : '#fff'; ctx.beginPath(); ctx.arc(b.r * 0.3, 0, 6, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (b.kind === 'titan') {
      // 星隕：厚重岩塊，外環裝甲
      ctx.save(); ctx.rotate(b.spin * 0.4); ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.fillStyle = b.color + '2a';
      ctx.beginPath(); for (let i = 0; i < 11; i++) { const a = i * TAU / 11; const rr = b.r * (0.8 + 0.2 * Math.abs(Math.sin(i * 2.3))); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 2; ctx.setLineDash([18, 10]); ctx.beginPath(); ctx.arc(0, 0, b.r * 0.62, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * 0.4); core.addColorStop(0, flash ? '#fff' : '#ffd166'); core.addColorStop(1, b.color + '55');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, b.r * 0.4, 0, TAU); ctx.fill();
    } else {
    ctx.save(); ctx.rotate(b.spin);
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * b.r, Math.sin(a) * b.r); }
    ctx.closePath(); ctx.stroke();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(Math.cos(a) * b.r, Math.sin(a) * b.r, 7, 0, TAU); ctx.fill(); }
    ctx.restore();
    ctx.save(); ctx.rotate(-b.spin * 1.6);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([12, 8]); ctx.beginPath(); ctx.arc(0, 0, b.r * 0.72, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, b.r * 0.5);
    core.addColorStop(0, flash ? '#fff' : '#ffb3c1'); core.addColorStop(1, b.color + '55');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, b.r * 0.5, 0, TAU); ctx.fill();
    const tgt = world.players.find(p => !p.dead) || { x: W / 2, y: H };
    const ea = Math.atan2(tgt.y - b.y, tgt.x - b.x);
    ctx.fillStyle = '#1a0010'; ctx.beginPath(); ctx.arc(Math.cos(ea) * 10, Math.sin(ea) * 10, b.phase === 3 ? 12 : 9, 0, TAU); ctx.fill();
    ctx.fillStyle = b.phase === 3 ? '#ff3860' : '#fff'; ctx.beginPath(); ctx.arc(Math.cos(ea) * 13, Math.sin(ea) * 13, 3.5, 0, TAU); ctx.fill();
    }
    if (b.atk === 'charge' && !b.chargeDir) {
      ctx.strokeStyle = `rgba(255,209,102,${0.3 + 0.4 * Math.sin(time * 30)})`; ctx.lineWidth = 4; ctx.setLineDash([16, 10]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(b.aim) * 2000, Math.sin(b.aim) * 2000); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function drawBullets() {
    const many = vfx.lowQ || world.bullets.length + world.enemyBullets.length > 90;
    ctx.shadowBlur = many ? 0 : 10;
    for (const b of world.bullets) {
      const ec = b.element && ELEMENTS[b.element === 'kinetic' ? 'neutral' : b.element === 'light' ? 'neutral' : b.element] ? ELEMENTS[b.element].color : null;
      if (b.slash) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx)); ctx.strokeStyle = '#fff'; ctx.shadowColor = '#f8c'; ctx.shadowBlur = 14; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(-20, 0, 34, -0.9, 0.9); ctx.stroke(); ctx.restore(); continue; }
      ctx.shadowColor = b.rail ? '#9ff' : b.burn ? '#ff8c42' : ec || (b.homing ? '#ffd166' : '#fff'); ctx.strokeStyle = b.rail ? '#c8ffff' : b.burn ? '#ffb070' : ec || (b.homing ? '#fff3c4' : '#fff'); ctx.lineWidth = 3 * b.size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * (b.rail ? 0.045 : 0.02), b.y - b.vy * (b.rail ? 0.045 : 0.02)); ctx.stroke();
    }
    for (const b of world.enemyBullets) {
      if (b.kind === 'mine') {
        // 感應地雷：脈動的橘色圓環 + 十字，快爆時閃爍
        const urgent = b.life !== undefined && b.life < 1.5, pulse = 1 + Math.sin(performance.now() / 120) * 0.15;
        ctx.shadowColor = '#ff8c42'; ctx.strokeStyle = urgent && Math.sin(performance.now() / 50) > 0 ? '#fff' : '#ff8c42'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * pulse, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(b.x - 5, b.y); ctx.lineTo(b.x + 5, b.y); ctx.moveTo(b.x, b.y - 5); ctx.lineTo(b.x, b.y + 5); ctx.stroke();
        ctx.globalAlpha = 0.15; ctx.strokeStyle = '#ff8c42'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.arc(b.x, b.y, 70, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        continue;
      }
      if (b.kind === 'mark') {
        const k = 1 - (b.life ?? 0) / 1.3;
        ctx.save(); ctx.globalAlpha = 0.35 + 0.4 * k; ctx.strokeStyle = '#ffb347'; ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * k, 0, TAU); ctx.fillStyle = 'rgba(255,179,71,.25)'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(b.x - 10, b.y); ctx.lineTo(b.x + 10, b.y); ctx.moveTo(b.x, b.y - 10); ctx.lineTo(b.x, b.y + 10); ctx.stroke(); ctx.restore();
        continue;
      }
      const c = b.ufo ? '#90f1a8' : b.homing ? (b.kind === 'hex' ? '#c77dff' : b.kind === 'spore' ? '#3ddc84' : b.kind === 'void' ? '#c77dff' : '#c77dff') : b.wall ? '#ff8c42' : b.boss ? '#ff3860' : b.kind === 'lead' ? '#ffb347' : b.kind === 'shard' ? '#ffd166' : b.kind === 'snipe' ? '#ff8c9c' : b.kind === 'shell' ? '#9b5de5' : b.kind === 'acid' ? '#f15bb5' : b.kind === 'ice' ? '#b8ffff' : b.kind === 'plasma' ? '#ffd166' : '#00f5d4';
      ctx.shadowColor = c; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      if (b.kind === 'lead' || b.kind === 'shard' || b.kind === 'snipe' || b.kind === 'ice') { ctx.strokeStyle = c; ctx.lineWidth = b.kind === 'snipe' ? 3 : 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * (b.kind === 'snipe' ? 0.07 : 0.04), b.y - b.vy * (b.kind === 'snipe' ? 0.07 : 0.04)); ctx.stroke(); }
      if (b.boss) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
  }
  function drawZones(time) {
    for (const z of world.zones) {
      if (z.kind !== 'toxic') { drawZoneKind(z, time); continue; }
      const a = Math.min(1, z.life / 1.5) * (0.55 + 0.15 * Math.sin(time * 4 + z.id));
      const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
      gr.addColorStop(0, `rgba(61,220,132,${0.28 * a})`); gr.addColorStop(0.7, `rgba(61,220,132,${0.14 * a})`); gr.addColorStop(1, 'rgba(61,220,132,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = a; ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -time * 40; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#3ddc84'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☣ 生化毒物', z.x, z.y);
      for (let k = 0; k < 4; k++) { const aa = time * 0.8 + k * TAU / 4, rr = z.r * (0.4 + 0.3 * Math.sin(time * 2 + k)); ctx.globalAlpha = a * 0.5; ctx.beginPath(); ctx.arc(z.x + Math.cos(aa) * rr, z.y + Math.sin(aa) * rr, 6, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (world.doom) {
      const k = 1 - world.doom.t / world.doom.warn, pulse = 0.5 + 0.5 * Math.sin(time * (6 + k * 14));
      ctx.fillStyle = `rgba(144,241,168,${0.05 + 0.1 * k * pulse})`; ctx.fillRect(0, 0, W, H);
      for (const z of world.safeZones) {
        ctx.save(); ctx.strokeStyle = '#fff'; ctx.shadowColor = '#90f1a8'; ctx.shadowBlur = 18; ctx.lineWidth = 3; ctx.setLineDash([12, 8]); ctx.lineDashOffset = -time * 60;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(144,241,168,.12)'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0; ctx.fillStyle = '#90f1a8'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('安全區', z.x, z.y);
        ctx.restore();
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,56,96,${0.7 + 0.3 * pulse})`; ctx.shadowColor = '#ff3860'; ctx.shadowBlur = 24; ctx.font = 'bold 44px sans-serif';
      ctx.fillText(`毀滅攻擊 ${Math.ceil(world.doom.t)}`, W / 2, 120);
      ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('進入白色安全區！其他地方會被打到只剩 1 點生命', W / 2, 158); ctx.shadowBlur = 0;
    }
  }
  function drawZoneKind(z, time) {
    ctx.save();
    const fade = Math.min(1, z.life / 1);
    if (z.kind === 'lava' || z.kind === 'fire') {
      const c = z.kind === 'lava' ? '255,100,40' : '255,170,60';
      const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r);
      gr.addColorStop(0, `rgba(${c},${0.45 * fade})`); gr.addColorStop(0.75, `rgba(${c},${0.2 * fade})`); gr.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = fade; ctx.strokeStyle = z.kind === 'lava' ? '#ff6428' : '#ffd166'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 7]); ctx.lineDashOffset = time * 30; ctx.beginPath(); ctx.arc(z.x, z.y, z.r * (0.9 + 0.05 * Math.sin(time * 5 + z.id)), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffd166'; for (let k = 0; k < 5; k++) { const aa = time * 1.2 + k * TAU / 5 + z.id, rr = z.r * (0.3 + 0.4 * ((time * 0.7 + k * 0.37) % 1)); ctx.globalAlpha = fade * (1 - ((time * 0.7 + k * 0.37) % 1)); ctx.beginPath(); ctx.arc(z.x + Math.cos(aa) * rr * 0.5, z.y + Math.sin(aa) * rr * 0.5 - ((time * 0.7 + k * 0.37) % 1) * 30, 3, 0, TAU); ctx.fill(); }
      if (z.kind === 'lava') { ctx.globalAlpha = fade * 0.9; ctx.fillStyle = '#ffb070'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('🌋 熔岩'), z.x, z.y); }
    } else if (z.kind === 'hex') {
      ctx.globalAlpha = fade * 0.8; ctx.strokeStyle = '#c77dff'; ctx.shadowColor = '#c77dff'; ctx.shadowBlur = 12; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(z.x, z.y); ctx.rotate(time * 0.6); ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * z.r * 0.7, Math.sin(a) * z.r * 0.7); } ctx.closePath(); ctx.stroke(); ctx.rotate(-time * 1.2); ctx.beginPath(); for (let i = 0; i < 3; i++) { const a = i * TAU / 3; ctx.lineTo(Math.cos(a) * z.r * 0.45, Math.sin(a) * z.r * 0.45); } ctx.closePath(); ctx.stroke(); ctx.restore();
      ctx.fillStyle = 'rgba(199,125,255,.12)'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#c77dff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('減速咒印'), z.x, z.y + z.r + 12);
    } else if (z.kind === 'rift') {
      ctx.save(); ctx.translate(z.x, z.y);
      for (let i = 0; i < 4; i++) { ctx.globalAlpha = fade * (0.25 + 0.15 * i); ctx.strokeStyle = i % 2 ? '#c77dff' : '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); const rr = z.r * (1 - i * 0.22); const a0 = -time * (1.5 + i * 0.8); ctx.arc(0, 0, rr, a0, a0 + 2.2); ctx.stroke(); }
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, z.r * 0.4); gr.addColorStop(0, 'rgba(0,0,0,.9)'); gr.addColorStop(1, 'rgba(60,20,90,0)'); ctx.globalAlpha = fade; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, z.r * 0.4, 0, TAU); ctx.fill();
      ctx.restore();
    } else if (z.kind === 'emp') {
      ctx.globalAlpha = Math.min(1, z.life * 1.5); ctx.strokeStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 16; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    } else if (z.kind === 'geyser' || z.kind === 'spike') {
      const c = z.kind === 'geyser' ? '#ff8c42' : '#b8ffff', k = 1 - Math.max(0, z.life - 0.45) / 1.15;
      if (!z.fired) { ctx.globalAlpha = 0.3 + 0.5 * k; ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = c; ctx.globalAlpha = 0.15 + 0.3 * k; ctx.beginPath(); ctx.arc(z.x, z.y, z.r * k, 0, TAU); ctx.fill(); }
      else { ctx.globalAlpha = Math.min(1, z.life * 2.5); ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 20; ctx.lineWidth = 3; if (z.kind === 'spike') { for (let i = 0; i < 7; i++) { const a = i * TAU / 7 + z.id; ctx.beginPath(); ctx.moveTo(z.x + Math.cos(a) * 8, z.y + Math.sin(a) * 8); ctx.lineTo(z.x + Math.cos(a) * z.r * 1.3, z.y + Math.sin(a) * z.r * 1.3); ctx.stroke(); } } else { const g = ctx.createLinearGradient(0, z.y, 0, z.y - 260); g.addColorStop(0, 'rgba(255,140,66,.9)'); g.addColorStop(1, 'rgba(255,209,102,0)'); ctx.fillStyle = g; ctx.fillRect(z.x - z.r * 0.6, z.y - 260, z.r * 1.2, 260); } }
    } else if (z.kind === 'pressure') {
      ctx.globalAlpha = fade * 0.7; ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) { const rr = z.r * ((1 - ((time * 0.5 + i / 3) % 1))); ctx.globalAlpha = fade * 0.5 * ((time * 0.5 + i / 3) % 1); ctx.beginPath(); ctx.arc(z.x, z.y, rr, 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = fade * 0.8; ctx.fillStyle = '#4cc9f0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('深海壓力'), z.x, z.y);
    } else if (z.kind === 'fog') {
      const gr = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r); gr.addColorStop(0, `rgba(120,220,140,${0.75 * fade})`); gr.addColorStop(0.6, `rgba(60,160,90,${0.6 * fade})`); gr.addColorStop(1, 'rgba(40,120,60,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  /** 重力井、黑洞、太陽風暴帶 */
  function drawHazards(time) {
    for (const w of world.wells) {
      ctx.save(); ctx.translate(w.x, w.y); ctx.globalAlpha = Math.min(1, w.life);
      for (let i = 0; i < 5; i++) { ctx.strokeStyle = i % 2 ? '#ffd166' : 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.2; const rr = w.r * (0.15 + i * 0.2), a0 = time * (1 + i * 0.5); ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 2.6); ctx.stroke(); }
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowBlur = 0; ctx.fillText(tr('重力井'), 0, 0);
      ctx.restore();
    }
    if (world.hole) {
      const h = world.hole; ctx.save(); ctx.translate(h.x, h.y);
      for (let i = 0; i < 6; i++) { ctx.globalAlpha = 0.25 + i * 0.1; ctx.strokeStyle = i % 2 ? '#ff8c42' : '#fff'; ctx.lineWidth = 2; const rr = h.r * (0.2 + i * 0.13), a0 = -time * (2 + i); ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 1.8); ctx.stroke(); }
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 70); gr.addColorStop(0, '#000'); gr.addColorStop(0.8, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha = 1; ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (world.flare) {
      const F = world.flare; ctx.save();
      const warn = F.t > 0;
      ctx.globalAlpha = warn ? 0.25 + 0.2 * Math.sin(time * 12) : 0.85;
      const g = ctx.createLinearGradient(F.x - F.w, 0, F.x + F.w, 0); g.addColorStop(0, 'rgba(255,209,102,0)'); g.addColorStop(0.5, warn ? 'rgba(255,209,102,.6)' : 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = g; ctx.fillRect(F.x - F.w, 0, F.w * 2, H);
      if (warn) { ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr(`太陽風暴 ${Math.ceil(F.t)}`), clamp(F.x, 80, W - 80), 60); }
      ctx.restore();
    }
  }
  /** 補給箱 */
  function drawCrate(c, time) {
    ctx.save(); ctx.translate(c.x, c.y);
    const col = c.hitFlash ? '#fff' : '#ffd166';
    ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 20; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(255,209,102,.15)';
    roundRect(-c.r, -c.r * 0.8, c.r * 2, c.r * 1.6, 8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-c.r, 0); ctx.lineTo(c.r, 0); ctx.moveTo(0, -c.r * 0.8); ctx.lineTo(0, c.r * 0.8); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(tr('補給箱') + (world.event ? ` ${Math.ceil(world.event.t)}s` : ''), 0, -c.r - 8);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-40, c.r + 6, 80, 5); ctx.fillStyle = c.hp / c.maxHp > 0.4 ? '#ffd166' : '#ff3860'; ctx.fillRect(-40, c.r + 6, 80 * (c.hp / c.maxHp), 5);
    ctx.restore();
  }
  /** 場地背景裝飾（純視覺） */
  const deco = [];
  for (let i = 0; i < 40; i++) deco.push({ x: rand(0, W), y: rand(0, H), s: rand(0.3, 1), t: rand(0, TAU) });
  function drawArenaBackdrop(A, time) {
    ctx.save();
    if (A.id === 'inferno') { for (const d of deco) { const a = 0.05 + 0.05 * Math.sin(time * 1.5 + d.t); const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 90 * d.s + 40); g.addColorStop(0, `rgba(255,90,30,${a})`); g.addColorStop(1, 'rgba(255,90,30,0)'); ctx.fillStyle = g; ctx.fillRect(d.x - 140, d.y - 140, 280, 280); } }
    else if (A.id === 'mercury') { const g = ctx.createRadialGradient(W * 0.85, -100, 0, W * 0.85, -100, 700); g.addColorStop(0, 'rgba(255,230,150,.35)'); g.addColorStop(0.4, 'rgba(255,160,60,.12)'); g.addColorStop(1, 'rgba(255,160,60,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    else if (A.id === 'venom') { for (const d of deco) { const yy = (d.y + time * 12 * d.s) % H; ctx.globalAlpha = 0.12 + 0.08 * Math.sin(time * 2 + d.t); ctx.fillStyle = '#3ddc84'; ctx.beginPath(); ctx.arc((d.x + Math.sin(time * 0.5 + d.t) * 30 + W) % W, yy, 2 + d.s * 3, 0, TAU); ctx.fill(); } }
    else if (A.id === 'abyss') { for (const d of deco) { const yy = (d.y - time * 25 * d.s + H * 10) % H; ctx.globalAlpha = 0.18; ctx.strokeStyle = '#8fd8ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc((d.x + Math.sin(time + d.t) * 10 + W) % W, yy, 2 + d.s * 4, 0, TAU); ctx.stroke(); } const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(40,120,200,.12)'); g.addColorStop(1, 'rgba(0,10,40,.35)'); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    else if (A.id === 'glacier') { for (const d of deco) { const yy = (d.y + time * 40 * d.s) % H; ctx.globalAlpha = 0.35 * d.s; ctx.fillStyle = '#e8f8ff'; ctx.beginPath(); ctx.arc((d.x + Math.sin(time * 1.3 + d.t) * 25 + W) % W, yy, 1 + d.s * 2, 0, TAU); ctx.fill(); } }
    else if (A.id === 'space') { for (let i = 0; i < 3; i++) { const d = deco[i]; const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 260); g.addColorStop(0, 'rgba(120,60,200,.10)'); g.addColorStop(1, 'rgba(120,60,200,0)'); ctx.fillStyle = g; ctx.fillRect(d.x - 260, d.y - 260, 520, 520); } }
    ctx.restore();
  }
  /** 天候與視野：暴風雪、日蝕、孢子霧（畫在最上層） */
  function drawWeather(time, me) {
    if (world.blizzard > 0) {
      const k = Math.min(1, world.blizzard / 1.5);
      ctx.save(); ctx.globalAlpha = 0.28 * k; ctx.fillStyle = '#dff4ff'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 0.6 * k; ctx.fillStyle = '#fff'; for (let i = 0; i < 80; i++) { const d = deco[i % deco.length]; ctx.beginPath(); ctx.arc((d.x + time * 300 * (0.5 + d.s) + i * 37) % W, (d.y + time * 120 * d.s + i * 53) % H, 1 + d.s * 2, 0, TAU); ctx.fill(); }
      if (me) { const g = ctx.createRadialGradient(me.x, me.y, 120, me.x, me.y, 520); g.addColorStop(0, 'rgba(200,230,255,0)'); g.addColorStop(1, `rgba(200,230,255,${0.75 * k})`); ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }
    if (world.eclipse > 0 && me) {
      const k = Math.min(1, world.eclipse / 1) * 0.92;
      ctx.save(); const g = ctx.createRadialGradient(me.x, me.y, 90, me.x, me.y, 330); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${k})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    }
  }
  function drawLasers(time) {
    for (const L of world.lasers) {
      const x2 = L.x + Math.cos(L.angle) * L.len, y2 = L.y + Math.sin(L.angle) * L.len;
      ctx.save();
      if (L.phase === 'warn') {
        const k = 1 - L.t / L.warn;   // 0 → 1 越接近發射越亮
        ctx.globalAlpha = 0.25 + 0.55 * k * (0.6 + 0.4 * Math.sin(time * 30));
        ctx.strokeStyle = L.color; ctx.shadowColor = L.color; ctx.shadowBlur = 8; ctx.lineWidth = 1.5 + k * 2; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -time * 200;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 0.6 + 0.4 * k; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(L.x, L.y, 10 + k * 18, 0, TAU); ctx.stroke();
      } else {
        const a = Math.min(1, L.t / 0.12 + 0.3);
        ctx.globalAlpha = a; ctx.lineCap = 'round';
        ctx.strokeStyle = L.color; ctx.shadowColor = L.color; ctx.shadowBlur = 30; ctx.lineWidth = L.w * (1 + Math.sin(time * 60) * 0.12);
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.shadowBlur = 0; ctx.lineWidth = L.w * 0.35;
        ctx.beginPath(); ctx.moveTo(L.x, L.y); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(L.x, L.y, L.w * 0.9, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawWeaponBeam(p, time) {
    ctx.save();
    if (p.weapon === 'frost') {
      const segs = p.beam && p.beam.length ? p.beam : [[p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, p.x + Math.cos(p.angle) * WEAPON_STATS.frostRange, p.y + Math.sin(p.angle) * WEAPON_STATS.frostRange]];
      const w = (p.beamW || 8) * 0.9;
      for (const [x1, y1, x2, y2] of segs) {
        ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(184,255,255,.55)'; ctx.shadowColor = '#b8ffff'; ctx.shadowBlur = 18; ctx.lineWidth = w + Math.sin(time * 40) * 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#fff'; ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -time * 300; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      }
    } else if (p.weapon === 'arc') {
      // 蓄電：機頭電弧環 + 蓄電量弧線
      const c = Math.min(1.5, p.arcCharge || 0) / 1.5, nx = p.x + Math.cos(p.angle) * 18, ny = p.y + Math.sin(p.angle) * 18;
      ctx.strokeStyle = c >= 1 ? '#fff' : '#9ff'; ctx.shadowColor = '#9ff'; ctx.shadowBlur = 14; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(nx, ny, 6 + c * 10 + Math.sin(time * 40) * 2, 0, TAU); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * c); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(153,255,255,.85)'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(c >= 1 ? '蓄滿 ×2' : '蓄電中 · 射程內無目標', p.x, p.y + p.r + 26);
    } else if (p.weapon === 'flame') {
      const R = p.fr || WEAPON_STATS.flameRange, c = p.fc || (WEAPON_STATS.flameCone + (p.spread - 1) * 0.1), fa = p.fa ?? p.angle;
      const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, R);
      g.addColorStop(0, 'rgba(255,209,102,.35)'); g.addColorStop(0.6, 'rgba(255,140,66,.18)'); g.addColorStop(1, 'rgba(255,56,96,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, R, fa - c, fa + c); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawPlayerLaser(p, time) {
    const segs = p.beam && p.beam.length ? p.beam : [[p.x + Math.cos(p.angle) * 18, p.y + Math.sin(p.angle) * 18, p.x + Math.cos(p.angle) * 720, p.y + Math.sin(p.angle) * 720]];
    const w = (p.beamW || 6) * 2, solar = p.evolved === 'solar';
    ctx.save(); ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2] of segs) {
      ctx.strokeStyle = solar ? '#ffe9a8' : '#7ff5ff'; ctx.shadowColor = solar ? '#ffd166' : '#7ff5ff'; ctx.shadowBlur = 26; ctx.lineWidth = w + Math.sin(time * 50) * 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.shadowBlur = 0; ctx.lineWidth = w * 0.35;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(segs[0][0], segs[0][1], 8, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawBlade(p, time) {
    if (!(p.swingT > 0)) return;
    const k = 1 - p.swingT / 0.18, arc = WEAPON_STATS.bladeArc + ((p.spread || 1) - 1) * 0.25, range = WEAPON_STATS.bladeRange * (1 + 0.4 * ((p.bulletSize || 1) - 1) / 0.5);
    const dir = p.swingDir || 1;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
    ctx.globalAlpha = 1 - k * 0.7; ctx.strokeStyle = '#fff'; ctx.shadowColor = p.evolved === 'dance' ? '#f8c' : p.color; ctx.shadowBlur = 24; ctx.lineWidth = 6; ctx.lineCap = 'round';
    const a0 = -arc / 2 * dir, a1 = (-arc / 2 + arc * Math.min(1, k * 1.6)) * dir;
    ctx.beginPath(); ctx.arc(0, 0, range, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, range * 0.8, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
    ctx.restore();
  }
  function drawTurrets(p, time) {
    for (const T of p.turrets || []) {
      ctx.save(); ctx.translate(T.x, T.y);
      ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 14; ctx.strokeStyle = T.life < 3 && Math.sin(time * 20) > 0 ? '#fff' : '#ffd166'; ctx.lineWidth = 2; ctx.fillStyle = 'rgba(255,209,102,.15)';
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(T.a || 0); ctx.fillStyle = '#ffd166'; ctx.fillRect(0, -3, 20, 6);
      ctx.restore();
    }
  }
  function drawPlayers(time) {
    for (const p of world.players) {
      if (p.dead) continue;
      for (const d of p.drones) {
        if (d.x === undefined) continue;
        ctx.save(); ctx.translate(d.x, d.y);
        const t = nearestTarget(world, d.x, d.y, 420);
        ctx.rotate(t ? Math.atan2(t.y - d.y, t.x - d.x) : d.a);
        ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 12; ctx.fillStyle = '#ffd166'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-3, 0); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      drawTurrets(p, time);
      if (p.downed) { drawDowned(p, time); continue; }
      if (p.laserOn && world.scene === 'play') drawPlayerLaser(p, time);
      else if (p.weaponOn && world.scene === 'play') drawWeaponBeam(p, time);
      if (p.weapon === 'blade') drawBlade(p, time);
      if (p.offline) ctx.globalAlpha = 0.35;
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.shield > 0) {
        ctx.strokeStyle = `rgba(76,201,240,${0.5 + 0.3 * Math.sin(time * 6)})`; ctx.lineWidth = 2; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 20;
        for (let i = 0; i < p.shield; i++) { ctx.beginPath(); ctx.arc(0, 0, p.r + 10 + i * 5, 0, TAU); ctx.stroke(); }
      }
      if (p.fs || (p.flags && p.flags.frontShield)) { ctx.save(); ctx.rotate(p.angle); ctx.strokeStyle = `rgba(76,201,240,${0.6 + 0.25 * Math.sin(time * 8)})`; ctx.lineWidth = 4; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(0, 0, p.r + 14, -1.05, 1.05); ctx.stroke(); ctx.restore(); }
      if (p.frozen > 0) { ctx.strokeStyle = '#b8ffff'; ctx.shadowColor = '#b8ffff'; ctx.shadowBlur = 16; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + time; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * (p.r + 16), Math.sin(a) * (p.r + 16)); ctx.stroke(); } }
      if (p.emp > 0) { ctx.strokeStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(0, 0, p.r + 20, time * 5, time * 5 + 4); ctx.stroke(); ctx.setLineDash([]); }
      if (p.hexed) { ctx.strokeStyle = 'rgba(199,125,255,.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, p.r + 7, 0, TAU); ctx.stroke(); }
      ctx.save();
      ctx.rotate(p.angle);
      ctx.globalAlpha = (p.inv > 0 && Math.sin(time * 40) > 0) ? 0.35 : 1;
      ctx.shadowColor = p.color; ctx.shadowBlur = 20;
      const thrust = Math.hypot(p.vx, p.vy) / 320;
      ctx.fillStyle = `rgba(255,${140 + randInt(0, 80)},60,${0.5 + thrust * 0.5})`;
      ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-16 - thrust * 14 - rand(0, 6), 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
      const sk = skinById(p.skin);
      ctx.fillStyle = sk.hull; ctx.strokeStyle = sk.stroke || p.color; ctx.shadowColor = sk.glow || p.color; ctx.lineWidth = 2; if (sk.dash) ctx.setLineDash([5, 4]);
      shipPath(p.ship); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      if (p.blinkFlash) { ctx.globalAlpha = 0.6; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, p.r + 12, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(4, 0, 3.5, 0, TAU); ctx.fill();
      ctx.restore();
      // 名牌：其他玩家在角色頭上看到名字
      ctx.shadowBlur = 0;
      ctx.font = `${p.local ? 'bold ' : ''}12px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(p.name).width + 14;
      ctx.fillStyle = 'rgba(3,4,10,.65)'; roundRect(-tw / 2, -p.r - 30, tw, 18, 9); ctx.fill();
      ctx.fillStyle = p.color; ctx.fillText(p.name, 0, -p.r - 21);
      // 小血條（多人時看隊友血量）
      if (world.players.length > 1) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(-16, -p.r - 10, 32, 3);
        ctx.fillStyle = p.hp / p.maxHp > 0.3 ? '#3ddc84' : '#ff3860'; ctx.fillRect(-16, -p.r - 10, 32 * (p.hp / p.maxHp), 3);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }
  /** 各機體的船身輪廓（朝 +x），畫在已 translate/rotate 的座標系 */
  function shipPath(ship) {
    ctx.beginPath();
    if (ship === 'wasp') { ctx.moveTo(22, 0); ctx.lineTo(-8, 6); ctx.lineTo(-14, 12); ctx.lineTo(-6, 0); ctx.lineTo(-14, -12); ctx.lineTo(-8, -6); }
    else if (ship === 'ronin') { ctx.moveTo(20, 0); ctx.lineTo(2, 5); ctx.lineTo(-12, 13); ctx.lineTo(-7, 0); ctx.lineTo(-12, -13); ctx.lineTo(2, -5); ctx.closePath(); ctx.moveTo(6, 0); ctx.lineTo(26, 0); }
    else if (ship === 'wraith') { ctx.moveTo(20, 0); ctx.lineTo(-4, 4); ctx.lineTo(-16, 10); ctx.lineTo(-10, 0); ctx.lineTo(-16, -10); ctx.lineTo(-4, -4); }
    else if (ship === 'engineer') { ctx.moveTo(14, 0); ctx.lineTo(6, 10); ctx.lineTo(-10, 10); ctx.lineTo(-14, 4); ctx.lineTo(-14, -4); ctx.lineTo(-10, -10); ctx.lineTo(6, -10); ctx.closePath(); ctx.moveTo(-2, -14); ctx.lineTo(-2, 14); }
    else if (ship === 'bastion') { ctx.moveTo(16, 0); ctx.lineTo(8, 12); ctx.lineTo(-12, 14); ctx.lineTo(-8, 0); ctx.lineTo(-12, -14); ctx.lineTo(8, -12); }
    else if (ship === 'carrier') { ctx.moveTo(20, 0); ctx.lineTo(4, 8); ctx.lineTo(-14, 8); ctx.lineTo(-10, 0); ctx.lineTo(-14, -8); ctx.lineTo(4, -8); ctx.closePath(); ctx.moveTo(-2, 14); ctx.lineTo(-12, 14); ctx.lineTo(-8, 9); ctx.moveTo(-2, -14); ctx.lineTo(-12, -14); ctx.lineTo(-8, -9); }
    else { ctx.moveTo(18, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); }
    ctx.closePath();
  }
  function drawDowned(p, time) {
    ctx.save(); ctx.translate(p.x, p.y);
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.globalAlpha = 0.55; ctx.shadowColor = '#ff5f7a'; ctx.shadowBlur = 16;
    ctx.rotate(p.angle);
    ctx.fillStyle = '#6a6a7a'; ctx.strokeStyle = '#ff5f7a'; ctx.lineWidth = 2;
    shipPath(p.ship); ctx.fill(); ctx.stroke();
    ctx.rotate(-p.angle); ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(255,95,122,${0.25 + pulse * 0.35})`; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (p.reviveProgress > 0) { ctx.strokeStyle = '#3ddc84'; ctx.shadowColor = '#3ddc84'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * (p.reviveProgress / REVIVE_TIME)); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff5f7a'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`${p.name} 倒地 ${Math.ceil(p.downTimer)}s`, 0, -p.r - 26);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '11px sans-serif'; ctx.fillText(p.reviveProgress > 0 ? '救援中…' : '靠近 3 秒救援', 0, p.r + 24);
    ctx.restore();
  }
  function drawConvoy(b, time) {
    ctx.save(); ctx.translate(b.x, b.y);
    const col = b.alive ? (b.hitFlash ? '#fff' : '#4cc9f0') : '#555';
    ctx.shadowColor = col; ctx.shadowBlur = b.alive ? 24 : 0;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.fillStyle = b.alive ? 'rgba(76,201,240,.18)' : 'rgba(80,80,80,.3)';
    const r = b.r;
    ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 0.6, -r * 0.7); ctx.lineTo(-r * 1.2, -r * 0.7); ctx.lineTo(-r * 1.5, -r * 0.3); ctx.lineTo(-r * 1.5, r * 0.3); ctx.lineTo(-r * 1.2, r * 0.7); ctx.lineTo(r * 0.6, r * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(-r * 0.3 + i * r * 0.5, 0, 5, 0, TAU); ctx.fill(); }
    if (b.alive) { ctx.fillStyle = 'rgba(255,170,60,' + (0.5 + Math.random() * 0.5) + ')'; ctx.beginPath(); ctx.moveTo(-r * 1.5, -r * 0.25); ctx.lineTo(-r * 2.1 - Math.random() * 10, 0); ctx.lineTo(-r * 1.5, r * 0.25); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(b.x - 50, b.y - b.r - 22, 100, 6);
    ctx.fillStyle = b.hp / b.maxHp > 0.4 ? '#4cc9f0' : '#ff3860'; ctx.fillRect(b.x - 50, b.y - b.r - 22, 100 * (b.hp / b.maxHp), 6);
    ctx.fillStyle = '#4cc9f0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('運輸艦', b.x, b.y - b.r - 26);
  }
  function drawBeacon(time) {
    const b = world.beacon;
    if (b.kind === 'convoy') { drawConvoy(b, time); return; }
    ctx.save(); ctx.translate(b.x, b.y);
    const col = b.alive ? (b.hitFlash ? '#fff' : '#4cc9f0') : '#555';
    ctx.shadowColor = col; ctx.shadowBlur = b.alive ? 30 : 0;
    ctx.rotate(time * 0.4);
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.fillStyle = b.alive ? 'rgba(76,201,240,.15)' : 'rgba(80,80,80,.3)';
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * b.r, Math.sin(a) * b.r); } ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.rotate(-time * 0.8); ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.arc(0, 0, b.r * 0.6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.rotate(time * 0.4);
    if (b.alive) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 8 + Math.sin(time * 6) * 2, 0, TAU); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(b.x - 50, b.y - b.r - 18, 100, 6);
    ctx.fillStyle = b.hp / b.maxHp > 0.4 ? '#4cc9f0' : '#ff3860'; ctx.fillRect(b.x - 50, b.y - b.r - 18, 100 * (b.hp / b.maxHp), 6);
  }
  function drawFloatTexts() {
    for (const f of floatTexts) {
      ctx.globalAlpha = Math.min(1, (f.life / f.maxLife) * 2);
      ctx.fillStyle = f.color; ctx.font = `bold ${f.size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = f.color; ctx.shadowBlur = 8; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // ---------- HUD ----------
  function drawHUD(p, best, muted) {
    ctx.save(); ctx.textBaseline = 'top';
    if (p) {
      const bw = 220, bh = 14, bx = 24, by = 24;
      ctx.fillStyle = 'rgba(255,255,255,.1)'; roundRect(bx, by, bw, bh, 7); ctx.fill();
      const hpF = p.hp / p.maxHp;
      ctx.fillStyle = hpF > 0.5 ? '#3ddc84' : hpF > 0.25 ? '#ffd166' : '#ff3860';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12; if (hpF > 0) { roundRect(bx, by, bw * hpF, bh, 7); ctx.fill(); } ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`${p.name} · HP ${Math.ceil(p.hp)} / ${p.maxHp}`, bx, by + bh + 6);
      ctx.fillStyle = 'rgba(255,255,255,.1)'; roundRect(bx, by + 40, 120, 6, 3); ctx.fill();
      ctx.fillStyle = p.dashCd <= 0 ? '#4cc9f0' : 'rgba(76,201,240,.4)'; roundRect(bx, by + 40, 120 * (1 - p.dashCd / p.dashCdMax), 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '11px sans-serif'; ctx.fillText('衝刺 (Shift)', bx, by + 50);
      ctx.fillStyle = 'rgba(255,255,255,.1)'; roundRect(bx + 130, by + 40, 90, 6, 3); ctx.fill();
      const bk = p.blinkCdMax ? 1 - (p.blinkCd || 0) / p.blinkCdMax : 1;
      ctx.fillStyle = (p.blinkCd || 0) <= 0 ? '#b8ffff' : 'rgba(184,255,255,.4)'; roundRect(bx + 130, by + 40, 90 * Math.max(0, bk), 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText('閃現 (空白鍵)', bx + 130, by + 50);
      let sx = bx, sy = by + 72;
      const tag = (label, color) => { ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; const w = ctx.measureText(label).width + 12; ctx.globalAlpha = .18; roundRect(sx, sy, w, 18, 9); ctx.fill(); ctx.globalAlpha = 1; ctx.fillText(label, sx + 6, sy + 3); sx += w + 6; };
      for (const id of Object.keys(p.syn || {})) { const s = SYNERGIES.find(x => x.id === id); if (s) tag(`${s.icon} ${s.name}`, '#ff8c42'); }
      if (p.spread > 1) tag(`散射 ×${p.spread}`, '#ffd166');
      if (p.rapid > 0) tag(`連射 ${p.rapid.toFixed(0)}s`, '#ff8c42');
      if (p.shield > 0) tag(`護盾 ×${p.shield}`, '#4cc9f0');
      if (p.laser > 0) tag(`雷射 ${p.laser.toFixed(0)}s`, '#b8ffff');
      const ups = Object.entries(p.upgrades);
      if (ups.length) {
        sx = bx; sy += 26; ctx.textAlign = 'left';
        for (const [id, lv] of ups) {
          const u = UPGRADES.find(u => u.id === id);
          ctx.font = '14px sans-serif'; ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.9; ctx.fillText(u.icon, sx, sy);
          ctx.font = 'bold 10px sans-serif'; ctx.fillStyle = '#ffd166'; ctx.fillText(String(lv), sx + 17, sy + 8);
          sx += 30; if (sx > bx + 240) { sx = bx; sy += 22; }
        }
        ctx.globalAlpha = 1;
      }
    }
    // 隊伍名單（多人時顯示）
    if (world.players.length > 1) {
      let y = 24;
      ctx.textAlign = 'left'; ctx.font = '12px sans-serif';
      for (const q of world.players) {
        ctx.fillStyle = q.dead ? 'rgba(255,255,255,.35)' : q.offline ? 'rgba(255,255,255,.5)' : q.downed ? '#ff5f7a' : q.color;
        ctx.fillText(`${q.dead ? '✕' : q.offline ? '⋯' : q.downed ? '⚠' : '●'} ${q.name}  ${q.kills} 擊殺${q.offline ? '（斷線）' : q.downed ? '（倒地）' : ''}`, 280, y); y += 18;
      }
    }
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = 'bold 32px sans-serif'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
    ctx.fillText(String(world.score).padStart(6, '0'), W - 24, 20); ctx.shadowBlur = 0;
    ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(`最高 ${best}`, W - 24, 58);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(world.endless ? `WAVE ${world.wave} · ${tr('無盡')}` : `WAVE ${world.wave} / ${WIN_WAVE}`, W - 24, 80);
    { const A = arenaById(world.arena); ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(`${A.icon} ${tr(A.name)}${world.dustBonus ? `  ✨+${world.dustBonus}` : ''}${p && p.evolved ? `  ${(EVOLUTIONS.find(e => e.id === p.evolved) || {}).icon || ''} ${tr((EVOLUTIONS.find(e => e.id === p.evolved) || {}).name || '')}` : ''}`, W - 24, 100); }
    if (world.event && EVENTS[world.event.id]) { const E = EVENTS[world.event.id]; ctx.textAlign = 'center'; ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10; ctx.font = 'bold 15px sans-serif'; ctx.fillText(`${E.icon} ${tr(E.name)}${E.dur ? `  ${Math.ceil(world.event.t)}s` : ''}`, W / 2, world.waveMode ? 62 : 24); ctx.shadowBlur = 0; ctx.textAlign = 'right'; }
    if (world.combo >= 3) {
      const s = 18 + Math.min(world.combo, 30);
      ctx.font = `bold ${s}px sans-serif`; ctx.fillStyle = world.combo >= 10 ? '#ff3860' : '#ffd166'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
      ctx.fillText(`${world.combo} COMBO`, W - 24, 120); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(W - 24 - 120, 120 + s + 6, 120, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(W - 24 - 120 * (world.comboTimer / 2.2), 120 + s + 6, 120 * (world.comboTimer / 2.2), 3);
    }
    if (world.waveMode) {
      const m = WAVE_MODES[world.waveMode];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 18px sans-serif'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10;
      const extra = m.duration ? `  ${Math.ceil(world.modeTimer)}s` : world.waveMode === 'asteroids' ? `  剩餘 ${world.enemies.length}` : world.waveMode === 'convoy' && world.beacon ? `  ${Math.round(clamp((world.beacon.x + 70) / (W + 130), 0, 1) * 100)}%` : '';
      ctx.fillText(m.name + extra, W / 2, 24); ctx.shadowBlur = 0;
      if (m.duration) { ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(W / 2 - 120, 50, 240, 4); ctx.fillStyle = '#ffd166'; ctx.fillRect(W / 2 - 120, 50, 240 * (1 - world.modeTimer / m.duration), 4); }
    }
    if (world.enemies.every(e => e.ambient) && world.bosses.length === 0 && world.bossWarn <= 0 && !world.waveMode && world.wave > 0 && world.scene === 'play') {
      ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '16px sans-serif';
      ctx.fillText(`下一波倒數 ${Math.ceil(world.waveTimer)}`, W / 2, H - 60);
    }
    if (muted) { ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '12px sans-serif'; ctx.fillText('🔇 靜音 (M)', W - 24, H - 30); }
    ctx.restore();
  }
  function drawBossHUD(time) {
    if (world.bossWarn > 0) {
      const a = 0.5 + 0.5 * Math.sin(time * 12);
      ctx.fillStyle = `rgba(255,56,96,${0.12 * a})`; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,56,96,${0.6 + 0.4 * a})`; ctx.font = 'bold 44px sans-serif'; ctx.shadowColor = '#ff3860'; ctx.shadowBlur = 24;
      ctx.fillText('⚠ WARNING ⚠', W / 2, H / 2 - 30);
      ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('偵測到巨型敵艦接近', W / 2, H / 2 + 16); ctx.shadowBlur = 0;
    }
    world.bosses.forEach((b, i) => {
      const n = world.bosses.length, bw = n > 1 ? 440 : 600, bx = n > 1 ? (i === 0 ? W / 2 - bw - 20 : W / 2 + 20) : (W - bw) / 2, by = 20;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.letterSpacing = '3px';
      ctx.fillText(b.name + (b.phase > 1 ? `  · PHASE ${b.phase}` : '') + (b.cloak ? '  · 隱形' : ''), bx + bw / 2, by); ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(bx, by + 22, bw, 12, 6); ctx.fill();
      const frac = b.hp / b.maxHp;
      ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 16; if (frac > 0) { roundRect(bx, by + 22, bw * frac, 12, 6); ctx.fill(); } ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx + bw * 0.33 - 1, by + 22, 2, 12); ctx.fillRect(bx + bw * 0.66 - 1, by + 22, 2, 12);
    });
  }
  function upgradeCardRects() {
    const cw = 260, ch = 300, gap = 24, total = cw * 3 + gap * 2, x0 = (W - total) / 2, y0 = H / 2 - ch / 2 + 20;
    return [0, 1, 2].map(i => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch }));
  }
  function skipRect() { return { x: W / 2 - 110, y: H / 2 + 200, w: 220, h: 38 }; }
  function drawUpgrade(time, mouse, me) {
    const choices = me ? world.pendingUpgrades.get(me.id) : null;
    ctx.save();
    ctx.fillStyle = 'rgba(3,4,10,.72)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rects = upgradeCardRects();
    ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 20; ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`第 ${world.wave} 波 清除！`, W / 2, rects[0].y - 70); ctx.shadowBlur = 0;
    if (!choices) {
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '18px sans-serif';
      ctx.fillText(`等待其他玩家選擇強化（${world.pendingUpgrades.size} 人尚未選擇）`, W / 2, H / 2);
      ctx.restore(); return;
    }
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '16px sans-serif'; ctx.fillText('選擇一項強化（點擊卡片或按 1 / 2 / 3）', W / 2, rects[0].y - 34);
    const hover = rects.findIndex(r => mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h);
    rects.forEach((r, i) => {
      const u = choices[i]; if (!u) return;
      const lv = me.upgrades[u.id] || 0, hov = i === hover;
      ctx.save(); ctx.translate(0, hov ? -8 : Math.sin(time * 2 + i) * 3);
      ctx.shadowColor = hov ? '#ffd166' : '#4cc9f0'; ctx.shadowBlur = hov ? 30 : 12; ctx.fillStyle = hov ? 'rgba(40,36,20,.95)' : 'rgba(14,18,40,.95)';
      roundRect(r.x, r.y, r.w, r.h, 16); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = hov ? '#ffd166' : 'rgba(76,201,240,.6)'; ctx.lineWidth = hov ? 3 : 1.5; roundRect(r.x, r.y, r.w, r.h, 16); ctx.stroke();
      ctx.fillStyle = hov ? '#ffd166' : 'rgba(255,255,255,.4)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`[${i + 1}]`, r.x + 16, r.y + 20);
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '12px sans-serif'; ctx.fillText(`${lv} / ${u.max}`, r.x + r.w - 16, r.y + 20);
      for (let k = 0; k < u.max; k++) { ctx.fillStyle = k < lv ? '#ffd166' : 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.arc(r.x + r.w - 20 - (u.max - 1 - k) * 12, r.y + 38, 4, 0, TAU); ctx.fill(); }
      ctx.textAlign = 'center';
      if (u.evo) { ctx.strokeStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 24 + Math.sin(time * 6) * 8; ctx.lineWidth = 3; roundRect(r.x, r.y, r.w, r.h, 16); ctx.stroke(); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(tr('武器進化'), r.x + r.w / 2, r.y + 20); }
      ctx.font = '56px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(u.icon, r.x + r.w / 2, r.y + 100);
      ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = hov ? '#ffd166' : '#fff'; ctx.fillText(tr(u.name), r.x + r.w / 2, r.y + 160);
      ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; wrapText(tr(u.desc(lv)), r.x + r.w / 2, r.y + 200, r.w - 36, 20);
      const syn = u.evo ? [] : synergyIfPicked(me.upgrades, u.id);
      if (syn.length) { ctx.fillStyle = '#ff8c42'; ctx.shadowColor = '#ff8c42'; ctx.shadowBlur = 12; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`組合技 ${syn[0].icon} ${syn[0].name}`, r.x + r.w / 2, r.y + r.h - 44); ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '11px sans-serif'; wrapText(syn[0].desc, r.x + r.w / 2, r.y + r.h - 26, r.w - 30, 14); }
      else if (lv + 1 >= u.max && !u.evo) { ctx.fillStyle = '#ff8c42'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(tr('已達上限（最後一級）'), r.x + r.w / 2, r.y + r.h - 24); }
      ctx.restore();
    });
    const sk = skipRect(), skHov = mouse.x >= sk.x && mouse.x <= sk.x + sk.w && mouse.y >= sk.y && mouse.y <= sk.y + sk.h;
    ctx.fillStyle = skHov ? 'rgba(61,220,132,.25)' : 'rgba(255,255,255,.06)'; roundRect(sk.x, sk.y, sk.w, sk.h, 10); ctx.fill();
    ctx.strokeStyle = skHov ? '#3ddc84' : 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; roundRect(sk.x, sk.y, sk.w, sk.h, 10); ctx.stroke();
    ctx.fillStyle = skHov ? '#3ddc84' : 'rgba(255,255,255,.7)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('[0] 放棄升級 +20 HP'), sk.x + sk.w / 2, sk.y + sk.h / 2);
    ctx.restore();
  }
  function drawOverlay(title, sub) {
    ctx.fillStyle = 'rgba(3,4,10,.6)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.fillText(title, W / 2, H / 2 - 20);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '18px sans-serif'; ctx.fillText(sub, W / 2, H / 2 + 30);
  }
  function drawMenuBackdrop(time) {
    // 選單的標題與輸入框由 HTML 覆蓋層負責；這裡只畫背景裝飾
    [['#ff5f7a', -260], ['#ffd166', -130], ['#9b5de5', 130], ['#00f5d4', 260]].forEach(([c, ox], i) => {
      const x = W / 2 + ox, y = H / 2 - 230 + Math.sin(time * 1.5 + i) * 10;
      ctx.strokeStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.lineWidth = 2; ctx.fillStyle = c + '33';
      ctx.beginPath(); for (let k = 0; k < 5 + i; k++) { const a = k * TAU / (5 + i) + time * 0.5; ctx.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); } ctx.closePath(); ctx.fill(); ctx.stroke();
    });
    ctx.shadowBlur = 0;
  }
  function drawVictory(time, ui) {
    ctx.fillStyle = 'rgba(3,4,10,.72)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 30 + Math.sin(time * 4) * 8; ctx.font = 'bold 64px sans-serif'; ctx.fillText('突圍成功', W / 2, H / 2 - 110); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(`${world.score}`, W / 2, H / 2 - 40);
    ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = '16px sans-serif'; ctx.fillText(`擊破殲滅者 Ω，撐過 ${WIN_WAVE} 波`, W / 2, H / 2);
    let y = H / 2 + 34;
    for (const p of world.players) { ctx.fillStyle = p.color; ctx.font = '14px sans-serif'; ctx.fillText(`${p.name}：${p.kills} 擊殺`, W / 2, y); y += 20; }
    const pulse = 0.7 + 0.3 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`; ctx.font = '20px sans-serif';
    const canDecide = !ui.online || ui.isHost;
    ctx.fillText(canDecide ? 'Enter 繼續無盡模式（敵人持續變強） · Esc 結束並結算' : '等待房主決定：繼續無盡模式或結算', W / 2, y + 40);
  }
  function drawGameOver(time, best, ui) {
    ctx.fillStyle = 'rgba(3,4,10,.7)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff3860'; ctx.shadowColor = '#ff3860'; ctx.shadowBlur = 24; ctx.font = 'bold 56px sans-serif'; if (world.won) { ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; } ctx.fillText(world.won && !world.abandoned ? (world.endless ? '無盡模式終結' : '突圍成功') : ui.left ? '已離開戰鬥' : world.abandoned ? '撤退' : world.players.length > 1 ? '全員陣亡' : '艦艇損毀', W / 2, H / 2 - 100); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(`${world.score}`, W / 2, H / 2 - 30);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '16px sans-serif';
    ctx.fillText(tr(`撐到第 ${world.wave} 波 · 最高分 ${best}${world.score >= best && world.score > 0 ? '  🏆 新紀錄！' : ''}`), W / 2, H / 2 + 10);
    const st = world.stats;
    if (st) {
      const A = arenaById(world.arena);
      if (st.killedBy && !world.abandoned && !world.won) { ctx.fillStyle = '#ff8c9c'; ctx.font = 'bold 15px sans-serif'; ctx.fillText(tr(`被「${st.killedBy}」擊落`) + ` · ${A.icon} ${tr(A.name)}`, W / 2, H / 2 + 34); }
      const kills = Object.values(st.kills || {}).reduce((a, b) => a + b, 0);
      const mins = Math.floor((st.timeAlive || 0) / 60), secs = Math.floor((st.timeAlive || 0) % 60);
      const evo = st.evolved ? EVOLUTIONS.find(e => e.id === st.evolved) : null;
      const cells = [[tr('存活'), `${mins}:${String(secs).padStart(2, '0')}`], [tr('擊殺'), `${kills}`], [tr('造成傷害'), `${Math.round(st.dmgDealt)}`], [tr('承受傷害'), `${Math.round(st.dmgTaken)}`], [tr('最高連擊'), `${st.maxCombo}`], [tr('擦彈'), `${st.grazes}`], [tr('閃現'), `${st.blinks}`], [tr('道具'), `${st.pickups}`]];
      const cw = 118, x0 = W / 2 - cells.length * cw / 2, yy = H / 2 + 60;
      cells.forEach(([k, v], i) => { ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(v, x0 + i * cw + cw / 2, yy); ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = '11px sans-serif'; ctx.fillText(k, x0 + i * cw + cw / 2, yy + 18); });
      const extras = []; if (evo) extras.push(`${evo.icon} ${tr(evo.name)}`); if (st.events && st.events.length) extras.push(tr('事件') + ' ' + st.events.map(id => (EVENTS[id] || {}).icon || '').join(' ')); if (st.bestNoHit >= 30) extras.push(tr(`最長無傷 ${Math.round(st.bestNoHit)} 秒`)); if (st.parries) extras.push(tr(`格擋 ${st.parries}`));
      if (extras.length) { ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '12px sans-serif'; ctx.fillText(extras.join('   ·   '), W / 2, yy + 42); }
    }
    let y = H / 2 + 118;
    if (ui.result) {
      ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 14; ctx.font = 'bold 22px sans-serif';
      const label = ui.result.mode === 'coop' ? '合作排行榜' : ui.result.mode === 'daily' ? '今日挑戰' : '單人排行榜';
      if (ui.result.rank) { ctx.fillText(`🏆 ${label} 第 ${ui.result.rank} 名`, W / 2, y); y += 32; }
      if (ui.result.dust) { ctx.fillStyle = '#fff3c4'; ctx.font = 'bold 20px sans-serif'; ctx.fillText(`✨ 星塵 +${ui.result.dust}`, W / 2, y); y += 30; }
      ctx.shadowBlur = 0;
    }
    else if (ui.left) { ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '15px sans-serif'; ctx.fillText('合作成績會在隊伍結束時一併結算，你的擊殺數會計入', W / 2, y); y += 28; }
    for (const p of world.players) { ctx.fillStyle = p.color; ctx.font = '14px sans-serif'; ctx.fillText(`${p.name}：${p.kills} 擊殺`, W / 2, y); y += 20; }
    const pulse = 0.7 + 0.3 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`; ctx.font = '20px sans-serif'; ctx.fillText(ui.daily ? '每日挑戰結束 · L 今日排行榜 · 點擊 或 Esc 回到選單' : ui.online ? (ui.isHost ? '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到大廳' : '等待房主再開一局 · L 排行榜 · Esc 回到大廳') : '點擊 或 按 Enter 再來一局 · L 排行榜 · Esc 回到選單', W / 2, y + 30);
  }
  function drawOffscreenArrows(time, p) {
    if (!p) return;
    const m = 30, targets = [];
    for (const e of world.enemies) targets.push({ x: e.x, y: e.y, r: e.r, color: e.color, type: e.type, boss: false });
    for (const b of world.bosses) if (!b.cloak) targets.push({ x: b.x, y: b.y, r: b.r, color: b.color, type: 'boss', boss: true });
    for (const q of world.players) if (q.downed && q !== p) targets.push({ x: q.x, y: q.y, r: q.r, color: '#3ddc84', type: 'downed', boss: false });
    ctx.save();
    for (const t of targets) {
      if (!(t.x < -t.r || t.x > W + t.r || t.y < -t.r || t.y > H + t.r)) continue;
      const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
      let tMax = Infinity;
      if (nx > 0) tMax = Math.min(tMax, (W - m - p.x) / nx); else if (nx < 0) tMax = Math.min(tMax, (m - p.x) / nx);
      if (ny > 0) tMax = Math.min(tMax, (H - m - p.y) / ny); else if (ny < 0) tMax = Math.min(tMax, (m - p.y) / ny);
      if (!isFinite(tMax) || tMax < 0) continue;
      const ax = p.x + nx * tMax, ay = p.y + ny * tMax;
      const near = clamp(1 - (d - 200) / 900, 0, 1);
      const size = t.boss ? 16 + Math.sin(time * 8) * 3 : 7 + near * 7 + (t.type === 'tank' ? 4 : 0);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(ny, nx));
      ctx.globalAlpha = t.boss ? 0.95 : 0.35 + near * 0.6; ctx.shadowColor = t.color; ctx.shadowBlur = 10 + near * 10;
      ctx.fillStyle = t.color; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(size, 0); ctx.lineTo(-size * 0.7, size * 0.65); ctx.lineTo(-size * 0.35, 0); ctx.lineTo(-size * 0.7, -size * 0.65); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (t.type === 'dart' && near > 0.5 && Math.sin(time * 20) > 0) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-size * 0.45, 0, 2.2, 0, TAU); ctx.fill(); }
      if (t.boss) { ctx.rotate(-Math.atan2(ny, nx)); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BOSS', 0, 26 * (ay < H / 2 ? 1 : -1)); }
      ctx.restore();
    }
    for (const e of world.enemies) {
      if (e.type !== 'dart') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 260 || e.x < 0 || e.x > W || e.y < 0 || e.y > H) continue;
      if ((e.vx * (p.x - e.x) + e.vy * (p.y - e.y)) <= 0 || Math.sin(time * 24) <= -0.2) continue;
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 12;
      ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', e.x, e.y - e.r - 12);
    }
    ctx.restore();
  }
  // 觸控：搖桿、瞄準桿、衝刺鈕、選單鈕（螢幕座標）
  function drawTouchControls(ui) {
    const me = ui.me;
    ctx.save();
    raw.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    const L = touchLayout(view.cw, view.ch);
    const inGame = world.scene === 'play';
    const stick = (s, color) => {
      ctx.globalAlpha = 0.35; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, 64, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.75; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(s.x, s.y, 26, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    };
    if (inGame) {
      if (touch.move) stick(touch.move, '#4cc9f0');
      else { ctx.globalAlpha = 0.12; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.arc(view.cw * 0.18, view.ch * 0.7, 64, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      if (touch.aim) stick(touch.aim, '#ff3860');
      // 衝刺鈕（冷卻弧）
      const d = L.dash, ready = me && me.dashCd <= 0;
      ctx.globalAlpha = 0.85; ctx.fillStyle = ready ? 'rgba(76,201,240,.25)' : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = ready ? '#4cc9f0' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = ready ? 14 : 0;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, -Math.PI / 2, -Math.PI / 2 + TAU * (me ? 1 - me.dashCd / me.dashCdMax : 1)); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = ready ? '#fff' : 'rgba(255,255,255,.5)'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('衝刺', d.x, d.y);
      // 閃現鈕
      const bl = L.blink, bReady = me && (me.blinkCd || 0) <= 0;
      ctx.globalAlpha = 0.85; ctx.fillStyle = bReady ? 'rgba(184,255,255,.22)' : 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = bReady ? '#b8ffff' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.shadowColor = '#b8ffff'; ctx.shadowBlur = bReady ? 12 : 0;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, -Math.PI / 2, -Math.PI / 2 + TAU * (me && me.blinkCdMax ? 1 - (me.blinkCd || 0) / me.blinkCdMax : 1)); ctx.stroke();
      ctx.shadowBlur = 0; ctx.fillStyle = bReady ? '#fff' : 'rgba(255,255,255,.5)'; ctx.font = 'bold 13px sans-serif'; ctx.fillText('閃現', bl.x, bl.y);
      // 自動瞄準提示
      if (touch.autoAngle !== null && me) {
        const p = view; const sx = p.ox + me.x * p.scale, sy = p.oy + me.y * p.scale;
        ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(touch.autoAngle) * 90, sy + Math.sin(touch.autoAngle) * 90); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }
    // 選單鈕
    const m = L.menu;
    ctx.globalAlpha = 0.8; ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(m.x - 9, m.y + i * 7); ctx.lineTo(m.x + 9, m.y + i * 7); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.restore();
    applyView();
  }
  function drawReticle({ mouse, time }) {
    const inGame = world.scene === 'play' || world.scene === 'pause';
    ctx.save(); ctx.translate(mouse.x, mouse.y);
    if (!inGame) {
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.stroke();
      ctx.restore(); return;
    }
    const hot = nearestTarget(world, mouse.x, mouse.y, 40);
    const punch = vfx.crossPunch, recoil = vfx.crossRecoil;
    const scale = 1 + punch * 0.6, gap = 6 + recoil * 6 + punch * 4, len = 8;
    ctx.rotate(punch * 0.5); ctx.scale(scale, scale);
    const col = hot ? '#ff3860' : punch > 0.3 ? '#ffd166' : '#fff';
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.moveTo(Math.cos(a) * gap, Math.sin(a) * gap); ctx.lineTo(Math.cos(a) * (gap + len), Math.sin(a) * (gap + len)); }
    ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
    if (hot) { ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(0, 0, gap + len + 4, 0, TAU); ctx.stroke(); }
    ctx.restore();
  }

  onThemeChange(() => { resize(); });
  return { resize, toWorld, view, draw, updateStars, upgradeCardRects, skipRect };
}
