// VisionOne View – dogodki, pametno iskanje, statistika, tloris in izvozi
import { h, clear, icon, get, post, del, toast, toastErr, field, select, fmtDateTime, fmtTime, fmtBytes, toLocalInput, fromLocalInput,
  eventTitle, EVENT_TYPES, LABELS, emptyState, modal, confirmDialog } from '../common/core.js';
import { createPlayer } from '../common/player.js';
import { S, camById, eventDetail, refreshUnacked } from './view.js';
import { openPlayback } from './playback.js';

const dayStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.floor(x / 1000); };
const camOptions = (all = 'Vse kamere') => [['', all], ...S.cameras.map(c => [c.id, c.name])];

// ======================= DOGODKI =======================
export function renderEvents(center, opts = {}) {
  const st = { offset: 0, limit: 50 };
  const cam = select(camOptions(), '', { 'aria-label': 'Kamera' });
  const type = select([['', 'Vse vrste'], ...Object.entries(EVENT_TYPES)], '', { 'aria-label': 'Vrsta' });
  const label = select([['', 'Vsi objekti'], ...Object.entries(LABELS)], '', { 'aria-label': 'Objekt' });
  const sev = select([['', 'Vse resnosti'], ['alarm', 'Alarm'], ['warning', 'Opozorilo'], ['info', 'Informacija']], opts.unacked ? 'alarm,warning' : '', { 'aria-label': 'Resnost' });
  const ack = select([['', 'Potrjeni in nepotrjeni'], ['0', 'Samo nepotrjeni'], ['1', 'Samo potrjeni']], opts.unacked ? '0' : '', { 'aria-label': 'Potrditev' });
  const from = h('input', { type: 'datetime-local', value: toLocalInput(dayStart() - 6 * 86400), 'aria-label': 'Od' });
  const to = h('input', { type: 'datetime-local', value: '', 'aria-label': 'Do' });
  const tbody = h('tbody');
  const info = h('span', { class: 'muted' });
  const more = h('button', { class: 'btn btn-sm', onclick: () => { st.offset += st.limit; load(false); } }, 'Naloži več');
  const canOp = ['admin', 'operator'].includes(S.me.role);
  async function load(reset = true) {
    if (reset) { st.offset = 0; clear(tbody); }
    const p = new URLSearchParams({ limit: st.limit, offset: st.offset });
    if (cam.value) p.set('camera', cam.value); if (type.value) p.set('type', type.value); if (label.value) p.set('label', label.value);
    if (sev.value) p.set('severity', sev.value); if (ack.value) p.set('ack', ack.value);
    if (from.value) p.set('from', fromLocalInput(from.value)); if (to.value) p.set('to', fromLocalInput(to.value));
    try {
      const r = await get(`/api/events?${p}`);
      for (const e of r.items) tbody.append(row(e));
      info.textContent = `${r.total} dogodkov`;
      more.hidden = st.offset + st.limit >= r.total;
      if (!r.total) tbody.append(h('tr', {}, h('td', { colspan: 7 }, emptyState('Ni dogodkov', 'Za izbrane filtre ni zadetkov. Razširite časovno obdobje ali odstranite filtre.'))));
    } catch (e) { toastErr(e); }
  }
  function row(e) {
    const tr = h('tr', { style: { cursor: 'pointer' }, onclick: ev => { if (!ev.target.closest('button')) eventDetail(e); } },
      h('td', {}, e.snapshot ? h('img', { src: `/api/events/${e.id}/snapshot`, alt: '', loading: 'lazy', style: { width: '80px', height: '45px', objectFit: 'cover', borderRadius: '4px', display: 'block' } }) : h('span', { class: 'muted' }, '–')),
      h('td', {}, fmtDateTime(e.ts)),
      h('td', {}, e.camera_name || '–'),
      h('td', {}, h('strong', {}, eventTitle(e)), e.zone ? h('div', { class: 'muted' }, e.zone) : null),
      h('td', {}, h('span', { class: `badge ${e.severity === 'alarm' ? 'alarm' : e.severity === 'warning' ? 'warn' : 'info'}` }, { alarm: 'Alarm', warning: 'Opozorilo', info: 'Informacija' }[e.severity] || e.severity)),
      h('td', {}, e.acknowledged ? h('span', { class: 'muted' }, `${e.ack_by}${e.ack_comment ? ': ' + e.ack_comment : ''}`) : '–'),
      h('td', { class: 'actions' },
        e.camera_id ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => openPlayback({ cameras: [e.camera_id], ts: e.ts - 10, autoplay: true }) }, icon('play', 14), 'Predvajaj') : null,
        canOp && !e.acknowledged && e.severity !== 'info' ? h('button', { class: 'btn btn-sm', onclick: async () => { await post(`/api/events/${e.id}/ack`, {}).catch(toastErr); e.acknowledged = 1; e.ack_by = S.me.username; tr.replaceWith(row(e)); refreshUnacked(); } }, 'Potrdi') : null));
    return tr;
  }
  for (const el of [cam, type, label, sev, ack, from, to]) el.addEventListener('change', () => load());
  clear(center, h('div', { class: 'scroll-page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Dogodki in alarmi'), info, h('span', { class: 'spacer' }),
      canOp ? h('button', { class: 'btn', onclick: async () => { if (await confirmDialog('Potrdim vse nepotrjene alarme in opozorila?')) { await post('/api/events/ack-all'); toast('Vsi alarmi so potrjeni'); refreshUnacked(); load(); } } }, icon('check', 16), 'Potrdi vse') : null),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, [cam, type, label, sev, ack, from, to].map(x => { x.style.width = 'auto'; return x; })),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Slika', 'Čas', 'Kamera', 'Dogodek', 'Resnost', 'Potrdil', ''].map(t => h('th', {}, t)))), tbody)),
    h('div', { style: { marginTop: '12px', textAlign: 'center' } }, more)));
  load();
}

// ======================= PAMETNO ISKANJE =======================
// Razume preproste slovenske poizvedbe: "oseba včeraj med 14 in 16", "rdeč avto danes", "pes ponoči na dvorišču"
function parseTime(text) {
  const t = text.toLowerCase();
  let from = null, to = null;
  const now = Date.now() / 1000;
  if (/včeraj|vceraj/.test(t)) { from = dayStart() - 86400; to = dayStart(); }
  else if (/danes/.test(t)) { from = dayStart(); to = now; }
  else if (/teden|7 dni/.test(t)) { from = now - 7 * 86400; to = now; }
  else if (/mesec|30 dni/.test(t)) { from = now - 30 * 86400; to = now; }
  else if (/zadnj\w* ur/.test(t)) { const m = /zadnj\w* (\d+)? ?ur/.exec(t); from = now - (Number(m?.[1]) || 1) * 3600; to = now; }
  const between = /med (\d{1,2})(?:[:.](\d{2}))? in (\d{1,2})(?:[:.](\d{2}))?/.exec(t);
  if (between) {
    const base = from ?? dayStart();
    from = base + Number(between[1]) * 3600 + Number(between[2] || 0) * 60;
    to = base + Number(between[3]) * 3600 + Number(between[4] || 0) * 60;
  }
  let hours = null;
  if (/ponoči|ponoci|noč|noc/.test(t)) hours = [22, 6];
  else if (/zjutraj/.test(t)) hours = [5, 10];
  else if (/popoldne/.test(t)) hours = [12, 18];
  else if (/zvečer|zvecer/.test(t)) hours = [18, 23];
  return { from, to, hours };
}

export function renderSearch(center) {
  const input = h('input', { type: 'search', placeholder: 'Npr. "oseba včeraj med 14 in 16", "avto ponoči", "sabotaža ta teden"', 'aria-label': 'Iskanje' });
  const chipsDef = [['person', 'Osebe'], ['car,truck,bus,motorcycle', 'Vozila'], ['bicycle', 'Kolesa'], ['dog,cat,bird', 'Živali'], ['line', 'Prečkanja linij'], ['zone', 'Vstopi v območja'], ['loiter', 'Zadrževanje'], ['tamper', 'Sabotaže'], ['motion', 'Gibanje']];
  const active = new Set(['person']);
  const chips = h('div', { class: 'chips' }, chipsDef.map(([k, l]) => h('button', { class: 'chip', 'aria-pressed': String(active.has(k)), onclick: e => { active.has(k) ? active.delete(k) : active.add(k); e.currentTarget.setAttribute('aria-pressed', String(active.has(k))); run(); } }, l)));
  const cam = select(camOptions(), '', { 'aria-label': 'Kamera', style: { width: 'auto' }, onchange: () => run() });
  const period = select([['86400', 'Zadnjih 24 ur'], ['604800', 'Zadnjih 7 dni'], ['2592000', 'Zadnjih 30 dni'], ['0', 'Kadarkoli']], '604800', { style: { width: 'auto' }, onchange: () => run() });
  const results = h('div', { class: 'results' });
  const info = h('p', { class: 'muted' });
  async function run() {
    const parsed = parseTime(input.value);
    const p = new URLSearchParams({ limit: 300, snapshot: '1' });
    if (input.value.trim()) p.set('q', input.value.trim());
    const labels = [], types = [];
    for (const k of active) for (const x of k.split(',')) (['line', 'zone', 'loiter', 'tamper', 'motion'].includes(x) ? types : labels).push(x);
    if (labels.length && !/oseb|avt|vozil|pes|psa|mač|mac|kol|tovor|motor|ptic/i.test(input.value)) p.set('label', labels.join(','));
    if (types.length && !labels.length) p.set('type', types.join(','));
    if (cam.value) p.set('camera', cam.value);
    const now = Date.now() / 1000;
    if (parsed.from) { p.set('from', Math.floor(parsed.from)); p.set('to', Math.floor(parsed.to || now)); }
    else if (Number(period.value)) p.set('from', Math.floor(now - Number(period.value)));
    try {
      const r = await get(`/api/events?${p}`);
      let items = r.items;
      if (types.length && labels.length) items = items.filter(e => labels.includes(e.label) || types.includes(e.type));
      if (parsed.hours) { const [a, b] = parsed.hours; items = items.filter(e => { const hr = new Date(e.ts * 1000).getHours(); return a < b ? hr >= a && hr < b : hr >= a || hr < b; }); }
      clear(results);
      info.textContent = items.length ? `Najdenih ${items.length} zadetkov${parsed.from ? ` (${fmtDateTime(parsed.from)} – ${fmtDateTime(parsed.to || now)})` : ''}` : '';
      if (!items.length) results.append(emptyState('Ni zadetkov', 'Poskusite drugo obdobje ali vrsto objekta. Pametno iskanje deluje za kamere z vklopljeno AI analizo.'));
      for (const e of items) results.append(h('div', { class: 'result', tabindex: '0', role: 'button', onclick: () => eventDetail(e), onkeydown: ev => { if (ev.key === 'Enter') eventDetail(e); } },
        h('div', { class: 'img', style: { backgroundImage: `url(/api/events/${e.id}/snapshot)` } }, h('span', { class: 'tag' }, eventTitle(e))),
        h('div', { class: 'info' }, h('strong', {}, e.camera_name || '–'), h('span', {}, `${fmtDateTime(e.ts)}${e.score ? ` · ${Math.round(e.score * 100)} %` : ''}${e.data?.color ? ` · ${e.data.color}` : ''}`))));
    } catch (e) { toastErr(e); }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  clear(center, h('div', { class: 'scroll-page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Pametno iskanje'), h('p', {}, 'Poiščite osebe, vozila in dogodke, ki jih je zaznala umetna inteligenca. Pišite po slovensko.'))),
    h('div', { class: 'searchbox' }, input, h('button', { class: 'btn btn-primary', onclick: run }, icon('search', 16), 'Išči')),
    h('div', { class: 'row', style: { marginBottom: '14px' } }, chips, h('span', { class: 'spacer' }), cam, period),
    info, results));
  input.focus();
  run();
}

// ======================= STATISTIKA =======================
export function renderStats(center) {
  const cam = select(camOptions(), '', { style: { width: 'auto' } });
  const period = select([['today', 'Danes'], ['yesterday', 'Včeraj'], ['7', 'Zadnjih 7 dni'], ['30', 'Zadnjih 30 dni']], 'today', { style: { width: 'auto' } });
  const cards = h('div', { class: 'stat-cards' });
  const chart = h('div', { class: 'panel chart' });
  const lines = h('div', { class: 'panel' });
  async function load() {
    const now = Date.now() / 1000;
    let from, to = now, bucket = 3600;
    if (period.value === 'today') from = dayStart();
    else if (period.value === 'yesterday') { from = dayStart() - 86400; to = dayStart(); }
    else { from = now - Number(period.value) * 86400; bucket = 86400; }
    const p = new URLSearchParams({ from: Math.floor(from), to: Math.floor(to), bucket });
    if (cam.value) p.set('camera', cam.value);
    const r = await get(`/api/events/stats?${p}`).catch(toastErr);
    if (!r) return;
    const totals = {};
    for (const b of r.buckets) totals[b.k] = (totals[b.k] || 0) + b.n;
    const show = [['person', 'Osebe'], ['car', 'Avti'], ['truck', 'Tovornjaki'], ['bicycle', 'Kolesa'], ['dog', 'Psi'], ['motion', 'Gibanja'], ['tamper', 'Sabotaže'], ['camera_offline', 'Izpadi kamer']];
    clear(cards, show.map(([k, l]) => h('div', { class: 'stat-card' }, h('b', {}, totals[k] || 0), h('span', {}, l))));
    drawChart(chart, r, from, to, bucket);
    clear(lines, h('h2', {}, 'Štetje na linijah'), r.lines.length
      ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Linija'), h('th', {}, 'Objekt'), h('th', {}, 'Smer'), h('th', { class: 'num' }, 'Število'))),
        h('tbody', {}, r.lines.map(x => h('tr', {}, h('td', {}, x.zone || '–'), h('td', {}, LABELS[x.label] || x.label || '–'), h('td', {}, x.dir === 'in' ? 'Noter' : x.dir === 'out' ? 'Ven' : '–'), h('td', { class: 'num' }, x.n))))))
      : h('p', { class: 'muted' }, 'Ni prečkanj. Linije za štetje oseb in vozil nastavite v VisionOne Admin pri kameri (Pametne funkcije).'));
  }
  cam.onchange = load; period.onchange = load;
  clear(center, h('div', { class: 'scroll-page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Statistika'), h('span', { class: 'spacer' }), cam, period),
    cards, h('div', { class: 'stack' }, chart, lines)));
  load();
}

function drawChart(el, r, from, to, bucket) {
  const series = [['person', 'Osebe', 'var(--warn)'], ['car', 'Vozila', 'var(--accent)'], ['motion', 'Gibanje', '#7d8ea3']];
  const nb = Math.max(1, Math.ceil((to - from) / bucket));
  const start = Math.floor(from / bucket) * bucket;
  const data = series.map(([k]) => Array.from({ length: nb }, (_, i) => r.buckets.filter(b => b.b === start + i * bucket && (k === 'car' ? ['car', 'truck', 'bus', 'motorcycle'].includes(b.k) : b.k === k)).reduce((a, b) => a + b.n, 0)));
  const max = Math.max(1, ...data.flat());
  const W = 900, H = 260, L = 36, B = 24, T = 10;
  const bw = (W - L - 10) / nb;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Število zaznav po času');
  let s = '';
  for (let i = 0; i <= 4; i++) { const y = T + (H - T - B) * (1 - i / 4); s += `<line class="axis" x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${Math.round(max * i / 4)}</text>`; }
  for (let i = 0; i < nb; i++) {
    const x0 = L + i * bw;
    series.forEach(([, , color], si) => {
      const v = data[si][i]; if (!v) return;
      const hh = ((H - T - B) * v) / max, w = Math.max(1, (bw - 4) / series.length);
      s += `<rect x="${x0 + 2 + si * w}" y="${H - B - hh}" width="${w - 1}" height="${hh}" fill="${color}" rx="1"><title>${v}</title></rect>`;
    });
    const every = Math.ceil(nb / 12);
    if (i % every === 0) { const d = new Date((start + i * bucket) * 1000); s += `<text x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${bucket >= 86400 ? `${d.getDate()}.${d.getMonth() + 1}.` : `${d.getHours()}h`}</text>`; }
  }
  svg.innerHTML = s;
  clear(el, h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, 'Zaznave skozi čas'), h('span', { class: 'spacer' }),
    ...series.map(([, l, c]) => h('span', { class: 'muted', style: { fontSize: '12px' } }, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', background: c, borderRadius: '2px', marginRight: '5px' } }), l))), svg);
}

// ======================= TLORIS =======================
export async function renderMap(center) {
  const maps = await get('/api/maps').catch(() => []);
  if (!maps.length) { clear(center, h('div', { class: 'scroll-page' }, emptyState('Ni tlorisov', S.me.role === 'admin' ? 'Tloris naložite v VisionOne Admin pod Tlorisi in nanj razporedite kamere.' : 'Skrbnik še ni dodal tlorisa.'))); return; }
  let cur = maps[0];
  const sel = select(maps.map(m => [m.id, m.name]), cur.id, { style: { width: 'auto' }, onchange: e => { cur = maps.find(m => m.id == e.target.value); draw(); } });
  const wrap = h('div', { class: 'map-wrap' });
  const draw = () => {
    clear(wrap, h('img', { src: `/api/maps/${cur.id}/image`, alt: cur.name }));
    for (const c of S.cameras.filter(c => c.plan_id === cur.id && c.plan_x != null)) {
      wrap.append(h('button', { class: `map-pin ${c.status === 'offline' ? 'offline' : ''}`, style: { left: `${c.plan_x * 100}%`, top: `${c.plan_y * 100}%` }, title: c.name, 'aria-label': c.name, 'data-cam': c.id, onclick: () => livePopup(c) }, icon('camera', 15)));
    }
  };
  clear(center, h('div', { class: 'scroll-page' }, h('div', { class: 'page-head' }, h('h1', {}, 'Tloris'), sel, h('span', { class: 'muted' }, 'Kliknite kamero za živo sliko.')), wrap));
  draw();
}
export function livePopup(c) {
  const box = h('div', { style: { position: 'relative', aspectRatio: '16/9', background: '#000', borderRadius: '6px', overflow: 'hidden' } });
  const p = createPlayer(`cam_${c.id}`);
  box.append(p);
  modal(c.name, box, { wide: true, onClose: () => p.remove(), actions: [{ label: 'Predvajaj zadnjih 5 minut', onClick: () => openPlayback({ cameras: [c.id], ts: Date.now() / 1000 - 300, autoplay: true }) }, { label: 'Zapri' }] });
  queueMicrotask(() => p.start());
}

// ======================= IZVOZI =======================
export async function renderExports(center) {
  const tbody = h('tbody');
  const load = async () => {
    const rows = await get('/api/exports').catch(toastErr) || [];
    clear(tbody);
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 6 }, emptyState('Ni izvozov', 'Posnetek izvozite v načinu Predvajanje z gumbom Izvozi.'))));
    for (const e of rows) tbody.append(h('tr', {},
      h('td', {}, fmtDateTime(e.created_at)), h('td', {}, e.camera_name || '–'), h('td', {}, `${fmtDateTime(e.start_ts)} – ${fmtTime(e.end_ts)}`),
      h('td', {}, h('span', { class: `badge ${e.status === 'done' ? 'ok' : e.status === 'error' ? 'err' : 'info'}` }, { queued: 'V vrsti', running: 'Pripravljam', done: 'Pripravljen', error: 'Napaka' }[e.status]), e.error ? h('div', { class: 'muted' }, e.error) : null),
      h('td', {}, e.size ? fmtBytes(e.size) : '–', e.sha256 ? h('div', { class: 'mono muted', title: e.sha256 }, `SHA-256 ${e.sha256.slice(0, 16)}…`) : null),
      h('td', { class: 'actions' },
        e.status === 'done' ? h('a', { class: 'btn btn-sm btn-primary', href: `/api/exports/${e.id}/download` }, icon('download', 14), 'MP4') : null, ' ',
        e.status === 'done' ? h('a', { class: 'btn btn-sm', href: `/api/exports/${e.id}/download?sha=1` }, 'Kontrolna vsota') : null, ' ',
        h('button', { class: 'btn btn-sm btn-danger', onclick: async () => { await del(`/api/exports/${e.id}`); load(); } }, 'Izbriši'))));
  };
  clear(center, h('div', { class: 'scroll-page' },
    h('div', { class: 'page-head' }, h('h1', {}, 'Izvozi posnetkov'), h('span', { class: 'spacer' }), h('button', { class: 'btn', onclick: load }, icon('refresh', 16), 'Osveži')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Ustvarjeno', 'Kamera', 'Obdobje', 'Stanje', 'Velikost', ''].map(t => h('th', {}, t)))), tbody))));
  load();
}
