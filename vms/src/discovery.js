// Odkrivanje naprav: ONVIF WS-Discovery (multicast + unicast po IP-območju) in pregled vrat
import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import crypto from 'node:crypto';
import { httpRequest, xmlText } from './http-util.js';

function probeXml(type) {
  return `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>${type}</d:Types></d:Probe></e:Body></e:Envelope>`;
}

function parseProbeMatch(xml, ip) {
  const xaddrs = (xmlText(xml, 'XAddrs') || '').split(/\s+/).filter(Boolean);
  const scopes = (xmlText(xml, 'Scopes') || '').split(/\s+/).filter(Boolean);
  const scope = key => {
    const s = scopes.find(x => x.includes(`/${key}/`));
    return s ? decodeURIComponent(s.split(`/${key}/`)[1] || '') : null;
  };
  let host = ip, port = 80;
  const x = xaddrs.find(a => a.includes(ip)) || xaddrs[0];
  if (x) { try { const u = new URL(x); host = u.hostname; port = Number(u.port) || 80; } catch {} }
  const types = xmlText(xml, 'Types') || '';
  return {
    ip, host, port, onvif: true,
    name: scope('name'), hardware: scope('hardware'), location: scope('location'),
    kind: /nvr|dvr|xvr|recorder|nvs/i.test(`${scope('hardware') || ''} ${scope('name') || ''} ${types}`) ? 'recorder' : 'camera',
    xaddrs,
  };
}

// targets: seznam IP naslovov za unicast; prazen = samo multicast
export function wsDiscovery({ targets = [], timeout = 3000 } = {}) {
  return new Promise(resolve => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('message', (msg, rinfo) => {
      const xml = msg.toString('utf8');
      if (!/ProbeMatch/i.test(xml)) return;
      const d = parseProbeMatch(xml, rinfo.address);
      found.set(rinfo.address, { ...(found.get(rinfo.address) || {}), ...d });
    });
    sock.on('error', () => {});
    sock.bind(0, () => {
      try { sock.setBroadcast(true); sock.setMulticastTTL(4); } catch {}
      const msgs = [probeXml('dn:NetworkVideoTransmitter'), probeXml('tds:Device')].map(s => Buffer.from(s));
      for (const m of msgs) sock.send(m, 3702, '239.255.255.250', () => {});
      // unicast – deluje tudi v Docker Desktop (Windows/macOS), kjer multicast ne pride do LAN
      let i = 0;
      const sendBatch = () => {
        const batch = targets.slice(i, i + 64); i += 64;
        for (const ip of batch) sock.send(msgs[0], 3702, ip, () => {});
        if (i < targets.length) setTimeout(sendBatch, 20);
      };
      sendBatch();
    });
    setTimeout(() => { try { sock.close(); } catch {} resolve([...found.values()]); }, timeout + Math.ceil(targets.length / 64) * 20);
  });
}

export function tcpCheck(host, port, timeout = 800) {
  return new Promise(resolve => {
    const s = net.connect({ host, port });
    const done = ok => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

// "192.168.1.0/24", "192.168.1.10-192.168.1.50", "192.168.1.10-50" ali posamezni IP
export function expandRange(spec) {
  const out = [];
  for (const part of String(spec || '').split(/[,\s]+/).filter(Boolean)) {
    const ipToInt = ip => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
    const intToIp = n => [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.');
    if (part.includes('/')) {
      const [base, bits] = part.split('/');
      const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
      const start = (ipToInt(base) & mask) >>> 0;
      const size = 2 ** (32 - Number(bits));
      if (size > 4096) throw new Error('Območje je preveliko (največ /20)');
      for (let i = 1; i < size - 1; i++) out.push(intToIp(start + i));
    } else if (part.includes('-')) {
      const [a, b] = part.split('-');
      const end = b.includes('.') ? ipToInt(b) : ((ipToInt(a) & 0xffffff00) | Number(b)) >>> 0;
      const s = ipToInt(a);
      if (end - s > 4096) throw new Error('Območje je preveliko');
      for (let n = s; n <= end; n++) out.push(intToIp(n));
    } else out.push(part);
  }
  return out;
}

export function localSubnets() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const p = a.address.split('.');
      out.push({ iface: name, address: a.address, range: `${p[0]}.${p[1]}.${p[2]}.0/24` });
    }
  }
  return out;
}

// Ugani proizvajalca iz odprtih vrat in HTTP glave
async function fingerprint(ip, ports) {
  const info = { vendor: null, model: null };
  if (ports.includes(8000)) info.vendor = 'hikvision';
  if (ports.includes(37777)) info.vendor = 'dahua';
  const httpPort = ports.includes(80) ? 80 : ports.includes(8080) ? 8080 : null;
  if (httpPort) {
    try {
      const r = await httpRequest(`http://${ip}:${httpPort}/ISAPI/System/deviceInfo`, { timeout: 1500 });
      const realm = String([].concat(r.headers['www-authenticate'] || []).join(' '));
      const server = String(r.headers.server || '');
      if (r.status === 401 && /realm="(?:DS-|Hik|IPCam|iDS|HikvisionNVR)/i.test(realm)) info.vendor = 'hikvision';
      if (/Login to/i.test(realm) || /dahua/i.test(server)) info.vendor = 'dahua';
      if (/uniview|unv/i.test(server + realm)) info.vendor = 'uniview';
      if (/axis/i.test(server + realm)) info.vendor = 'axis';
    } catch {}
  }
  return info;
}

// Celoten pregled: unicast ONVIF + pregled vrat
export async function scanNetwork(rangeSpec, { onProgress } = {}) {
  const targets = expandRange(rangeSpec);
  const onvif = await wsDiscovery({ targets, timeout: 3500 });
  const byIp = new Map(onvif.map(d => [d.ip, d]));
  const PORTS = [80, 554, 8000, 37777, 8080, 443];
  const queue = [...targets];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const ip = queue.shift();
      const open = [];
      // najprej 554/80 – če nič od tega ni odprto, preskočimo ostalo
      for (const p of PORTS) if (await tcpCheck(ip, p, 500)) open.push(p);
      done++;
      if (onProgress && done % 16 === 0) onProgress(done, targets.length);
      if (!open.length) continue;
      if (!open.includes(554) && !open.includes(8000) && !open.includes(37777) && !byIp.has(ip)) continue;
      const fp = await fingerprint(ip, open);
      const prev = byIp.get(ip) || { ip, host: ip, port: open.includes(80) ? 80 : open[0], onvif: false, kind: 'camera' };
      byIp.set(ip, { ...prev, ...fp, ports: open });
    }
  };
  await Promise.all(Array.from({ length: 48 }, worker));
  return [...byIp.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}
