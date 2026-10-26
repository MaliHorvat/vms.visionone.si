// Minimalen MQTT 3.1.1 odjemalec (samo objavljanje, QoS 0) – za Home Assistant in druge sisteme
import net from 'node:net';
import tls from 'node:tls';

function encLen(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0);
  return Buffer.from(out);
}
const str = s => { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };

export class MqttClient {
  constructor({ host, port = 1883, username, password, tls: useTls = false, clientId, will } = {}) {
    Object.assign(this, { host, port: Number(port) || 1883, username, password, useTls, will });
    this.clientId = clientId || `visionone-${Math.random().toString(16).slice(2, 10)}`;
    this.connected = false; this.queue = []; this.closed = false; this.lastError = null;
  }
  connect() {
    if (this.closed) return;
    const opts = { host: this.host, port: this.port };
    this.sock = this.useTls ? tls.connect({ ...opts, rejectUnauthorized: false }) : net.connect(opts);
    this.sock.setTimeout(90000);
    this.sock.on('connect', () => this.sendConnect());
    this.sock.on('secureConnect', () => {});
    this.sock.on('data', d => {
      if (d[0] === 0x20) { // CONNACK
        if (d[3] === 0) { this.connected = true; this.lastError = null; this.flush(); this.onConnect?.(); }
        else { this.lastError = `Strežnik MQTT je zavrnil povezavo (koda ${d[3]})`; this.sock.destroy(); }
      }
    });
    this.sock.on('timeout', () => this.sock.destroy());
    this.sock.on('error', e => { this.lastError = e.message; });
    this.sock.on('close', () => {
      this.connected = false;
      clearInterval(this.ping);
      if (!this.closed) setTimeout(() => this.connect(), 5000);
    });
  }
  sendConnect() {
    let flags = 0x02; // clean session
    const payload = [str(this.clientId)];
    if (this.will) { flags |= 0x04 | 0x20; payload.push(str(this.will.topic), str(this.will.payload)); }
    if (this.username) { flags |= 0x80; payload.push(str(this.username)); }
    if (this.password) { flags |= 0x40; payload.push(str(this.password)); }
    const vh = Buffer.concat([str('MQTT'), Buffer.from([4, flags, 0, 60])]);
    const body = Buffer.concat([vh, ...payload]);
    this.sock.write(Buffer.concat([Buffer.from([0x10]), encLen(body.length), body]));
    this.ping = setInterval(() => this.connected && this.sock.write(Buffer.from([0xc0, 0])), 30000);
    if (this.ping.unref) this.ping.unref();
  }
  publish(topic, payload, { retain = false } = {}) {
    const p = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
    const body = Buffer.concat([str(topic), p]);
    const pkt = Buffer.concat([Buffer.from([0x30 | (retain ? 1 : 0)]), encLen(body.length), body]);
    if (this.connected) this.sock.write(pkt);
    else if (this.queue.length < 500) this.queue.push(pkt);
  }
  flush() { while (this.queue.length) this.sock.write(this.queue.shift()); }
  end() { this.closed = true; clearInterval(this.ping); try { this.sock?.write(Buffer.from([0xe0, 0])); this.sock?.end(); } catch {} }
}
