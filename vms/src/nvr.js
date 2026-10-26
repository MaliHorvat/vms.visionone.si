// Snemalniki (NVR/DVR/XVR): branje podatkov, uvoz vseh kanalov, stanje diskov, iskanje in predvajanje posnetkov
import { authRequest, xmlAll, xmlText } from './http-util.js';
import { OnvifDevice } from './onvif.js';

const enc = encodeURIComponent;
const pad = (n, l = 2) => String(n).padStart(l, '0');

function rtsp(rec, path) {
  const cred = rec.username ? `${enc(rec.username)}:${enc(rec.password || '')}@` : '';
  return `rtsp://${cred}${rec.host}:${rec.rtsp_port || 554}${path}`;
}
function httpBase(rec) {
  return `${rec.https ? 'https' : 'http'}://${rec.host}:${rec.http_port || (rec.https ? 443 : 80)}`;
}
async function get(rec, path, opts = {}) {
  const r = await authRequest(httpBase(rec) + path, { username: rec.username, password: rec.password, timeout: 8000, ...opts });
  if (r.status === 401) throw new Error('Napačno uporabniško ime ali geslo');
  if (r.status >= 400) throw new Error(`Snemalnik je vrnil HTTP ${r.status} za ${path}`);
  return r.body.toString('utf8');
}

// Lokalni čas naprave (privzeto enak časovnemu pasu strežnika)
function localParts(ts) {
  const d = new Date(ts * 1000);
  return { Y: d.getFullYear(), M: pad(d.getMonth() + 1), D: pad(d.getDate()), h: pad(d.getHours()), m: pad(d.getMinutes()), s: pad(d.getSeconds()) };
}

// ---------------- Hikvision (ISAPI) ----------------
const hikvision = {
  async info(rec) {
    const x = await get(rec, '/ISAPI/System/deviceInfo');
    return { name: xmlText(x, 'deviceName'), model: xmlText(x, 'model'), serial: xmlText(x, 'serialNumber'), firmware: xmlText(x, 'firmwareVersion'), mac: xmlText(x, 'macAddress') };
  },
  async channels(rec) {
    const out = [];
    // IP kanali (NVR)
    try {
      const x = await get(rec, '/ISAPI/ContentMgmt/InputProxy/channels');
      let status = {};
      try {
        const s = await get(rec, '/ISAPI/ContentMgmt/InputProxy/channels/status');
        for (const c of xmlAll(s, 'InputProxyChannelStatus')) status[xmlText(c, 'id')] = xmlText(c, 'online') === 'true';
      } catch {}
      for (const c of xmlAll(x, 'InputProxyChannel')) {
        const id = Number(xmlText(c, 'id'));
        const src = c.match(/<sourceInputPortDescriptor>([\s\S]*?)<\/sourceInputPortDescriptor>/)?.[1] || '';
        out.push({ channel: id, name: xmlText(c, 'name') || `Kamera ${id}`, ip: xmlText(src, 'ipAddress'), online: status[id] ?? null });
      }
    } catch {}
    // analogni / vgrajeni kanali (DVR, XVR)
    if (!out.length) {
      try {
        const x = await get(rec, '/ISAPI/System/Video/inputs/channels');
        for (const c of xmlAll(x, 'VideoInputChannel')) {
          const id = Number(xmlText(c, 'id'));
          out.push({ channel: id, name: xmlText(c, 'name') || `Kamera ${id}`, online: xmlText(c, 'resDesc') !== 'NO VIDEO' });
        }
      } catch {}
    }
    return out.map(c => ({ ...c, main_url: this.live(rec, c.channel, 'main'), sub_url: this.live(rec, c.channel, 'sub'), snapshot_url: `${httpBase(rec)}/ISAPI/Streaming/channels/${c.channel}01/picture` }));
  },
  live(rec, ch, stream) { return rtsp(rec, `/Streaming/Channels/${ch}0${stream === 'sub' ? 2 : 1}`); },
  playback(rec, ch, start, end) {
    const f = ts => { const p = localParts(ts); return `${p.Y}${p.M}${p.D}T${p.h}${p.m}${p.s}Z`; };
    return rtsp(rec, `/Streaming/tracks/${ch}01/?starttime=${f(start)}${end ? `&endtime=${f(end)}` : ''}`);
  },
  async disks(rec) {
    const x = await get(rec, '/ISAPI/ContentMgmt/Storage');
    return xmlAll(x, 'hdd').map(h => ({
      id: xmlText(h, 'id'), name: xmlText(h, 'hddName') || `HDD ${xmlText(h, 'id')}`, status: xmlText(h, 'status'),
      capacity_gb: Math.round(Number(xmlText(h, 'capacity')) / 1024), free_gb: Math.round(Number(xmlText(h, 'freeSpace')) / 1024),
    }));
  },
  // Iskanje posnetkov za časovnico
  async search(rec, ch, start, end) {
    const iso = ts => new Date(ts * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    const out = [];
    let pos = 0;
    for (let page = 0; page < 10; page++) {
      const body = `<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription><searchID>${crypto.randomUUID().toUpperCase()}</searchID><trackList><trackID>${ch}01</trackID></trackList><timeSpanList><timeSpan><startTime>${iso(start)}</startTime><endTime>${iso(end)}</endTime></timeSpan></timeSpanList><maxResults>200</maxResults><searchResultPostion>${pos}</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>`;
      const x = await get(rec, '/ISAPI/ContentMgmt/search', { method: 'POST', body, headers: { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body) } });
      const items = xmlAll(x, 'searchMatchItem');
      for (const it of items) {
        const s = Date.parse(xmlText(it, 'startTime')) / 1000, e = Date.parse(xmlText(it, 'endTime')) / 1000;
        if (s && e) out.push({ start_ts: s, end_ts: e, type: /CMR|motion|VMD/i.test(it) ? 'event' : 'continuous' });
      }
      if (xmlText(x, 'responseStatusStrg') !== 'MORE' || !items.length) break;
      pos += items.length;
    }
    return out;
  },
};

// ---------------- Dahua (CGI) ----------------
function parseDahuaKV(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) { const i = line.indexOf('='); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return out;
}
const dahua = {
  async info(rec) {
    const kv = async p => parseDahuaKV(await get(rec, p).catch(() => ''));
    const t = await kv('/cgi-bin/magicBox.cgi?action=getDeviceType');
    const s = await kv('/cgi-bin/magicBox.cgi?action=getSerialNo');
    const v = await kv('/cgi-bin/magicBox.cgi?action=getSoftwareVersion');
    const n = await kv('/cgi-bin/magicBox.cgi?action=getMachineName');
    return { name: n.name, model: t.type, serial: s.sn, firmware: v.version };
  },
  async channels(rec) {
    const kv = parseDahuaKV(await get(rec, '/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle'));
    const out = [];
    for (const [k, v] of Object.entries(kv)) {
      const m = /ChannelTitle\[(\d+)\]\.Name/.exec(k);
      if (m) out.push({ channel: Number(m[1]) + 1, name: v || `Kamera ${Number(m[1]) + 1}` });
    }
    // stanje kanalov (če je podprto)
    try {
      const st = parseDahuaKV(await get(rec, '/cgi-bin/LogicDeviceManager.cgi?action=getCameraState&uniqueChannels[0]=-1'));
      for (const c of out) {
        const key = Object.keys(st).find(k => new RegExp(`states\\[${c.channel - 1}\\]\\.connectionState`).test(k));
        if (key) c.online = st[key] === 'Connected';
      }
    } catch {}
    return out.sort((a, b) => a.channel - b.channel).map(c => ({ ...c, main_url: this.live(rec, c.channel, 'main'), sub_url: this.live(rec, c.channel, 'sub'), snapshot_url: `${httpBase(rec)}/cgi-bin/snapshot.cgi?channel=${c.channel}` }));
  },
  live(rec, ch, stream) { return rtsp(rec, `/cam/realmonitor?channel=${ch}&subtype=${stream === 'sub' ? 1 : 0}`); },
  playback(rec, ch, start, end) {
    const f = ts => { const p = localParts(ts); return `${p.Y}_${p.M}_${p.D}_${p.h}_${p.m}_${p.s}`; };
    return rtsp(rec, `/cam/playback?channel=${ch}&starttime=${f(start)}${end ? `&endtime=${f(end)}` : ''}`);
  },
  async disks(rec) {
    const kv = parseDahuaKV(await get(rec, '/cgi-bin/storageDevice.cgi?action=getDeviceAllInfo'));
    const disks = {};
    for (const [k, v] of Object.entries(kv)) {
      const m = /list\.info\[(\d+)\]\.(?:Detail\[\d+\]\.)?(\w+)/.exec(k);
      if (!m) continue;
      const d = (disks[m[1]] ||= { id: m[1], name: `HDD ${Number(m[1]) + 1}`, total: 0, used: 0 });
      if (m[2] === 'TotalBytes') d.total += Number(v);
      if (m[2] === 'UsedBytes') d.used += Number(v);
      if (m[2] === 'State') d.status = v;
      if (m[2] === 'Name') d.name = v;
    }
    return Object.values(disks).map(d => ({ id: d.id, name: d.name, status: d.status || 'ok', capacity_gb: Math.round(d.total / 1e9), free_gb: Math.round((d.total - d.used) / 1e9) }));
  },
};

// ---------------- Uniview ----------------
const uniview = {
  async info(rec) { return onvifAdapter.info(rec); },
  async channels(rec) {
    const ch = await onvifAdapter.channels(rec);
    return ch.map(c => ({ ...c, main_url: this.live(rec, c.channel, 'main'), sub_url: this.live(rec, c.channel, 'sub') }));
  },
  live(rec, ch, stream) { return rtsp(rec, `/unicast/c${ch}/s${stream === 'sub' ? 1 : 0}/live`); },
  playback(rec, ch, start, end) { return rtsp(rec, `/c${ch}/b${Math.floor(start)}/e${Math.floor(end || start + 3600)}/replay/`); },
};

// ---------------- Splošni ONVIF snemalnik ----------------
const onvifAdapter = {
  device(rec) { return new OnvifDevice({ host: rec.host, port: rec.http_port, username: rec.username, password: rec.password }); },
  async info(rec) {
    const d = this.device(rec); await d.connect();
    const i = await d.deviceInfo();
    return { name: `${i.manufacturer || ''} ${i.model || ''}`.trim(), model: i.model, serial: i.serial, firmware: i.firmware, mac: await d.networkMac() };
  },
  async channels(rec) {
    const d = this.device(rec); await d.connect();
    const list = await d.channels();
    return list.map(c => ({ channel: c.index, name: c.name, main_url: c.main_url, sub_url: c.sub_url, snapshot_url: c.snapshot_url, resolution: c.resolution, codec: c.codec, ptz: c.ptz, audio: c.audio, onvif_token: c.main_token }));
  },
  live() { return null; },
  playback() { return null; },
};

// ---------------- Splošni (predloge URL) ----------------
const generic = {
  async info() { return {}; },
  async channels(rec) {
    const n = Number(rec.channels) || 4;
    return Array.from({ length: n }, (_, i) => ({ channel: i + 1, name: `Kamera ${i + 1}`, main_url: this.live(rec, i + 1, 'main'), sub_url: this.live(rec, i + 1, 'sub') }));
  },
  live(rec, ch, stream) {
    const tpl = stream === 'sub' ? (rec.sub_template || rec.main_template) : rec.main_template;
    if (!tpl) return null;
    return tpl.replace(/\{ch\}/g, ch).replace(/\{host\}/g, rec.host).replace(/\{port\}/g, rec.rtsp_port || 554)
      .replace(/\{user\}/g, enc(rec.username || '')).replace(/\{pass\}/g, enc(rec.password || ''));
  },
  playback() { return null; },
};

export const adapters = { hikvision, dahua, uniview, onvif: onvifAdapter, generic };
export const adapterFor = rec => adapters[rec.vendor] || onvifAdapter;

// Samodejna prepoznava proizvajalca
export async function detectVendor(rec) {
  for (const v of ['hikvision', 'dahua']) {
    try { await adapters[v].info({ ...rec, vendor: v }); return v; } catch (e) { if (/geslo/.test(e.message)) { /* morda prava znamka, napačno geslo */ } }
  }
  try { await onvifAdapter.info(rec); return 'onvif'; } catch {}
  return null;
}

export async function probeRecorder(rec) {
  let vendor = rec.vendor;
  if (!vendor || vendor === 'auto') {
    vendor = await detectVendor(rec);
    if (!vendor) throw new Error('Snemalnika ni bilo mogoče prepoznati (preverite IP, vrata, uporabnika in geslo)');
  }
  const a = adapters[vendor];
  const info = await a.info({ ...rec, vendor });
  const channels = await a.channels({ ...rec, vendor });
  let disks = [];
  if (a.disks) { try { disks = await a.disks({ ...rec, vendor }); } catch {} }
  return { vendor, info, channels, disks };
}

export function playbackUrl(rec, channel, start, end) {
  const a = adapterFor(rec);
  return a.playback ? a.playback(rec, channel, start, end) : null;
}
