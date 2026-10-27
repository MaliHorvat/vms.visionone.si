// Mali DOM + API pripomočki (brez zunanjih knjižnic; skladno s CSP).
export function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
export const clear = (el, ...kids) => { el.replaceChildren(); for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k))); return el; };
export const $ = (s, r = document) => r.querySelector(s);

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/' + path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || ('Napaka ' + r.status));
  return data;
}
export const get = (p) => api(p);
export const post = (p, b = {}) => api(p, { method: 'POST', body: b });
export const put = (p, b = {}) => api(p, { method: 'PUT', body: b });
export const del = (p) => api(p, { method: 'DELETE' });

export function toast(msg, isErr = false) {
  const t = h('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), isErr ? 4500 : 2400);
}

export function dialog(title, bodyNode, actions = []) {
  let back;
  const close = () => back && back.remove();
  const btns = actions.map(a => h('button', {
    class: 'btn ' + (a.kind || ''),
    onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { const r = a.onClick ? await a.onClick() : true; if (r !== false) close(); }
      catch (err) { toast(err.message || String(err), true); }
      finally { e.currentTarget.disabled = false; }
    },
  }, a.label));
  const box = h('div', { class: 'dlg' }, h('h3', {}, title), bodyNode, actions.length ? h('div', { class: 'acts' }, btns) : null);
  back = h('div', { class: 'back', onclick: (e) => { if (e.target === back) close(); } }, box);
  document.body.append(back);
  return { close, box };
}

export function badge(status) {
  const map = { online: ['b-online', 'online'], offline: ['b-offline', 'izpad'], warn: ['b-warn', 'opozorilo'], unknown: ['b-unknown', 'neznano'] };
  const [cls, label] = map[status] || map.unknown;
  return h('span', { class: 'badge ' + cls }, h('span', { class: 'd', style: 'background:currentColor' }), label);
}

export function field(labelText, input, hint) {
  return h('label', { class: 'f' }, h('span', {}, labelText), input, hint ? h('small', { class: 'muted' }, hint) : null);
}

export const fmtDate = (s) => { if (!s) return '–'; const d = new Date(s); return d.toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }); };
export const fmtDay = (s) => { if (!s) return '–'; return new Date(s).toLocaleDateString('sl-SI'); };
export const ago = (s) => {
  if (!s) return 'nikoli';
  const sec = Math.round((Date.now() - new Date(s).getTime()) / 1000);
  if (sec < 60) return 'pravkar'; if (sec < 3600) return Math.round(sec / 60) + ' min'; if (sec < 86400) return Math.round(sec / 3600) + ' h';
  return Math.round(sec / 86400) + ' dni';
};

// Enostaven sparkline iz vrednosti (SVG).
export function sparkline(values, { color = '#2f81f7', height = 46 } = {}) {
  const w = 300, pad = 3;
  const xs = values.length > 1 ? values : [0, ...values];
  const max = Math.max(1, ...xs), min = Math.min(0, ...xs);
  const pts = xs.map((v, i) => {
    const x = pad + (i / (xs.length - 1)) * (w - pad * 2);
    const y = height - pad - ((v - min) / (max - min || 1)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', `0 0 ${w} ${height}`); svg.setAttribute('preserveAspectRatio', 'none');
  const pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pl.setAttribute('points', pts); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', color); pl.setAttribute('stroke-width', '2'); pl.setAttribute('stroke-linejoin', 'round');
  svg.append(pl);
  return svg;
}
