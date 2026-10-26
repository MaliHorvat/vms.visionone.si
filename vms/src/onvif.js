// ONVIF odjemalec (SOAP) – brez zunanjih knjižnic
// Podpira: informacije o napravi, profile/kanale, RTSP in snapshot URL-je, PTZ, prednastavitve in dogodke (PullPoint)
import crypto from 'node:crypto';
import { httpRequest, xmlAll, xmlFirst, xmlText, xmlAttr, xmlEscape } from './http-util.js';

const NS = 'xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tev="http://www.onvif.org/ver10/events/wsdl" xmlns:wsa="http://www.w3.org/2005/08/addressing" xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"';

export class OnvifDevice {
  constructor({ host, port = 80, username = '', password = '', https = false }) {
    this.host = host; this.port = port || 80; this.username = username; this.password = password;
    this.base = `${https ? 'https' : 'http'}://${host}:${this.port}`;
    this.deviceUrl = `${this.base}/onvif/device_service`;
    this.timeOffset = 0;
    this.xaddr = {};
  }

  security() {
    if (!this.username) return '';
    const nonce = crypto.randomBytes(16);
    const created = new Date(Date.now() + this.timeOffset).toISOString().replace(/\.\d+Z$/, 'Z');
    const digest = crypto.createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(this.password)])).digest('base64');
    return `<wsse:Security s:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${xmlEscape(this.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
  }

  async soap(url, body, { extraHeader = '', auth = true, timeout = 8000 } = {}) {
    const env = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope ${NS}><s:Header>${auth ? this.security() : ''}${extraHeader}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
    const r = await httpRequest(url, { method: 'POST', body: env, timeout, headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(env) } });
    const xml = r.body.toString('utf8');
    if (r.status >= 400 || /<(\w+:)?Fault>/.test(xml)) {
      const reason = xmlText(xml, 'Text') || xmlText(xml, 'faultstring') || `HTTP ${r.status}`;
      const err = new Error(`ONVIF: ${reason}`);
      err.status = r.status; err.xml = xml;
      if (r.status === 401 || /NotAuthorized|not authorized|Sender/i.test(reason)) err.auth = true;
      throw err;
    }
    return xml;
  }

  async syncTime() {
    try {
      const xml = await this.soap(this.deviceUrl, '<tds:GetSystemDateAndTime/>', { auth: false, timeout: 5000 });
      const utc = xmlFirst(xml, 'UTCDateTime');
      if (utc) {
        const n = t => Number(xmlText(utc, t));
        const dev = Date.UTC(n('Year'), n('Month') - 1, n('Day'), n('Hour'), n('Minute'), n('Second'));
        this.timeOffset = dev - Date.now();
      }
    } catch { /* nekatere naprave tega ne podpirajo brez prijave */ }
  }

  async connect() {
    await this.syncTime();
    const xml = await this.soap(this.deviceUrl, '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>');
    const pick = sec => { const s = xmlFirst(xml, sec); return s ? this.fixAddr(xmlText(s, 'XAddr')) : null; };
    this.xaddr = { media: pick('Media'), ptz: pick('PTZ'), events: pick('Events'), imaging: pick('Imaging') };
    if (!this.xaddr.media) this.xaddr.media = `${this.base}/onvif/media_service`;
    return this.xaddr;
  }

  // Kamere za NAT-om ali v Dockerju pogosto vrnejo napačen IP – zamenjamo z znanim naslovom
  fixAddr(addr) {
    if (!addr) return null;
    try { const u = new URL(addr); u.hostname = this.host; if (!u.port || u.port === '80') u.port = String(this.port); return u.toString(); } catch { return addr; }
  }

  async deviceInfo() {
    const xml = await this.soap(this.deviceUrl, '<tds:GetDeviceInformation/>');
    return {
      manufacturer: xmlText(xml, 'Manufacturer'), model: xmlText(xml, 'Model'),
      firmware: xmlText(xml, 'FirmwareVersion'), serial: xmlText(xml, 'SerialNumber'), hardware: xmlText(xml, 'HardwareId'),
    };
  }

  async networkMac() {
    try {
      const xml = await this.soap(this.deviceUrl, '<tds:GetNetworkInterfaces/>');
      return xmlText(xml, 'HwAddress');
    } catch { return null; }
  }

  async profiles() {
    const xml = await this.soap(this.xaddr.media, '<trt:GetProfiles/>');
    const out = [];
    const re = /<(?:[\w-]+:)?Profiles\s([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Profiles>/g;
    let m;
    while ((m = re.exec(xml))) {
      const token = /token="([^"]+)"/.exec(m[1])?.[1];
      const p = m[2];
      const vsc = xmlFirst(p, 'VideoSourceConfiguration') || '';
      const vec = xmlFirst(p, 'VideoEncoderConfiguration') || '';
      out.push({
        token,
        name: xmlText(p, 'Name'),
        sourceToken: xmlText(vsc, 'SourceToken'),
        encoding: xmlText(vec, 'Encoding'),
        width: Number(xmlText(vec, 'Width')) || null,
        height: Number(xmlText(vec, 'Height')) || null,
        hasPtz: /PTZConfiguration/.test(p),
        hasAudio: /AudioEncoderConfiguration/.test(p),
      });
    }
    return out;
  }

  withCreds(uri) {
    if (!uri || !this.username) return uri;
    try {
      const u = new URL(uri);
      u.username = encodeURIComponent(this.username); u.password = encodeURIComponent(this.password);
      return u.toString();
    } catch { return uri; }
  }

  async streamUri(profileToken) {
    const xml = await this.soap(this.xaddr.media, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${xmlEscape(profileToken)}</trt:ProfileToken></trt:GetStreamUri>`);
    let uri = xmlText(xml, 'Uri');
    if (uri) {
      uri = uri.replace(/&amp;/g, '&');
      try { const u = new URL(uri); u.hostname = this.host; uri = u.toString(); } catch {}
    }
    return uri;
  }

  async snapshotUri(profileToken) {
    try {
      const xml = await this.soap(this.xaddr.media, `<trt:GetSnapshotUri><trt:ProfileToken>${xmlEscape(profileToken)}</trt:ProfileToken></trt:GetSnapshotUri>`);
      let uri = xmlText(xml, 'Uri');
      if (uri) uri = this.fixAddr(uri.replace(/&amp;/g, '&'));
      return uri;
    } catch { return null; }
  }

  // Vse kanale (vire videa) z glavnim in podtokom
  async channels() {
    const profiles = await this.profiles();
    const bySource = new Map();
    for (const p of profiles) {
      const key = p.sourceToken || p.token;
      if (!bySource.has(key)) bySource.set(key, []);
      bySource.get(key).push(p);
    }
    const out = [];
    let idx = 0;
    for (const [source, list] of bySource) {
      idx++;
      list.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
      const main = list[0], sub = list[list.length - 1];
      const mainUrl = await this.streamUri(main.token).catch(() => null);
      const subUrl = sub !== main ? await this.streamUri(sub.token).catch(() => null) : null;
      out.push({
        index: idx, source, name: main.name || `Kanal ${idx}`,
        main_url: mainUrl, sub_url: subUrl,
        main_token: main.token, sub_token: sub.token,
        resolution: main.width ? `${main.width}x${main.height}` : null,
        codec: main.encoding, ptz: list.some(p => p.hasPtz), audio: list.some(p => p.hasAudio),
        snapshot_url: await this.snapshotUri(main.token),
      });
    }
    return out;
  }

  // ---------- PTZ ----------
  async ptzMove(profileToken, { x = 0, y = 0, zoom = 0 }) {
    if (!this.xaddr.ptz) throw new Error('Naprava ne podpira PTZ');
    return this.soap(this.xaddr.ptz, `<tptz:ContinuousMove><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${x}" y="${y}"/><tt:Zoom x="${zoom}"/></tptz:Velocity></tptz:ContinuousMove>`);
  }
  async ptzStop(profileToken) {
    return this.soap(this.xaddr.ptz, `<tptz:Stop><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`);
  }
  async ptzPresets(profileToken) {
    const xml = await this.soap(this.xaddr.ptz, `<tptz:GetPresets><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken></tptz:GetPresets>`);
    const out = [];
    const re = /<(?:[\w-]+:)?Preset\s([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Preset>/g;
    let m;
    while ((m = re.exec(xml))) out.push({ token: /token="([^"]+)"/.exec(m[1])?.[1], name: xmlText(m[2], 'Name') });
    return out;
  }
  async ptzGoto(profileToken, presetToken) {
    return this.soap(this.xaddr.ptz, `<tptz:GotoPreset><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken><tptz:PresetToken>${xmlEscape(presetToken)}</tptz:PresetToken></tptz:GotoPreset>`);
  }
  async ptzSetPreset(profileToken, name) {
    const xml = await this.soap(this.xaddr.ptz, `<tptz:SetPreset><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken><tptz:PresetName>${xmlEscape(name)}</tptz:PresetName></tptz:SetPreset>`);
    return xmlText(xml, 'PresetToken');
  }
  async ptzHome(profileToken) {
    return this.soap(this.xaddr.ptz, `<tptz:GotoHomePosition><tptz:ProfileToken>${xmlEscape(profileToken)}</tptz:ProfileToken></tptz:GotoHomePosition>`);
  }

  // ---------- Dogodki (PullPoint) ----------
  async createPullPoint() {
    if (!this.xaddr.events) throw new Error('Naprava ne podpira ONVIF dogodkov');
    const xml = await this.soap(this.xaddr.events, '<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT600S</tev:InitialTerminationTime></tev:CreatePullPointSubscription>');
    const ref = xmlFirst(xml, 'SubscriptionReference') || '';
    this.pullAddr = this.fixAddr(xmlText(ref, 'Address'));
    return this.pullAddr;
  }
  async pullMessages(timeoutSec = 10) {
    const hdr = `<wsa:Action>http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest</wsa:Action><wsa:To>${xmlEscape(this.pullAddr)}</wsa:To>`;
    const xml = await this.soap(this.pullAddr, `<tev:PullMessages><tev:Timeout>PT${timeoutSec}S</tev:Timeout><tev:MessageLimit>50</tev:MessageLimit></tev:PullMessages>`, { extraHeader: hdr, timeout: (timeoutSec + 10) * 1000 });
    return xmlAll(xml, 'NotificationMessage').map(n => {
      const topic = (xmlText(n, 'Topic') || '').replace(/^[\w-]+:/, '');
      const items = {};
      n.replace(/<(?:[\w-]+:)?SimpleItem\s+Name="([^"]+)"\s+Value="([^"]*)"/g, (_, k, v) => { items[k] = v; });
      n.replace(/<(?:[\w-]+:)?SimpleItem\s+Value="([^"]*)"\s+Name="([^"]+)"/g, (_, v, k) => { items[k] = v; });
      const time = xmlAttr(n, 'Message', 'UtcTime');
      return { topic, items, time };
    });
  }
  async renewPullPoint() {
    const hdr = `<wsa:Action>http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest</wsa:Action><wsa:To>${xmlEscape(this.pullAddr)}</wsa:To>`;
    return this.soap(this.pullAddr, '<wsnt:Renew><wsnt:TerminationTime>PT600S</wsnt:TerminationTime></wsnt:Renew>', { extraHeader: hdr });
  }
}

// Pretvori ONVIF temo v VisionOne tip dogodka
export function mapOnvifEvent(msg) {
  const t = msg.topic.toLowerCase();
  const val = v => v === 'true' || v === '1';
  const it = msg.items;
  if (t.includes('motiondetector') || t.includes('motionalarm')) {
    const active = val(it.IsMotion ?? it.State ?? it.Value ?? 'false');
    return { type: 'motion', active };
  }
  if (t.includes('linedetector') || t.includes('crossed') || t.includes('linecross')) return { type: 'line', active: true };
  if (t.includes('fielddetector') || t.includes('intrusion') || t.includes('objectsinside')) return { type: 'zone', active: val(it.IsInside ?? it.State ?? 'true') };
  if (t.includes('tamper') || t.includes('globalscenechange') || t.includes('imagetooblurry') || t.includes('imagetoodark')) return { type: 'tamper', active: val(it.State ?? it.IsTamper ?? 'true') };
  if (t.includes('humandetect') || t.includes('people') || /\bperson\b/.test(t)) return { type: 'object', label: 'person', active: val(it.State ?? it.IsPeople ?? 'true') };
  if (t.includes('vehicle')) return { type: 'object', label: 'car', active: val(it.State ?? 'true') };
  if (t.includes('digitalinput') || t.includes('alarmin')) return { type: 'input', active: val(it.LogicalState ?? it.State ?? 'true') };
  return null;
}
