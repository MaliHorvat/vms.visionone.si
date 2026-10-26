// Povezava z go2rtc (pretakanje v brskalnik prek MSE/WebRTC in RTSP restream za snemanje)
import { config } from './config.js';
import { httpRequest } from './http-util.js';
import { q } from './db.js';

const api = (path, opts = {}) => httpRequest(config.go2rtcApi + path, { timeout: 5000, ...opts });

const DEMO = ['testsrc', 'testsrc2', 'smptebars', 'rgbtestsrc', 'mandelbrot', 'life'];
export function demoSource(cam, sub = false) {
  const pattern = DEMO[(cam.id - 1) % DEMO.length];
  return `ffmpeg:virtual?video=${pattern}&size=${sub ? '640x360' : '1280x720'}#video=h264`;
}

export function streamName(camId, sub = false) { return `cam_${camId}${sub ? '_sub' : ''}`; }

export function camSources(cam) {
  if (cam.source === 'demo') return { main: demoSource(cam), sub: demoSource(cam, true) };
  const main = cam.main_url;
  // pri RTSP dodamo #backchannel=0, ker dvosmerni zvok uporabljamo samo na zahtevo
  return { main, sub: cam.sub_url || main };
}

export async function listStreams() {
  const r = await api('/api/streams');
  if (r.status !== 200) throw new Error('go2rtc ni dosegljiv');
  return JSON.parse(r.body.toString() || '{}');
}

export async function putStream(name, src) {
  const srcs = [].concat(src).map(s => `&src=${encodeURIComponent(s)}`).join('');
  const r = await api(`/api/streams?name=${encodeURIComponent(name)}${srcs}`, { method: 'PUT' });
  // go2rtc vrne 400, če ne more shraniti v svojo datoteko – tok je kljub temu dodan
  return r.status;
}
export async function deleteStream(name) {
  return (await api(`/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' })).status;
}

let syncing = false;
export async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    const existing = await listStreams();
    const want = new Map();
    for (const cam of q.all('SELECT * FROM cameras WHERE enabled=1')) {
      const s = camSources(cam);
      // drugi vir: MJPEG prepis na zahtevo – samo za brskalnike brez H.264/H.265 (go2rtc ga zažene le, ko ga kdo potrebuje)
      if (s.main) want.set(streamName(cam.id), [s.main, `ffmpeg:${streamName(cam.id)}#video=mjpeg`]);
      if (s.sub) want.set(streamName(cam.id, true), [s.sub, `ffmpeg:${streamName(cam.id, true)}#video=mjpeg`]);
    }
    for (const [name, src] of want) {
      const cur = existing[name]?.producers?.map(p => p.url) || [];
      if (cur.length === src.length && cur.every((u, i) => u === src[i])) continue;
      if (existing[name]) await deleteStream(name);
      await putStream(name, src);
    }
    for (const name of Object.keys(existing)) {
      if (/^cam_\d+(_sub)?$/.test(name) && !want.has(name)) await deleteStream(name);
    }
    return true;
  } catch (e) {
    console.error('[go2rtc] sinhronizacija ni uspela:', e.message);
    return false;
  } finally { syncing = false; }
}

// Začasen tok za predvajanje s snemalnika
const temp = new Map();
export async function tempStream(src, ttlSec = 3 * 3600) {
  const name = `pb_${Math.random().toString(36).slice(2, 10)}`;
  await putStream(name, src);
  temp.set(name, Date.now() + ttlSec * 1000);
  return name;
}
setInterval(async () => {
  for (const [name, exp] of temp) if (exp < Date.now()) { temp.delete(name); deleteStream(name).catch(() => {}); }
}, 60000).unref();

export async function snapshot(camId, sub = true) {
  const r = await httpRequest(`${config.go2rtcApi}/api/frame.jpeg?src=${streamName(camId, sub)}`, { timeout: 12000 });
  if (r.status !== 200) throw new Error('Slike ni bilo mogoče pridobiti');
  return r.body;
}

export function restreamUrl(camId, sub = false) {
  return `${config.go2rtcRtsp}/${streamName(camId, sub)}`;
}
