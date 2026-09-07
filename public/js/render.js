// 渲染：把世界狀態與特效畫到 Canvas。固定 1600x900 邏輯座標，等比縮放到視窗並加黑邊。
import { TAU, rand, randInt, clamp } from '../../shared/math.js';
import { PICKUP_STYLE, UPGRADES, WAVE_MODES, REVIVE_TIME } from '../../shared/constants.js';
import { nearestTarget } from './game.js';
import { vfx, particles, floatTexts } from './effects.js';
import { themedContext, getTheme, onThemeChange } from './themes.js';

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
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, T.bg[0]); bg.addColorStop(1, T.bg[1]);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (vfx.shake > 0.3) ctx.translate(rand(-vfx.shake, vfx.shake), rand(-vfx.shake, vfx.shake));
    if (vfx.zoom > 0 && me) { const z = 1 + vfx.zoom * 0.018; ctx.translate(me.x, me.y); ctx.scale(z, z); ctx.translate(-me.x, -me.y); }

    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + s.tw);
      raw.fillStyle = `rgba(${T.star},${(0.25 + 0.6 * tw) * s.z})`;
      ctx.fillRect(s.x, s.y, s.z * 2, s.z * 2);
    }

    if (world.scene === 'menu') { drawMenuBackdrop(time); ctx.restore(); drawReticle(ui); return; }

    drawParticles();
    if (world.beacon) drawBeacon(time);
    drawPickups();
    drawEnemies();
    if (world.boss) drawBoss(time);
    drawBullets();
    drawPlayers(time);
    drawFloatTexts();
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
    drawReticle(ui);
  }

  function drawParticles() {
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
      ctx.shadowColor = e.color; ctx.shadowBlur = 14;
      ctx.strokeStyle = e.hitFlash > 0 ? '#fff' : e.color; ctx.lineWidth = 2.5;
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
      else { for (let i = 0; i < 4; i++) { const a = i * TAU / 4 + Math.PI / 4; ctx.lineTo(Math.cos(a) * e.r, Math.sin(a) * e.r); } }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (e.maxHp >= 60 && e.hp < e.maxHp) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2, 4);
        ctx.fillStyle = e.color; ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2 * (e.hp / e.maxHp), 4);
      }
    }
  }
  function drawBoss(time) {
    const b = world.boss, flash = b.hitFlash > 0, col = flash ? '#fff' : b.color;
    ctx.save(); ctx.translate(b.x, b.y);
    ctx.shadowColor = b.color; ctx.shadowBlur = 30;
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
    if (b.atk === 'charge' && !b.chargeDir) {
      ctx.strokeStyle = `rgba(255,209,102,${0.3 + 0.4 * Math.sin(time * 30)})`; ctx.lineWidth = 4; ctx.setLineDash([16, 10]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(b.aim) * 2000, Math.sin(b.aim) * 2000); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  function drawBullets() {
    ctx.shadowBlur = 10;
    for (const b of world.bullets) {
      ctx.shadowColor = b.homing ? '#ffd166' : '#fff'; ctx.strokeStyle = b.homing ? '#fff3c4' : '#fff'; ctx.lineWidth = 3 * b.size; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
    }
    for (const b of world.enemyBullets) {
      const c = b.homing ? '#c77dff' : b.wall ? '#ff8c42' : b.boss ? '#ff3860' : '#00f5d4';
      ctx.shadowColor = c; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
      if (b.boss) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU); ctx.fill(); }
    }
    ctx.shadowBlur = 0;
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
      if (p.downed) { drawDowned(p, time); continue; }
      if (p.offline) ctx.globalAlpha = 0.35;
      ctx.save(); ctx.translate(p.x, p.y);
      if (p.shield > 0) {
        ctx.strokeStyle = `rgba(76,201,240,${0.5 + 0.3 * Math.sin(time * 6)})`; ctx.lineWidth = 2; ctx.shadowColor = '#4cc9f0'; ctx.shadowBlur = 20;
        for (let i = 0; i < p.shield; i++) { ctx.beginPath(); ctx.arc(0, 0, p.r + 10 + i * 5, 0, TAU); ctx.stroke(); }
      }
      ctx.save();
      ctx.rotate(p.angle);
      ctx.globalAlpha = (p.inv > 0 && Math.sin(time * 40) > 0) ? 0.35 : 1;
      ctx.shadowColor = p.color; ctx.shadowBlur = 20;
      const thrust = Math.hypot(p.vx, p.vy) / 320;
      ctx.fillStyle = `rgba(255,${140 + randInt(0, 80)},60,${0.5 + thrust * 0.5})`;
      ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(-16 - thrust * 14 - rand(0, 6), 0); ctx.lineTo(-10, 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8f6ff'; ctx.strokeStyle = p.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); ctx.closePath(); ctx.fill(); ctx.stroke();
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
  function drawDowned(p, time) {
    ctx.save(); ctx.translate(p.x, p.y);
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.globalAlpha = 0.55; ctx.shadowColor = '#ff5f7a'; ctx.shadowBlur = 16;
    ctx.rotate(p.angle);
    ctx.fillStyle = '#6a6a7a'; ctx.strokeStyle = '#ff5f7a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, 11); ctx.lineTo(-5, 0); ctx.lineTo(-10, -11); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.rotate(-p.angle); ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(255,95,122,${0.25 + pulse * 0.35})`; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.arc(0, 0, 70, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    if (p.reviveProgress > 0) { ctx.strokeStyle = '#3ddc84'; ctx.shadowColor = '#3ddc84'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * (p.reviveProgress / REVIVE_TIME)); ctx.stroke(); }
    ctx.shadowBlur = 0; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff5f7a'; ctx.font = 'bold 13px sans-serif'; ctx.fillText(`${p.name} 倒地 ${Math.ceil(p.downTimer)}s`, 0, -p.r - 26);
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '11px sans-serif'; ctx.fillText(p.reviveProgress > 0 ? '救援中…' : '靠近 3 秒救援', 0, p.r + 24);
    ctx.restore();
  }
  function drawBeacon(time) {
    const b = world.beacon;
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
      let sx = bx, sy = by + 72;
      const tag = (label, color) => { ctx.fillStyle = color; ctx.font = 'bold 11px sans-serif'; const w = ctx.measureText(label).width + 12; ctx.globalAlpha = .18; roundRect(sx, sy, w, 18, 9); ctx.fill(); ctx.globalAlpha = 1; ctx.fillText(label, sx + 6, sy + 3); sx += w + 6; };
      if (p.spread > 1) tag(`散射 ×${p.spread}`, '#ffd166');
      if (p.rapid > 0) tag(`連射 ${p.rapid.toFixed(0)}s`, '#ff8c42');
      if (p.shield > 0) tag(`護盾 ×${p.shield}`, '#4cc9f0');
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
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px sans-serif'; ctx.fillText(`WAVE ${world.wave}`, W - 24, 80);
    if (world.combo >= 3) {
      const s = 18 + Math.min(world.combo, 30);
      ctx.font = `bold ${s}px sans-serif`; ctx.fillStyle = world.combo >= 10 ? '#ff3860' : '#ffd166'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 14;
      ctx.fillText(`${world.combo} COMBO`, W - 24, 104); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(W - 24 - 120, 104 + s + 6, 120, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(W - 24 - 120 * (world.comboTimer / 2.2), 104 + s + 6, 120 * (world.comboTimer / 2.2), 3);
    }
    if (world.waveMode) {
      const m = WAVE_MODES[world.waveMode];
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 18px sans-serif'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 10;
      ctx.fillText(m.name + (m.duration ? `  ${Math.ceil(world.modeTimer)}s` : world.waveMode === 'asteroids' ? `  剩餘 ${world.enemies.length}` : ''), W / 2, 24); ctx.shadowBlur = 0;
      if (m.duration) { ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(W / 2 - 120, 50, 240, 4); ctx.fillStyle = '#ffd166'; ctx.fillRect(W / 2 - 120, 50, 240 * (1 - world.modeTimer / m.duration), 4); }
    }
    if (world.enemies.length === 0 && !world.boss && world.bossWarn <= 0 && !world.waveMode && world.wave > 0 && world.scene === 'play') {
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
    const b = world.boss;
    if (b) {
      const bw = 600, bx = (W - bw) / 2, by = 20;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.letterSpacing = '3px';
      ctx.fillText(b.name + (b.phase > 1 ? `  · PHASE ${b.phase}` : ''), W / 2, by); ctx.letterSpacing = '0px';
      ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(bx, by + 22, bw, 12, 6); ctx.fill();
      const frac = b.hp / b.maxHp;
      ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 16; if (frac > 0) { roundRect(bx, by + 22, bw * frac, 12, 6); ctx.fill(); } ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(bx + bw * 0.33 - 1, by + 22, 2, 12); ctx.fillRect(bx + bw * 0.66 - 1, by + 22, 2, 12);
    }
  }
  function upgradeCardRects() {
    const cw = 260, ch = 300, gap = 24, total = cw * 3 + gap * 2, x0 = (W - total) / 2, y0 = H / 2 - ch / 2 + 20;
    return [0, 1, 2].map(i => ({ x: x0 + i * (cw + gap), y: y0, w: cw, h: ch }));
  }
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
      ctx.font = '56px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(u.icon, r.x + r.w / 2, r.y + 100);
      ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = hov ? '#ffd166' : '#fff'; ctx.fillText(u.name, r.x + r.w / 2, r.y + 160);
      ctx.font = '14px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; wrapText(u.desc(lv), r.x + r.w / 2, r.y + 200, r.w - 36, 20);
      if (lv + 1 >= u.max) { ctx.fillStyle = '#ff8c42'; ctx.font = 'bold 12px sans-serif'; ctx.fillText('已達上限（最後一級）', r.x + r.w / 2, r.y + r.h - 24); }
      ctx.restore();
    });
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
  function drawGameOver(time, best, ui) {
    ctx.fillStyle = 'rgba(3,4,10,.7)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff3860'; ctx.shadowColor = '#ff3860'; ctx.shadowBlur = 24; ctx.font = 'bold 56px sans-serif'; ctx.fillText(world.players.length > 1 ? '全員陣亡' : '艦艇損毀', W / 2, H / 2 - 100); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText(`${world.score}`, W / 2, H / 2 - 30);
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '16px sans-serif';
    ctx.fillText(`撐到第 ${world.wave} 波 · 最高分 ${best}${world.score >= best && world.score > 0 ? '  🏆 新紀錄！' : ''}`, W / 2, H / 2 + 10);
    let y = H / 2 + 44;
    if (ui.result) { ctx.fillStyle = '#ffd166'; ctx.shadowColor = '#ffd166'; ctx.shadowBlur = 14; ctx.font = 'bold 22px sans-serif'; ctx.fillText(`🏆 ${ui.result.mode === 'coop' ? '合作' : '單人'}排行榜 第 ${ui.result.rank} 名`, W / 2, y); ctx.shadowBlur = 0; y += 32; }
    for (const p of world.players) { ctx.fillStyle = p.color; ctx.font = '14px sans-serif'; ctx.fillText(`${p.name}：${p.kills} 擊殺`, W / 2, y); y += 20; }
    const pulse = 0.7 + 0.3 * Math.sin(time * 4);
    ctx.fillStyle = `rgba(255,255,255,${pulse})`; ctx.font = '20px sans-serif'; ctx.fillText(ui.online ? (ui.isHost ? '點擊 或 按 Enter 再來一局 · Esc 回到大廳' : '等待房主再開一局 · Esc 回到大廳') : '點擊 或 按 Enter 再來一局 · Esc 回到選單', W / 2, y + 30);
  }
  function drawOffscreenArrows(time, p) {
    if (!p) return;
    const m = 30, targets = [];
    for (const e of world.enemies) targets.push({ x: e.x, y: e.y, r: e.r, color: e.color, type: e.type, boss: false });
    if (world.boss) targets.push({ x: world.boss.x, y: world.boss.y, r: world.boss.r, color: world.boss.color, type: 'boss', boss: true });
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
  return { resize, toWorld, view, draw, updateStars, upgradeCardRects };
}
