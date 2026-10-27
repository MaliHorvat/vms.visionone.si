import { h, clear, $, api, get, post, put, del, toast, dialog, badge, field, fmtDate, fmtDay, ago, sparkline, ApiError } from './dom.js';

const S = { user: null, customer: null, plans: null, featureLabels: {} };
const isStaff = () => S.user && (S.user.role === 'admin' || S.user.role === 'tech');
const isAdmin = () => S.user && S.user.role === 'admin';
const root = () => document.getElementById('root');

// ─────────────────────────── zagon ───────────────────────────
async function boot() {
  try {
    const me = await get('auth/me');
    S.user = me.user; S.customer = me.customer;
  } catch (e) { S.user = null; }
  if (!S.user) return renderLogin();
  try { const p = await get('plans'); S.plans = p.plans; S.featureLabels = p.featureLabels; } catch (e) {}
  renderShell();
  window.addEventListener('hashchange', route);
  route();
}

// ─────────────────────────── prijava ───────────────────────────
function renderLogin() {
  const err = h('div', { class: 'err' });
  const uI = h('input', { type: 'text', autocomplete: 'username', placeholder: 'uporabniško ime' });
  const pI = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'geslo' });
  const tI = h('input', { type: 'text', inputmode: 'numeric', placeholder: '6-mestna koda', class: 'hidden' });
  const btn = h('button', { class: 'btn primary', style: 'width:100%' }, 'Prijava');
  let need2fa = false;

  async function submit() {
    err.textContent = ''; btn.disabled = true;
    try {
      const r = await post('auth/login', { username: uI.value.trim(), password: pI.value, totp: tI.value });
      if (r.need2fa) { need2fa = true; tI.classList.remove('hidden'); tI.focus(); err.textContent = 'Vnesite kodo iz aplikacije.'; btn.disabled = false; return; }
      location.hash = '#/'; location.reload();
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  }
  btn.addEventListener('click', submit);
  [uI, pI, tI].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));

  clear(root(), h('div', { class: 'login' }, h('div', { class: 'card' },
    h('div', { class: 'brand' }, h('span', { class: 'dot' }, '◉'), h('div', {}, 'Vision', h('span', {}, 'One'))),
    h('p', { class: 'muted', style: 'margin-bottom:20px' }, 'Nadzorni portal'),
    field('Uporabnik', uI), field('Geslo', pI), field('Dvofaktorska koda', tI),
    err, btn,
  )));
  setTimeout(() => uI.focus(), 50);
}

// ─────────────────────────── ogrodje ───────────────────────────
const NAV = [
  { href: '#/', icon: '▦', label: 'Nadzorna plošča' },
  { href: '#/locations', icon: '◉', label: 'Lokacije' },
  { href: '#/customers', icon: '🏢', label: 'Stranke', staff: true },
  { href: '#/licenses', icon: '🔑', label: 'Licence' },
  { sep: true, staff: true },
  { href: '#/users', icon: '👥', label: 'Uporabniki', admin: true },
  { href: '#/audit', icon: '📜', label: 'Dnevnik', staff: true },
  { href: '#/account', icon: '⚙', label: 'Moj račun' },
];

function renderShell() {
  const nav = h('nav', { class: 'nav' }, NAV.filter(n => (!n.staff || isStaff()) && (!n.admin || isAdmin()))
    .map(n => n.sep ? h('div', { class: 'sep' }) : h('a', { href: n.href, dataset: { href: n.href } }, h('span', { class: 'ic' }, n.icon), n.label)));
  clear(root(), h('div', { class: 'app' },
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'dot' }, '◉'), h('div', {}, 'Vision', h('span', {}, 'One'))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'who' }, h('b', {}, S.user.username), roleLabel(S.user.role) + (S.customer ? ' · ' + S.customer.name : '')),
      h('button', { class: 'btn sm', onclick: logout }, 'Odjava'),
    ),
    h('aside', { class: 'side' }, nav),
    h('main', { class: 'main', id: 'view' }),
  ));
}
const roleLabel = (r) => ({ admin: 'Skrbnik', tech: 'Tehnik', customer: 'Stranka' }[r] || r);
async function logout() { try { await post('auth/logout'); } catch (e) {} location.hash = ''; location.reload(); }

function setActive() {
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.href === ('#' + (location.hash.slice(1).split('/').slice(0, 2).join('/') || '/'))));
}

// ─────────────────────────── usmerjevalnik ───────────────────────────
function route() {
  if (!S.user) return;
  const hash = location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  const view = $('#view'); if (!view) { renderShell(); }
  setActive();
  try {
    if (hash === '/' || parts[0] === '') return viewDashboard();
    if (parts[0] === 'locations') return viewLocations();
    if (parts[0] === 'location') return viewLocation(+parts[1]);
    if (parts[0] === 'customers') return viewCustomers();
    if (parts[0] === 'licenses') return viewLicenses();
    if (parts[0] === 'users') return viewUsers();
    if (parts[0] === 'audit') return viewAudit();
    if (parts[0] === 'account') return viewAccount();
    viewDashboard();
  } catch (e) { toast(e.message, true); }
}

const page = (title, sub, ...nodes) => clear($('#view'), h('h1', {}, title), sub ? h('p', { class: 'sub' }, sub) : null, ...nodes);
const stat = (n, l, sub, color) => h('div', { class: 'stat' }, h('div', { class: 'n', style: color ? `color:${color}` : '' }, n), h('div', { class: 'l' }, l), sub ? h('p', { class: 'sub muted' }, sub) : null);

// ─────────────────────────── nadzorna plošča ───────────────────────────
async function viewDashboard() {
  page('Nadzorna plošča', 'Pregled stanja infrastrukture');
  const s = await get('stats');
  const cards = [
    stat(`${s.locations.online}/${s.locations.total}`, 'Lokacije online', s.locations.offline ? `${s.locations.offline} v izpadu` : 'vse delujejo', s.locations.offline ? 'var(--bad)' : 'var(--ok)'),
    stat(`${s.devices.online}/${s.devices.total}`, 'Naprave online', s.devices.offline ? `${s.devices.offline} v izpadu` : 'vse delujejo', s.devices.offline ? 'var(--bad)' : 'var(--ok)'),
    stat(s.openIncidents, 'Odprti izpadi', null, s.openIncidents ? 'var(--bad)' : 'var(--ok)'),
  ];
  if (isStaff()) {
    cards.push(stat(s.customers, 'Stranke'));
    if (s.licenses) cards.push(stat(s.licenses.active, 'Aktivne licence', s.licenses.soon ? `${s.licenses.soon} poteče <30 dni` : (s.licenses.expired ? `${s.licenses.expired} poteklih` : 'vse veljavne'), s.licenses.soon ? 'var(--warn)' : 'var(--ok)'));
  }
  $('#view').append(h('div', { class: 'cards' }, cards));

  const inc = (await get('incidents?open=1&limit=15')).incidents;
  $('#view').append(h('div', { class: 'panel' },
    h('h2', {}, 'Odprti izpadi', h('div', { class: 'spacer' }), h('a', { class: 'btn sm', href: '#/locations' }, 'Vse lokacije')),
    inc.length ? tableIncidents(inc) : h('div', { class: 'body muted' }, '✅ Trenutno ni odprtih izpadov.')));
}

function tableIncidents(inc) {
  return h('table', {}, h('thead', {}, h('tr', {}, ['Stranka', 'Lokacija', 'Naprava', 'Začetek', 'Tip'].map(t => h('th', {}, t)))),
    h('tbody', {}, inc.map(i => h('tr', { class: 'clk', onclick: () => location.hash = '#/location/' + i.location_id },
      h('td', {}, i.customer_name), h('td', {}, i.location_name),
      h('td', {}, i.device_name || h('span', { class: 'muted' }, 'agent')),
      h('td', {}, fmtDate(i.started_at)),
      h('td', {}, h('span', { class: 'badge b-offline' }, i.kind === 'agent_offline' ? 'agent' : 'naprava'))))));
}

// ─────────────────────────── lokacije ───────────────────────────
async function viewLocations() {
  page('Lokacije', 'Vse nadzorovane lokacije');
  if (isStaff()) $('#view').append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: dlgNewLocation }, '+ Nova lokacija')));
  const locs = (await get('locations')).locations;
  if (!locs.length) return $('#view').append(h('div', { class: 'panel' }, h('div', { class: 'body muted' }, 'Ni lokacij. ' + (isStaff() ? 'Dodajte prvo zgoraj.' : ''))));
  $('#view').append(h('div', { class: 'panel' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Lokacija', 'Stranka', 'Agent', 'Naprave', 'Licenca', 'Zadnji stik'].map(t => h('th', {}, t)))),
    h('tbody', {}, locs.map(l => h('tr', { class: 'clk', onclick: () => location.hash = '#/location/' + l.id },
      h('td', {}, h('b', {}, l.name), l.address ? h('div', { class: 'muted', style: 'font-size:12px' }, l.address) : null),
      h('td', {}, l.customer_name),
      h('td', {}, badge(l.status)),
      h('td', {}, `${l.devices - l.devices_down}/${l.devices}`, l.devices_down ? h('span', { class: 'badge b-offline', style: 'margin-left:6px' }, l.devices_down + ' ↓') : null),
      h('td', {}, l.license_plan ? h('span', { class: 'badge b-plan' }, (S.plans[l.license_plan] || {}).name || l.license_plan) : h('span', { class: 'muted' }, 'brez')),
      h('td', { class: 'muted' }, ago(l.agent_last_seen)))))) ));
}

function dlgNewLocation() {
  (async () => {
    const custs = (await get('customers')).customers;
    const cSel = h('select', {}, custs.map(c => h('option', { value: c.id }, c.name)));
    const nI = h('input', { placeholder: 'npr. Trgovina Center' });
    const aI = h('input', { placeholder: 'naslov (neobvezno)' });
    if (!custs.length) { toast('Najprej ustvarite stranko.', true); location.hash = '#/customers'; return; }
    dialog('Nova lokacija', h('div', {}, field('Stranka', cSel), field('Ime lokacije', nI), field('Naslov', aI)), [
      { label: 'Prekliči' },
      { label: 'Ustvari', kind: 'primary', onClick: async () => {
        if (!nI.value.trim()) throw new Error('Vnesite ime');
        const r = await post('locations', { customer_id: +cSel.value, name: nI.value.trim(), address: aI.value });
        showAgentToken(r.agentToken);
        route();
      } },
    ]);
  })();
}

function showAgentToken(tokenRaw) {
  dialog('Žeton agenta', h('div', {},
    h('p', { class: 'muted' }, 'Ta žeton vnesite v agenta pri stranki (ENV VO_TOKEN ali config). Prikazan je samo enkrat.'),
    h('div', { class: 'key' }, tokenRaw),
    h('button', { class: 'btn sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(tokenRaw); toast('Kopirano'); } }, 'Kopiraj'),
  ), [{ label: 'Zapri', kind: 'primary' }]);
}

// ─────────────────────────── podrobnosti lokacije ───────────────────────────
async function viewLocation(id) {
  const locs = (await get('locations')).locations;
  const loc = locs.find(l => l.id === id);
  if (!loc) return page('Lokacija', 'Ne obstaja ali nimate dostopa');
  page(loc.name, `${loc.customer_name}${loc.address ? ' · ' + loc.address : ''}`);
  const top = h('div', { class: 'row', style: 'margin-bottom:16px' },
    badge(loc.status), h('span', { class: 'pill' }, 'Agent: ' + (loc.agent_version || '?')),
    h('span', { class: 'pill' }, 'Zadnji stik: ' + ago(loc.agent_last_seen)),
    h('div', { class: 'spacer', style: 'flex:1' }));
  if (isStaff()) {
    top.append(
      h('button', { class: 'btn sm', onclick: () => dlgNewDevice(loc.id) }, '+ Naprava'),
      h('button', { class: 'btn sm', onclick: () => showDiscovered(loc.id) }, 'Zaznane naprave'),
      h('button', { class: 'btn sm', onclick: () => regenToken(loc.id) }, 'Nov žeton'));
  }
  $('#view').append(top);

  const devs = (await get('devices?location_id=' + id)).devices;
  $('#view').append(h('div', { class: 'panel' },
    h('h2', {}, 'Naprave (' + devs.length + ')'),
    devs.length ? h('table', {},
      h('thead', {}, h('tr', {}, ['Naprava', 'Tip', 'IP', 'Stanje', 'Odziv', 'Zadnji stik', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, devs.map(d => deviceRow(d, loc))))
      : h('div', { class: 'body muted' }, 'Ni naprav.')));

  // ukazi (če ima lokacija pravico)
  const cmds = (await get('commands?location_id=' + id)).commands;
  $('#view').append(h('div', { class: 'panel' },
    h('h2', {}, 'Daljinski ukazi'),
    h('div', { class: 'body' },
      h('p', { class: 'muted', style: 'margin-bottom:10px' }, 'Agent izvede samo lokalno dovoljena dejanja. Vsak ukaz se beleži.'),
      h('div', { class: 'row' }, devs.filter(d => d.kind === 'domofon' || (d.settings && d.settings.actions)).map(d =>
        h('button', { class: 'btn', onclick: () => sendCommand(loc.id, d.id, 'open_door', d.name) }, '🔓 ' + d.name))),
      cmds.length ? h('table', { style: 'margin-top:12px' },
        h('thead', {}, h('tr', {}, ['Čas', 'Dejanje', 'Naprava', 'Kdo', 'Status'].map(t => h('th', {}, t)))),
        h('tbody', {}, cmds.slice(0, 10).map(c => h('tr', {},
          h('td', { class: 'muted' }, fmtDate(c.created_at)), h('td', {}, c.action),
          h('td', {}, c.device_name || '–'), h('td', { class: 'muted' }, c.created_by),
          h('td', {}, cmdBadge(c.status)))))) : null)));

  const inc = (await get('incidents?location_id=' + id + '&limit=20')).incidents;
  $('#view').append(h('div', { class: 'panel' }, h('h2', {}, 'Zgodovina izpadov'),
    inc.length ? h('table', {}, h('thead', {}, h('tr', {}, ['Naprava', 'Začetek', 'Konec', 'Trajanje'].map(t => h('th', {}, t)))),
      h('tbody', {}, inc.map(i => h('tr', {}, h('td', {}, i.device_name || 'agent'), h('td', {}, fmtDate(i.started_at)),
        h('td', {}, i.resolved_at ? fmtDate(i.resolved_at) : h('span', { class: 'badge b-offline' }, 'odprto')),
        h('td', { class: 'muted' }, dur(i.started_at, i.resolved_at))))))
      : h('div', { class: 'body muted' }, 'Ni zabeleženih izpadov.')));
}

function deviceRow(d, loc) {
  const tr = h('tr', { class: 'clk', onclick: () => showDevice(d, loc) },
    h('td', {}, h('b', {}, d.name), d.model ? h('div', { class: 'muted', style: 'font-size:12px' }, d.vendor ? d.vendor + ' ' + d.model : d.model) : null),
    h('td', {}, kindLabel(d.kind)), h('td', { class: 'mono' }, d.ip || '–'),
    h('td', {}, badge(d.status)), h('td', { class: 'muted' }, d.last_latency_ms != null ? d.last_latency_ms + ' ms' : '–'),
    h('td', { class: 'muted' }, ago(d.last_seen)),
    h('td', {}, isStaff() ? h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); dlgEditDevice(d, loc); } }, 'Uredi') : ''));
  return tr;
}

async function showDevice(d, loc) {
  const body = h('div', {});
  body.append(h('div', { class: 'row', style: 'margin-bottom:10px' }, badge(d.status),
    h('span', { class: 'pill' }, kindLabel(d.kind)), d.ip ? h('span', { class: 'pill mono' }, d.ip) : null,
    d.mac ? h('span', { class: 'pill mono' }, d.mac) : null));
  const info = [['Proizvajalec', d.vendor], ['Model', d.model], ['Firmware', d.firmware], ['Zadnji odziv', d.last_latency_ms != null ? d.last_latency_ms + ' ms' : null]].filter(x => x[1]);
  body.append(h('table', {}, h('tbody', {}, info.map(([k, v]) => h('tr', {}, h('td', { class: 'muted' }, k), h('td', {}, v))))));
  const spark = h('div', { class: 'body muted' }, 'Nalagam graf …');
  body.append(h('div', { class: 'panel', style: 'margin-top:12px' }, h('h2', {}, 'Odzivni čas (24 h)'), spark));
  dialog(d.name, body, [{ label: 'Zapri', kind: 'primary' }]);
  try {
    const m = await get('metrics?device_id=' + d.id + '&hours=24');
    const lat = m.metrics.map(x => x.up ? (x.latency_ms || 0) : 0);
    clear(spark, lat.length ? sparkline(lat) : h('span', { class: 'muted' }, 'Ni podatkov.'),
      h('p', { class: 'muted', style: 'padding:8px 0 0' }, m.availability != null ? 'Razpoložljivost: ' + m.availability.toFixed(1) + ' %' : ''));
  } catch (e) { clear(spark, h('span', { class: 'muted' }, 'Ni podatkov.')); }
}

async function sendCommand(locId, devId, action, name) {
  try { await post('commands', { location_id: locId, device_id: devId, action }); toast('Ukaz poslan: ' + name); setTimeout(route, 600); }
  catch (e) { toast(e.message, true); }
}
async function regenToken(id) {
  dialog('Nov žeton agenta?', h('p', { class: 'muted' }, 'Star žeton takoj preneha veljati. Agenta boste morali posodobiti.'), [
    { label: 'Prekliči' },
    { label: 'Ustvari nov', kind: 'danger', onClick: async () => { const r = await put('locations?id=' + id + '&action=regen_token'); showAgentToken(r.agentToken); } },
  ]);
}
async function showDiscovered(id) {
  const d = await get('discovered?location_id=' + id);
  const items = d.items || [];
  dialog('Zaznane naprave', h('div', {}, items.length
    ? h('table', {}, h('thead', {}, h('tr', {}, ['IP', 'MAC', 'Proizvajalec', 'Vrata', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, items.map(it => h('tr', {}, h('td', { class: 'mono' }, it.ip), h('td', { class: 'mono' }, it.mac || '–'),
        h('td', {}, it.vendor || '–'), h('td', { class: 'muted' }, (it.ports || []).join(', ')),
        h('td', {}, h('button', { class: 'btn sm', onclick: () => { dlgNewDevice(id, it); } }, '+ Dodaj'))))))
    : h('p', { class: 'muted' }, 'Agent še ni poslal zaznanih naprav (ali so vse že dodane).')), [{ label: 'Zapri', kind: 'primary' }]);
}

const KINDS = [['camera', 'Kamera'], ['nvr', 'Snemalnik'], ['switch', 'Switch'], ['router', 'Usmerjevalnik'], ['ap', 'WiFi točka'], ['ups', 'UPS'], ['server', 'Strežnik'], ['domofon', 'Domofon'], ['nas', 'NAS'], ['printer', 'Tiskalnik'], ['other', 'Drugo']];
const kindLabel = (k) => (KINDS.find(x => x[0] === k) || [k, k])[1];

function dlgNewDevice(locId, seed) { deviceDialog(locId, null, seed); }
function dlgEditDevice(d, loc) { deviceDialog(loc.id, d); }
function deviceDialog(locId, d, seed) {
  seed = seed || {};
  const nI = h('input', { value: d ? d.name : (seed.vendor || '') });
  const kSel = h('select', {}, KINDS.map(([v, l]) => h('option', { value: v, selected: (d ? d.kind : 'other') === v }, l)));
  const ipI = h('input', { class: 'mono', value: d ? (d.ip || '') : (seed.ip || '') });
  const macI = h('input', { class: 'mono', value: d ? (d.mac || '') : (seed.mac || '') });
  const venI = h('input', { value: d ? (d.vendor || '') : (seed.vendor || '') });
  const modI = h('input', { value: d ? (d.model || '') : (seed.model || '') });
  const mon = (d && d.monitor) || {};
  const pingC = h('input', { type: 'checkbox', checked: mon.ping !== false, style: 'width:auto' });
  const portsI = h('input', { class: 'mono', value: (mon.ports || (seed.ports || [])).join(','), placeholder: 'npr. 80,443,554' });
  const snmpI = h('input', { value: mon.snmp && mon.snmp.community ? mon.snmp.community : '', placeholder: 'SNMP community (npr. public)' });
  const body = h('div', {}, field('Ime', nI), field('Tip', kSel),
    h('div', { class: 'row' }, h('div', { style: 'flex:1' }, field('IP', ipI)), h('div', { style: 'flex:1' }, field('MAC', macI))),
    h('div', { class: 'row' }, h('div', { style: 'flex:1' }, field('Proizvajalec', venI)), h('div', { style: 'flex:1' }, field('Model', modI))),
    h('div', { class: 'panel', style: 'margin-top:4px' }, h('h2', {}, 'Nadzor'), h('div', { class: 'body' },
      h('label', { class: 'f', style: 'display:flex;gap:8px;align-items:center' }, pingC, h('span', { style: 'margin:0' }, 'Ping / dosegljivost')),
      field('TCP vrata (preverjanje)', portsI, 'ločena z vejico'),
      field('SNMP', snmpI, 'za switche, UPS (prazno = izklopljeno)'))));
  const actions = [{ label: 'Prekliči' }];
  if (d) actions.push({ label: 'Izbriši', kind: 'danger', onClick: async () => { await del('devices?id=' + d.id); route(); } });
  actions.push({ label: d ? 'Shrani' : 'Dodaj', kind: 'primary', onClick: async () => {
    if (!nI.value.trim()) throw new Error('Vnesite ime');
    const monitor = { ping: pingC.checked, ports: portsI.value.split(',').map(x => +x.trim()).filter(Boolean) };
    if (snmpI.value.trim()) monitor.snmp = { community: snmpI.value.trim() };
    const payload = { location_id: locId, name: nI.value.trim(), kind: kSel.value, ip: ipI.value.trim(), mac: macI.value.trim(), vendor: venI.value.trim(), model: modI.value.trim(), monitor };
    if (d) await put('devices?id=' + d.id, payload); else await post('devices', payload);
    route();
  } });
  dialog(d ? 'Uredi napravo' : 'Nova naprava', body, actions);
}

function cmdBadge(s) { const m = { pending: ['b-warn', 'čaka'], sent: ['b-warn', 'poslano'], done: ['b-online', 'izvedeno'], error: ['b-offline', 'napaka'], canceled: ['b-unknown', 'preklicano'], expired: ['b-unknown', 'poteklo'] }; const [c, l] = m[s] || ['b-unknown', s]; return h('span', { class: 'badge ' + c }, l); }
function dur(a, b) { if (!b) return 'poteka'; const m = Math.round((new Date(b) - new Date(a)) / 60000); return m < 60 ? m + ' min' : (m / 60).toFixed(1) + ' h'; }

// ─────────────────────────── stranke ───────────────────────────
async function viewCustomers() {
  page('Stranke', 'Upravljanje strank');
  $('#view').append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: () => custDialog() }, '+ Nova stranka')));
  const cs = (await get('customers')).customers;
  $('#view').append(h('div', { class: 'panel' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Stranka', 'Kontakt', 'Lokacije', 'Naprave', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, cs.map(c => h('tr', {},
      h('td', {}, h('b', {}, c.name), c.active ? null : h('span', { class: 'badge b-unknown', style: 'margin-left:6px' }, 'neaktivna')),
      h('td', { class: 'muted' }, [c.contact_email, c.contact_phone].filter(Boolean).join(' · ') || '–'),
      h('td', {}, c.locations), h('td', {}, c.devices),
      h('td', {}, h('button', { class: 'btn sm', onclick: () => custDialog(c) }, 'Uredi'))))))));
}
function custDialog(c) {
  const nI = h('input', { value: c ? c.name : '' });
  const eI = h('input', { value: c ? (c.contact_email || '') : '' });
  const pI = h('input', { value: c ? (c.contact_phone || '') : '' });
  const noI = h('textarea', { rows: 2 }, c ? (c.notes || '') : '');
  const acts = [{ label: 'Prekliči' }];
  if (c && isAdmin()) acts.push({ label: 'Izbriši', kind: 'danger', onClick: async () => { if (!confirm('Izbrišem stranko in vse njene lokacije?')) return false; await del('customers?id=' + c.id); route(); } });
  acts.push({ label: c ? 'Shrani' : 'Ustvari', kind: 'primary', onClick: async () => {
    if (!nI.value.trim()) throw new Error('Vnesite ime');
    const payload = { name: nI.value.trim(), contact_email: eI.value, contact_phone: pI.value, notes: noI.value, active: c ? c.active : 1 };
    if (c) await put('customers?id=' + c.id, payload); else await post('customers', payload);
    route();
  } });
  dialog(c ? 'Uredi stranko' : 'Nova stranka', h('div', {}, field('Ime', nI), field('E-pošta', eI), field('Telefon', pI), field('Opombe', noI)), acts);
}

// ─────────────────────────── licence ───────────────────────────
async function viewLicenses() {
  page('Licence', 'Paketi po lokaciji (letni obračun)');
  if (isAdmin()) $('#view').append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: dlgIssueLicense }, '+ Izdaj licenco')));
  // paketi
  $('#view').append(h('div', { class: 'cards' }, Object.entries(S.plans).map(([id, p]) => h('div', { class: 'stat' },
    h('div', { class: 'n', style: 'font-size:18px' }, p.name), h('div', { class: 'l' }, p.priceEUR + ' €/leto'),
    h('p', { class: 'sub muted' }, 'do ' + p.maxDevices + ' naprav'),
    h('div', { style: 'margin-top:8px' }, p.features.map(f => h('span', { class: 'pill', style: 'margin:2px;display:inline-block' }, S.featureLabels[f] || f)))))));
  const ls = (await get('licenses')).licenses;
  $('#view').append(h('div', { class: 'panel' }, h('h2', {}, 'Izdane licence'),
    ls.length ? h('table', {}, h('thead', {}, h('tr', {}, ['ID', 'Stranka', 'Lokacija', 'Paket', 'Poteče', 'Stanje', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, ls.map(l => h('tr', {},
        h('td', { class: 'mono' }, l.id), h('td', {}, l.customer_name), h('td', {}, l.location_name || '–'),
        h('td', {}, h('span', { class: 'badge b-plan' }, (S.plans[l.plan] || {}).name || l.plan)),
        h('td', {}, fmtDay(l.expires_at)), h('td', {}, licBadge(l)),
        h('td', {}, h('div', { class: 'row' },
          h('a', { class: 'btn sm', href: '/api/licenses?id=' + l.id + '&download=1' }, 'Prenesi'),
          isAdmin() && !l.revoked ? h('button', { class: 'btn sm danger', onclick: () => revokeLicense(l.id) }, 'Prekliči') : null))))))
      : h('div', { class: 'body muted' }, 'Ni izdanih licenc.')));
}
function licBadge(l) {
  if (l.revoked) return h('span', { class: 'badge b-offline' }, 'preklicana');
  const days = Math.round((new Date(l.expires_at) - Date.now()) / 86400000);
  if (days < 0) return h('span', { class: 'badge b-offline' }, 'potekla');
  if (days < 30) return h('span', { class: 'badge b-warn' }, 'poteče čez ' + days + ' dni');
  return h('span', { class: 'badge b-online' }, 'veljavna');
}
async function revokeLicense(id) {
  if (!confirm('Preklичem licenco ' + id + '?')) return;
  try { await put('licenses?id=' + id + '&action=revoke'); toast('Preklicano'); route(); } catch (e) { toast(e.message, true); }
}
function dlgIssueLicense() {
  (async () => {
    const custs = (await get('customers')).customers;
    if (!custs.length) { toast('Najprej ustvarite stranko.', true); return; }
    const cSel = h('select', {}, custs.map(c => h('option', { value: c.id }, c.name)));
    const locSel = h('select', {}, h('option', { value: '' }, '(cela stranka)'));
    const pSel = h('select', {}, Object.entries(S.plans).map(([id, p]) => h('option', { value: id }, `${p.name} – ${p.priceEUR} €/leto`)));
    const yI = h('input', { type: 'number', value: 1, min: 1, max: 10 });
    async function loadLocs() { const ls = (await get('locations?customer_id=' + cSel.value)).locations; clear(locSel, h('option', { value: '' }, '(cela stranka)'), ...ls.map(l => h('option', { value: l.id }, l.name))); }
    cSel.addEventListener('change', loadLocs); await loadLocs();
    dialog('Izdaj licenco', h('div', {}, field('Stranka', cSel), field('Lokacija', locSel), field('Paket', pSel), field('Trajanje (let)', yI)), [
      { label: 'Prekliči' },
      { label: 'Izdaj', kind: 'primary', onClick: async () => {
        const r = await post('licenses', { customer_id: +cSel.value, location_id: locSel.value ? +locSel.value : null, plan: pSel.value, years: +yI.value });
        toast('Licenca izdana: ' + r.id);
        dialog('Licenca ' + r.id, h('div', {}, h('p', { class: 'muted' }, 'Pošljite stranki to datoteko ali prenesite s seznama.'),
          h('div', { class: 'key' }, JSON.stringify(r.document, null, 2))), [{ label: 'Zapri', kind: 'primary' }]);
        route();
      } },
    ]);
  })();
}

// ─────────────────────────── uporabniki ───────────────────────────
async function viewUsers() {
  page('Uporabniki', 'Dostop do portala');
  $('#view').append(h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: () => userDialog() }, '+ Nov uporabnik')));
  const us = (await get('users')).users;
  $('#view').append(h('div', { class: 'panel' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Uporabnik', 'Vloga', 'Stranka', '2FA', 'Telegram', 'Zadnja prijava', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, us.map(u => h('tr', {},
      h('td', {}, h('b', {}, u.username), u.active ? null : h('span', { class: 'badge b-unknown', style: 'margin-left:6px' }, 'neaktiven')),
      h('td', {}, roleLabel(u.role)), h('td', {}, u.customer_name || '–'),
      h('td', {}, u.totp_enabled ? '✅' : '–'), h('td', {}, u.telegram_linked ? '✅' : '–'),
      h('td', { class: 'muted' }, u.last_login ? fmtDate(u.last_login) : 'nikoli'),
      h('td', {}, h('button', { class: 'btn sm', onclick: () => userDialog(u) }, 'Uredi'))))))));
}
function userDialog(u) {
  (async () => {
    const custs = (await get('customers')).customers;
    const unI = h('input', { value: u ? u.username : '', disabled: !!u });
    const eI = h('input', { value: u ? (u.email || '') : '' });
    const rSel = h('select', {}, [['admin', 'Skrbnik'], ['tech', 'Tehnik'], ['customer', 'Stranka']].map(([v, l]) => h('option', { value: v, selected: (u ? u.role : 'tech') === v }, l)));
    const cSel = h('select', {}, h('option', { value: '' }, '–'), ...custs.map(c => h('option', { value: c.id, selected: u && u.customer_id === c.id }, c.name)));
    const pI = h('input', { type: 'password', placeholder: u ? 'novo geslo (prazno = brez spremembe)' : 'geslo (min 10 znakov)' });
    const custWrap = h('div', {}, field('Stranka (za vlogo stranka)', cSel));
    const upd = () => custWrap.style.display = rSel.value === 'customer' ? '' : 'none'; rSel.addEventListener('change', upd); upd();
    const acts = [{ label: 'Prekliči' }];
    if (u && u.id !== S.user.id) acts.push({ label: 'Izbriši', kind: 'danger', onClick: async () => { await del('users?id=' + u.id); route(); } });
    acts.push({ label: u ? 'Shrani' : 'Ustvari', kind: 'primary', onClick: async () => {
      const payload = { email: eI.value, role: rSel.value, customer_id: cSel.value ? +cSel.value : null, password: pI.value || undefined };
      if (u) { payload.active = u.active; await put('users?id=' + u.id, payload); }
      else { payload.username = unI.value.trim(); await post('users', payload); }
      route();
    } });
    dialog(u ? 'Uredi uporabnika' : 'Nov uporabnik', h('div', {}, field('Uporabniško ime', unI), field('E-pošta', eI), field('Vloga', rSel), custWrap, field('Geslo', pI)), acts);
  })();
}

// ─────────────────────────── dnevnik ───────────────────────────
async function viewAudit() {
  page('Revizijski dnevnik', 'Zadnja dejanja v portalu');
  const rows = (await get('audit?limit=200')).audit;
  $('#view').append(h('div', { class: 'panel' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Čas', 'Uporabnik', 'Vloga', 'Dejanje', 'Cilj', 'IP'].map(t => h('th', {}, t)))),
    h('tbody', {}, rows.map(r => h('tr', {}, h('td', { class: 'muted' }, fmtDate(r.ts)), h('td', {}, r.username || '–'),
      h('td', { class: 'muted' }, roleLabel(r.role)), h('td', {}, h('span', { class: 'pill' }, r.action)),
      h('td', { class: 'muted' }, r.target || '–'), h('td', { class: 'mono muted' }, r.ip || '–')))))));
}

// ─────────────────────────── moj račun ───────────────────────────
async function viewAccount() {
  page('Moj račun', S.user.username + ' · ' + roleLabel(S.user.role));
  // geslo
  const cp = h('input', { type: 'password', placeholder: 'trenutno geslo' });
  const np = h('input', { type: 'password', placeholder: 'novo geslo (min 10)' });
  const pErr = h('div', { class: 'err' });
  $('#view').append(h('div', { class: 'panel' }, h('h2', {}, 'Sprememba gesla'), h('div', { class: 'body' },
    field('Trenutno geslo', cp), field('Novo geslo', np), pErr,
    h('button', { class: 'btn primary', onclick: async () => { pErr.textContent = ''; try { await post('auth/password', { current: cp.value, next: np.value }); toast('Geslo spremenjeno'); cp.value = np.value = ''; } catch (e) { pErr.textContent = e.message; } } }, 'Shrani geslo'))));

  // 2FA
  const twofa = h('div', { class: 'body' });
  $('#view').append(h('div', { class: 'panel' }, h('h2', {}, 'Dvofaktorska prijava (2FA)'), twofa));
  render2fa(twofa);

  // Telegram
  const tgBox = h('div', { class: 'body' });
  $('#view').append(h('div', { class: 'panel' }, h('h2', {}, 'Telegram obvestila'), tgBox));
  renderTelegram(tgBox);
}
function render2fa(box) {
  if (S.user.totp_enabled) {
    clear(box, h('p', { class: 'ok-msg' }, '✅ Dvofaktorska prijava je vklopljena.'),
      h('button', { class: 'btn danger', onclick: () => {
        const pw = h('input', { type: 'password', placeholder: 'geslo za potrditev' });
        dialog('Izklop 2FA', field('Geslo', pw), [{ label: 'Prekliči' }, { label: 'Izklopi', kind: 'danger', onClick: async () => { await api('auth/twofa', { method: 'DELETE', body: { password: pw.value } }); S.user.totp_enabled = false; route(); } }]);
      } }, 'Izklopi 2FA'));
    return;
  }
  clear(box, h('p', { class: 'muted' }, 'Zaščitite račun z aplikacijo (Google Authenticator, Authy …).'),
    h('button', { class: 'btn primary', onclick: async () => {
      const r = await get('auth/twofa');
      const codeI = h('input', { inputmode: 'numeric', placeholder: '6-mestna koda' });
      dialog('Vklop 2FA', h('div', {},
        h('p', { class: 'muted' }, '1. V aplikacijo vnesite ta ključ (ročno) ali URI:'),
        h('div', { class: 'key' }, r.secret),
        h('div', { class: 'key', style: 'font-size:10px' }, r.otpauth),
        h('p', { class: 'muted' }, '2. Vnesite trenutno kodo:'), field('Koda', codeI)), [
        { label: 'Prekliči' },
        { label: 'Vklopi', kind: 'primary', onClick: async () => { await post('auth/twofa', { secret: r.secret, code: codeI.value }); S.user.totp_enabled = true; toast('2FA vklopljena'); route(); } },
      ]);
    } }, 'Vklopi 2FA'));
}
function renderTelegram(box) {
  if (S.user.telegram_linked) {
    clear(box, h('p', { class: 'ok-msg' }, '✅ Telegram je povezan – prejemali boste obvestila o izpadih.'),
      h('button', { class: 'btn danger', onclick: async () => { await del('telegram-link'); S.user.telegram_linked = false; route(); } }, 'Odklopi Telegram'));
    return;
  }
  clear(box, h('p', { class: 'muted' }, 'Povežite Telegram za obvestila in daljinske ukaze.'),
    h('button', { class: 'btn primary', onclick: async () => {
      const r = await get('telegram-link');
      dialog('Poveži Telegram', h('div', {}, h('p', { class: 'muted' }, 'Odprite bota v Telegramu in pošljite:'),
        h('div', { class: 'key' }, '/povezi ' + r.code), r.botUsername ? h('p', {}, h('a', { href: 'https://t.me/' + r.botUsername, target: '_blank', rel: 'noopener' }, 'Odpri @' + r.botUsername)) : null,
        h('p', { class: 'muted', style: 'font-size:12px' }, 'Po pošiljanju kode osvežite to stran.')), [{ label: 'Zapri', kind: 'primary' }]);
    } }, 'Poveži Telegram'));
}

boot();
