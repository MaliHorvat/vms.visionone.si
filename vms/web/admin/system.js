// VisionOne Admin – pravila, tlorisi, uporabniki, integracije, revizijska sled, sistem
import { h, clear, icon, get, post, put, del, toast, toastErr, modal, confirmDialog, field, select, toggle, formData, fmtDateTime, fmtAgo, emptyState, EVENT_TYPES, LABELS, debounce } from '../common/core.js';
import qrcode from '../common/qrcode.mjs';
import { A, go, pageHead, loadCommon } from './admin.js';
import { scheduleEditor } from './widgets.js';

const ROLE = { admin: 'Skrbnik', operator: 'Operater', viewer: 'Opazovalec' };
const ROLE_DESC = { admin: 'Vse nastavitve, naprave in uporabniki.', operator: 'Živa slika, PTZ, predvajanje, izvoz in potrjevanje alarmov.', viewer: 'Samo živa slika in predvajanje dodeljenih kamer.' };

function checkList(items, chosen = []) {
  const set = new Set(chosen.map(String));
  const el = h('div', { class: 'checks' }, items.map(([v, l]) => h('label', {}, h('input', { type: 'checkbox', value: v, checked: set.has(String(v)) }), l)));
  el.value = () => [...el.querySelectorAll('input:checked')].map(i => i.value);
  return el;
}

// ======================= PRAVILA =======================
const ACTIONS = {
  severity: 'Nastavi resnost', popup: 'Pojavno okno v View', sound: 'Zvočni signal v View', ntfy: 'Push obvestilo na telefon (ntfy)',
  webhook: 'Pokliči spletni naslov (webhook)', mqtt: 'Objavi na MQTT / Home Assistant', lock: 'Zakleni posnetek', ptz_preset: 'Premakni PTZ kamero na položaj',
};

export async function pageRules(page) {
  await loadCommon();
  const rules = await get('/api/rules');
  const camName = id => A.cameras.find(c => c.id === Number(id))?.name || id;
  const desc = r => {
    const t = r.trigger;
    const parts = [];
    parts.push(t.types?.length ? t.types.map(x => EVENT_TYPES[x] || x).join(', ') : 'Vsi dogodki');
    if (t.labels?.length) parts.push(t.labels.map(x => LABELS[x] || x).join(', '));
    if (t.cameras?.length) parts.push(`kamere: ${t.cameras.map(camName).join(', ')}`);
    if (t.schedule && t.schedule.includes('0')) parts.push('po urniku');
    return parts.join(' · ');
  };
  clear(page,
    pageHead('Pravila in alarmi', 'Kaj naj se zgodi ob dogodku: alarm, obvestilo na telefon, Home Assistant, zaklep posnetka, premik PTZ.',
      h('button', { class: 'btn btn-primary', onclick: () => editRule() }, icon('plus', 16), 'Novo pravilo')),
    rules.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Pravilo', 'Sproži ob', 'Dejanja', 'Zadnjič', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rules.map(r => h('tr', {},
        h('td', { class: 'name-cell' }, h('strong', {}, r.name), r.enabled ? null : h('small', {}, 'izklopljeno')),
        h('td', {}, desc(r)),
        h('td', {}, r.actions.map(a => h('span', { class: 'badge plain', style: { margin: '2px' } }, a.type === 'severity' ? `Resnost: ${{ alarm: 'alarm', warning: 'opozorilo', info: 'info' }[a.value]}` : ACTIONS[a.type]))),
        h('td', {}, r.last_fired ? fmtAgo(r.last_fired) : '–'),
        h('td', { class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => editRule(r) }, 'Uredi'), ' ',
          h('button', { class: 'btn-icon', 'aria-label': 'Izbriši', onclick: async () => { if (await confirmDialog(`Izbrišem pravilo "${r.name}"?`, { danger: true, ok: 'Izbriši' })) { await del(`/api/rules/${r.id}`); go('rules'); } } }, icon('trash', 16))))))))
      : h('div', { class: 'panel' }, emptyState('Ni pravil', 'Primer: "Oseba na dvorišču ponoči" → alarm, pojavno okno v View in obvestilo na telefon.', h('button', { class: 'btn btn-primary', onclick: () => editRule({ name: 'Oseba ponoči', enabled: 1, cooldown_seconds: 60, trigger: { types: ['object', 'zone', 'line'], labels: ['person'], schedule: Array.from({ length: 168 }, (_, i) => (i % 24 >= 20 || i % 24 < 6 ? '1' : '0')).join('') }, actions: [{ type: 'severity', value: 'alarm' }, { type: 'popup' }, { type: 'sound' }] }) }, 'Ustvari primer pravila'))));
}

function editRule(r = { name: '', enabled: 1, cooldown_seconds: 30, trigger: {}, actions: [{ type: 'severity', value: 'alarm' }, { type: 'popup' }] }) {
  const t = r.trigger || {};
  const types = checkList(Object.entries(EVENT_TYPES), t.types || []);
  const labels = checkList(Object.entries(LABELS), t.labels || []);
  const cams = checkList(A.cameras.map(c => [c.id, c.name]), t.cameras || []);
  const zones = h('input', { value: (t.zones || []).join(', '), placeholder: 'npr. Vhod, Dvorišče' });
  const minScore = h('input', { type: 'number', step: 0.05, min: 0, max: 1, value: t.min_score || '' });
  const sched = scheduleEditor(t.schedule);
  const name = h('input', { value: r.name, required: true });
  const enabled = toggle(r.enabled, 'Pravilo je vklopljeno');
  const cooldown = h('input', { type: 'number', min: 0, value: r.cooldown_seconds ?? 30 });
  let actions = JSON.parse(JSON.stringify(r.actions || []));
  const actBox = h('div');
  const renderActs = () => clear(actBox, actions.map((a, i) => {
    const set = (k, v) => { a[k] = v; };
    const extra = {
      severity: () => select([['alarm', 'Alarm'], ['warning', 'Opozorilo'], ['info', 'Informacija']], a.value || 'alarm', { onchange: e => set('value', e.target.value), style: { width: 'auto' } }),
      ntfy: () => h('div', { class: 'row' }, h('input', { placeholder: 'Tema (npr. visionone-hisa-a7k3)', value: a.topic || '', oninput: e => set('topic', e.target.value), style: { flex: 1 } }), h('input', { placeholder: 'Strežnik (privzeto https://ntfy.sh)', value: a.server || '', oninput: e => set('server', e.target.value), style: { flex: 1 } })),
      webhook: () => h('input', { placeholder: 'https://…', value: a.url || '', oninput: e => set('url', e.target.value) }),
      mqtt: () => h('input', { placeholder: 'Tema (prazno = visionone/rules/<ime>)', value: a.topic || '', oninput: e => set('topic', e.target.value) }),
      lock: () => h('div', { class: 'row' }, 'Pred dogodkom', h('input', { type: 'number', value: a.before ?? 30, style: { width: '80px' }, oninput: e => set('before', Number(e.target.value)) }), 's, po dogodku', h('input', { type: 'number', value: a.after ?? 60, style: { width: '80px' }, oninput: e => set('after', Number(e.target.value)) }), 's'),
      ptz_preset: () => h('div', { class: 'row' }, select([['', 'Kamera dogodka'], ...A.cameras.filter(c => c.ptz).map(c => [c.id, c.name])], a.camera_id || '', { onchange: e => set('camera_id', e.target.value ? Number(e.target.value) : null), style: { width: 'auto' } }), h('input', { placeholder: 'Št. položaja', value: a.preset || '', oninput: e => set('preset', e.target.value), style: { width: '120px' } })),
    }[a.type];
    return h('div', { class: 'svc' }, h('strong', { style: { minWidth: '210px' } }, ACTIONS[a.type]), h('div', { style: { flex: 1 } }, extra ? extra() : null),
      h('button', { class: 'btn-icon', type: 'button', 'aria-label': 'Odstrani dejanje', onclick: () => { actions.splice(i, 1); renderActs(); } }, icon('x', 16)));
  }), h('div', { class: 'row', style: { marginTop: '8px' } }, select([['', 'Dodaj dejanje …'], ...Object.entries(ACTIONS)], '', { style: { width: 'auto' }, onchange: e => { if (e.target.value) { actions.push({ type: e.target.value }); renderActs(); } } })));
  renderActs();
  modal(r.id ? `Pravilo: ${r.name}` : 'Novo pravilo', h('div', {},
    h('div', { class: 'form-grid' }, field('Ime pravila', name), field('Premor med ponovitvami (s)', cooldown, 'Prepreči množico obvestil za isti dogodek.')), enabled,
    h('fieldset', {}, h('legend', {}, 'Sproži ob'),
      h('div', { class: 'field' }, h('label', {}, 'Vrsta dogodka (prazno = vse)'), types),
      h('div', { class: 'field' }, h('label', {}, 'Objekt (prazno = vsi)'), labels),
      h('div', { class: 'field' }, h('label', {}, 'Kamere (prazno = vse)'), cams),
      h('div', { class: 'form-grid' }, field('Samo območja / linije z imenom', zones), field('Najmanjša zanesljivost AI', minScore))),
    h('fieldset', {}, h('legend', {}, 'Kdaj je pravilo aktivno'), sched),
    h('fieldset', {}, h('legend', {}, 'Dejanja'), actBox,
      h('small', { class: 'hint' }, 'Za ntfy si na telefon namestite aplikacijo ntfy in se naročite na izbrano temo. Izberite dolgo, težko uganljivo ime teme.'))), {
    wide: true,
    actions: [{ label: 'Prekliči' }, { label: 'Shrani pravilo', kind: 'btn-primary', onClick: async () => {
      if (!name.value) throw new Error('Vpišite ime pravila');
      const body = {
        name: name.value, enabled: enabled.input.checked ? 1 : 0, cooldown_seconds: Number(cooldown.value) || 0,
        trigger: { types: types.value(), labels: labels.value(), cameras: cams.value().map(Number), zones: zones.value.split(',').map(s => s.trim()).filter(Boolean), min_score: Number(minScore.value) || undefined, schedule: sched.value() },
        actions,
      };
      if (r.id) await put(`/api/rules/${r.id}`, body); else await post('/api/rules', body);
      toast('Pravilo je shranjeno'); go('rules');
    } }],
  });
}

// ======================= TLORISI =======================
export async function pageMaps(page) {
  await loadCommon();
  const maps = await get('/api/maps');
  let cur = maps[0];
  const canvas = h('div', { class: 'map-canvas' });
  const list = h('div', { class: 'map-list' });
  const upload = () => {
    const name = h('input', { value: 'Pritličje' });
    const file = h('input', { type: 'file', accept: 'image/*' });
    modal('Nov tloris', h('div', {}, field('Ime', name), field('Slika tlorisa (PNG, JPG, SVG)', file)), {
      actions: [{ label: 'Prekliči' }, { label: 'Naloži', kind: 'btn-primary', onClick: async () => {
        const f = file.files[0]; if (!f) throw new Error('Izberite sliko');
        if (f.size > 15e6) throw new Error('Slika je prevelika (največ 15 MB)');
        const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
        await post('/api/maps', { name: name.value, image: dataUrl }); toast('Tloris je dodan'); go('maps');
      } }],
    });
  };
  const draw = () => {
    if (!cur) return;
    clear(canvas, h('img', { src: `/api/maps/${cur.id}/image`, alt: cur.name, draggable: false }));
    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.ondrop = async e => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/camera')); if (!id) return;
      const r = canvas.getBoundingClientRect();
      await put(`/api/cameras/${id}`, { plan_id: cur.id, plan_x: (e.clientX - r.left) / r.width, plan_y: (e.clientY - r.top) / r.height });
      await loadCommon(); draw();
    };
    for (const c of A.cameras.filter(c => c.plan_id === cur.id && c.plan_x != null)) {
      const pin = h('div', { class: 'map-pin', style: { left: `${c.plan_x * 100}%`, top: `${c.plan_y * 100}%` }, title: c.name }, icon('camera', 15), h('span', {}, c.name));
      let drag = false;
      pin.addEventListener('pointerdown', e => { drag = true; pin.setPointerCapture(e.pointerId); });
      pin.addEventListener('pointermove', e => { if (!drag) return; const r = canvas.getBoundingClientRect(); pin.style.left = `${((e.clientX - r.left) / r.width) * 100}%`; pin.style.top = `${((e.clientY - r.top) / r.height) * 100}%`; });
      pin.addEventListener('pointerup', async e => {
        drag = false; const r = canvas.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        if (x < 0 || y < 0 || x > 1 || y > 1) await put(`/api/cameras/${c.id}`, { plan_id: null, plan_x: null, plan_y: null });
        else await put(`/api/cameras/${c.id}`, { plan_x: x, plan_y: y });
        await loadCommon(); draw();
      });
      canvas.append(pin);
    }
    clear(list, h('h3', {}, 'Kamere'), h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Povlecite kamero na tloris. Za odstranitev jo povlecite izven slike.'),
      A.cameras.map(c => h('div', { class: 'cam-item', draggable: 'true', ondragstart: e => e.dataTransfer.setData('text/camera', String(c.id)) }, icon('camera', 15), c.name, c.plan_id === cur.id ? h('span', { class: 'muted' }, ' ✓') : null)));
  };
  clear(page,
    pageHead('Tlorisi', 'Razporedite kamere na tloris objekta. Operater v View klikne kamero na tlorisu za živo sliko.',
      maps.length ? select(maps.map(m => [m.id, m.name]), cur?.id, { style: { width: 'auto' }, onchange: e => { cur = maps.find(m => m.id == e.target.value); draw(); } }) : null,
      cur ? h('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmDialog(`Izbrišem tloris "${cur.name}"?`, { danger: true, ok: 'Izbriši' })) { await del(`/api/maps/${cur.id}`); go('maps'); } } }, 'Izbriši tloris') : null,
      h('button', { class: 'btn btn-primary', onclick: upload }, icon('plus', 16), 'Nov tloris')),
    cur ? h('div', { class: 'map-editor' }, h('div', {}, canvas), list) : h('div', { class: 'panel' }, emptyState('Ni tlorisov', 'Naložite sliko tlorisa (npr. izvoz iz arhitekturnega načrta ali fotografijo skice).', h('button', { class: 'btn btn-primary', onclick: upload }, 'Naloži tloris'))));
  draw();
}

// ======================= UPORABNIKI =======================
export async function pageUsers(page) {
  await loadCommon();
  const users = await get('/api/users');
  clear(page,
    pageHead('Uporabniki', 'Vloge in dostop do kamer.', h('button', { class: 'btn btn-primary', onclick: () => editUser() }, icon('plus', 16), 'Nov uporabnik')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Uporabnik', 'Vloga', 'Kamere', '2FA', 'Zadnja prijava', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, users.map(u => h('tr', {},
        h('td', { class: 'name-cell' }, h('strong', {}, u.username), h('small', {}, [u.full_name, u.email].filter(Boolean).join(' · ')), u.enabled ? null : h('span', { class: 'badge' }, 'Onemogočen')),
        h('td', {}, ROLE[u.role]),
        h('td', {}, u.role === 'admin' || u.all_cameras ? 'Vse' : `${u.cameras.length} kamer`),
        h('td', {}, u.totp_enabled ? h('span', { class: 'badge ok' }, 'Vklopljena') : h('span', { class: 'muted' }, 'ne')),
        h('td', {}, u.last_login ? fmtDateTime(u.last_login) : '–'),
        h('td', { class: 'actions' }, h('button', { class: 'btn btn-sm', onclick: () => editUser(u) }, 'Uredi'), ' ',
          u.id !== A.me.id ? h('button', { class: 'btn-icon', 'aria-label': 'Izbriši', onclick: async () => { if (await confirmDialog(`Izbrišem uporabnika "${u.username}"?`, { danger: true, ok: 'Izbriši' })) { await del(`/api/users/${u.id}`); go('users'); } } }, icon('trash', 16)) : null)))))));
}

function editUser(u = null) {
  const f = h('form', { autocomplete: 'off' }, h('div', { class: 'form-grid' },
    field('Uporabniško ime', h('input', { name: 'username', value: u?.username || '', disabled: !!u })),
    field('Ime in priimek', h('input', { name: 'full_name', value: u?.full_name || '' })),
    field('E-pošta', h('input', { name: 'email', type: 'email', value: u?.email || '' })),
    field(u ? 'Novo geslo (prazno = nespremenjeno)' : 'Geslo (vsaj 8 znakov)', h('input', { name: 'password', type: 'password', autocomplete: 'new-password' }))));
  const role = h('div', { class: 'choice' }, Object.entries(ROLE).map(([k, l]) => h('label', {}, h('input', { type: 'radio', name: 'role', value: k, checked: (u?.role || 'operator') === k }), h('strong', {}, l), h('small', {}, ROLE_DESC[k]))));
  const all = toggle(u ? u.all_cameras : 1, 'Dostop do vseh kamer');
  const cams = checkList(A.cameras.map(c => [c.id, c.name]), u?.cameras || []);
  const camsWrap = h('div', { hidden: !!(u ? u.all_cameras : 1) }, cams);
  all.input.onchange = () => { camsWrap.hidden = all.input.checked; };
  const enabled = toggle(u ? u.enabled : 1, 'Račun je omogočen');
  const reset2fa = u?.totp_enabled ? toggle(false, 'Ponastavi dvofaktorsko prijavo') : null;
  modal(u ? `Uporabnik: ${u.username}` : 'Nov uporabnik', h('div', {}, f, h('h3', {}, 'Vloga'), role, all, camsWrap, enabled, reset2fa), {
    wide: true,
    actions: [{ label: 'Prekliči' }, { label: 'Shrani', kind: 'btn-primary', onClick: async () => {
      const d = formData(f);
      const body = { ...d, role: role.querySelector('input:checked').value, all_cameras: all.input.checked ? 1 : 0, cameras: cams.value().map(Number), enabled: enabled.input.checked ? 1 : 0, reset_totp: reset2fa?.input.checked };
      if (!body.password) delete body.password;
      if (u) await put(`/api/users/${u.id}`, body); else await post('/api/users', body);
      toast('Uporabnik je shranjen'); go('users');
    } }],
  });
}

// ======================= INTEGRACIJE =======================
export async function pageIntegrations(page) {
  const [s, tokens, ai] = await Promise.all([get('/api/settings'), get('/api/tokens'), get('/api/ai/status')]);
  const m = s.mqtt || {};
  const f = h('form', {},
    toggle(m.enabled, 'Pošiljaj dogodke na MQTT strežnik'),
    h('div', { class: 'form-grid' },
      field('Strežnik (IP Home Assistanta)', h('input', { name: 'host', value: m.host || '', placeholder: '192.168.1.10' })),
      field('Vrata', h('input', { name: 'port', type: 'number', value: m.port || 1883 })),
      field('Uporabniško ime', h('input', { name: 'username', value: m.username || '', autocomplete: 'off' })),
      field('Geslo', h('input', { name: 'password', type: 'password', value: m.password || '', autocomplete: 'new-password' })),
      field('Osnovna tema', h('input', { name: 'topic', value: m.topic || 'visionone' }))),
    toggle(m.ha_discovery !== false, 'Samodejno dodaj senzorje v Home Assistant (MQTT discovery)'),
    toggle(m.tls, 'Šifrirana povezava (TLS)'));
  const [en, disc, tls] = f.querySelectorAll('.toggle input');
  en.name = 'enabled'; disc.name = 'ha_discovery'; tls.name = 'tls';
  const tokRows = h('tbody', {}, tokens.map(t => h('tr', {}, h('td', {}, t.name), h('td', {}, ROLE[t.role]), h('td', {}, fmtDateTime(t.created_at)), h('td', {}, t.last_used ? fmtAgo(t.last_used) : 'nikoli'),
    h('td', { class: 'actions' }, h('button', { class: 'btn-icon', 'aria-label': 'Prekliči žeton', onclick: async () => { if (await confirmDialog(`Prekličem žeton "${t.name}"? Naprave, ki ga uporabljajo, ne bodo več imele dostopa.`, { danger: true, ok: 'Prekliči žeton' })) { await del(`/api/tokens/${t.id}`); go('integrations'); } } }, icon('trash', 16))))));
  clear(page,
    pageHead('Integracije', 'Home Assistant, VisionOne Field, AI modul in druge povezave.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Home Assistant (MQTT)'),
        h('p', { class: 'muted' }, 'VisionOne v Home Assistant samodejno doda senzorje za vsako kamero: gibanje, oseba, vozilo, povezava, sabotaža in zadnji dogodek. Tako lahko npr. ob osebi na dvorišču prižgete luči.'),
        h('p', {}, 'Stanje: ', s.mqtt_status.connected ? h('span', { class: 'badge ok' }, 'povezano') : s.mqtt_status.error ? h('span', { class: 'badge err' }, s.mqtt_status.error) : h('span', { class: 'badge' }, 'izklopljeno')),
        f, h('button', { class: 'btn btn-primary', onclick: async () => { const d = formData(f); d.enabled = !!d.enabled; d.ha_discovery = !!d.ha_discovery; d.tls = !!d.tls; await put('/api/settings', { mqtt: d }); toast('Nastavitve MQTT so shranjene'); setTimeout(() => go('integrations'), 1500); } }, 'Shrani')),
      h('div', { class: 'stack' },
        h('div', { class: 'panel' }, h('h2', {}, 'AI modul'),
          h('p', {}, 'Stanje: ', ai.connected ? h('span', { class: 'badge ok' }, `deluje (${ai.info?.cameras ?? 0} kamer, ${ai.info?.device || 'CPU'}${ai.info?.model ? `, ${ai.info.model}` : ''})`) : h('span', { class: 'badge' }, 'ni zagnan')),
          h('p', { class: 'muted' }, 'AI modul je ločena storitev. Zaženete ga z ', h('code', {}, 'docker compose --profile ai up -d'), '. Pametne funkcije vklopite pri vsaki kameri.')),
        h('div', { class: 'panel' }, h('h2', {}, 'API žetoni'),
          h('p', { class: 'muted' }, 'Žeton omogoča dostop drugim aplikacijam, npr. VisionOne Field za prikaz stanja sistema pri stranki ali Home Assistant za sliko kamere.'),
          tokens.length ? h('div', { class: 'table-wrap', style: { marginBottom: '12px' } }, h('table', {}, h('thead', {}, h('tr', {}, ['Ime', 'Vloga', 'Ustvarjen', 'Uporabljen', ''].map(t => h('th', {}, t)))), tokRows)) : null,
          h('button', { class: 'btn', onclick: newToken }, icon('key', 16), 'Nov žeton')),
        h('div', { class: 'panel' }, h('h2', {}, 'Naslovi za druge sisteme'),
          h('dl', { class: 'info-grid' },
            h('dt', {}, 'Stanje sistema'), h('dd', { class: 'mono' }, `${location.origin}/api/integration/status`),
            h('dt', {}, 'Slika kamere'), h('dd', { class: 'mono' }, `${location.origin}/api/cameras/<id>/snapshot`),
            h('dt', {}, 'RTSP kamere'), h('dd', { class: 'mono' }, `rtsp://${location.hostname}:8554/cam_<id>`)),
          h('p', { class: 'muted', style: { fontSize: '12.5px' } }, 'Pri klicu API pošljite glavo "Authorization: Bearer <žeton>". RTSP restream (vrata 8554, odprete jih v docker-compose.yml) omogoča, da kamero v Home Assistant dodate brez dodatne povezave na kamero.')))));
}

function newToken() {
  const name = h('input', { value: 'VisionOne Field' });
  const role = select(Object.entries(ROLE), 'viewer');
  modal('Nov API žeton', h('div', {}, field('Ime (kdo ga bo uporabljal)', name), field('Vloga', role)), {
    actions: [{ label: 'Prekliči' }, { label: 'Ustvari', kind: 'btn-primary', onClick: async () => {
      const r = await post('/api/tokens', { name: name.value, role: role.value });
      modal('Žeton je ustvarjen', h('div', {}, h('p', {}, 'Kopirajte žeton zdaj. Kasneje ga ne bo mogoče več prikazati.'), h('div', { class: 'token-box mono' }, r.token),
        h('button', { class: 'btn', style: { marginTop: '10px' }, onclick: () => { navigator.clipboard?.writeText(r.token); toast('Kopirano'); } }, 'Kopiraj')), { onClose: () => go('integrations') });
    } }],
  });
}

// ======================= REVIZIJSKA SLED =======================
export async function pageAudit(page) {
  const search = h('input', { type: 'search', placeholder: 'Išči po uporabniku, dejanju, cilju', style: { maxWidth: '360px' } });
  const tbody = h('tbody');
  const ACT = { prijava: 'Prijava', prijava_neuspesna: 'Neuspešna prijava', predvajanje_snemalnik: 'Predvajanje s snemalnika', izvoz: 'Izvoz posnetka', izvoz_prenos: 'Prenos izvoza', potrditev_alarma: 'Potrditev alarma', kamera_spremenjena: 'Sprememba kamere', kamera_dodana: 'Nova kamera', kamera_izbrisana: 'Izbris kamere', snemalnik_dodan: 'Nov snemalnik', uporabnik_dodan: 'Nov uporabnik', nastavitve: 'Nastavitve', zaznamek: 'Zaznamek', rocni_dogodek: 'Ročni alarm' };
  const load = async () => {
    const rows = await get(`/api/audit${search.value ? `?q=${encodeURIComponent(search.value)}` : ''}`);
    clear(tbody, rows.map(r => h('tr', {}, h('td', {}, fmtDateTime(r.ts)), h('td', {}, r.username), h('td', {}, ACT[r.action] || r.action.replace(/_/g, ' ')), h('td', {}, r.target), h('td', { class: 'muted' }, r.detail), h('td', { class: 'mono muted' }, r.ip))));
  };
  search.oninput = debounce(load, 300);
  clear(page, pageHead('Revizijska sled', 'Kdo je kdaj gledal posnetke, izvažal, spreminjal nastavitve. Zahteva GDPR za videonadzor.'),
    h('div', { class: 'toolbar' }, search),
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Čas', 'Uporabnik', 'Dejanje', 'Cilj', 'Podrobnosti', 'IP'].map(t => h('th', {}, t)))), tbody)));
  load();
}

// ======================= SISTEM =======================
export async function pageSystem(page) {
  const s = await get('/api/settings');
  const me = await get('/api/auth/me');
  const sysName = h('input', { value: s.system_name || 'VisionOne' });
  const evRet = h('input', { type: 'number', min: 7, value: s.event_retention_days || 90 });
  const restoreFile = h('input', { type: 'file', accept: '.json,application/json' });
  const oldPw = h('input', { type: 'password', autocomplete: 'current-password' });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password' });
  clear(page,
    pageHead('Sistem', 'Splošne nastavitve, varnostna kopija in vaš račun.'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Splošno'),
        field('Ime sistema', sysName, 'Prikazano v naslovu aplikacij, npr. ime objekta ali podjetja.'),
        field('Hramba dogodkov in sličic (dni)', evRet),
        h('p', { class: 'muted', style: { fontSize: '12.5px' } }, `Posnetki: ${s.recordings_root} · dolžina segmenta ${s.segment_seconds} s`),
        h('button', { class: 'btn btn-primary', onclick: async () => { await put('/api/settings', { system_name: sysName.value, event_retention_days: Number(evRet.value) }); toast('Shranjeno'); } }, 'Shrani')),
      h('div', { class: 'panel' }, h('h2', {}, 'Varnostna kopija nastavitev'),
        h('p', { class: 'muted' }, 'Kopija vsebuje kamere, snemalnike, uporabnike, pravila, poglede in tlorise (brez posnetkov). Shranite jo po vsaki večji spremembi.'),
        h('a', { class: 'btn', href: '/api/system/backup' }, icon('download', 16), 'Prenesi kopijo'),
        h('hr'),
        field('Obnovi iz kopije', restoreFile, 'Obnova zamenja vse trenutne nastavitve.'),
        h('button', { class: 'btn btn-danger', onclick: async () => {
          const file = restoreFile.files[0]; if (!file) return toast('Izberite datoteko', 'warn');
          if (!await confirmDialog('Obnova bo zamenjala vse trenutne nastavitve. Nadaljujem?', { danger: true, ok: 'Obnovi' })) return;
          try { await post('/api/system/restore', JSON.parse(await file.text())); toast('Nastavitve so obnovljene'); setTimeout(() => location.reload(), 1200); } catch (e) { toastErr(e); }
        } }, 'Obnovi')),
      h('div', { class: 'panel' }, h('h2', {}, 'Moj račun'),
        field('Trenutno geslo', oldPw), field('Novo geslo (vsaj 8 znakov)', newPw),
        h('button', { class: 'btn btn-primary', onclick: async () => { try { await post('/api/auth/password', { old_password: oldPw.value, new_password: newPw.value }); oldPw.value = newPw.value = ''; toast('Geslo je spremenjeno'); } catch (e) { toastErr(e); } } }, 'Spremeni geslo')),
      h('div', { class: 'panel' }, h('h2', {}, 'Dvofaktorska prijava'),
        me.totp_enabled ? h('div', {}, h('p', {}, h('span', { class: 'badge ok' }, 'Vklopljena'), ' Ob prijavi vpišete še kodo iz aplikacije.'),
          h('button', { class: 'btn btn-danger', onclick: async () => { if (await confirmDialog('Izklopim dvofaktorsko prijavo?', { danger: true, ok: 'Izklopi' })) { await post('/api/auth/totp/disable'); go('system'); } } }, 'Izklopi'))
          : h('div', {}, h('p', { class: 'muted' }, 'Zaščitite skrbniški račun s kodo iz aplikacije (Google Authenticator, Microsoft Authenticator, 2FAS …).'), h('button', { class: 'btn btn-primary', onclick: setup2fa }, 'Vklopi')))));
}

async function setup2fa() {
  const r = await post('/api/auth/totp/setup');
  const qr = qrcode(0, 'M'); qr.addData(r.uri); qr.make();
  const code = h('input', { inputmode: 'numeric', placeholder: '123456', autocomplete: 'one-time-code' });
  modal('Vklop dvofaktorske prijave', h('div', {},
    h('p', {}, '1. V aplikaciji za preverjanje skenirajte kodo QR.'),
    h('div', { class: 'qr', html: qr.createImgTag(5, 8) }),
    h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } }, 'Ali vpišite ključ: ', h('span', { class: 'mono' }, r.secret)),
    field('2. Vpišite 6-mestno kodo iz aplikacije', code)), {
    actions: [{ label: 'Prekliči' }, { label: 'Potrdi in vklopi', kind: 'btn-primary', onClick: async () => { await post('/api/auth/totp/enable', { code: code.value }); toast('Dvofaktorska prijava je vklopljena'); go('system'); } }],
  });
}
