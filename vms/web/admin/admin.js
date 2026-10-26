// VisionOne Admin – nastavitve sistema, dodajanje naprav, snemanje, pravila, uporabniki
import { h, $, clear, icon, get, post, put, del, toast, toastErr, modal, confirmDialog, promptDialog, field, select, toggle, formData,
  ensureLogin, logout, fmtBytes, fmtAgo, fmtDuration, fmtDateTime, toggleTheme, emptyState, EVENT_TYPES, LABELS, liveEvents, debounce } from '../common/core.js';
import { scheduleEditor, zoneEditor, maskEditor } from './widgets.js';
import { pageRecorders, pageDiscovery, pageStorage, openAddRecorder } from './devices.js';
import { pageRules, pageMaps, pageUsers, pageIntegrations, pageAudit, pageSystem } from './system.js';

export const A = { me: null, cameras: [], groups: [], pools: [], recorders: [] };

const PAGES = [
  ['dashboard', 'Pregled', 'home'],
  ['cameras', 'Kamere', 'camera'],
  ['recorders', 'Snemalniki', 'server'],
  ['discovery', 'Iskanje naprav', 'radar'],
  ['storage', 'Snemanje in diski', 'disk'],
  ['rules', 'Pravila in alarmi', 'rule'],
  ['maps', 'Tlorisi', 'map'],
  '-',
  ['users', 'Uporabniki', 'users'],
  ['integrations', 'Integracije', 'link'],
  ['audit', 'Revizijska sled', 'list'],
  ['system', 'Sistem', 'settings'],
];
let main, side, navBtns = {};

async function boot() {
  A.me = await ensureLogin('VisionOne Admin', 'Nastavitve sistema');
  if (A.me.role !== 'admin') {
    clear($('#app'), h('div', { class: 'login-screen' }, h('div', { class: 'login-card' }, h('h2', {}, 'Ni dostopa'), h('p', {}, 'VisionOne Admin je na voljo samo skrbnikom.'), h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '/view/' }, 'Odpri VisionOne View'), h('button', { class: 'btn', onclick: logout }, 'Odjava')))));
    return;
  }
  document.title = `${A.me.system_name || 'VisionOne'} – Admin`;
  side = h('aside', { class: 'side' },
    h('div', { class: 'side-brand' }, h('span', { class: 'brand-mark' }), h('div', {}, h('strong', {}, A.me.system_name || 'VisionOne'), h('span', {}, 'Admin'))),
    h('nav', { class: 'nav', 'aria-label': 'Glavni meni' }, PAGES.map(p => {
      if (p === '-') return h('div', { class: 'nav-sep' });
      const [id, label, ic] = p;
      const b = h('button', { onclick: () => go(id) }, icon(ic), label);
      navBtns[id] = b;
      return b;
    }), h('div', { class: 'nav-sep' }), h('a', { href: '/view/' }, icon('grid'), 'Odpri View')),
    h('div', { class: 'side-foot' }, h('span', { class: 'who' }, A.me.full_name || A.me.username),
      h('button', { class: 'btn-icon', title: 'Tema', onclick: () => toggleTheme('v1-theme-admin') }, icon('sun')),
      h('button', { class: 'btn-icon', title: 'Odjava', onclick: logout }, icon('logout'))));
  main = h('main', { class: 'main' });
  clear($('#app'), h('div', { class: 'app' }, side, main));
  liveEvents({ camera_status: d => { const c = A.cameras.find(x => x.id === d.id); if (c) c.status = d.status; } });
  window.addEventListener('hashchange', () => route());
  route();
}

function route() {
  const id = location.hash.slice(1) || 'dashboard';
  go(PAGES.some(p => p[0] === id) ? id : 'dashboard', false);
}
export async function go(id, push = true) {
  if (push && location.hash !== `#${id}`) { history.pushState(null, '', `#${id}`); }
  side.classList.remove('open');
  for (const [k, b] of Object.entries(navBtns)) { if (k === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  const page = h('div', { class: 'page' });
  clear(main, page);
  const fn = { dashboard: pageDashboard, cameras: pageCameras, recorders: pageRecorders, discovery: pageDiscovery, storage: pageStorage, rules: pageRules, maps: pageMaps, users: pageUsers, integrations: pageIntegrations, audit: pageAudit, system: pageSystem }[id];
  try { await fn(page); } catch (e) { toastErr(e); }
}
export function pageHead(title, desc, ...actions) {
  return h('div', { class: 'page-head' },
    h('button', { class: 'btn-icon menu-btn', 'aria-label': 'Meni', onclick: () => side.classList.toggle('open') }, icon('list')),
    h('div', {}, h('h1', {}, title), desc ? h('p', {}, desc) : null), h('span', { class: 'spacer' }), ...actions);
}
export async function loadCommon() {
  [A.cameras, A.groups, A.pools] = await Promise.all([get('/api/cameras'), get('/api/groups'), get('/api/storage').then(s => s.pools)]);
}

// ======================= PREGLED =======================
async function pageDashboard(page) {
  const o = await get('/api/system/overview');
  const recCount = Object.keys(o.recording).length;
  const alarms = o.events_24h.reduce((a, e) => a + e.n, 0);
  const svc = (name, ok, detail) => h('div', { class: 'svc' }, h('span', { class: `dot ${ok === true ? 'ok' : ok === false ? 'alarm' : ''}` }), h('span', { class: 'n' }, name), h('span', { class: 'muted' }, detail));
  clear(page,
    pageHead('Pregled sistema', `${o.system_name} · različica ${o.version} · deluje ${fmtDuration(o.uptime)}`, h('button', { class: 'btn', onclick: () => go('dashboard') }, icon('refresh', 16), 'Osveži')),
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('div', { class: 'v' }, `${o.cameras.online}/${o.cameras.enabled}`), h('div', { class: 'l' }, 'Kamer na povezavi'), o.cameras.offline ? h('div', { class: 's', style: { color: 'var(--alarm)' } }, `${o.cameras.offline} brez povezave`) : h('div', { class: 's muted' }, 'Vse delujejo')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, recCount), h('div', { class: 'l' }, 'Snema na strežnik'), h('div', { class: 's muted' }, `${o.cameras.total - recCount} samo na snemalniku ali brez snemanja`)),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, o.recorders.length), h('div', { class: 'l' }, 'Snemalnikov'), h('div', { class: 's muted' }, `${o.recorders.filter(r => r.status === 'online').length} na povezavi`)),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, alarms), h('div', { class: 'l' }, 'Dogodkov v 24 urah'), o.unacked_alarms ? h('div', { class: 's', style: { color: 'var(--warn)' } }, `${o.unacked_alarms} nepotrjenih alarmov`) : h('div', { class: 's muted' }, 'Ni nepotrjenih alarmov')),
      h('div', { class: 'stat' }, h('div', { class: 'v' }, o.cameras.ai), h('div', { class: 'l' }, 'Kamer z AI analizo'), h('div', { class: 's' }, o.services.ai.connected ? h('span', { style: { color: 'var(--ok)' } }, 'AI modul deluje') : h('span', { class: 'muted' }, 'AI modul ni zagnan')))),
    h('div', { class: 'grid-2' },
      h('div', { class: 'panel' }, h('h2', {}, 'Diski strežnika'),
        o.pools.length ? o.pools.map(p => {
          const pct = p.disk.total ? (p.disk.used / p.disk.total) * 100 : 0;
          return h('div', { class: 'pool' }, h('div', { class: 'row' }, h('strong', {}, p.name), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `${fmtBytes(p.disk.free)} prosto od ${fmtBytes(p.disk.total)}`)),
            h('div', { class: `meter ${pct > 95 ? 'alarm' : pct > 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } })),
            h('small', { class: 'muted' }, `Posnetki VisionOne: ${fmtBytes(p.vms_used)}${p.oldest ? ` · najstarejši ${fmtDateTime(p.oldest)}` : ''}`));
        }) : h('p', { class: 'muted' }, 'Ni nastavljenih diskov.')),
      h('div', { class: 'panel' }, h('h2', {}, 'Storitve'),
        svc('Pretočni strežnik (go2rtc)', o.services.go2rtc, o.services.go2rtc ? 'deluje' : 'ni dosegljiv'),
        svc('AI modul', o.services.ai.connected || null, o.services.ai.connected ? `${o.services.ai.info?.cameras ?? 0} kamer · ${o.services.ai.info?.device || 'CPU'}` : 'ni zagnan (neobvezno)'),
        svc('MQTT / Home Assistant', o.services.mqtt.connected ? true : o.services.mqtt.error ? false : null, o.services.mqtt.connected ? 'povezano' : o.services.mqtt.error || 'izklopljeno'),
        svc('Strežnik', true, `${o.host.cpus} jeder · obremenitev ${o.host.load[0].toFixed(2)} · prost RAM ${fmtBytes(o.host.mem_free)}`)),
      h('div', { class: 'panel' }, h('h2', {}, 'Snemalniki'),
        o.recorders.length ? o.recorders.map(r => h('div', { class: 'svc' }, h('span', { class: `dot ${r.status === 'online' ? 'ok' : 'alarm'}` }), h('span', { class: 'n' }, r.name),
          h('span', { class: 'muted' }, r.disks.length ? r.disks.map(d => `${d.name}: ${d.status}`).join(', ') : r.vendor))) : emptyState('Ni snemalnikov', 'Dodajte snemalnik in VisionOne bo samodejno uvozil vse kamere.', h('button', { class: 'btn btn-primary', onclick: () => go('recorders') }, 'Dodaj snemalnik'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Kamere brez povezave'),
        o.offline_cameras.length ? o.offline_cameras.map(c => h('div', { class: 'svc' }, h('span', { class: 'dot alarm' }), h('span', { class: 'n' }, c.name), h('button', { class: 'btn btn-sm', onclick: () => editCamera(c.id) }, 'Uredi')))
          : h('p', { class: 'muted' }, 'Vse kamere so na povezavi.'))));
}

// ======================= KAMERE =======================
const REC_LOC = { server: 'Strežnik', recorder: 'Snemalnik', both: 'Strežnik + snemalnik', off: 'Ne snema' };
const REC_MODE = { continuous: 'Stalno', events: 'Ob dogodku', schedule: 'Po urniku' };
const AI_CLASSES = [['person', 'Osebe'], ['car', 'Avti'], ['truck', 'Tovornjaki'], ['bus', 'Avtobusi'], ['motorcycle', 'Motorji'], ['bicycle', 'Kolesa'], ['dog', 'Psi'], ['cat', 'Mačke'], ['bird', 'Ptice']];

async function pageCameras(page) {
  await loadCommon();
  const selected = new Set();
  const search = h('input', { type: 'search', placeholder: 'Išči po imenu, IP ali modelu', 'aria-label': 'Išči' });
  const groupF = select([['', 'Vse skupine'], ...A.groups.map(g => [g.id, g.name])], '', { 'aria-label': 'Skupina' });
  const statusF = select([['', 'Vsa stanja'], ['online', 'Na povezavi'], ['offline', 'Brez povezave'], ['disabled', 'Izklopljene']], '', { 'aria-label': 'Stanje' });
  const tbody = h('tbody');
  const selBar = h('div', { class: 'sel-bar', hidden: true });
  const render = () => {
    const s = search.value.toLowerCase();
    const rows = A.cameras.filter(c => (!s || [c.name, c.main_url, c.model, c.host].join(' ').toLowerCase().includes(s))
      && (!groupF.value || String(c.group_id) === groupF.value)
      && (!statusF.value || (statusF.value === 'disabled' ? !c.enabled : c.enabled && c.status === statusF.value)));
    clear(tbody);
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 8 }, emptyState(A.cameras.length ? 'Ni zadetkov' : 'Ni kamer', A.cameras.length ? 'Spremenite iskanje ali filtre.' : 'Dodajte posamezno kamero, poiščite naprave v omrežju ali uvozite vse kamere s snemalnika.'))));
    for (const c of rows) {
      const rec = A.recorders?.find?.(r => r.id === c.recorder_id);
      const cb = h('input', { type: 'checkbox', checked: selected.has(c.id), 'aria-label': `Izberi ${c.name}`, onchange: e => { e.target.checked ? selected.add(c.id) : selected.delete(c.id); renderSel(); } });
      tbody.append(h('tr', {},
        h('td', {}, cb),
        h('td', {}, h('img', { class: 'cam-thumb', loading: 'lazy', alt: '', src: c.enabled ? `/api/cameras/${c.id}/snapshot?t=${Math.floor(Date.now() / 60000)}` : '', onerror: e => { e.target.style.visibility = 'hidden'; } })),
        h('td', { class: 'name-cell' }, h('strong', {}, c.name), h('small', {}, [c.source === 'recorder' ? `Snemalnik, kanal ${c.channel}` : c.source === 'demo' ? 'Demo kamera' : c.host || 'RTSP', c.model, c.resolution].filter(Boolean).join(' · '))),
        h('td', {}, A.groups.find(g => g.id === c.group_id)?.name || h('span', { class: 'muted' }, '–')),
        h('td', {}, !c.enabled ? h('span', { class: 'badge' }, 'Izklopljena') : h('span', { class: `badge ${c.status === 'online' ? 'ok' : c.status === 'offline' ? 'err' : ''}`, title: c.status_detail || '' }, c.status === 'online' ? 'Na povezavi' : c.status === 'offline' ? 'Brez povezave' : 'Neznano')),
        h('td', {}, REC_LOC[c.rec_location], h('div', { class: 'muted', style: { fontSize: '12px' } }, c.rec_location === 'off' ? '' : `${REC_MODE[c.rec_mode]} · ${c.retention_days} dni`, c.recording ? h('span', { style: { color: 'var(--rec)' } }, ' · snema') : null, c.recording_error ? h('div', { style: { color: 'var(--alarm)' } }, c.recording_error) : null)),
        h('td', {}, c.ai_enabled ? h('span', { class: 'badge info' }, 'AI') : null, ' ', c.ptz ? h('span', { class: 'badge plain' }, 'PTZ') : null, ' ', (c.zones || []).length ? h('span', { class: 'badge plain' }, `${c.zones.length} območij`) : null),
        h('td', { class: 'actions' },
          h('button', { class: 'btn btn-sm', onclick: () => editCamera(c.id) }, icon('edit', 14), 'Uredi'), ' ',
          h('button', { class: 'btn-icon', title: 'Izbriši', 'aria-label': `Izbriši ${c.name}`, onclick: () => deleteCamera(c) }, icon('trash', 16)))));
    }
  };
  const renderSel = () => {
    selBar.hidden = !selected.size;
    clear(selBar, h('strong', {}, `Izbranih: ${selected.size}`),
      h('button', { class: 'btn btn-sm', onclick: () => bulkEdit([...selected]) }, 'Uredi skupaj'),
      h('button', { class: 'btn btn-sm', onclick: async () => { await post('/api/cameras/bulk', { ids: [...selected], changes: { enabled: 1 } }); refresh(); } }, 'Vklopi'),
      h('button', { class: 'btn btn-sm', onclick: async () => { await post('/api/cameras/bulk', { ids: [...selected], changes: { enabled: 0 } }); refresh(); } }, 'Izklopi'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { selected.clear(); renderSel(); render(); } }, 'Počisti izbiro'));
  };
  const refresh = async () => { await loadCommon(); render(); };
  for (const el of [groupF, statusF]) el.onchange = render;
  search.oninput = debounce(render, 150);
  A.recorders = await get('/api/recorders').catch(() => []);
  clear(page,
    pageHead('Kamere', `${A.cameras.length} kamer · ${A.cameras.filter(c => c.status === 'online').length} na povezavi`,
      h('button', { class: 'btn', onclick: manageGroups }, 'Skupine'),
      h('button', { class: 'btn', onclick: () => openAddRecorder() }, icon('server', 16), 'Uvozi s snemalnika'),
      h('button', { class: 'btn btn-primary', onclick: () => addCameraDialog() }, icon('plus', 16), 'Dodaj kamero')),
    h('div', { class: 'toolbar' }, search, groupF, statusF),
    selBar,
    h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {},
      h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Izberi vse', onchange: e => { A.cameras.forEach(c => e.target.checked ? selected.add(c.id) : selected.delete(c.id)); render(); renderSel(); } })),
      ...['', 'Kamera', 'Skupina', 'Stanje', 'Snemanje', 'Funkcije', ''].map(t => h('th', {}, t)))), tbody)));
  render();
}

async function deleteCamera(c) {
  const withRec = toggle(false, 'Izbriši tudi posnetke na strežniku');
  let ok = false;
  await new Promise(res => modal('Izbris kamere', h('div', {}, h('p', {}, `Kamera "${c.name}" bo odstranjena iz sistema.`), withRec), {
    onClose: res,
    actions: [{ label: 'Prekliči' }, { label: 'Izbriši kamero', kind: 'btn-danger', onClick: () => { ok = true; } }],
  }));
  if (!ok) return;
  await del(`/api/cameras/${c.id}${withRec.input.checked ? '?recordings=1' : ''}`).catch(toastErr);
  toast('Kamera je izbrisana');
  go('cameras');
}

async function manageGroups() {
  const list = h('div');
  const render = async () => {
    A.groups = await get('/api/groups');
    clear(list, A.groups.length ? A.groups.map(g => h('div', { class: 'svc' }, h('span', { class: 'n' }, g.name),
      h('button', { class: 'btn btn-sm', onclick: async () => { const n = await promptDialog('Preimenuj skupino', 'Ime', g.name); if (n) { await put(`/api/groups/${g.id}`, { name: n }); render(); } } }, 'Preimenuj'),
      h('button', { class: 'btn-icon', 'aria-label': 'Izbriši', onclick: async () => { if (await confirmDialog(`Izbrišem skupino "${g.name}"? Kamere ostanejo.`, { danger: true, ok: 'Izbriši' })) { await del(`/api/groups/${g.id}`); render(); } } }, icon('trash', 16))))
      : h('p', { class: 'muted' }, 'Ni skupin. Skupine (npr. "Zunaj", "Proizvodnja", "Skladišče") olajšajo iskanje kamer v aplikaciji View.'));
  };
  const name = h('input', { placeholder: 'Ime nove skupine' });
  modal('Skupine kamer', h('div', {}, list, h('div', { class: 'row', style: { marginTop: '12px' } }, name, h('button', { class: 'btn btn-primary', onclick: async () => { if (name.value) { await post('/api/groups', { name: name.value }); name.value = ''; render(); } } }, 'Dodaj'))), { onClose: () => go('cameras') });
  render();
}

// ---------- Dodajanje kamere ----------
export function addCameraDialog(prefill = {}) {
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div');
  const show = t => {
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    clear(body, t === 'onvif' ? onvifForm() : t === 'rtsp' ? rtspForm() : demoForm());
  };
  for (const [t, l] of [['onvif', 'ONVIF (priporočeno)'], ['rtsp', 'RTSP naslov'], ['demo', 'Demo kamera']]) tabs.append(h('button', { role: 'tab', 'data-t': t, onclick: () => show(t) }, l));
  const groupSel = () => select([['', 'Brez skupine'], ...A.groups.map(g => [g.id, g.name])], '', { name: 'group_id' });
  const recSel = () => select(Object.entries(REC_LOC).filter(([k]) => k !== 'recorder' && k !== 'both'), 'server', { name: 'rec_location' });
  let dlg;

  function onvifForm() {
    const f = h('form', { onsubmit: e => e.preventDefault() },
      h('div', { class: 'form-grid' },
        field('IP naslov kamere', h('input', { name: 'host', value: prefill.host || '', placeholder: '192.168.1.64', required: true })),
        field('ONVIF vrata', h('input', { name: 'port', type: 'number', value: prefill.port || 80 })),
        field('Uporabniško ime', h('input', { name: 'username', value: 'admin', autocomplete: 'off' })),
        field('Geslo', h('input', { name: 'password', type: 'password', autocomplete: 'new-password' }))));
    const result = h('div');
    const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Povezujem …';
      try {
        const d = formData(f);
        const r = await post('/api/onvif/probe', d);
        const checks = r.channels.map(c => ({ c, cb: h('input', { type: 'checkbox', checked: true }), name: h('input', { value: r.channels.length > 1 ? `${r.info.model || 'Kamera'} ${c.index}` : (r.info.model || 'Kamera'), style: { height: '30px' } }) }));
        const g = groupSel(), rl = recSel();
        clear(result, h('hr'),
          h('dl', { class: 'info-grid' }, h('dt', {}, 'Proizvajalec'), h('dd', {}, r.info.manufacturer || '–'), h('dt', {}, 'Model'), h('dd', {}, r.info.model || '–'), h('dt', {}, 'Serijska št.'), h('dd', {}, r.info.serial || '–'), h('dt', {}, 'Firmware'), h('dd', {}, r.info.firmware || '–'), h('dt', {}, 'PTZ / dogodki'), h('dd', {}, `${r.ptz ? 'da' : 'ne'} / ${r.events ? 'da' : 'ne'}`)),
          h('div', { class: 'chan-list' }, h('table', {}, h('tbody', {}, checks.map(({ c, cb, name }) => h('tr', {}, h('td', {}, cb), h('td', {}, name), h('td', { class: 'muted' }, `${c.resolution || ''} ${c.codec || ''}`), h('td', { class: 'mono muted' }, c.main_url_display?.replace(/^rtsp:\/\/[^/]+/, '') || '')))))),
          h('div', { class: 'form-grid', style: { marginTop: '12px' } }, field('Skupina', g), field('Snemanje', rl)),
          h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
            const cams = checks.filter(x => x.cb.checked).map(({ c, name }) => ({
              name: name.value, source: 'onvif', host: d.host, http_port: Number(d.port) || 80, onvif_port: Number(d.port) || 80, username: d.username, password: d.password,
              main_url: c.main_url, sub_url: c.sub_url, snapshot_url: c.snapshot_url, model: r.info.model, serial: r.info.serial, firmware: r.info.firmware, mac: r.info.mac,
              resolution: c.resolution, codec: c.codec, ptz: c.ptz ? 1 : 0, audio: c.audio ? 1 : 0, channel: c.index, group_id: g.value || null, rec_location: rl.value, vendor: (r.info.manufacturer || '').toLowerCase(),
            }));
            if (!cams.length) return toast('Izberite vsaj en kanal', 'warn');
            try { await post('/api/cameras', { cameras: cams }); toast(`Dodanih kamer: ${cams.length}`); dlg.close(); go('cameras'); } catch (e) { toastErr(e); }
          } }, `Dodaj izbrane kamere`));
      } catch (e) { clear(result, h('p', { class: 'form-error' }, e.message)); }
      finally { btn.disabled = false; btn.textContent = 'Poveži in preberi kamero'; }
    } }, 'Poveži in preberi kamero');
    return h('div', {}, h('p', { class: 'muted' }, 'VisionOne prek ONVIF prebere model, tokove (glavni in podtok), PTZ in dogodke kamere. ONVIF mora biti na kameri vklopljen.'), f, btn, result);
  }

  function rtspForm() {
    const f = h('form', { onsubmit: e => e.preventDefault() },
      field('Ime kamere', h('input', { name: 'name', value: prefill.name || '', required: true })),
      field('Glavni tok (RTSP)', h('input', { name: 'main_url', value: prefill.main_url || '', placeholder: 'rtsp://192.168.1.64:554/Streaming/Channels/101' }), 'Uporabniško ime in geslo lahko vpišete spodaj ali neposredno v naslov.'),
      field('Podtok za predogled (neobvezno)', h('input', { name: 'sub_url', placeholder: 'rtsp://192.168.1.64:554/Streaming/Channels/102' }), 'Manjša ločljivost razbremeni brskalnik pri mreži več kamer.'),
      h('div', { class: 'form-grid' },
        field('Uporabniško ime', h('input', { name: 'username', autocomplete: 'off' })),
        field('Geslo', h('input', { name: 'password', type: 'password', autocomplete: 'new-password' })),
        field('IP naslov (za nadzor povezave in PTZ)', h('input', { name: 'host', value: prefill.host || '' })),
        field('Skupina', groupSel()), field('Snemanje', recSel())));
    const out = h('div');
    return h('div', {}, f, out, h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        const d = formData(f);
        clear(out, h('p', { class: 'muted' }, 'Preverjam tok …'));
        try { const r = await post('/api/cameras/test-stream', { url: d.main_url, username: d.username, password: d.password }); clear(out, h('p', { style: { color: 'var(--ok)' } }, `Tok deluje: ${r.streams.map(s => s.codec_type === 'video' ? `video ${s.codec_name} ${s.width}×${s.height}` : `zvok ${s.codec_name}`).join(', ')}`)); }
        catch (e) { clear(out, h('p', { class: 'form-error' }, e.message)); }
      } }, 'Preizkusi tok'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        const d = formData(f);
        if (!d.name || !d.main_url) return toast('Ime in glavni tok sta obvezna', 'warn');
        try { await post('/api/cameras', { ...d, source: 'manual', group_id: d.group_id || null }); toast('Kamera je dodana'); dlg.close(); go('cameras'); } catch (e) { toastErr(e); }
      } }, 'Dodaj kamero')));
  }

  function demoForm() {
    const n = h('input', { type: 'number', min: 1, max: 16, value: 1 });
    const g = groupSel();
    return h('div', {}, h('p', { class: 'muted' }, 'Demo kamera prikazuje testno sliko. Uporabna je za preizkus snemanja, pravil, izvoza in pogledov brez prave kamere.'),
      h('div', { class: 'form-grid' }, field('Število kamer', n), field('Skupina', g)),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const cams = Array.from({ length: Number(n.value) || 1 }, () => ({ source: 'demo', group_id: g.value || null, rec_location: 'server', resolution: '1280x720', codec: 'H264' }));
        await post('/api/cameras', { cameras: cams }).catch(toastErr); toast('Demo kamere so dodane'); dlg.close(); go('cameras');
      } }, 'Dodaj demo kamere'));
  }
  dlg = modal('Dodaj kamero', h('div', {}, tabs, body), { wide: true });
  show(prefill.tab || 'onvif');
}

// ---------- Urejanje kamere ----------
export async function editCamera(id) {
  await loadCommon();
  const c = await get(`/api/cameras/${id}`);
  const isRec = !!c.recorder_id;
  const snap = `/api/cameras/${c.id}/snapshot?hq=1&t=${Date.now()}`;
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const panes = {};
  const f = (name, el) => { el.name = name; return el; };
  const inp = (name, val, attrs = {}) => h('input', { name, value: val ?? '', ...attrs });
  const num = (name, val, attrs = {}) => h('input', { name, type: 'number', value: val ?? '', ...attrs });

  panes.basic = h('div', {},
    h('div', { class: 'form-grid' },
      field('Ime kamere', inp('name', c.name)),
      field('Skupina', select([['', 'Brez skupine'], ...A.groups.map(g => [g.id, g.name])], c.group_id, { name: 'group_id' })),
      field('Model', inp('model', c.model)), field('Serijska številka', inp('serial', c.serial)),
      field('MAC naslov', inp('mac', c.mac)), field('Firmware', inp('firmware', c.firmware)),
      field('Ločljivost', inp('resolution', c.resolution)), field('Kodek', inp('codec', c.codec))),
    h('div', { class: 'checks', style: { gap: '4px 24px' } },
      tg('enabled', c.enabled, 'Kamera je vklopljena'), tg('ptz', c.ptz, 'PTZ (vrtljiva kamera)'), tg('audio', c.audio, 'Zvok'),
      tg('two_way_audio', c.two_way_audio, 'Dvosmerni zvok (domofon, zvočnik)'), tg('fisheye', c.fisheye, 'Ribje oko (360°)')));

  panes.stream = c.source === 'demo' ? h('p', { class: 'muted' }, 'Demo kamera nima nastavitev povezave.') : h('div', {},
    isRec ? h('div', { class: 'explain' }, h('p', {}, `Kamera je uvožena s snemalnika (kanal ${c.channel}). Naslove samodejno posodablja VisionOne, ko spremenite podatke snemalnika.`)) : null,
    field('Glavni tok (RTSP)', inp('main_url', c.main_url), 'Geslo je skrito kot ***. Pustite ga tako, če ga ne spreminjate.'),
    field('Podtok (RTSP)', inp('sub_url', c.sub_url)),
    h('div', { class: 'form-grid' },
      field('IP naslov', inp('host', c.host)), field('HTTP / ONVIF vrata', num('onvif_port', c.onvif_port || c.http_port || 80)),
      field('Uporabniško ime', inp('username', c.username, { autocomplete: 'off' })), field('Geslo', h('input', { name: 'password', type: 'password', placeholder: c.has_password ? 'nespremenjeno' : '', autocomplete: 'new-password' }))),
    tg('onvif_events', c.onvif_events, 'Sprejemaj ONVIF dogodke kamere (gibanje, linija, sabotaža)'),
    c.onvif_events_error ? h('p', { class: 'form-error' }, `ONVIF dogodki: ${c.onvif_events_error}`) : null,
    !isRec && c.host ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await post(`/api/cameras/${c.id}/refresh`); toast('Podatki kamere so osveženi'); } catch (e) { toastErr(e); } } }, icon('refresh', 14), 'Preberi podatke iz kamere') : null);

  const sched = scheduleEditor(c.rec_schedule);
  const locChoice = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': 'Kje se snema' },
    [['server', 'Na strežnik', 'Vgrajeni diski strežnika. Pametno iskanje in hitro predvajanje.'],
      ['recorder', 'Na snemalnik', 'NVR snema sam, VisionOne posnetke predvaja z njega.', !isRec],
      ['both', 'Oboje', 'Dvojna varnost: posnetek na snemalniku in na strežniku.', !isRec],
      ['off', 'Ne snemaj', 'Samo živa slika.']].map(([v, l, d, dis]) => h('label', { style: dis ? { opacity: .5 } : {} }, h('input', { type: 'radio', name: 'rec_location', value: v, checked: c.rec_location === v, disabled: !!dis }), h('strong', {}, l), h('small', {}, dis ? 'Na voljo za kamere s snemalnika.' : d))));
  const schedWrap = h('fieldset', { hidden: c.rec_mode !== 'schedule' }, h('legend', {}, 'Urnik snemanja'), sched);
  const modeSel = select(Object.entries(REC_MODE), c.rec_mode, { name: 'rec_mode', onchange: e => { schedWrap.hidden = e.target.value !== 'schedule'; } });
  panes.rec = h('div', {}, locChoice,
    h('div', { class: 'form-grid' },
      field('Način snemanja', modeSel, 'Ob dogodku: VisionOne snema neprekinjeno v medpomnilnik in ohrani le odseke z dogodki.'),
      field('Tok za snemanje', select([['main', 'Glavni tok (polna ločljivost)'], ['sub', 'Podtok (manj prostora)']], c.rec_stream, { name: 'rec_stream' })),
      field('Rok hrambe (dni)', num('retention_days', c.retention_days, { min: 1, max: 3650 }), 'Starejši posnetki se samodejno brišejo (razen zaklenjenih).'),
      field('Disk na strežniku', select([['', 'Samodejno (največ prostora)'], ...A.pools.map(p => [p.id, p.name])], c.pool_id, { name: 'pool_id' })),
      field('Pred-snemanje (s)', num('pre_seconds', c.pre_seconds, { min: 0, max: 120 })),
      field('Po-snemanje (s)', num('post_seconds', c.post_seconds, { min: 0, max: 600 }))),
    schedWrap);

  const zones = zoneEditor(snap, c.zones, AI_CLASSES);
  const classes = new Set(String(c.ai_classes || '').split(',').filter(Boolean));
  panes.ai = h('div', {},
    h('div', { class: 'explain' }, h('p', {}, 'Pametne funkcije izvaja modul VisionOne AI (neobvezna storitev v docker-compose). Zazna osebe, vozila in živali, prečkanja linij, vstop v območja, zadrževanje in sabotažo kamere. Dogodki so na voljo v pametnem iskanju, statistiki in pravilih.')),
    tg('ai_enabled', c.ai_enabled, 'Vklopi AI zaznavanje objektov'),
    h('div', { class: 'field' }, h('label', {}, 'Zaznavaj'), h('div', { class: 'checks' }, AI_CLASSES.map(([k, l]) => h('label', {}, h('input', { type: 'checkbox', 'data-cls': k, checked: classes.has(k) }), l)))),
    h('div', { class: 'form-grid' },
      field('Najmanjša zanesljivost', num('ai_min_score', c.ai_min_score, { min: 0.2, max: 0.95, step: 0.05 }), 'Višja vrednost = manj lažnih alarmov.'),
      field('Analiz na sekundo', num('ai_fps', c.ai_fps, { min: 0.5, max: 10, step: 0.5 }), 'Več = natančnejše sledenje, a večja obremenitev.')),
    tg('tamper_detect', c.tamper_detect, 'Zaznavaj sabotažo (prekrita, zamegljena ali premaknjena kamera)'),
    h('h3', { style: { marginTop: '10px' } }, 'Območja in linije'), zones);

  const masks = maskEditor(snap, c.masks);
  panes.privacy = masks;

  const order = [['basic', 'Osnovno'], ['stream', 'Povezava'], ['rec', 'Snemanje'], ['ai', 'Pametne funkcije'], ['privacy', 'Zasebnost']];
  const bodyEl = h('div');
  const showTab = t => { tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === t))); for (const [k] of order) panes[k].hidden = k !== t; };
  for (const [k, l] of order) { tabs.append(h('button', { role: 'tab', 'data-t': k, type: 'button', onclick: () => showTab(k) }, l)); bodyEl.append(panes[k]); }
  showTab('basic');
  modal(`Kamera: ${c.name}`, h('div', {}, tabs, bodyEl), {
    wide: true,
    actions: [{ label: 'Prekliči' }, { label: 'Shrani', kind: 'btn-primary', onClick: async () => {
      const d = formData(bodyEl);
      d.rec_location = bodyEl.querySelector('input[name=rec_location]:checked')?.value || c.rec_location;
      d.group_id = d.group_id || null; d.pool_id = d.pool_id || null;
      d.rec_schedule = sched.value();
      d.ai_classes = [...bodyEl.querySelectorAll('[data-cls]')].filter(x => x.checked).map(x => x.dataset.cls).join(',');
      d.zones = zones.value(); d.masks = masks.value();
      if (!d.password) delete d.password;
      if (c.source === 'demo') { delete d.main_url; delete d.sub_url; }
      await put(`/api/cameras/${c.id}`, d);
      toast('Kamera je shranjena');
      if (location.hash === '#cameras' || !location.hash) go('cameras');
    } }],
  });
}
function tg(name, val, label) { const t = toggle(val, label); t.input.name = name; return t; }

async function bulkEdit(ids) {
  await loadCommon();
  const sched = scheduleEditor(null);
  const fields = h('div', {},
    h('p', { class: 'muted' }, `Spremembe veljajo za ${ids.length} kamer. Polja z vrednostjo "Ne spreminjaj" ostanejo kot so.`),
    h('div', { class: 'form-grid' },
      field('Skupina', select([['_', 'Ne spreminjaj'], ['', 'Brez skupine'], ...A.groups.map(g => [g.id, g.name])], '_', { name: 'group_id' })),
      field('Kje se snema', select([['_', 'Ne spreminjaj'], ...Object.entries(REC_LOC)], '_', { name: 'rec_location' })),
      field('Način snemanja', select([['_', 'Ne spreminjaj'], ...Object.entries(REC_MODE)], '_', { name: 'rec_mode' })),
      field('Rok hrambe (dni)', h('input', { name: 'retention_days', type: 'number', placeholder: 'Ne spreminjaj' })),
      field('Disk', select([['_', 'Ne spreminjaj'], ['', 'Samodejno'], ...A.pools.map(p => [p.id, p.name])], '_', { name: 'pool_id' })),
      field('AI zaznavanje', select([['_', 'Ne spreminjaj'], ['1', 'Vklopi'], ['0', 'Izklopi']], '_', { name: 'ai_enabled' })),
      field('Zaznava sabotaže', select([['_', 'Ne spreminjaj'], ['1', 'Vklopi'], ['0', 'Izklopi']], '_', { name: 'tamper_detect' }))),
    h('details', {}, h('summary', {}, 'Nastavi skupen urnik snemanja'), h('div', { style: { marginTop: '10px' } }, sched)));
  let useSched = false;
  fields.querySelector('details').addEventListener('toggle', e => { useSched = e.target.open; });
  modal('Skupno urejanje kamer', fields, {
    wide: true,
    actions: [{ label: 'Prekliči' }, { label: 'Uveljavi', kind: 'btn-primary', onClick: async () => {
      const d = formData(fields), changes = {};
      for (const [k, v] of Object.entries(d)) if (v !== '_' && v !== null && v !== '') changes[k] = ['ai_enabled', 'tamper_detect'].includes(k) ? Number(v) : v;
      if (d.group_id === '') changes.group_id = null;
      if (d.pool_id === '') changes.pool_id = null;
      if (useSched) changes.rec_schedule = sched.value();
      await post('/api/cameras/bulk', { ids, changes });
      toast('Spremembe so shranjene'); go('cameras');
    } }],
  });
}

export { REC_LOC, REC_MODE, AI_CLASSES };
boot().catch(e => { document.body.textContent = `Napaka pri zagonu: ${e.message}`; });
