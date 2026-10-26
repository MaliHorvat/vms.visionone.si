// VisionOne Admin – snemalniki (uvoz kamer), iskanje naprav v omrežju, snemanje in diski
import { h, clear, icon, get, post, put, del, toast, toastErr, modal, confirmDialog, field, select, toggle, formData, fmtBytes, fmtAgo, fmtDateTime, emptyState } from '../common/core.js';
import { A, go, pageHead, loadCommon, addCameraDialog, REC_LOC } from './admin.js';

const VENDORS = [['auto', 'Samodejno prepoznaj'], ['hikvision', 'Hikvision / HiLook / HiWatch'], ['dahua', 'Dahua / Imou / Lorex'], ['uniview', 'Uniview (UNV)'], ['onvif', 'Drug proizvajalec (ONVIF)'], ['generic', 'Ročno (predloga RTSP)']];
const vendorName = v => (VENDORS.find(x => x[0] === v) || [v, v])[1];

// ======================= SNEMALNIKI =======================
export async function pageRecorders(page) {
  const recs = await get('/api/recorders');
  const tbody = h('tbody');
  for (const r of recs) {
    tbody.append(h('tr', {},
      h('td', { class: 'name-cell' }, h('strong', {}, r.name), h('small', {}, [vendorName(r.vendor), r.model].filter(Boolean).join(' · '))),
      h('td', { class: 'mono' }, `${r.host}:${r.http_port}`),
      h('td', {}, h('span', { class: `badge ${r.status === 'online' ? 'ok' : r.status === 'offline' ? 'err' : ''}` }, r.status === 'online' ? 'Na povezavi' : r.status === 'offline' ? 'Brez povezave' : 'Neznano'), h('div', { class: 'muted', style: { fontSize: '12px' } }, r.last_seen ? `Nazadnje ${fmtAgo(r.last_seen)}` : '')),
      h('td', {}, `${r.camera_count} kamer`),
      h('td', {}, r.disks.length ? r.disks.map(d => h('div', { style: { fontSize: '12.5px' } }, `${d.name}: `, h('span', { style: { color: /ok|normal|idle|sleep|running/i.test(d.status || '') ? 'var(--ok)' : 'var(--alarm)' } }, d.status || '–'), d.capacity_gb ? h('span', { class: 'muted' }, ` · ${d.free_gb}/${d.capacity_gb} GB prosto`) : null)) : h('span', { class: 'muted' }, '–')),
      h('td', { class: 'actions' },
        h('button', { class: 'btn btn-sm', title: 'Ponovno preberi kanale in dodaj nove kamere', onclick: async e => { e.target.disabled = true; try { const x = await post(`/api/recorders/${r.id}/sync`, {}); toast(`Prebranih ${x.channels} kanalov, dodanih ${x.added} novih kamer`); go('recorders'); } catch (er) { toastErr(er); e.target.disabled = false; } } }, icon('refresh', 14), 'Sinhroniziraj'), ' ',
        h('button', { class: 'btn btn-sm', onclick: () => editRecorder(r) }, 'Uredi'), ' ',
        h('button', { class: 'btn-icon', 'aria-label': 'Izbriši', onclick: async () => { if (await confirmDialog(`Izbrišem snemalnik "${r.name}" in vseh ${r.camera_count} njegovih kamer iz VisionOne? Posnetki na snemalniku ostanejo.`, { danger: true, ok: 'Izbriši' })) { await del(`/api/recorders/${r.id}`); toast('Snemalnik je izbrisan'); go('recorders'); } } }, icon('trash', 16)))));
  }
  clear(page,
    pageHead('Snemalniki', 'NVR, DVR in XVR naprave. Ob dodajanju VisionOne prebere vse kanale in jih doda kot kamere.',
      h('button', { class: 'btn btn-primary', onclick: () => openAddRecorder() }, icon('plus', 16), 'Dodaj snemalnik')),
    recs.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Snemalnik', 'Naslov', 'Stanje', 'Kamere', 'Diski', ''].map(t => h('th', {}, t)))), tbody))
      : h('div', { class: 'panel' }, emptyState('Ni snemalnikov', 'Dodajte snemalnik z IP naslovom in prijavnimi podatki. VisionOne bo prebral vse kamere, njihova imena in stanje diskov.', h('button', { class: 'btn btn-primary', onclick: () => openAddRecorder() }, 'Dodaj snemalnik'))));
}

export async function openAddRecorder(prefill = {}) {
  await loadCommon();
  const tplFields = h('div', { hidden: true },
    field('Predloga glavnega toka', h('input', { name: 'main_template', value: 'rtsp://{user}:{pass}@{host}:{port}/ch{ch}/main' }), 'Spremenljivke: {host}, {port}, {ch}, {user}, {pass}'),
    field('Predloga podtoka', h('input', { name: 'sub_template', value: 'rtsp://{user}:{pass}@{host}:{port}/ch{ch}/sub' })),
    field('Število kanalov', h('input', { name: 'channels', type: 'number', value: 8 })));
  const vendor = select(VENDORS, prefill.vendor || 'auto', { name: 'vendor', onchange: e => { tplFields.hidden = e.target.value !== 'generic'; } });
  const f = h('form', { onsubmit: e => e.preventDefault() },
    h('div', { class: 'form-grid' },
      field('Ime snemalnika', h('input', { name: 'name', value: prefill.name || 'Snemalnik', required: true })),
      field('Proizvajalec', vendor),
      field('IP naslov', h('input', { name: 'host', value: prefill.host || '', placeholder: '192.168.1.100', required: true })),
      field('HTTP vrata', h('input', { name: 'http_port', type: 'number', value: prefill.http_port || 80 })),
      field('RTSP vrata', h('input', { name: 'rtsp_port', type: 'number', value: 554 })),
      field('Uporabniško ime', h('input', { name: 'username', value: 'admin', autocomplete: 'off' })),
      field('Geslo', h('input', { name: 'password', type: 'password', autocomplete: 'new-password' }))),
    tplFields);
  const result = h('div');
  let dlg;
  const connect = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    connect.disabled = true; connect.textContent = 'Povezujem in berem kanale …';
    const d = formData(f);
    try {
      const r = await post('/api/recorders/probe', d);
      const rows = r.channels.map(c => ({ c, cb: h('input', { type: 'checkbox', checked: c.online !== false }), name: h('input', { value: c.name, style: { height: '30px' } }) }));
      const loc = h('div', { class: 'choice' }, [['recorder', 'Na snemalniku', 'Snemalnik snema kot doslej, VisionOne predvaja z njega.'], ['server', 'Na strežniku', 'VisionOne snema na svoje diske.'], ['both', 'Oboje', 'Posnetek na obeh mestih.']]
        .map(([v, l, dd], i) => h('label', {}, h('input', { type: 'radio', name: 'imp_loc', value: v, checked: i === 0 }), h('strong', {}, l), h('small', {}, dd))));
      const grp = select([['', 'Brez skupine'], ['__new', `Nova skupina "${d.name}"`], ...A.groups.map(g => [g.id, g.name])], '__new');
      const ret = h('input', { type: 'number', value: 30, min: 1 });
      const all = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Izberi vse', onchange: e => rows.forEach(x => { x.cb.checked = e.target.checked; }) });
      clear(result, h('hr'),
        h('dl', { class: 'info-grid' },
          h('dt', {}, 'Prepoznan kot'), h('dd', {}, vendorName(r.vendor)), h('dt', {}, 'Model'), h('dd', {}, r.info.model || '–'),
          h('dt', {}, 'Serijska št.'), h('dd', {}, r.info.serial || '–'), h('dt', {}, 'Firmware'), h('dd', {}, r.info.firmware || '–'),
          h('dt', {}, 'Diski'), h('dd', {}, r.disks.length ? r.disks.map(x => `${x.name} (${x.status}, ${x.capacity_gb} GB)`).join(', ') : '–')),
        h('h3', {}, `Najdenih kanalov: ${r.channels.length}`),
        h('div', { class: 'chan-list table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, all), h('th', {}, 'Kanal'), h('th', {}, 'Ime kamere'), h('th', {}, 'Stanje'), h('th', {}, 'IP kamere'))),
          h('tbody', {}, rows.map(({ c, cb, name }) => h('tr', {}, h('td', {}, cb), h('td', {}, c.channel), h('td', {}, name),
            h('td', {}, c.online === false ? h('span', { class: 'badge err' }, 'Ni signala') : c.online ? h('span', { class: 'badge ok' }, 'Deluje') : h('span', { class: 'muted' }, '–')), h('td', { class: 'mono muted' }, c.ip || '')))))),
        h('h3', { style: { marginTop: '16px' } }, 'Kje naj se snema?'), loc,
        h('div', { class: 'form-grid' }, field('Skupina', grp), field('Rok hrambe na strežniku (dni)', ret)),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async e => {
          const chosen = rows.filter(x => x.cb.checked).map(({ c, name }) => ({ ...c, name: name.value }));
          if (!chosen.length) return toast('Izberite vsaj en kanal', 'warn');
          e.target.disabled = true;
          try {
            let group_id = grp.value || null;
            if (group_id === '__new') group_id = (await post('/api/groups', { name: d.name })).id;
            const res = await post('/api/recorders', { ...d, vendor: r.vendor, model: r.info.model, serial: r.info.serial, firmware: r.info.firmware, mac: r.info.mac, channels: r.channels.length,
              channels_selected: chosen, rec_location: result.querySelector('input[name=imp_loc]:checked').value, group_id, retention_days: Number(ret.value) || 30, generic: d.vendor === 'generic' });
            toast(`Snemalnik je dodan, uvoženih kamer: ${res.imported}`);
            dlg.close(); go('cameras');
          } catch (er) { toastErr(er); e.target.disabled = false; }
        } }, 'Dodaj snemalnik in uvozi kamere'));
    } catch (e) { clear(result, h('p', { class: 'form-error' }, e.message)); }
    finally { connect.disabled = false; connect.textContent = 'Poveži in preberi kanale'; }
  } }, 'Poveži in preberi kanale');
  dlg = modal('Dodaj snemalnik', h('div', {},
    h('p', { class: 'muted' }, 'Podprti so Hikvision (ISAPI), Dahua (CGI), Uniview in vsi snemalniki z ONVIF. Za Hikvision in Dahua VisionOne prebere tudi imena kamer, stanje kanalov in diskov ter omogoča predvajanje posnetkov s snemalnika.'),
    f, connect, result), { wide: true });
}

function editRecorder(r) {
  const f = h('form', {}, h('div', { class: 'form-grid' },
    field('Ime', h('input', { name: 'name', value: r.name })),
    field('Proizvajalec', select(VENDORS.filter(v => v[0] !== 'auto'), r.vendor, { name: 'vendor' })),
    field('IP naslov', h('input', { name: 'host', value: r.host })),
    field('HTTP vrata', h('input', { name: 'http_port', type: 'number', value: r.http_port })),
    field('RTSP vrata', h('input', { name: 'rtsp_port', type: 'number', value: r.rtsp_port })),
    field('Uporabniško ime', h('input', { name: 'username', value: r.username || '' })),
    field('Geslo', h('input', { name: 'password', type: 'password', placeholder: 'nespremenjeno', autocomplete: 'new-password' }))));
  modal(`Snemalnik: ${r.name}`, h('div', {}, f, h('p', { class: 'muted' }, 'Ob spremembi naslova ali gesla VisionOne posodobi tokove vseh kamer tega snemalnika.')), {
    actions: [{ label: 'Prekliči' }, { label: 'Shrani', kind: 'btn-primary', onClick: async () => { await put(`/api/recorders/${r.id}`, formData(f)); toast('Snemalnik je shranjen'); go('recorders'); } }],
  });
}

// ======================= ISKANJE NAPRAV =======================
export async function pageDiscovery(page) {
  const sub = await get('/api/discovery/subnets');
  const suggestions = [...new Set([...(sub.saved || []), ...sub.local.map(s => s.range)])];
  const range = h('input', { value: sub.saved?.slice(-1)[0] || '192.168.1.0/24', list: 'ranges', 'aria-label': 'IP območje', style: { maxWidth: '320px' } });
  const out = h('div');
  const btn = h('button', { class: 'btn btn-primary', onclick: async () => {
    btn.disabled = true; btn.textContent = 'Iščem …';
    clear(out, h('div', { class: 'panel' }, h('p', {}, 'Pregledujem omrežje (ONVIF in vrata 80, 554, 8000, 37777). To lahko traja do minute.'), h('div', { class: 'meter' }, h('span', { style: { width: '35%' } }))));
    try {
      const res = await post('/api/discovery/scan', { range: range.value });
      clear(out, res.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['IP naslov', 'Vrsta', 'Proizvajalec / ime', 'Odprta vrata', 'ONVIF', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, res.map(d => h('tr', {},
          h('td', { class: 'mono' }, d.ip),
          h('td', {}, d.kind === 'recorder' ? 'Snemalnik' : 'Kamera'),
          h('td', {}, [d.vendor && vendorName(d.vendor), d.name, d.hardware].filter(Boolean).join(' · ') || h('span', { class: 'muted' }, 'neznano')),
          h('td', { class: 'mono muted' }, (d.ports || []).join(', ')),
          h('td', {}, d.onvif ? h('span', { class: 'badge ok' }, 'da') : h('span', { class: 'muted' }, 'ne')),
          h('td', { class: 'actions' }, d.added ? h('span', { class: 'badge info' }, 'Že dodano') : h('div', { class: 'btn-row', style: { justifyContent: 'flex-end' } },
            h('button', { class: 'btn btn-sm', onclick: () => addCameraDialog({ host: d.ip, port: d.port || 80, tab: d.onvif ? 'onvif' : 'rtsp' }) }, 'Kot kamero'),
            h('button', { class: 'btn btn-sm', onclick: () => openAddRecorder({ host: d.ip, vendor: d.vendor || 'auto', http_port: d.port || 80, name: d.name || 'Snemalnik' }) }, 'Kot snemalnik'))))))))
        : h('div', { class: 'panel' }, emptyState('Ni najdenih naprav', 'Preverite IP območje. V Docker Desktop (Windows/macOS) vpišite območje svojega lokalnega omrežja, npr. 192.168.1.0/24.')));
    } catch (e) { clear(out, h('p', { class: 'form-error' }, e.message)); }
    finally { btn.disabled = false; btn.textContent = 'Poišči naprave'; }
  } }, 'Poišči naprave');
  clear(page,
    pageHead('Iskanje naprav', 'Poišči kamere in snemalnike v lokalnem omrežju.'),
    h('div', { class: 'explain' }, h('p', {}, 'VisionOne pošlje ONVIF poizvedbo vsakemu naslovu v območju in preveri značilna vrata (Hikvision 8000, Dahua 37777, RTSP 554). Najdene naprave dodate z enim klikom.'),
      h('p', { class: 'muted' }, 'Lokalna omrežja strežnika: ', sub.local.map(s => `${s.address} (${s.iface})`).join(', ') || '–', '. Če VisionOne teče v Docker Desktop, so to notranja omrežja Dockerja – vpišite območje svojega LAN.')),
    h('div', { class: 'row', style: { marginBottom: '16px' } }, range, h('datalist', { id: 'ranges' }, suggestions.map(s => h('option', { value: s }))), btn),
    out);
}

// ======================= SNEMANJE IN DISKI =======================
export async function pageStorage(page) {
  const [st] = await Promise.all([get('/api/storage'), loadCommon()]);
  const camName = id => A.cameras.find(c => c.id === id)?.name || `Kamera ${id} (izbrisana)`;
  const pools = st.pools.map(p => {
    const pct = p.disk.total ? (p.disk.used / p.disk.total) * 100 : 0;
    const days = p.oldest ? (Date.now() / 1000 - p.oldest) / 86400 : 0;
    return h('div', { class: 'panel' },
      h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, p.name), p.enabled ? null : h('span', { class: 'badge' }, 'Izklopljen'), h('span', { class: 'spacer' }),
        h('button', { class: 'btn btn-sm', onclick: () => editPool(p) }, 'Uredi'),
        h('button', { class: 'btn-icon', 'aria-label': 'Odstrani', onclick: async () => { if (await confirmDialog(`Odstranim disk "${p.name}" iz VisionOne? Datoteke na disku ostanejo, a ne bodo več vidne v predvajanju.`, { danger: true, ok: 'Odstrani' })) { try { await del(`/api/storage/pools/${p.id}`); go('storage'); } catch (e) { toastErr(e); } } } }, icon('trash', 16))),
      h('p', { class: 'mono muted', style: { margin: '4px 0 10px' } }, p.path),
      p.disk.error ? h('p', { class: 'form-error' }, p.disk.error) : h('div', {},
        h('div', { class: `meter ${pct > 95 ? 'alarm' : pct > 85 ? 'warn' : ''}`, style: { height: '10px', borderRadius: '5px' } }, h('span', { style: { width: `${pct}%` } })),
        h('div', { class: 'row', style: { marginTop: '8px', fontSize: '13px' } },
          h('span', {}, `Zasedeno ${fmtBytes(p.disk.used)} od ${fmtBytes(p.disk.total)}`), h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `Prosto ${fmtBytes(p.disk.free)}`))),
      h('dl', { class: 'info-grid', style: { marginTop: '10px' } },
        h('dt', {}, 'Posnetki VisionOne'), h('dd', {}, `${fmtBytes(p.vms_used)} v ${p.segments} datotekah`),
        h('dt', {}, 'Najstarejši posnetek'), h('dd', {}, p.oldest ? `${fmtDateTime(p.oldest)} (${days.toFixed(1)} dni)` : '–'),
        h('dt', {}, 'Omejitev'), h('dd', {}, p.quota_gb ? `${p.quota_gb} GB` : `do ${p.min_free_percent} % prostega prostora`)));
  });
  const camRows = st.per_camera.sort((a, b) => b.size - a.size).map(r => {
    const days = (r.newest - r.oldest) / 86400;
    return h('tr', {}, h('td', {}, camName(r.camera_id)), h('td', {}, st.pools.find(p => p.id === r.pool_id)?.name || '–'),
      h('td', { class: 'num' }, fmtBytes(r.size)), h('td', { class: 'num' }, days.toFixed(1)), h('td', { class: 'num' }, days > 0.04 ? fmtBytes(r.size / days) : '–'),
      h('td', {}, fmtDateTime(r.oldest)), h('td', {}, st.recording[r.camera_id] ? h('span', { class: 'badge ok' }, 'Snema') : h('span', { class: 'muted' }, '–')));
  });
  clear(page,
    pageHead('Snemanje in diski', `Posnetki se shranjujejo v ${st.root} (v Dockerju priklopljeni diski strežnika).`,
      h('button', { class: 'btn', onclick: async () => { const r = await post('/api/storage/reindex'); toast(`Najdenih ${r.added} novih posnetkov`); go('storage'); } }, 'Ponovno indeksiraj'),
      h('button', { class: 'btn', onclick: async () => { const r = await post('/api/storage/cleanup'); toast(`Izbrisanih ${r.removed} starih posnetkov`); go('storage'); } }, 'Počisti zdaj'),
      h('button', { class: 'btn btn-primary', onclick: () => addPool(st) }, icon('plus', 16), 'Dodaj disk')),
    h('div', { class: 'explain' },
      h('p', {}, h('strong', {}, 'Snemanje na snemalnik ali na strežnik. '), 'Za vsako kamero posebej izberete, ali posnetke hrani snemalnik (NVR), strežnik VisionOne (vgrajeni diski) ali oboje. Nastavite pri kameri na zavihku Snemanje ali skupaj za več kamer na strani Kamere.'),
      h('p', {}, 'Ko je disk poln, VisionOne briše najstarejše posnetke. Zaklenjeni posnetki (zaznamki, pravila) se ne brišejo.')),
    h('div', { class: 'grid-2', style: { marginBottom: '16px' } }, pools),
    h('h2', {}, 'Poraba po kamerah'),
    camRows.length ? h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['Kamera', 'Disk', 'Velikost', 'Dni posnetkov', 'Na dan', 'Najstarejši', 'Stanje'].map((t, i) => h('th', { class: [2, 3, 4].includes(i) ? 'num' : '' }, t)))), h('tbody', {}, camRows)))
      : h('p', { class: 'muted' }, 'Na strežniku še ni posnetkov.'));
}

function addPool(st) {
  const name = h('input', { value: `Disk ${st.pools.length + 1}` });
  const path = h('input', { value: st.mounts[0]?.path || `${st.root}/disk${st.pools.length + 1}`, list: 'mounts' });
  const quota = h('input', { type: 'number', value: 0, min: 0 });
  const minFree = h('input', { type: 'number', value: 5, min: 1, max: 50 });
  modal('Dodaj disk za snemanje', h('div', {},
    h('div', { class: 'explain' }, h('p', {}, 'Disk najprej priklopite v docker-compose.yml, npr. ', h('code', {}, '- D:/VisionOne/disk2:/recordings/disk2'), ', in ponovno zaženite VisionOne. Nato ga tukaj dodajte.')),
    st.mounts.length ? h('p', { class: 'muted' }, 'Priklopljeni, še neuporabljeni: ', st.mounts.map(m => `${m.path} (${fmtBytes(m.free)} prosto)`).join(', ')) : null,
    field('Ime', name), field('Pot v vsebniku', path), h('datalist', { id: 'mounts' }, st.mounts.map(m => h('option', { value: m.path }))),
    h('div', { class: 'form-grid' }, field('Največja poraba (GB, 0 = brez)', quota), field('Najmanj prostega prostora (%)', minFree))), {
    actions: [{ label: 'Prekliči' }, { label: 'Dodaj disk', kind: 'btn-primary', onClick: async () => { await post('/api/storage/pools', { name: name.value, path: path.value, quota_gb: Number(quota.value), min_free_percent: Number(minFree.value) }); toast('Disk je dodan'); go('storage'); } }],
  });
}
function editPool(p) {
  const f = h('form', {}, field('Ime', h('input', { name: 'name', value: p.name })),
    h('div', { class: 'form-grid' }, field('Največja poraba (GB, 0 = brez)', h('input', { name: 'quota_gb', type: 'number', value: p.quota_gb })), field('Najmanj prostega prostora (%)', h('input', { name: 'min_free_percent', type: 'number', value: p.min_free_percent }))),
    toggle(p.enabled, 'Disk je v uporabi za nove posnetke'));
  f.querySelector('.toggle input').name = 'enabled';
  modal(`Disk: ${p.name}`, f, { actions: [{ label: 'Prekliči' }, { label: 'Shrani', kind: 'btn-primary', onClick: async () => { await put(`/api/storage/pools/${p.id}`, formData(f)); toast('Shranjeno'); go('storage'); } }] });
}
