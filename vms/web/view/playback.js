// VisionOne View – predvajanje posnetkov s časovnico (strežnik ali snemalnik), do 4 kamere sinhrono, izvoz in zaznamki
import { h, $, clear, icon, get, post, toast, toastErr, modal, field, select, toggle, fmtDateTime, toLocalInput, fromLocalInput, eventTitle, debounce, emptyState } from '../common/core.js';
import { createPlayer } from '../common/player.js';
import { S, camById, setMode } from './view.js';

const P = {
  cams: [], T: Date.now() / 1000 - 300, playing: false, speed: 1, source: 'server',
  vs: 0, ve: 0, lanes: {}, players: {}, selIn: null, selOut: null, skipGaps: true, loop: null,
};

export function openPlayback(opts) { setMode('playback', opts); }
// Klik na kamero v drevesu: doda (največ 4) ali odstrani kamero iz predvajanja
export function togglePlaybackCamera(id) {
  let cams = P.cams.includes(id) ? P.cams.filter(x => x !== id) : [...P.cams, id];
  if (cams.length > 4) cams = cams.slice(-4);
  if (!cams.length) cams = [id];
  setMode('playback', { cameras: cams, ts: P.T });
}

export function renderPlayback(center, opts = {}) {
  stopAll();
  if (opts.cameras) P.cams = opts.cameras.slice(0, 4);
  if (!P.cams.length && S.cameras.length) P.cams = [S.cells.find(Boolean) || S.cameras[0].id];
  P.cams = P.cams.filter(id => camById(id));
  if (opts.ts) P.T = opts.ts;
  const span = 3 * 3600;
  P.vs = P.T - span * 0.75; P.ve = P.T + span * 0.25;
  const anyRec = P.cams.some(id => camById(id)?.recorder_id);
  const allRecOnly = P.cams.length && P.cams.every(id => camById(id)?.rec_location === 'recorder');
  P.source = opts.source || (allRecOnly ? 'recorder' : 'server');

  if (!P.cams.length) { clear(center, emptyState('Izberite kamero', 'Kliknite kamero na levi, da prikažete njene posnetke.')); return; }

  const videos = h('div', { class: 'pb-videos' });
  const n = P.cams.length;
  videos.style.gridTemplateColumns = `repeat(${n > 1 ? 2 : 1}, minmax(0,1fr))`;
  videos.style.gridTemplateRows = `repeat(${n > 2 ? 2 : 1}, minmax(0,1fr))`;
  for (const id of P.cams) {
    const cam = camById(id);
    const tile = h('div', { class: 'tile' });
    const msg = h('div', { class: 'ov-msg' }, 'Nalaganje …');
    const top = h('div', { class: 'ov-top' }, h('span', { class: 'nm' }, cam.name), h('span', { class: 'st' }));
    const tools = h('div', { class: 'ov-tools' }, h('button', { class: 'btn-icon', title: 'Odstrani', onclick: () => { P.cams = P.cams.filter(x => x !== id); renderPlayback(center); } }, icon('x', 16)));
    tile.append(msg, top, tools);
    videos.append(tile);
    P.players[id] = P.source === 'recorder' && cam.recorder_id ? recorderPlayer(cam, tile, msg) : serverPlayer(cam, tile, msg);
  }

  const now = h('span', { class: 'now' });
  const dt = h('input', { type: 'datetime-local', step: 1, value: toLocalInput(P.T), 'aria-label': 'Skoči na čas', onchange: e => seek(fromLocalInput(e.target.value), true) });
  const playBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: () => (P.playing ? pause() : play()), 'aria-label': 'Predvajaj ali ustavi' }, icon('play', 16));
  const speed = select([[0.25, '0,25×'], [0.5, '0,5×'], [1, '1×'], [2, '2×'], [4, '4×'], [8, '8×'], [16, '16×']], P.speed, { 'aria-label': 'Hitrost', disabled: P.source === 'recorder', onchange: e => { P.speed = Number(e.target.value); for (const p of Object.values(P.players)) p.setRate?.(P.speed); } });
  const srcSel = anyRec ? select([['server', 'Vir: strežnik'], ['recorder', 'Vir: snemalnik']], P.source, { 'aria-label': 'Vir posnetkov', onchange: e => renderPlayback(center, { source: e.target.value, ts: P.T }) }) : null;
  const zoomBtns = [['10 min', 600], ['1 h', 3600], ['6 h', 6 * 3600], ['24 h', 86400], ['7 dni', 7 * 86400]].map(([l, s]) =>
    h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { P.vs = P.T - s / 2; P.ve = P.T + s / 2; loadLanes(); } }, l));
  const canOp = ['admin', 'operator'].includes(S.me.role);
  const controls = h('div', { class: 'pb-controls' },
    now,
    h('button', { class: 'btn-icon', title: 'Prejšnji dogodek', onclick: () => jumpEvent(-1) }, '⏮'),
    h('button', { class: 'btn-icon', title: '−10 s', onclick: () => seek(P.T - 10, true) }, '−10'),
    playBtn,
    h('button', { class: 'btn-icon', title: '+10 s', onclick: () => seek(P.T + 10, true) }, '+10'),
    h('button', { class: 'btn-icon', title: 'Naslednji dogodek', onclick: () => jumpEvent(1) }, '⏭'),
    speed, srcSel, dt,
    h('span', { class: 'spacer', style: { flex: 1 } }),
    ...zoomBtns,
    canOp ? h('button', { class: 'btn btn-sm', title: 'Označi začetek izreza', onclick: () => { P.selIn = P.T; if (P.selOut && P.selOut < P.selIn) P.selOut = null; draw(); } }, '[ Začetek') : null,
    canOp ? h('button', { class: 'btn btn-sm', title: 'Označi konec izreza', onclick: () => { P.selOut = P.T; if (P.selIn && P.selIn > P.selOut) P.selIn = null; draw(); } }, 'Konec ]') : null,
    canOp ? h('button', { class: 'btn btn-sm', onclick: bookmarkDialog }, icon('bookmark', 15), 'Zaznamek') : null,
    canOp ? h('button', { class: 'btn btn-sm btn-primary', onclick: exportDialog }, icon('download', 15), 'Izvozi') : null);
  const canvas = h('canvas');
  const tl = h('div', { class: 'timeline', 'aria-label': 'Časovnica: klik za skok, vlečenje za premik, kolešček za povečavo' }, canvas);
  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { style: { background: 'var(--accent)' } }), 'Posnetek na strežniku'),
    h('span', {}, h('i', { style: { background: '#7d8ea3' } }), 'Posnetek na snemalniku'),
    h('span', {}, h('i', { style: { background: 'var(--warn)' } }), 'Oseba / objekt'),
    h('span', {}, h('i', { style: { background: 'var(--alarm)' } }), 'Alarm'),
    h('span', {}, h('i', { style: { background: '#b48cf2' } }), 'Zaznamek / zaklenjeno'),
    h('label', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: P.skipGaps, onchange: e => { P.skipGaps = e.target.checked; } }), 'Preskoči obdobja brez posnetkov'));
  clear(center, h('div', { class: 'pb' }, videos, h('div', { class: 'pb-bar' }, controls, tl, legend)));
  P.ui = { now, dt, playBtn, canvas, tl };
  bindTimeline(tl);
  new ResizeObserver(() => draw()).observe(tl);
  loadLanes().then(() => { seek(P.T, true); if (opts.autoplay) play(); });
  P.loop = setInterval(tick, 250);
}

function stopAll() {
  clearInterval(P.loop); P.loop = null;
  for (const p of Object.values(P.players)) p.destroy();
  P.players = {}; P.playing = false;
}

// ---------- podatki časovnice ----------
const loadLanes = debounce0(async () => {
  const from = Math.floor(P.vs - 3600), to = Math.ceil(P.ve + 3600);
  await Promise.all(P.cams.map(async id => {
    try { P.lanes[id] = { ...(await get(`/api/recordings/timeline?camera=${id}&from=${from}&to=${to}`)), from, to }; }
    catch (e) { P.lanes[id] = { server: [], recorder: [], events: [], bookmarks: [], from, to, error: e.message }; }
  }));
  const errs = P.cams.map(id => P.lanes[id]?.recorder_error).filter(Boolean);
  if (errs.length && P.source === 'recorder') toast(errs[0], 'warn');
  draw();
});
function debounce0(fn) { let p = null, again = false; return async () => { if (p) { again = true; return p; } p = fn(); await p; p = null; if (again) { again = false; return loadLanes(); } }; }
const reloadSoon = debounce(() => loadLanes(), 250);

function segmentsFor(id) {
  const l = P.lanes[id];
  if (!l) return [];
  return P.source === 'recorder' ? l.recorder : l.server;
}
function hasRecording(id, t) { return segmentsFor(id).some(s => s.start_ts <= t && s.end_ts > t); }
function nextRecordingStart(t) {
  let best = null;
  for (const id of P.cams) for (const s of segmentsFor(id)) if (s.start_ts > t && (best == null || s.start_ts < best)) best = s.start_ts;
  return best;
}

// ---------- predvajalnik s strežnika ----------
function serverPlayer(cam, tile, msg) {
  const v = h('video', { muted: true, playsInline: true, preload: 'auto' });
  v.muted = true;
  tile.prepend(v);
  let seg = null, loadingSeek = null;
  const findSeg = t => (P.lanes[cam.id]?.server || []).find(s => s.start_ts <= t + 0.05 && s.end_ts > t);
  const self = {
    ts() { return seg && !v.paused && v.readyState >= 2 ? seg.start_ts + v.currentTime : null; },
    async seek(t) {
      const s = findSeg(t);
      if (!s) { seg = null; v.removeAttribute('src'); v.load(); msg.hidden = false; msg.textContent = 'Ni posnetka za ta čas'; return; }
      msg.hidden = true;
      const off = Math.max(0, t - s.start_ts);
      if (!seg || seg.id !== s.id) {
        seg = s;
        v.src = `/api/recordings/segment/${s.id}`;
        loadingSeek = off;
        await new Promise(r => { v.onloadedmetadata = r; v.onerror = r; });
        if (v.error) { msg.hidden = false; msg.textContent = 'Posnetka ni mogoče predvajati (kodek?)'; return; }
        v.currentTime = loadingSeek; loadingSeek = null;
      } else if (Math.abs(v.currentTime - off) > 0.4) v.currentTime = off;
      v.playbackRate = P.speed;
      if (P.playing) v.play().catch(() => {});
    },
    play() { if (seg) { v.playbackRate = P.speed; v.play().catch(() => {}); } },
    pause() { v.pause(); },
    setRate(r) { v.playbackRate = r; },
    destroy() { v.pause(); v.removeAttribute('src'); v.load(); },
    drift(t) { if (!seg) return findSeg(t) ? 99 : 0; return Math.abs(seg.start_ts + v.currentTime - t); },
    has: t => !!findSeg(t),
  };
  v.addEventListener('ended', () => {
    if (!seg) return;
    const end = seg.end_ts;
    const next = (P.lanes[cam.id]?.server || []).find(s => s.start_ts >= end - 1 && s.id !== seg.id);
    if (next && next.start_ts - end < 3) { self.seek(next.start_ts); }
    else seg = null;
  });
  v.addEventListener('waiting', () => { tile.querySelector('.st').textContent = 'nalaganje …'; });
  v.addEventListener('playing', () => { tile.querySelector('.st').textContent = ''; });
  return self;
}

// ---------- predvajalnik s snemalnika (prek go2rtc) ----------
function recorderPlayer(cam, tile, msg) {
  let player = null, startTs = null, startWall = null;
  const self = {
    ts() { return startTs != null && P.playing ? startTs + (Date.now() - startWall) / 1000 : null; },
    async seek(t) {
      player?.remove(); player = null; startTs = null;
      if (!P.playing) { msg.hidden = false; msg.textContent = `Snemalnik – pritisnite predvajaj (${fmtDateTime(t)})`; self.pendingT = t; return; }
      msg.hidden = false; msg.textContent = 'Povezovanje s snemalnikom …';
      try {
        const r = await post('/api/recordings/playback', { camera: cam.id, ts: Math.floor(t) });
        player = createPlayer(r.stream);
        tile.prepend(player);
        player.addEventListener('state', e => { if (e.detail === 'live') { msg.hidden = true; startTs = t; startWall = Date.now(); } });
        player.start();
      } catch (e) { msg.textContent = e.message; }
    },
    play() { self.seek(self.pendingT ?? P.T); },
    pause() { self.pendingT = self.ts() ?? P.T; player?.remove(); player = null; startTs = null; msg.hidden = false; msg.textContent = 'Ustavljeno'; },
    setRate() {},
    destroy() { player?.remove(); },
    drift() { return 0; },
    has: () => true,
  };
  return self;
}

// ---------- predvajanje ----------
function play() {
  P.playing = true;
  P.lastTick = performance.now();
  for (const p of Object.values(P.players)) { if (P.source === 'recorder') p.pendingT = P.T; p.play(); }
  if (P.source === 'server') for (const p of Object.values(P.players)) p.seek(P.T);
  P.ui.playBtn.replaceChildren(icon('pause', 16));
}
function pause() {
  P.playing = false;
  for (const p of Object.values(P.players)) p.pause();
  P.ui.playBtn.replaceChildren(icon('play', 16));
}
async function seek(t, force = false) {
  P.T = t;
  if (t < P.vs || t > P.ve) { const span = P.ve - P.vs; P.vs = t - span / 2; P.ve = t + span / 2; await loadLanes(); }
  for (const p of Object.values(P.players)) await p.seek(t);
  draw();
  if (P.ui) P.ui.dt.value = toLocalInput(t);
}

function tick() {
  if (!P.ui) return;
  const nowPerf = performance.now();
  const dtS = ((nowPerf - (P.lastTick || nowPerf)) / 1000) * (P.source === 'recorder' ? 1 : P.speed);
  P.lastTick = nowPerf;
  if (P.playing) {
    // glavna ura: prva kamera, ki dejansko predvaja
    const master = P.cams.map(id => P.players[id]?.ts()).find(x => x != null);
    if (master != null) P.T = master;
    else {
      P.T += dtS;
      if (P.source === 'server' && P.skipGaps && !P.cams.some(id => hasRecording(id, P.T))) {
        const nxt = nextRecordingStart(P.T);
        if (nxt && nxt < Date.now() / 1000) { seek(nxt); return; }
      }
      if (P.source === 'server') for (const id of P.cams) { const p = P.players[id]; if (p.has(P.T) && p.drift(P.T) > 2) p.seek(P.T); }
    }
    // sinhronizacija ostalih kamer
    if (P.source === 'server') for (const id of P.cams.slice(1)) { const p = P.players[id]; if (p.has(P.T) && p.drift(P.T) > 1.5) p.seek(P.T); }
    if (P.T > Date.now() / 1000) { pause(); P.T = Date.now() / 1000; toast('Dosegli ste trenutni čas – za živo sliko izberite Živo'); }
    // časovnica sledi kazalcu
    const span = P.ve - P.vs;
    if (P.T > P.ve - span * 0.05) { P.vs = P.T - span * 0.2; P.ve = P.vs + span; reloadSoon(); }
    const l = P.lanes[P.cams[0]];
    if (l && (P.T > l.to - 600)) reloadSoon();
  }
  P.ui.now.textContent = new Date(P.T * 1000).toLocaleString('sl-SI', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  draw();
}

function jumpEvent(dir) {
  const evs = P.cams.flatMap(id => P.lanes[id]?.events || []).map(e => e.ts).sort((a, b) => a - b);
  const t = dir > 0 ? evs.find(x => x > P.T + 1) : [...evs].reverse().find(x => x < P.T - 5);
  if (t) seek(t - 5, true); else toast('V prikazanem obdobju ni več dogodkov', 'warn');
}

// ---------- risanje časovnice ----------
function draw() {
  const c = P.ui?.canvas; if (!c) return;
  const r = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height;
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();
  ctx.clearRect(0, 0, W, H);
  const x = t => ((t - P.vs) / (P.ve - P.vs)) * W;
  const span = P.ve - P.vs;
  // oznake časa
  const steps = [60, 300, 600, 1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400];
  const step = steps.find(s => (W / (span / s)) > 70) || 86400;
  ctx.fillStyle = col('--muted'); ctx.strokeStyle = col('--line'); ctx.font = '11px system-ui'; ctx.lineWidth = 1;
  const tzOff = new Date().getTimezoneOffset() * 60;
  for (let t = Math.ceil((P.vs - tzOff) / step) * step + tzOff; t < P.ve; t += step) {
    const xx = Math.round(x(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(xx, 14); ctx.lineTo(xx, H); ctx.stroke();
    const d = new Date(t * 1000);
    const lbl = step >= 86400 || (d.getHours() === 0 && d.getMinutes() === 0) ? d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric' }) : d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
    ctx.fillText(lbl, xx + 3, 11);
  }
  // izbor za izvoz
  if (P.selIn || P.selOut) {
    const a = x(P.selIn ?? P.vs), b = x(P.selOut ?? P.T);
    ctx.fillStyle = 'rgba(106,168,255,.18)'; ctx.fillRect(Math.min(a, b), 14, Math.abs(b - a), H - 14);
  }
  // pasovi kamer
  const n = P.cams.length, top = 18, laneH = (H - top - 4) / Math.max(1, n);
  P.cams.forEach((id, i) => {
    const l = P.lanes[id]; if (!l) return;
    const y = top + i * laneH, hh = Math.max(6, laneH - 6);
    ctx.fillStyle = col('--panel-2'); ctx.fillRect(0, y, W, hh);
    ctx.fillStyle = '#7d8ea3';
    for (const s of l.recorder || []) ctx.fillRect(x(s.start_ts), y + hh * 0.55, Math.max(1, x(s.end_ts) - x(s.start_ts)), hh * 0.45);
    ctx.fillStyle = col('--accent');
    for (const s of l.server || []) ctx.fillRect(x(s.start_ts), y, Math.max(1, x(s.end_ts) - x(s.start_ts) + 0.5), (l.recorder?.length ? hh * 0.5 : hh));
    ctx.fillStyle = '#b48cf2';
    for (const b of l.bookmarks || []) ctx.fillRect(x(b.start_ts), y, Math.max(2, x(b.end_ts) - x(b.start_ts)), 3);
    for (const e of l.events || []) {
      ctx.fillStyle = e.severity === 'alarm' ? col('--alarm') : ['object', 'zone', 'line', 'loiter'].includes(e.type) ? col('--warn') : e.type === 'motion' ? 'rgba(240,178,62,.55)' : col('--muted');
      const ex = x(e.ts), ew = e.end_ts ? Math.max(2, x(e.end_ts) - ex) : 2;
      ctx.fillRect(ex, y + hh - 4, ew, 4);
    }
    if (n > 1) { ctx.fillStyle = col('--text'); ctx.font = '10.5px system-ui'; ctx.fillText(camById(id)?.name || '', 4, y + 10); }
  });
  // trenutni čas
  const nx = x(Date.now() / 1000);
  if (nx < W) { ctx.fillStyle = 'rgba(128,128,128,.15)'; ctx.fillRect(nx, 14, W - nx, H); }
  const cx = Math.round(x(P.T)) + 0.5;
  ctx.strokeStyle = col('--rec'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, 12); ctx.lineTo(cx, H); ctx.stroke();
  ctx.fillStyle = col('--rec'); ctx.beginPath(); ctx.moveTo(cx - 5, 12); ctx.lineTo(cx + 5, 12); ctx.lineTo(cx, 18); ctx.fill();
}

function bindTimeline(tl) {
  let down = null;
  tl.addEventListener('pointerdown', e => { down = { x: e.clientX, vs: P.vs, ve: P.ve, moved: false }; tl.setPointerCapture(e.pointerId); });
  tl.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.abs(dx) > 4) down.moved = true;
    if (down.moved) { const span = down.ve - down.vs; const dt = (dx / tl.clientWidth) * span; P.vs = down.vs - dt; P.ve = down.ve - dt; draw(); }
  });
  tl.addEventListener('pointerup', e => {
    if (!down) return;
    if (!down.moved) { const r = tl.getBoundingClientRect(); const t = P.vs + ((e.clientX - r.left) / r.width) * (P.ve - P.vs); seek(Math.min(t, Date.now() / 1000), true); }
    else reloadSoon();
    down = null;
  });
  tl.addEventListener('wheel', e => {
    e.preventDefault();
    const r = tl.getBoundingClientRect();
    const t = P.vs + ((e.clientX - r.left) / r.width) * (P.ve - P.vs);
    const f = e.deltaY < 0 ? 0.8 : 1.25;
    const span = Math.max(120, Math.min(14 * 86400, (P.ve - P.vs) * f));
    const k = (t - P.vs) / (P.ve - P.vs);
    P.vs = t - span * k; P.ve = P.vs + span;
    draw(); reloadSoon();
  }, { passive: false });
  tl.tabIndex = 0;
  tl.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') seek(P.T - (e.shiftKey ? 60 : 5), true);
    if (e.key === 'ArrowRight') seek(P.T + (e.shiftKey ? 60 : 5), true);
    if (e.key === ' ') { e.preventDefault(); P.playing ? pause() : play(); }
  });
}

// ---------- izvoz in zaznamki ----------
function rangeDefaults() {
  const a = P.selIn ?? P.T - 30, b = P.selOut ?? Math.max(a + 30, P.T + 30);
  return [Math.min(a, b), Math.max(a, b)];
}
function exportDialog() {
  const [a, b] = rangeDefaults();
  const camSel = select(P.cams.map(id => [id, camById(id).name]), P.cams[0]);
  const from = h('input', { type: 'datetime-local', step: 1, value: toLocalInput(a) });
  const to = h('input', { type: 'datetime-local', step: 1, value: toLocalInput(b) });
  const wm = toggle(true, 'Vodni žig s časom in imenom kamere (počasnejše, ponovno kodiranje)');
  const src = select([['', 'Samodejno'], ['server', 'Strežnik'], ['recorder', 'Snemalnik']], P.source === 'recorder' ? 'recorder' : '');
  modal('Izvoz posnetka', h('div', {},
    h('p', { class: 'muted' }, 'Posnetek se pripravi v ozadju. Ob izvozu se ustvari tudi SHA-256 kontrolna vsota, s katero dokažete, da posnetek ni bil spremenjen.'),
    h('div', { class: 'form-grid' }, field('Kamera', camSel), field('Vir', src), field('Od', from), field('Do', to)), wm), {
    actions: [{ label: 'Prekliči' }, { label: 'Izvozi', kind: 'btn-primary', onClick: async () => {
      const s = fromLocalInput(from.value), e = fromLocalInput(to.value);
      if (e <= s) throw new Error('Konec mora biti za začetkom');
      await post('/api/exports', { camera_id: Number(camSel.value), start_ts: s, end_ts: e, watermark: wm.input.checked, source: src.value || undefined });
      toast('Izvoz se pripravlja – obvestilo prejmete, ko bo končan');
      P.selIn = P.selOut = null; draw();
    } }],
  });
}
function bookmarkDialog() {
  const [a, b] = rangeDefaults();
  const title = h('input', { value: 'Zaznamek' });
  const from = h('input', { type: 'datetime-local', step: 1, value: toLocalInput(a) });
  const to = h('input', { type: 'datetime-local', step: 1, value: toLocalInput(b) });
  const lock = toggle(true, 'Zakleni posnetek (ne bo izbrisan ob izteku roka hrambe)');
  modal('Nov zaznamek', h('div', {}, field('Naziv', title), h('div', { class: 'form-grid' }, field('Od', from), field('Do', to)), lock), {
    actions: [{ label: 'Prekliči' }, { label: 'Shrani zaznamek', kind: 'btn-primary', onClick: async () => {
      for (const id of P.cams) await post('/api/bookmarks', { camera_id: id, title: title.value, start_ts: fromLocalInput(from.value), end_ts: fromLocalInput(to.value), locked: lock.input.checked });
      toast('Zaznamek je shranjen'); loadLanes();
    } }],
  });
}
