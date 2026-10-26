// VisionOne View – živa slika, predvajanje, dogodki, pametno iskanje, statistika, tloris
import { h, $, clear, icon, get, post, put, del, toast, toastErr, modal, confirmDialog, promptDialog, field, select, ensureLogin, logout,
  liveEvents, fmtTime, fmtDateTime, eventTitle, toggleTheme, store, EVENT_TYPES } from '../common/core.js';
import { createPlayer } from '../common/player.js';
import { renderPlayback, openPlayback, togglePlaybackCamera } from './playback.js';
import { renderEvents, renderSearch, renderStats, renderMap, renderExports } from './pages.js';
import { renderEsp32, leaveEsp32 } from './esp32.js';

export const S = {
  me: null, cameras: [], groups: [], layouts: [],
  mode: 'live', grid: store.get('v1-grid', 4), cells: store.get('v1-cells', []), selected: 0,
  maximized: null, tour: null, unacked: 0, feed: [],
};
export const camById = id => S.cameras.find(c => c.id === Number(id));

const MODES = [
  ['live', 'Živo', 'grid'], ['playback', 'Predvajanje', 'film'], ['events', 'Dogodki', 'bell'],
  ['search', 'Pametno iskanje', 'search'], ['stats', 'Statistika', 'chart'], ['map', 'Tloris', 'map'], ['exports', 'Izvozi', 'download'],
  ['esp32', 'ESP32', 'chip'],
];
const GRIDS = { 1: [1, 1], 4: [2, 2], 6: [3, 3, 'big'], 9: [3, 3], 12: [4, 3], 16: [4, 4], 25: [5, 5], 36: [6, 6] };

let root, body, center, leftPane, rightPane, modeBtns = {};

async function boot() {
  S.me = await ensureLogin('VisionOne View', 'Pregled in upravljanje');
  document.title = `${S.me.system_name || 'VisionOne'} – View`;
  await loadData();
  if (!S.cells.some(Boolean)) { S.cells = S.cameras.slice(0, S.grid).map(c => c.id); }
  S.cells = S.cells.map(id => (id && camById(id) ? id : null));
  buildShell();
  liveEvents({
    event: onLiveEvent,
    camera_status: d => { const c = camById(d.id); if (c) { c.status = d.status; refreshTileStatus(d.id); renderTree(); } },
    export: d => { if (d.status === 'done') toast('Izvoz je pripravljen – najdete ga pod Izvozi'); if (d.status === 'error') toast(`Izvoz ni uspel: ${d.error}`, 'err'); },
  });
  setInterval(() => { const c = $('.v-clock'); if (c) c.textContent = new Date().toLocaleString('sl-SI', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); }, 1000);
  refreshUnacked();
  const hash = location.hash.slice(1);
  setMode(MODES.some(m => m[0] === hash) ? hash : 'live');
}

export async function loadData() {
  [S.cameras, S.groups, S.layouts] = await Promise.all([get('/api/cameras'), get('/api/groups'), get('/api/layouts')]);
  S.cameras = S.cameras.filter(c => c.enabled);
}

function buildShell() {
  const isAdmin = S.me.role === 'admin';
  const canOperate = ['admin', 'operator'].includes(S.me.role);
  const modes = h('nav', { class: 'v-modes', 'aria-label': 'Načini' }, MODES.filter(m => canOperate || !['exports', 'esp32'].includes(m[0])).map(([id, label, ic]) => {
    const b = h('button', { 'aria-pressed': 'false', onclick: () => setMode(id), title: label }, icon(ic), h('span', {}, label));
    modeBtns[id] = b;
    return b;
  }));
  const alarmBtn = h('button', { class: 'btn-icon alarm-btn', title: 'Nepotrjeni alarmi', onclick: () => setMode('events', { unacked: true }) }, icon('bell'), h('span', { class: 'n', hidden: true }));
  const top = h('header', { class: 'v-top' },
    h('button', { class: 'btn-icon menu-btn', 'aria-label': 'Kamere', onclick: () => leftPane.classList.toggle('open') }, icon('list')),
    h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', { class: 'txt' }, S.me.system_name || 'VisionOne')),
    modes,
    h('div', { class: 'right' },
      h('span', { class: 'v-clock' }),
      alarmBtn,
      h('button', { class: 'btn-icon', title: 'Svetla / temna tema', onclick: () => toggleTheme('v1-theme-view') }, icon('sun')),
      isAdmin ? h('a', { class: 'btn-icon', href: '/admin/', title: 'VisionOne Admin' }, icon('settings')) : null,
      h('button', { class: 'btn-icon', title: `Odjava (${S.me.username})`, onclick: logout }, icon('logout'))));
  leftPane = h('aside', { class: 'v-left' });
  center = h('main', { class: 'v-center' });
  rightPane = h('aside', { class: 'v-right' });
  body = h('div', { class: 'v-body' }, leftPane, center, rightPane);
  root = h('div', { class: 'v-app' }, top, body);
  clear($('#app'), root);
  renderTree();
  renderFeed();
}

export function setMode(mode, opts = {}) {
  stopLive();
  if (S.mode === 'esp32' && mode !== 'esp32') leaveEsp32();
  S.mode = mode;
  for (const [id, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', id === mode ? 'true' : 'false');
  history.replaceState(null, '', `#${mode}`);
  const showLeft = ['live', 'playback'].includes(mode);
  const showRight = mode === 'live' && store.get('v1-feed', true);
  body.classList.toggle('no-left', !showLeft);
  body.classList.toggle('no-right', !showRight);
  clear(center);
  if (mode === 'live') renderLive();
  else if (mode === 'playback') renderPlayback(center, opts);
  else if (mode === 'events') renderEvents(center, opts);
  else if (mode === 'search') renderSearch(center, opts);
  else if (mode === 'stats') renderStats(center);
  else if (mode === 'map') renderMap(center);
  else if (mode === 'exports') renderExports(center);
  else if (mode === 'esp32') renderEsp32(center);
}
export { openPlayback };

// ======================= DREVO KAMER =======================
function renderTree() {
  const filter = $('.v-left .search')?.value?.toLowerCase() || '';
  const search = $('.v-left .search') || h('input', { class: 'search', type: 'search', placeholder: 'Išči kamero', 'aria-label': 'Išči kamero', oninput: () => renderTree() });
  const inView = new Set(S.cells.filter(Boolean));
  const groups = [...S.groups, { id: null, name: 'Brez skupine' }];
  const list = h('div', { class: 'pane-scroll' });
  for (const g of groups) {
    const cams = S.cameras.filter(c => (c.group_id ?? null) === g.id && c.name.toLowerCase().includes(filter));
    if (!cams.length) continue;
    const det = h('details', { class: 'tree-group', open: true }, h('summary', {}, g.name, h('span', { class: 'muted', style: { fontWeight: 400 } }, ` ${cams.length}`)));
    for (const c of cams) {
      const item = h('div', {
        class: `cam-item ${inView.has(c.id) ? 'in-view' : ''}`, draggable: 'true', tabindex: '0', role: 'button', title: 'Povlecite v okno ali kliknite',
        ondragstart: e => e.dataTransfer.setData('text/camera', String(c.id)),
        onclick: () => cameraClicked(c.id),
        onkeydown: e => { if (e.key === 'Enter') cameraClicked(c.id); },
      }, h('span', { class: `dot ${c.status === 'online' ? 'ok' : c.status === 'offline' ? 'alarm' : ''}` }), h('span', { class: 'nm' }, c.name),
        c.recording ? h('span', { class: 'rec', title: 'Snemanje na strežnik' }) : null,
        c.ptz ? h('span', { class: 'muted', style: { fontSize: '11px' } }, 'PTZ') : null);
      det.append(item);
    }
    list.append(det);
  }
  if (!S.cameras.length) list.append(h('p', { class: 'muted', style: { padding: '12px' } }, S.me.role === 'admin' ? 'Ni kamer. Dodajte jih v VisionOne Admin.' : 'Nimate dodeljenih kamer.'));
  clear(leftPane, h('div', { class: 'pane-head' }, h('h3', {}, 'Kamere')), search, list);
  if (filter) { search.focus(); }
}

function cameraClicked(id) {
  leftPane.classList.remove('open');
  if (S.mode === 'playback') { togglePlaybackCamera(id); return; }
  if (S.mode !== 'live') setMode('live');
  // v izbrano okno ali prvo prosto
  let idx = S.cells.findIndex((c, i) => i < S.grid && !c);
  if (S.selected != null && S.selected < S.grid) idx = S.selected;
  if (idx < 0) idx = 0;
  placeCamera(idx, id);
  S.selected = (idx + 1) % S.grid;
  highlightSelected();
}

// ======================= ŽIVA SLIKA =======================
let wall, tiles = [], tourTimer = null;

function stopLive() {
  for (const t of tiles) t.destroy?.();
  tiles = [];
  clearInterval(tourTimer); tourTimer = null;
}

function layoutGlyph(n) {
  const [c, r, big] = GRIDS[n];
  const g = h('span', { class: 'layout-glyph', style: { gridTemplateColumns: `repeat(${c},1fr)`, gridTemplateRows: `repeat(${r},1fr)` } });
  const count = big ? 6 : c * r;
  for (let i = 0; i < count; i++) g.append(h('i', big && i === 0 ? { style: { gridColumn: 'span 2', gridRow: 'span 2' } } : {}));
  return g;
}

function renderLive() {
  const layoutSel = select([['', 'Shranjeni pogledi …'], ...S.layouts.map(l => [l.id, l.name + (l.user_id ? '' : ' (skupni)')])], '', { 'aria-label': 'Shranjeni pogledi', onchange: e => { if (e.target.value) applyLayout(S.layouts.find(l => l.id == e.target.value)); } });
  const bar = h('div', { class: 'grid-bar' },
    h('div', { class: 'layout-btns', role: 'group', 'aria-label': 'Razporeditev' }, Object.keys(GRIDS).map(n =>
      h('button', { 'aria-pressed': String(Number(n) === S.grid), title: `${n} oken`, onclick: () => { S.grid = Number(n); S.maximized = null; persist(); renderLive(); } }, layoutGlyph(Number(n))))),
    h('span', { class: 'sep' }),
    layoutSel,
    h('button', { class: 'btn btn-sm', onclick: saveLayout }, 'Shrani pogled'),
    h('button', { class: `btn-icon ${S.tour ? 'active' : ''}`, title: 'Samodejno kroženje pogledov', onclick: toggleTour }, icon('tour')),
    h('span', { class: 'spacer', style: { flex: 1 } }),
    h('button', { class: 'btn-icon', title: 'Počisti vsa okna', onclick: () => { S.cells = []; persist(); renderLive(); } }, icon('trash')),
    h('button', { class: `btn-icon ${store.get('v1-feed', true) ? 'active' : ''}`, title: 'Dogodki v živo', onclick: e => { store.set('v1-feed', !store.get('v1-feed', true)); setMode('live'); } }, icon('bell')),
    h('button', { class: 'btn-icon', title: 'Celozaslonski način', onclick: () => document.fullscreenElement ? document.exitFullscreen() : wall.requestFullscreen() }, icon('full')));
  stopLive();
  wall = h('div', { class: 'wall' });
  const n = S.maximized != null ? 1 : S.grid;
  const [cols, rows, big] = S.maximized != null ? [1, 1] : GRIDS[S.grid];
  wall.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
  wall.style.gridTemplateRows = `repeat(${rows}, minmax(0,1fr))`;
  for (let i = 0; i < n; i++) {
    const idx = S.maximized != null ? S.maximized : i;
    const t = makeTile(idx, S.cells[idx], { hq: S.maximized != null || S.grid <= 1 || (big && i === 0), big: big && i === 0 });
    tiles.push(t);
    wall.append(t.el);
  }
  clear(center, bar, wall);
  highlightSelected();
  if (S.tour) startTour();
}

function persist() { store.set('v1-grid', S.grid); store.set('v1-cells', S.cells); }

function placeCamera(idx, camId) {
  // prepreči podvajanje iste kamere v mreži
  const prev = S.cells.indexOf(camId);
  if (prev >= 0 && prev !== idx && prev < S.grid) S.cells[prev] = S.cells[idx] || null;
  S.cells[idx] = camId;
  persist();
  if (S.mode === 'live') renderLive();
  renderTree();
}

function highlightSelected() {
  tiles.forEach(t => t.el.classList.toggle('selected', t.idx === S.selected));
}

function makeTile(idx, camId, { hq, big }) {
  const cam = camId ? camById(camId) : null;
  const el = h('div', { class: `tile ${big ? 'big' : ''}`, tabindex: '0', 'aria-label': cam ? cam.name : `Prazno okno ${idx + 1}` });
  const t = { el, idx, camId, destroy() { player?.remove(); clearInterval(statusTimer); } };
  let player = null, statusTimer = null;
  el.addEventListener('click', () => { S.selected = idx; highlightSelected(); });
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drop'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', e => {
    e.preventDefault(); el.classList.remove('drop');
    const id = Number(e.dataTransfer.getData('text/camera'));
    const fromTile = e.dataTransfer.getData('text/tile');
    if (fromTile !== '') { const a = Number(fromTile); [S.cells[a], S.cells[idx]] = [S.cells[idx] || null, S.cells[a] || null]; persist(); renderLive(); return; }
    if (id) placeCamera(idx, id);
  });
  if (!cam) {
    el.append(h('div', { class: 'empty-slot' }, 'Povlecite kamero sem'));
    return t;
  }
  el.draggable = true;
  el.addEventListener('dragstart', e => { if (e.target === el) e.dataTransfer.setData('text/tile', String(idx)); });
  el.addEventListener('dblclick', () => { S.maximized = S.maximized == null ? idx : null; renderLive(); });

  // zoom plast (digitalni zoom in premik)
  const zl = h('div', { class: 'zoom-layer' });
  const stream = `cam_${cam.id}${hq ? '' : '_sub'}`;
  player = createPlayer(stream);
  zl.append(player);
  for (const m of cam.masks || []) zl.append(h('div', { class: 'mask', style: { left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` } }));
  const msg = h('div', { class: 'ov-msg' }, cam.status === 'offline' ? 'Kamera ni dosegljiva' : 'Povezovanje …');
  const st = h('span', { class: 'st' });
  const top = h('div', { class: 'ov-top' }, cam.recording ? h('span', { class: 'recdot', title: 'Snemanje' }) : null, h('span', { class: 'nm' }, cam.name), st);
  player.addEventListener('state', e => {
    msg.hidden = e.detail === 'live';
    if (e.detail === 'reconnect') { msg.hidden = false; msg.textContent = 'Ponovno povezovanje …'; }
  });
  const updateStatus = () => { st.textContent = new Date().toLocaleTimeString('sl-SI'); };
  updateStatus(); statusTimer = setInterval(updateStatus, 1000);

  let zoom = 1, ox = 0, oy = 0;
  const zoomBadge = h('span', { class: 'zoom-badge', hidden: true });
  const applyZoom = () => {
    zoom = Math.max(1, Math.min(8, zoom));
    const w = el.clientWidth, hgt = el.clientHeight;
    ox = Math.min(0, Math.max(w - w * zoom, ox)); oy = Math.min(0, Math.max(hgt - hgt * zoom, oy));
    zl.style.transform = `translate(${ox}px, ${oy}px) scale(${zoom})`;
    zoomBadge.hidden = zoom === 1; zoomBadge.textContent = `${zoom.toFixed(1)}×`;
  };
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const nz = Math.max(1, Math.min(8, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    ox = mx - (mx - ox) * (nz / zoom); oy = my - (my - oy) * (nz / zoom); zoom = nz;
    applyZoom();
  }, { passive: false });
  let drag = null;
  el.addEventListener('pointerdown', e => { if (zoom > 1 && e.button === 0 && !e.target.closest('button,select')) { drag = { x: e.clientX - ox, y: e.clientY - oy }; el.setPointerCapture(e.pointerId); } });
  el.addEventListener('pointermove', e => { if (drag) { ox = e.clientX - drag.x; oy = e.clientY - drag.y; applyZoom(); } });
  el.addEventListener('pointerup', () => { drag = null; });

  const canOp = ['admin', 'operator'].includes(S.me.role);
  let ptzEl = null, audioOn = false, micOn = false;
  const restart = (opts) => { player.remove(); player = createPlayer(stream, opts); zl.prepend(player); player.addEventListener('state', e => { msg.hidden = e.detail === 'live'; }); player.start(); };
  const tools = h('div', { class: 'ov-tools' },
    h('button', { class: 'btn-icon', title: 'Posnetek zaslona', onclick: e => { e.stopPropagation(); snapshotTile(player, cam); } }, icon('snap', 16)),
    h('button', { class: 'btn-icon', title: 'Takojšnje predvajanje (zadnjih 30 s)', onclick: e => { e.stopPropagation(); openPlayback({ cameras: [cam.id], ts: Date.now() / 1000 - 30, autoplay: true }); } }, icon('film', 16)),
    cam.audio ? h('button', { class: 'btn-icon', title: 'Zvok', onclick: e => { e.stopPropagation(); audioOn = !audioOn; e.currentTarget.classList.toggle('active', audioOn); restart({ audio: audioOn }); setTimeout(() => { if (player.video) player.video.muted = !audioOn; }, 50); } }, icon('volume', 16)) : null,
    cam.two_way_audio && canOp ? h('button', { class: 'btn-icon', title: 'Govori (dvosmerni zvok – potrebuje HTTPS in WebRTC)', onclick: e => { e.stopPropagation(); micOn = !micOn; e.currentTarget.classList.toggle('active', micOn); restart({ audio: true, mic: micOn }); } }, icon('mic', 16)) : null,
    cam.ptz && canOp ? h('button', { class: 'btn-icon', title: 'PTZ krmiljenje', onclick: e => { e.stopPropagation(); if (ptzEl) { ptzEl.forEach(x => x.remove()); ptzEl = null; e.currentTarget.classList.remove('active'); } else { ptzEl = ptzPanel(cam); el.append(...ptzEl); e.currentTarget.classList.add('active'); } } }, icon('radar', 16)) : null,
    canOp ? h('button', { class: 'btn-icon', title: 'Ročni alarm', onclick: async e => { e.stopPropagation(); if (await confirmDialog(`Sprožim ročni alarm za kamero "${cam.name}"?`, { ok: 'Sproži alarm', danger: true })) { await post('/api/events', { type: 'manual', camera_id: cam.id, severity: 'alarm' }).catch(toastErr); toast('Alarm je zabeležen'); } } }, icon('shield', 16)) : null,
    h('button', { class: 'btn-icon', title: S.maximized != null ? 'Nazaj na mrežo' : 'Povečaj', onclick: e => { e.stopPropagation(); S.maximized = S.maximized == null ? idx : null; renderLive(); } }, icon('full', 16)),
    h('button', { class: 'btn-icon', title: 'Odstrani iz okna', onclick: e => { e.stopPropagation(); S.cells[idx] = null; persist(); renderLive(); renderTree(); } }, icon('x', 16)));
  el.append(zl, msg, top, tools, zoomBadge);
  queueMicrotask(() => player.start());
  t.flash = () => { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); };
  t.showBox = (bbox, label) => {
    if (!bbox) return;
    const b = h('div', { class: 'ai-box', style: { left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`, width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%` } }, h('span', {}, label));
    zl.append(b);
    setTimeout(() => { b.style.opacity = 0; setTimeout(() => b.remove(), 700); }, 2500);
  };
  t.setStatus = s => { if (s === 'offline') { msg.hidden = false; msg.textContent = 'Kamera ni dosegljiva'; } };
  return t;
}

function refreshTileStatus(camId) {
  const c = camById(camId);
  for (const t of tiles) if (t.camId === camId) t.setStatus?.(c.status);
}

function snapshotTile(player, cam) {
  const v = player.video;
  if (!v || !v.videoWidth) { window.open(`/api/cameras/${cam.id}/snapshot?hq=1`, '_blank'); return; }
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(v, 0, 0);
  ctx.font = `${Math.round(c.height / 30)}px sans-serif`; ctx.fillStyle = 'rgba(0,0,0,.5)';
  const label = `${cam.name}  ${new Date().toLocaleString('sl-SI')}`;
  ctx.fillRect(0, 0, ctx.measureText(label).width + 24, c.height / 22);
  ctx.fillStyle = '#fff'; ctx.fillText(label, 12, c.height / 30);
  c.toBlob(b => {
    const a = h('a', { href: URL.createObjectURL(b), download: `${cam.name.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg` });
    a.click();
  }, 'image/jpeg', 0.92);
}

function ptzPanel(cam) {
  const cmd = body => post(`/api/cameras/${cam.id}/ptz`, body).catch(toastErr);
  const speed = () => Number(sp.value);
  const hold = (x, y, zoom) => ({
    onpointerdown: e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); cmd({ action: 'move', x: x * speed(), y: y * speed(), zoom: zoom * speed() }); },
    onpointerup: e => { e.stopPropagation(); cmd({ action: 'stop' }); },
    onclick: e => e.stopPropagation(),
  });
  const pad = h('div', { class: 'ptz', onclick: e => e.stopPropagation(), ondblclick: e => e.stopPropagation() },
    h('button', { ...hold(-1, 1, 0), 'aria-label': 'Levo gor' }, '↖'), h('button', { ...hold(0, 1, 0), 'aria-label': 'Gor' }, icon('up', 14)), h('button', { ...hold(1, 1, 0), 'aria-label': 'Desno gor' }, '↗'),
    h('button', { ...hold(-1, 0, 0), 'aria-label': 'Levo' }, icon('left', 14)), h('button', { onclick: e => { e.stopPropagation(); cmd({ action: 'home' }); }, 'aria-label': 'Domači položaj', title: 'Domači položaj' }, icon('home2', 14)), h('button', { ...hold(1, 0, 0), 'aria-label': 'Desno' }, icon('right', 14)),
    h('button', { ...hold(-1, -1, 0), 'aria-label': 'Levo dol' }, '↙'), h('button', { ...hold(0, -1, 0), 'aria-label': 'Dol' }, icon('down', 14)), h('button', { ...hold(1, -1, 0), 'aria-label': 'Desno dol' }, '↘'));
  const sp = h('input', { type: 'range', min: 0.1, max: 1, step: 0.1, value: 0.5, 'aria-label': 'Hitrost', title: 'Hitrost', style: { width: '90px' }, onclick: e => e.stopPropagation() });
  const presets = h('select', { 'aria-label': 'Prednastavljeni položaji', onclick: e => e.stopPropagation(), onchange: e => { if (e.target.value) cmd({ action: 'goto', preset: e.target.value }); } }, h('option', { value: '' }, 'Položaji …'));
  post(`/api/cameras/${cam.id}/ptz`, { action: 'presets' }).then(list => { for (const p of list || []) presets.append(h('option', { value: p.token }, p.name)); }).catch(() => {});
  const extra = h('div', { class: 'ptz-extra', onclick: e => e.stopPropagation(), ondblclick: e => e.stopPropagation() },
    h('div', { class: 'zr' }, h('button', { ...hold(0, 0, 1), title: 'Približaj' }, icon('zoomin', 14)), h('button', { ...hold(0, 0, -1), title: 'Oddalji' }, icon('zoomout', 14))),
    sp, presets,
    h('button', { onclick: async e => { e.stopPropagation(); const n = await promptDialog('Shrani položaj', 'Ime položaja', 'Vhod'); if (n) { await cmd({ action: 'set_preset', name: n }); toast('Položaj je shranjen'); } } }, 'Shrani položaj'));
  return [pad, extra];
}

async function saveLayout() {
  const name = await promptDialog('Shrani pogled', 'Ime pogleda', 'Moj pogled');
  if (!name) return;
  const shared = ['admin', 'operator'].includes(S.me.role) && await confirmDialog('Naj bo pogled na voljo vsem uporabnikom?', { ok: 'Da, skupen pogled' });
  try {
    await post('/api/layouts', { name, grid: S.grid, cells: S.cells.slice(0, S.grid), shared });
    S.layouts = await get('/api/layouts');
    toast('Pogled je shranjen');
    renderLive();
  } catch (e) { toastErr(e); }
}
function applyLayout(l) {
  if (!l) return;
  S.grid = GRIDS[l.grid] ? l.grid : 4; S.cells = [...l.cells]; S.maximized = null;
  persist(); renderLive(); renderTree();
}
function toggleTour() {
  if (S.tour) { S.tour = null; clearInterval(tourTimer); renderLive(); return; }
  if (S.layouts.length < 2 && S.cameras.length <= S.grid) { toast('Za kroženje potrebujete vsaj dva shranjena pogleda ali več kamer, kot je oken', 'warn'); return; }
  S.tour = { i: 0 };
  renderLive();
}
function startTour() {
  clearInterval(tourTimer);
  const secs = 15;
  tourTimer = setInterval(() => {
    if (S.layouts.length >= 2) { S.tour.i = (S.tour.i + 1) % S.layouts.length; const l = S.layouts[S.tour.i]; S.grid = l.grid; S.cells = [...l.cells]; }
    else { const ids = S.cameras.map(c => c.id); const start = (S.tour.i = (S.tour.i + S.grid) % ids.length); S.cells = Array.from({ length: S.grid }, (_, k) => ids[(start + k) % ids.length]); }
    const tour = S.tour; renderLive(); S.tour = tour;
  }, secs * 1000);
}

// ======================= DOGODKI V ŽIVO =======================
function renderFeed() {
  const list = h('div', { class: 'pane-scroll', id: 'feed' });
  clear(rightPane, h('div', { class: 'pane-head' }, h('h3', {}, 'Dogodki v živo'), h('button', { class: 'btn btn-sm btn-ghost', onclick: () => setMode('events') }, 'Vsi')), list);
  get('/api/events?limit=40').then(r => { S.feed = r.items; for (const e of r.items) list.append(feedItem(e)); if (!r.items.length) list.append(h('p', { class: 'muted', style: { padding: '12px' } }, 'Ni dogodkov.')); }).catch(() => {});
}
function feedItem(e, isNew) {
  const cam = camById(e.camera_id);
  return h('div', { class: `feed-item ${e.severity} ${isNew ? 'new' : ''}`, tabindex: '0', role: 'button', onclick: () => eventDetail(e) },
    h('div', { class: 'th', style: e.snapshot ? { backgroundImage: `url(/api/events/${e.id}/snapshot)` } : {} }, e.snapshot ? null : icon(e.type === 'camera_offline' ? 'camera' : 'bell')),
    h('div', {}, h('div', { class: 't' }, eventTitle(e)), h('div', { class: 'm' }, `${cam?.name || e.camera_name || 'Sistem'} · ${fmtTime(e.ts)}`), e.acknowledged ? h('div', { class: 'ack' }, `Potrdil ${e.ack_by}`) : null));
}

function onLiveEvent(e) {
  const list = $('#feed');
  if (list) { list.querySelector('p.muted')?.remove(); list.prepend(feedItem(e, true)); while (list.children.length > 80) list.lastChild.remove(); }
  for (const t of tiles) if (t.camId === e.camera_id) { t.flash?.(); if (e.data?.bbox) t.showBox(e.data.bbox, eventTitle(e)); }
  if (e.severity !== 'info') refreshUnacked();
  if (e.data?.popup) alarmPopup(e);
  if (e.data?.sound || e.severity === 'alarm') beep();
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch {}
}

async function refreshUnacked() {
  try {
    const r = await get('/api/events?ack=0&severity=alarm,warning&limit=1');
    S.unacked = r.total;
    const n = $('.alarm-btn .n');
    if (n) { n.hidden = !r.total; n.textContent = r.total > 99 ? '99+' : r.total; }
  } catch {}
}
export { refreshUnacked };

let popupOpen = null;
function alarmPopup(e) {
  popupOpen?.close();
  const cam = camById(e.camera_id);
  const live = h('div', { class: 'live' });
  let p = null;
  if (cam) { p = createPlayer(`cam_${cam.id}`); live.append(p); }
  const comment = h('input', { placeholder: 'Komentar (neobvezno)' });
  const body = h('div', { class: 'alarm-pop' }, live,
    h('div', { class: 'meta' }, h('span', { class: `badge ${e.severity === 'alarm' ? 'alarm' : 'warn'}` }, eventTitle(e)), h('span', {}, cam?.name || 'Sistem'), h('span', { class: 'muted' }, fmtDateTime(e.ts)), e.data?.rules?.length ? h('span', { class: 'muted' }, `Pravilo: ${e.data.rules.join(', ')}`) : null),
    e.snapshot ? h('img', { src: `/api/events/${e.id}/snapshot`, alt: 'Slika dogodka', style: { maxWidth: '220px', borderRadius: '6px', marginBottom: '10px' } }) : null,
    field('Komentar ob potrditvi', comment));
  popupOpen = modal('Alarm', body, {
    wide: true, onClose: () => { p?.remove(); popupOpen = null; },
    actions: [
      { label: 'Predvajaj posnetek', onClick: () => openPlayback({ cameras: [e.camera_id], ts: e.ts - 10, autoplay: true }) },
      ['admin', 'operator'].includes(S.me.role) ? { label: 'Potrdi alarm', kind: 'btn-primary', onClick: async () => { await post(`/api/events/${e.id}/ack`, { comment: comment.value }); refreshUnacked(); toast('Alarm je potrjen'); } } : { label: 'Zapri' },
    ],
  });
  if (p) queueMicrotask(() => p.start());
}

export function eventDetail(e) {
  const cam = camById(e.camera_id);
  const comment = h('input', { placeholder: 'Komentar (neobvezno)' });
  const canAck = ['admin', 'operator'].includes(S.me.role) && !e.acknowledged && e.severity !== 'info';
  const data = e.data || {};
  modal(eventTitle(e), h('div', {},
    e.snapshot ? h('img', { src: `/api/events/${e.id}/snapshot`, alt: 'Slika dogodka', style: { width: '100%', borderRadius: '6px', marginBottom: '12px', background: '#000' } }) : null,
    h('table', {}, h('tbody', {},
      h('tr', {}, h('th', {}, 'Kamera'), h('td', {}, cam?.name || e.camera_name || '–')),
      h('tr', {}, h('th', {}, 'Čas'), h('td', {}, fmtDateTime(e.ts))),
      h('tr', {}, h('th', {}, 'Vrsta'), h('td', {}, EVENT_TYPES[e.type] || e.type)),
      e.label ? h('tr', {}, h('th', {}, 'Objekt'), h('td', {}, `${eventTitle({ label: e.label })}${e.score ? ` (${Math.round(e.score * 100)} %)` : ''}`)) : null,
      e.zone ? h('tr', {}, h('th', {}, 'Območje / linija'), h('td', {}, e.zone + (data.direction ? ` – smer ${data.direction === 'in' ? 'noter' : 'ven'}` : ''))) : null,
      data.dwell ? h('tr', {}, h('th', {}, 'Zadrževanje'), h('td', {}, `${Math.round(data.dwell)} s`)) : null,
      data.color ? h('tr', {}, h('th', {}, 'Barva'), h('td', {}, data.color)) : null,
      data.detail || data.message ? h('tr', {}, h('th', {}, 'Podrobnosti'), h('td', {}, data.detail || data.message)) : null,
      e.acknowledged ? h('tr', {}, h('th', {}, 'Potrjeno'), h('td', {}, `${e.ack_by}, ${fmtDateTime(e.ack_at)}${e.ack_comment ? ` – ${e.ack_comment}` : ''}`)) : null)),
    canAck ? h('div', { style: { marginTop: '12px' } }, field('Komentar ob potrditvi', comment)) : null), {
    actions: [
      e.camera_id ? { label: 'Predvajaj posnetek', onClick: () => openPlayback({ cameras: [e.camera_id], ts: e.ts - 10, autoplay: true }) } : null,
      canAck ? { label: 'Potrdi', kind: 'btn-primary', onClick: async () => { await post(`/api/events/${e.id}/ack`, { comment: comment.value }); e.acknowledged = 1; refreshUnacked(); toast('Dogodek je potrjen'); } } : { label: 'Zapri' },
    ].filter(Boolean),
  });
}

boot().catch(e => { document.body.textContent = `Napaka pri zagonu: ${e.message}`; });
