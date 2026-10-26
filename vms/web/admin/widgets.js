// Gradniki za Admin: urnik (7×24), urejevalnik območij in linij, urejevalnik mask zasebnosti
import { h, clear, icon, toast, select, field } from '../common/core.js';

const DAYS = ['Pon', 'Tor', 'Sre', 'Čet', 'Pet', 'Sob', 'Ned'];

// ---------- Urnik ----------
export function scheduleEditor(value) {
  let bits = (value && /^[01]{168}$/.test(value) ? value : '1'.repeat(168)).split('');
  let painting = null;
  const grid = h('div', { class: 'sched', role: 'grid', 'aria-label': 'Tedenski urnik' });
  grid.append(h('span'), ...Array.from({ length: 24 }, (_, i) => h('span', { class: 'sched-h' }, i % 3 === 0 ? String(i) : '')));
  const cells = [];
  DAYS.forEach((d, di) => {
    grid.append(h('span', { class: 'sched-d' }, d));
    for (let hr = 0; hr < 24; hr++) {
      const i = di * 24 + hr;
      const c = h('button', { type: 'button', class: `sched-c ${bits[i] === '1' ? 'on' : ''}`, 'aria-label': `${d} ${hr}:00`, 'aria-pressed': String(bits[i] === '1') });
      const set = v => { bits[i] = v; c.classList.toggle('on', v === '1'); c.setAttribute('aria-pressed', String(v === '1')); };
      c.addEventListener('pointerdown', e => { e.preventDefault(); painting = bits[i] === '1' ? '0' : '1'; set(painting); });
      c.addEventListener('pointerenter', () => { if (painting) set(painting); });
      c.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(bits[i] === '1' ? '0' : '1'); } });
      cells.push({ c, set });
      grid.append(c);
    }
  });
  window.addEventListener('pointerup', () => { painting = null; });
  const preset = (fn) => { for (let i = 0; i < 168; i++) cells[i].set(fn(Math.floor(i / 24), i % 24) ? '1' : '0'); };
  const el = h('div', {},
    h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => preset(() => true) }, 'Ves čas'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => preset((d, hr) => d < 5 && hr >= 7 && hr < 17) }, 'Delovni čas (pon–pet 7–17)'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => preset((d, hr) => d >= 5 || hr < 7 || hr >= 17) }, 'Izven delovnega časa'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => preset((d, hr) => hr >= 20 || hr < 6) }, 'Ponoči (20–6)'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => preset(() => false) }, 'Počisti')),
    grid, h('small', { class: 'hint' }, 'Kliknite ali povlecite čez ure. Obarvane ure so aktivne.'));
  el.value = () => bits.join('');
  return el;
}

// ---------- Urejevalnik območij in linij ----------
// zones: [{id, name, type:'zone'|'line', points:[[x,y]...], classes:[], loiter_seconds, direction:'both'|'in'|'out'}]
export function zoneEditor(snapshotUrl, zones = [], allClasses = []) {
  let list = JSON.parse(JSON.stringify(zones || []));
  let mode = null, draft = [], selected = null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1000 562.5'); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('ze-svg');
  const img = h('img', { src: snapshotUrl, alt: 'Slika kamere', class: 'ze-img', onerror: e => { e.target.replaceWith(h('div', { class: 'ze-img ze-noimg' }, 'Slike ni bilo mogoče pridobiti – območja lahko vseeno narišete.')); } });
  const stage = h('div', { class: 'ze-stage' }, img, svg);
  const side = h('div', { class: 'ze-side' });
  const hint = h('p', { class: 'muted ze-hint' });
  const P = (x, y) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
  const pt = e => { const r = svg.getBoundingClientRect(); return P((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); };
  const NS = t => document.createElementNS('http://www.w3.org/2000/svg', t);
  const colors = { zone: '#f0b23e', line: '#6aa8ff' };

  function draw() {
    svg.replaceChildren();
    for (const z of list) {
      const pts = z.points.map(([x, y]) => `${x * 1000},${y * 562.5}`).join(' ');
      const el = NS(z.type === 'line' ? 'polyline' : 'polygon');
      el.setAttribute('points', pts);
      el.setAttribute('fill', z.type === 'zone' ? 'rgba(240,178,62,.22)' : 'none');
      el.setAttribute('stroke', colors[z.type]); el.setAttribute('stroke-width', selected === z ? 6 : 3);
      el.style.cursor = 'pointer';
      el.addEventListener('click', e => { e.stopPropagation(); selected = z; draw(); renderSide(); });
      svg.append(el);
      if (z.type === 'line' && z.points.length === 2) {
        // puščica smeri "noter" (levo od smeri A→B)
        const [[x1, y1], [x2, y2]] = z.points;
        const mx = (x1 + x2) / 2 * 1000, my = (y1 + y2) / 2 * 562.5;
        const dx = (x2 - x1) * 1000, dy = (y2 - y1) * 562.5, len = Math.hypot(dx, dy) || 1;
        const nx = dy / len, ny = -dx / len;
        const a = NS('line');
        a.setAttribute('x1', mx); a.setAttribute('y1', my); a.setAttribute('x2', mx + nx * 40); a.setAttribute('y2', my + ny * 40);
        a.setAttribute('stroke', colors.line); a.setAttribute('stroke-width', 3); a.setAttribute('marker-end', 'url(#arr)');
        svg.append(a);
      }
      const t = NS('text');
      t.setAttribute('x', z.points[0][0] * 1000 + 6); t.setAttribute('y', z.points[0][1] * 562.5 - 6);
      t.setAttribute('fill', '#fff'); t.setAttribute('font-size', '22'); t.setAttribute('paint-order', 'stroke'); t.setAttribute('stroke', '#000'); t.setAttribute('stroke-width', '4');
      t.textContent = z.name;
      svg.append(t);
    }
    const defs = NS('defs');
    defs.innerHTML = '<marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#6aa8ff"/></marker>';
    svg.append(defs);
    if (draft.length) {
      const el = NS('polyline');
      el.setAttribute('points', draft.map(([x, y]) => `${x * 1000},${y * 562.5}`).join(' '));
      el.setAttribute('fill', 'none'); el.setAttribute('stroke', '#fff'); el.setAttribute('stroke-dasharray', '8 6'); el.setAttribute('stroke-width', 3);
      svg.append(el);
      for (const [x, y] of draft) { const c = NS('circle'); c.setAttribute('cx', x * 1000); c.setAttribute('cy', y * 562.5); c.setAttribute('r', 7); c.setAttribute('fill', '#fff'); svg.append(c); }
    }
  }
  function finish() {
    if (mode === 'zone' && draft.length >= 3) list.push(selected = { id: `z${Date.now()}`, name: `Območje ${list.filter(z => z.type === 'zone').length + 1}`, type: 'zone', points: draft, classes: ['person'], loiter_seconds: 0 });
    if (mode === 'line' && draft.length === 2) list.push(selected = { id: `l${Date.now()}`, name: `Linija ${list.filter(z => z.type === 'line').length + 1}`, type: 'line', points: draft, classes: ['person'], direction: 'both' });
    mode = null; draft = []; hint.textContent = ''; draw(); renderSide();
  }
  svg.addEventListener('click', e => {
    if (!mode) { selected = null; draw(); renderSide(); return; }
    draft.push(pt(e));
    if (mode === 'line' && draft.length === 2) finish(); else draw();
  });
  svg.addEventListener('dblclick', e => { if (mode === 'zone') { e.preventDefault(); draft.pop(); finish(); } });
  function start(m) {
    mode = m; draft = []; selected = null;
    hint.textContent = m === 'zone' ? 'Klikajte oglišča območja. Dvoklik ali Enter zaključi.' : 'Kliknite začetek in konec linije. Puščica kaže smer "noter".';
    draw(); renderSide();
  }
  stage.tabIndex = 0;
  stage.addEventListener('keydown', e => { if (e.key === 'Enter' && mode === 'zone') finish(); if (e.key === 'Escape') { mode = null; draft = []; hint.textContent = ''; draw(); } });

  function renderSide() {
    const items = list.map(z => h('button', { type: 'button', class: `ze-item ${selected === z ? 'sel' : ''}`, onclick: () => { selected = z; draw(); renderSide(); } },
      h('span', { class: 'dot', style: { background: colors[z.type] } }), z.name, h('small', { class: 'muted' }, z.type === 'line' ? ' linija' : ' območje')));
    let form = null;
    if (selected) {
      const z = selected;
      const name = h('input', { value: z.name, oninput: e => { z.name = e.target.value; draw(); } });
      const cls = h('div', { class: 'checks' }, allClasses.map(([k, l]) => h('label', {}, h('input', { type: 'checkbox', checked: (z.classes || []).includes(k), onchange: e => { z.classes = e.target.checked ? [...new Set([...(z.classes || []), k])] : (z.classes || []).filter(x => x !== k); } }), l)));
      form = h('div', { class: 'ze-form' }, field('Ime', name), h('div', { class: 'field' }, h('label', {}, 'Zaznavaj'), cls),
        z.type === 'zone' ? field('Zadrževanje (sekunde, 0 = izklopljeno)', h('input', { type: 'number', min: 0, value: z.loiter_seconds || 0, oninput: e => { z.loiter_seconds = Number(e.target.value); } }), 'Alarm, če se objekt v območju zadržuje dlje od navedenega časa.') : null,
        z.type === 'line' ? field('Smer prečkanja', select([['both', 'Obe smeri'], ['in', 'Samo noter (smer puščice)'], ['out', 'Samo ven']], z.direction || 'both', { onchange: e => { z.direction = e.target.value; } })) : null,
        z.type === 'line' ? h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { z.points.reverse(); draw(); } }, 'Obrni smer') : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => { list = list.filter(x => x !== z); selected = null; draw(); renderSide(); } }, icon('trash', 14), 'Izbriši'));
    }
    clear(side,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: `btn btn-sm ${mode === 'zone' ? 'btn-primary' : ''}`, onclick: () => start('zone') }, icon('plus', 14), 'Območje'),
        h('button', { type: 'button', class: `btn btn-sm ${mode === 'line' ? 'btn-primary' : ''}`, onclick: () => start('line') }, icon('plus', 14), 'Linija')),
      hint, h('div', { class: 'ze-list' }, items.length ? items : h('p', { class: 'muted' }, 'Ni območij. Brez območij se zaznava izvaja na celotni sliki.')), form);
  }
  draw(); renderSide();
  const el = h('div', { class: 'ze' }, stage, side);
  el.value = () => list;
  return el;
}

// ---------- Maske zasebnosti ----------
export function maskEditor(snapshotUrl, masks = []) {
  let list = JSON.parse(JSON.stringify(masks || []));
  const stage = h('div', { class: 'ze-stage me-stage' }, h('img', { src: snapshotUrl, alt: 'Slika kamere', class: 'ze-img', onerror: e => e.target.replaceWith(h('div', { class: 'ze-img ze-noimg' }, 'Ni slike')) }));
  let drag = null;
  const rel = e => { const r = stage.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; };
  function draw() {
    stage.querySelectorAll('.me-mask').forEach(x => x.remove());
    list.forEach((m, i) => stage.append(h('div', { class: 'me-mask', style: { left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` } },
      h('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Odstrani masko', onpointerdown: e => e.stopPropagation(), onclick: () => { list.splice(i, 1); draw(); } }, icon('x', 14)))));
  }
  stage.addEventListener('pointerdown', e => { if (e.target.closest('button')) return; const [x, y] = rel(e); drag = { x, y, el: h('div', { class: 'me-mask' }) }; stage.append(drag.el); stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const [x, y] = rel(e);
    Object.assign(drag.el.style, { left: `${Math.min(x, drag.x) * 100}%`, top: `${Math.min(y, drag.y) * 100}%`, width: `${Math.abs(x - drag.x) * 100}%`, height: `${Math.abs(y - drag.y) * 100}%` });
    drag.cur = [x, y];
  });
  stage.addEventListener('pointerup', () => {
    if (drag?.cur) {
      const [x, y] = drag.cur;
      const m = { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
      if (m.w > 0.01 && m.h > 0.01) list.push(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 1000])));
    }
    drag?.el.remove(); drag = null; draw();
  });
  draw();
  const el = h('div', {}, h('p', { class: 'muted' }, 'Povlecite pravokotnik čez del slike, ki ga operater ne sme videti (npr. sosedova okna). Maske veljajo v živi sliki aplikacije View.'), stage);
  el.value = () => list;
  return el;
}
