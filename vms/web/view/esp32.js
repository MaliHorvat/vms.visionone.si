// VisionOne View – ESP32 programator (Web Serial + esptool-js, vse teče v brskalniku)
// Naprava je priklopljena na USB računalnika, na katerem je odprt View – ne na strežnik.
import { h, clear, icon, toast, toastErr, confirmDialog, store } from '../common/core.js';

const ESPTOOL_URLS = [
  'https://cdn.jsdelivr.net/npm/esptool-js@0.6.0/bundle.js',
  'https://unpkg.com/esptool-js@0.6.0/bundle.js',
  'https://esm.sh/esptool-js@0.6.0',
];
let esptoolMod = null;
async function loadEsptool() {
  if (esptoolMod) return esptoolMod;
  let lastErr;
  for (const u of ESPTOOL_URLS) {
    try { esptoolMod = await import(/* @vite-ignore */ u); return esptoolMod; } catch (e) { lastErr = e; }
  }
  throw new Error(`Knjižnice esptool-js ni bilo mogoče naložiti (${lastErr?.message || 'ni povezave'})`);
}

// Pogoste postavitve flasha (naslovi za Arduino / ESP-IDF)
const PRESETS = {
  merged: { label: 'Ena datoteka (merged / factory)', rows: [['0x0', 'firmware']] },
  esp32: { label: 'ESP32 – Arduino / IDF', rows: [['0x1000', 'bootloader'], ['0x8000', 'partitions'], ['0xe000', 'boot_app0'], ['0x10000', 'aplikacija']] },
  s3c3: { label: 'ESP32-S3 / C3 / C6 – Arduino / IDF', rows: [['0x0', 'bootloader'], ['0x8000', 'partitions'], ['0xe000', 'boot_app0'], ['0x10000', 'aplikacija']] },
  app: { label: 'Samo aplikacija (posodobitev)', rows: [['0x10000', 'aplikacija']] },
};
const BAUDS = [115200, 230400, 460800, 921600];

const S = { port: null, transport: null, loader: null, chip: null, busy: false, monitor: null };

export function renderEsp32(center) {
  const supported = 'serial' in navigator;
  const secure = window.isSecureContext;

  const logBox = h('pre', { class: 'esp-log', 'aria-live': 'polite' });
  const log = (line = '') => { logBox.textContent += line; logBox.scrollTop = logBox.scrollHeight; };
  const logLn = line => log(`${line}\n`);
  const terminal = { clean: () => { logBox.textContent = ''; }, writeLine: logLn, write: log };

  const chipBadge = h('span', { class: 'badge plain' }, 'Ni povezave');
  const baud = h('select', { 'aria-label': 'Hitrost' }, BAUDS.map(b => h('option', { value: b, selected: b === store.get('v1-esp-baud', 460800) }, `${b.toLocaleString('sl-SI')} b/s`)));
  baud.onchange = () => store.set('v1-esp-baud', Number(baud.value));

  const rowsBox = h('div', { class: 'esp-rows' });
  const rows = [];
  const progress = h('div', { class: 'esp-progress', hidden: true }, h('div', { class: 'bar' }), h('span', { class: 'txt' }));
  const setProgress = (pct, text) => {
    progress.hidden = pct == null;
    if (pct == null) return;
    progress.querySelector('.bar').style.width = `${pct}%`;
    progress.querySelector('.txt').textContent = text;
  };

  function addRow(addr = '0x10000', label = '') {
    const addrIn = h('input', { class: 'mono', value: addr, 'aria-label': 'Naslov', style: { width: '110px' } });
    const fileIn = h('input', { type: 'file', accept: '.bin,.img,application/octet-stream', 'aria-label': `Datoteka ${label}` });
    const info = h('span', { class: 'muted small' }, label);
    fileIn.onchange = () => { const f = fileIn.files[0]; info.textContent = f ? `${f.name} · ${(f.size / 1024).toFixed(1)} kB` : label; };
    const row = { addrIn, fileIn };
    const el = h('div', { class: 'esp-row' }, addrIn, fileIn, info,
      h('button', { class: 'btn-icon', title: 'Odstrani', onclick: () => { rows.splice(rows.indexOf(row), 1); el.remove(); } }, icon('x', 16)));
    row.el = el;
    rows.push(row);
    rowsBox.append(el);
  }
  function applyPreset(key) {
    rows.splice(0); clear(rowsBox);
    for (const [a, l] of PRESETS[key].rows) addRow(a, l);
    store.set('v1-esp-preset', key);
  }

  const eraseAll = h('input', { type: 'checkbox' });
  const btnConnect = h('button', { class: 'btn btn-primary', onclick: connect }, icon('link', 16), 'Poveži napravo');
  const btnDisconnect = h('button', { class: 'btn', onclick: disconnect, hidden: true }, 'Prekini');
  const btnFlash = h('button', { class: 'btn btn-primary', onclick: flash, disabled: true }, icon('download', 16), 'Naloži firmware');
  const btnErase = h('button', { class: 'btn btn-danger', onclick: erase, disabled: true }, icon('trash', 16), 'Izbriši flash');
  const btnMonitor = h('button', { class: 'btn', onclick: toggleMonitor }, icon('list', 16), 'Serijski monitor');
  const btnReset = h('button', { class: 'btn', onclick: resetBoard, title: 'Ponastavi ploščo (EN)' }, icon('refresh', 16), 'Ponastavi');

  const setBusy = b => {
    S.busy = b;
    const connected = !!S.loader;
    btnConnect.hidden = connected; btnDisconnect.hidden = !connected;
    btnFlash.disabled = b || !connected; btnErase.disabled = b || !connected;
    btnConnect.disabled = b; btnMonitor.disabled = b || connected;
  };

  async function connect() {
    try {
      await stopMonitor();
      const { ESPLoader, Transport } = await loadEsptool();
      if (!S.port) S.port = await navigator.serial.requestPort({});
      setBusy(true);
      terminal.clean();
      S.transport = new Transport(S.port, true);
      S.loader = new ESPLoader({ transport: S.transport, baudrate: Number(baud.value), terminal, debugLogging: false });
      S.chip = await S.loader.main();
      chipBadge.className = 'badge ok';
      chipBadge.textContent = S.chip;
      logLn(`\n✔ Povezano: ${S.chip}`);
      toast(`Povezano: ${S.chip}`);
    } catch (e) {
      if (e?.name === 'NotFoundError') return; // uporabnik je zaprl izbiro vrat
      logLn(`✖ ${e.message || e}`);
      toastErr(new Error(`Povezava ni uspela: ${e.message || e}. Držite tipko BOOT med priklopom in poskusite znova.`));
      await disconnect(true);
    } finally { setBusy(false); }
  }

  async function disconnect(silent = false) {
    try { if (S.transport) await S.transport.disconnect(); } catch { /* ignore */ }
    S.transport = null; S.loader = null; S.chip = null;
    chipBadge.className = 'badge plain'; chipBadge.textContent = 'Ni povezave';
    if (!silent) logLn('— povezava prekinjena');
    setBusy(false);
  }

  async function readFiles() {
    const out = [];
    for (const r of rows) {
      const f = r.fileIn.files[0];
      if (!f) continue;
      const address = parseInt(r.addrIn.value.trim(), 16);
      if (!Number.isFinite(address) || address < 0) throw new Error(`Neveljaven naslov: ${r.addrIn.value}`);
      out.push({ address, data: new Uint8Array(await f.arrayBuffer()), name: f.name });
    }
    if (!out.length) throw new Error('Izberite vsaj eno datoteko .bin');
    out.sort((a, b) => a.address - b.address);
    for (let i = 1; i < out.length; i++) {
      if (out[i - 1].address + out[i - 1].data.length > out[i].address) throw new Error(`Datoteki ${out[i - 1].name} in ${out[i].name} se prekrivata`);
    }
    return out;
  }

  async function flash() {
    let files;
    try { files = await readFiles(); } catch (e) { return toastErr(e); }
    if (eraseAll.checked && !(await confirmDialog('Pred nalaganjem izbrišem celoten flash (tudi shranjene nastavitve in Wi-Fi)?', { danger: true, ok: 'Izbriši in naloži' }))) return;
    setBusy(true);
    const total = files.reduce((s, f) => s + f.data.length, 0);
    const done = [];
    try {
      logLn(`\n▶ Nalagam ${files.length} ${files.length === 1 ? 'datoteko' : 'datotek'} (${(total / 1024).toFixed(0)} kB) …`);
      setProgress(0, 'Pripravljam …');
      await S.loader.writeFlash({
        fileArray: files.map(f => ({ data: f.data, address: f.address })),
        flashSize: 'keep', flashMode: 'keep', flashFreq: 'keep',
        eraseAll: eraseAll.checked, compress: true,
        reportProgress: (i, written, size) => {
          done[i] = written;
          const all = done.reduce((s, v) => s + (v || 0), 0);
          const pct = Math.min(100, Math.round((all / total) * 100));
          setProgress(pct, `${files[i].name} @ 0x${files[i].address.toString(16)} – ${pct} %`);
        },
      });
      setProgress(100, 'Končano – ponastavljam ploščo');
      await S.loader.after('hard_reset');
      logLn('✔ Firmware je naložen, plošča je ponastavljena.');
      toast('Firmware je naložen');
      await disconnect(true);
    } catch (e) {
      logLn(`✖ Nalaganje ni uspelo: ${e.message || e}`);
      toastErr(new Error(`Nalaganje ni uspelo: ${e.message || e}`));
    } finally { setBusy(false); setTimeout(() => setProgress(null), 4000); }
  }

  async function erase() {
    if (!(await confirmDialog('Izbrišem celoten flash naprave? Firmware in nastavitve bodo izgubljeni.', { danger: true, ok: 'Izbriši' }))) return;
    setBusy(true);
    try {
      logLn('\n▶ Brišem flash (lahko traja do minute) …');
      await S.loader.eraseFlash();
      logLn('✔ Flash je izbrisan.');
      toast('Flash je izbrisan');
    } catch (e) { logLn(`✖ ${e.message || e}`); toastErr(e); }
    finally { setBusy(false); }
  }

  // ---------- serijski monitor ----------
  async function toggleMonitor() { if (S.monitor) await stopMonitor(); else await startMonitor(); }
  async function startMonitor() {
    try {
      if (S.loader) await disconnect(true);
      if (!S.port) S.port = await navigator.serial.requestPort({});
      await S.port.open({ baudRate: Number(store.get('v1-esp-monbaud', 115200)) });
      const reader = S.port.readable.getReader();
      const dec = new TextDecoder();
      S.monitor = { reader, stop: false };
      btnMonitor.classList.add('active');
      btnMonitor.lastChild.textContent = 'Ustavi monitor';
      logLn(`\n— serijski monitor ${store.get('v1-esp-monbaud', 115200)} b/s —`);
      btnConnect.disabled = true;
      (async () => {
        try {
          while (!S.monitor?.stop) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) log(dec.decode(value, { stream: true }));
          }
        } catch (e) { if (!S.monitor?.stop) logLn(`✖ ${e.message}`); }
      })();
    } catch (e) {
      if (e?.name !== 'NotFoundError') toastErr(new Error(`Monitorja ni bilo mogoče odpreti: ${e.message}`));
      S.monitor = null;
    }
  }
  async function stopMonitor() {
    if (!S.monitor) return;
    S.monitor.stop = true;
    try { await S.monitor.reader.cancel(); } catch { /* ignore */ }
    try { S.monitor.reader.releaseLock(); } catch { /* ignore */ }
    try { await S.port.close(); } catch { /* ignore */ }
    S.monitor = null;
    btnMonitor.classList.remove('active');
    btnMonitor.lastChild.textContent = 'Serijski monitor';
    btnConnect.disabled = false;
    logLn('\n— monitor ustavljen —');
  }
  async function resetBoard() {
    try {
      if (S.loader) { await S.loader.after('hard_reset'); logLn('↻ ponastavljeno'); return; }
      if (!S.port) S.port = await navigator.serial.requestPort({});
      const wasOpen = !!S.monitor;
      if (!wasOpen) await S.port.open({ baudRate: 115200 });
      await S.port.setSignals({ dataTerminalReady: false, requestToSend: true });
      await new Promise(r => setTimeout(r, 120));
      await S.port.setSignals({ dataTerminalReady: false, requestToSend: false });
      if (!wasOpen) await S.port.close();
      logLn('↻ ponastavljeno');
    } catch (e) { if (e?.name !== 'NotFoundError') toastErr(e); }
  }

  const presetSel = h('select', { 'aria-label': 'Postavitev', onchange: e => applyPreset(e.target.value) },
    Object.entries(PRESETS).map(([k, p]) => h('option', { value: k, selected: k === store.get('v1-esp-preset', 'merged') }, p.label)));
  const monBaud = h('select', { 'aria-label': 'Hitrost monitorja', onchange: e => store.set('v1-esp-monbaud', Number(e.target.value)) },
    [9600, 57600, 74880, 115200, 230400].map(b => h('option', { value: b, selected: b === store.get('v1-esp-monbaud', 115200) }, `${b} b/s`)));

  const warn = !supported
    ? h('div', { class: 'esp-note err' }, icon('shield', 16), 'Ta brskalnik ne podpira Web Serial. Uporabite Chrome ali Edge na računalniku (ne na telefonu).')
    : !secure
      ? h('div', { class: 'esp-note err' }, icon('lock', 16), 'Programiranje deluje le prek HTTPS (npr. https://vms.visionone.si) ali na localhost.')
      : null;

  clear(center, h('div', { class: 'scroll-page' }, h('div', { class: 'esp-page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'ESP32 programator'), h('p', {}, 'Nalaganje firmwara na ESP32 prek USB kabla, priklopljenega na ta računalnik.')),
      h('span', { class: 'spacer' }), chipBadge),
    warn,
    h('div', { class: 'esp-grid' },
      h('section', { class: 'card esp-card' },
        h('h2', {}, '1. Povezava'),
        h('div', { class: 'btn-row' }, baud, btnConnect, btnDisconnect),
        h('p', { class: 'muted small' }, 'Če se povezava ne vzpostavi, med pritiskom na Poveži držite tipko BOOT. Za USB-serijski čip (CP210x, CH340) mora biti nameščen gonilnik.'),
        h('h2', {}, '2. Datoteke'),
        h('div', { class: 'btn-row' }, presetSel, h('button', { class: 'btn btn-sm', onclick: () => addRow('0x0', '') }, icon('plus', 14), 'Dodaj')),
        rowsBox,
        h('label', { class: 'esp-check' }, eraseAll, ' Pred nalaganjem izbriši celoten flash'),
        h('div', { class: 'btn-row' }, btnFlash, btnErase),
        progress),
      h('section', { class: 'card esp-card esp-term' },
        h('div', { class: 'btn-row' }, h('h2', { style: { margin: 0 } }, 'Dnevnik in serijski monitor'), h('span', { class: 'spacer' }),
          monBaud, btnMonitor, btnReset,
          h('button', { class: 'btn btn-sm btn-ghost', onclick: () => terminal.clean() }, 'Počisti')),
        logBox)))));

  applyPreset(store.get('v1-esp-preset', 'merged'));
  setBusy(false);
  if (!supported || !secure) { btnConnect.disabled = true; btnMonitor.disabled = true; btnReset.disabled = true; }
}

// ob zapustitvi strani sprostimo vrata
export async function leaveEsp32() {
  try { if (S.monitor) { S.monitor.stop = true; await S.monitor.reader.cancel().catch(() => {}); S.monitor.reader.releaseLock(); await S.port.close(); } } catch { /* ignore */ }
  try { if (S.transport) await S.transport.disconnect(); } catch { /* ignore */ }
  S.monitor = null; S.transport = null; S.loader = null; S.chip = null;
}
