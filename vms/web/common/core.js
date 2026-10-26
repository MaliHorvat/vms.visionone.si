// VisionOne – skupne funkcije za Admin in View (brez zunanjih knjižnic)

// ---------- DOM ----------
export function h(tag, attrs = {}, ...children) {
  const el = tag === 'frag' ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs && tag !== 'frag') {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export function clear(el, ...children) { el.replaceChildren(); for (const c of children.flat()) if (c) el.append(c); return el; }

// ---------- Ikone (lastne, preproste črte) ----------
const ICONS = {
  camera: 'M3 7h11v10H3zM14 10l7-3v10l-7-3',
  grid: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  play: 'M7 4l13 8-13 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0',
  search: 'M10 17a7 7 0 110-14 7 7 0 010 14zM15 15l6 6',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L5 8.5 3 8 2 11l2 1v0l-2 1 1 3 2-.5L6.5 16 6 18l3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z',
  disk: 'M4 5h16v14H4zM4 13h16M8 16h.01',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  users: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a6 6 0 0114 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-5',
  rule: 'M4 6h10M4 12h16M4 18h7M17 4l3 2-3 2M14 16l3 2-3 2',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  radar: 'M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 12m-5 0a5 5 0 1010 0 5 5 0 10-10 0M12 12l6-6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  refresh: 'M20 11a8 8 0 10-2 6M20 4v7h-7',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  logout: 'M15 4h4v16h-4M10 16l-4-4 4-4M6 12h11',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  snap: 'M4 7h4l2-3h4l2 3h4v12H4zM12 17a4 4 0 100-8 4 4 0 000 8z',
  mic: 'M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3',
  rec: 'M12 12m-6 0a6 6 0 1012 0 6 6 0 10-12 0',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 018 0v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  shield: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z',
  home: 'M4 11l8-7 8 7v9H4z',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  key: 'M14 10a4 4 0 10-4 4l-6 6v-3h3v-3h3',
  link: 'M10 14a4 4 0 005.5.5l3-3a4 4 0 00-5.5-5.5l-1 1M14 10a4 4 0 00-5.5-.5l-3 3a4 4 0 005.5 5.5l1-1',
  zoomin: 'M10 17a7 7 0 110-14 7 7 0 010 14zM15 15l6 6M7 10h6M10 7v6',
  zoomout: 'M10 17a7 7 0 110-14 7 7 0 010 14zM15 15l6 6M7 10h6',
  home2: 'M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0',
  up: 'M12 5l-7 8h14z', down: 'M12 19l-7-8h14z', left: 'M5 12l8-7v14z', right: 'M19 12l-8-7v14z',
  sun: 'M12 12m-4 0a4 4 0 108 0 4 4 0 10-8 0M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  moon: 'M20 14A8 8 0 0110 4a8 8 0 1010 10z',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  volume: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 010 6M19.5 6.5a8 8 0 010 11',
  tour: 'M4 12a8 8 0 0114-5M20 12a8 8 0 01-14 5M18 3v4h-4M6 21v-4h4',
  chip: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.classList.add('ico');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || ICONS.camera);
  if (['play', 'up', 'down', 'left', 'right', 'rec'].includes(name)) p.setAttribute('fill', 'currentColor');
  s.append(p);
  return s;
}

// ---------- API ----------
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  if (r.status === 401 && window.__v1ready && !path.startsWith('/api/auth/')) { window.dispatchEvent(new Event('v1-unauthorized')); throw new ApiError(401, 'Prijava je potrebna'); }
  if (raw) return r;
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, data?.error || `Napaka ${r.status}`);
  return data;
}
export const get = p => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = p => api(p, { method: 'DELETE' });

// ---------- Oblikovanje ----------
const dtf = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tf = new Intl.DateTimeFormat('sl-SI', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const df = new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' });
export const fmtDateTime = ts => (ts ? dtf.format(new Date(ts * 1000)) : '–');
export const fmtTime = ts => (ts ? tf.format(new Date(ts * 1000)) : '–');
export const fmtDate = ts => (ts ? df.format(new Date(ts * 1000)) : '–');
export function fmtBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  return `${b.toFixed(b < 10 && i ? 1 : 0)} ${u[i]}`;
}
export function fmtAgo(ts) {
  if (!ts) return '–';
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'pravkar';
  if (s < 3600) return `pred ${Math.floor(s / 60)} min`;
  if (s < 86400) return `pred ${Math.floor(s / 3600)} h`;
  return `pred ${Math.floor(s / 86400)} dnevi`;
}
export function fmtDuration(s) {
  s = Math.floor(s);
  const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), mm = Math.floor((s % 3600) / 60);
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}
// datetime-local <-> unix
export const toLocalInput = ts => { const d = new Date(ts * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = v => Math.floor(new Date(v).getTime() / 1000);

export const EVENT_TYPES = {
  motion: 'Gibanje', object: 'Zaznan objekt', zone: 'Vstop v območje', line: 'Prečkanje linije', loiter: 'Zadrževanje',
  tamper: 'Sabotaža kamere', camera_offline: 'Kamera brez povezave', camera_online: 'Kamera spet povezana',
  recorder_offline: 'Snemalnik brez povezave', disk: 'Opozorilo diska', system: 'Sistem', manual: 'Ročni alarm', input: 'Alarmni vhod',
};
export const LABELS = { person: 'Oseba', car: 'Avto', truck: 'Tovornjak', bus: 'Avtobus', motorcycle: 'Motor', bicycle: 'Kolo', dog: 'Pes', cat: 'Mačka', bird: 'Ptica' };
export const eventTitle = e => (e.label ? `${LABELS[e.label] || e.label}` : EVENT_TYPES[e.type] || e.type) + (e.type === 'line' ? ' prečkal linijo' : e.type === 'zone' ? ' v območju' : e.type === 'loiter' ? ' se zadržuje' : '');

// ---------- Obvestila ----------
let toastBox;
export function toast(msg, kind = 'ok', ms = 3500) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h('div', { class: `toast toast-${kind}` }, msg);
  toastBox.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}
export const toastErr = e => toast(e?.message || String(e), 'err', 6000);

// ---------- Modalna okna ----------
export function modal(title, body, { actions = [], wide = false, onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = e => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: `modal ${wide ? 'modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'btn-icon', onclick: close, 'aria-label': 'Zapri' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? h('footer', {}, actions.map(a => h('button', { class: `btn ${a.kind || ''}`, onclick: async ev => {
      const btn = ev.currentTarget; btn.disabled = true;
      try { const r = await a.onClick?.(close); if (r !== false && a.close !== false) close(); }
      catch (e) { toastErr(e); }
      finally { btn.disabled = false; }
    } }, a.label))) : null);
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  document.addEventListener('keydown', esc);
  setTimeout(() => box.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
  return { close, box };
}
export function confirmDialog(msg, { ok = 'Potrdi', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    modal('Potrditev', h('p', {}, msg), {
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Prekliči', onClick: () => { done = true; resolve(false); } },
        { label: ok, kind: danger ? 'btn-danger' : 'btn-primary', onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}
export function promptDialog(title, label, value = '') {
  return new Promise(resolve => {
    const inp = h('input', { value });
    let done = false;
    modal(title, field(label, inp), {
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Prekliči' }, { label: 'Shrani', kind: 'btn-primary', onClick: () => { done = true; resolve(inp.value); } }],
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; resolve(inp.value); inp.closest('.modal-back').remove(); } });
  });
}

// ---------- Obrazci ----------
export function field(label, input, hint) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
}
export function select(options, value, attrs = {}) {
  const s = h('select', attrs);
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o.value, o.label];
    s.append(h('option', { value: v ?? '', selected: String(v ?? '') === String(value ?? '') }, l));
  }
  return s;
}
export function toggle(checked, label) {
  const inp = h('input', { type: 'checkbox', checked: !!checked });
  const el = h('label', { class: 'toggle' }, inp, h('span', { class: 'track' }), h('span', {}, label));
  el.input = inp;
  return el;
}
// Zberi vrednosti obrazca: elementi z atributom name
export function formData(root) {
  const out = {};
  for (const el of root.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

// ---------- Prijava ----------
export async function ensureLogin(appTitle, subtitle) {
  try { const me = await get('/api/auth/me'); window.__v1ready = true; return me; } catch (e) { if (e.status !== 401) throw e; }
  return new Promise(resolve => {
    const user = h('input', { name: 'username', autocomplete: 'username', required: true });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const totp = h('input', { name: 'totp', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-mestna koda' });
    const totpField = field('Koda iz aplikacije za preverjanje', totp);
    totpField.hidden = true;
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'login-card', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      try {
        const r = await post('/api/auth/login', { username: user.value, password: pass.value, totp: totp.value || undefined });
        if (r.need_totp) { totpField.hidden = false; totp.focus(); return; }
        screen.remove();
        window.__v1ready = true;
        resolve(await get('/api/auth/me'));
      } catch (ex) { err.textContent = ex.message; }
    } },
      h('div', { class: 'login-brand' }, h('span', { class: 'brand-mark' }), h('div', {}, h('strong', {}, appTitle), h('span', {}, subtitle))),
      field('Uporabniško ime', user), field('Geslo', pass), totpField, err,
      h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Prijava'));
    const screen = h('div', { class: 'login-screen' }, form);
    document.body.append(screen);
    user.focus();
  });
}
window.addEventListener('v1-unauthorized', () => { if (!document.querySelector('.login-screen')) location.reload(); });

export async function logout() { await post('/api/auth/logout'); location.reload(); }

// ---------- Dogodki v živo (SSE) ----------
export function liveEvents(handlers) {
  let es;
  const connect = () => {
    es = new EventSource('/api/stream');
    for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, e => { try { fn(JSON.parse(e.data)); } catch (x) { console.error(x); } });
    es.onerror = () => { es.close(); setTimeout(connect, 4000); };
  };
  connect();
  return () => es?.close();
}

// ---------- Tema ----------
export function initTheme(key) {
  const saved = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
}
export function toggleTheme(key) {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(key, next); } catch {}
}
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// Zakasnitev (debounce)
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', {}, title), text ? h('p', {}, text) : null, action || null);
}
