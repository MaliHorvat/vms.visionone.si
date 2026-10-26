// PTZ krmiljenje: neposredno prek ONVIF ali prek snemalnika (Hikvision ISAPI, Dahua CGI)
import { q } from './db.js';
import { OnvifDevice } from './onvif.js';
import { authRequest } from './http-util.js';

const onvifCache = new Map(); // camId -> { dev, token, sig }

async function onvifFor(cam) {
  const sig = [cam.host, cam.onvif_port, cam.http_port, cam.username, cam.password].join('|');
  const c = onvifCache.get(cam.id);
  if (c && c.sig === sig) return c;
  const dev = new OnvifDevice({ host: cam.host, port: cam.onvif_port || cam.http_port || 80, username: cam.username, password: cam.password });
  await dev.connect();
  const profiles = await dev.profiles();
  const p = profiles.find(x => x.hasPtz) || profiles[0];
  if (!p) throw new Error('Kamera nima ONVIF profila');
  const entry = { dev, token: p.token, sig };
  onvifCache.set(cam.id, entry);
  return entry;
}

function recBase(rec) { return `${rec.https ? 'https' : 'http'}://${rec.host}:${rec.http_port || 80}`; }
async function recReq(rec, path, method = 'GET', body = null) {
  const r = await authRequest(recBase(rec) + path, { username: rec.username, password: rec.password, method, body, headers: body ? { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(body) } : {}, timeout: 6000 });
  if (r.status >= 400) throw new Error(`Snemalnik je zavrnil PTZ ukaz (HTTP ${r.status})`);
  return r.body.toString();
}

const hik = {
  move: (rec, ch, { x, y, zoom }) => recReq(rec, `/ISAPI/PTZCtrl/channels/${ch}/continuous`, 'PUT', `<PTZData><pan>${Math.round(x * 100)}</pan><tilt>${Math.round(y * 100)}</tilt><zoom>${Math.round(zoom * 100)}</zoom></PTZData>`),
  stop: (rec, ch) => recReq(rec, `/ISAPI/PTZCtrl/channels/${ch}/continuous`, 'PUT', '<PTZData><pan>0</pan><tilt>0</tilt><zoom>0</zoom></PTZData>'),
  async presets(rec, ch) {
    const x = await recReq(rec, `/ISAPI/PTZCtrl/channels/${ch}/presets`);
    const out = [];
    x.replace(/<PTZPreset>([\s\S]*?)<\/PTZPreset>/g, (_, p) => {
      const id = /<id>(\d+)<\/id>/.exec(p)?.[1];
      const name = /<presetName>([^<]*)<\/presetName>/.exec(p)?.[1];
      const en = /<enabled>(\w+)<\/enabled>/.exec(p)?.[1];
      if (id && en !== 'false') out.push({ token: id, name: name || `Položaj ${id}` });
    });
    return out;
  },
  goto: (rec, ch, id) => recReq(rec, `/ISAPI/PTZCtrl/channels/${ch}/presets/${id}/goto`, 'PUT'),
  setPreset: (rec, ch, name, id = 1) => recReq(rec, `/ISAPI/PTZCtrl/channels/${ch}/presets/${id}`, 'PUT', `<PTZPreset><id>${id}</id><presetName>${name}</presetName></PTZPreset>`),
};

const dahuaCode = (x, y, zoom) => {
  if (zoom > 0) return 'ZoomTele'; if (zoom < 0) return 'ZoomWide';
  if (x < 0 && y > 0) return 'LeftUp'; if (x > 0 && y > 0) return 'RightUp';
  if (x < 0 && y < 0) return 'LeftDown'; if (x > 0 && y < 0) return 'RightDown';
  if (x < 0) return 'Left'; if (x > 0) return 'Right'; if (y > 0) return 'Up'; return 'Down';
};
const dahuaLast = new Map();
const dh = {
  move(rec, ch, { x, y, zoom }) {
    const code = dahuaCode(x, y, zoom);
    dahuaLast.set(`${rec.id}:${ch}`, code);
    const speed = Math.max(1, Math.round(Math.max(Math.abs(x), Math.abs(y), Math.abs(zoom)) * 8));
    return recReq(rec, `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=${code}&arg1=${speed}&arg2=${speed}&arg3=0`);
  },
  stop(rec, ch) {
    const code = dahuaLast.get(`${rec.id}:${ch}`) || 'Up';
    return recReq(rec, `/cgi-bin/ptz.cgi?action=stop&channel=${ch}&code=${code}&arg1=0&arg2=0&arg3=0`);
  },
  async presets(rec, ch) {
    const t = await recReq(rec, `/cgi-bin/ptz.cgi?action=getPresets&channel=${ch}`);
    const m = {};
    t.replace(/presets\[(\d+)\]\.(Index|Name)=(.*)/g, (_, i, k, v) => { (m[i] ||= {})[k] = v.trim(); });
    return Object.values(m).map(p => ({ token: p.Index, name: p.Name || `Položaj ${p.Index}` }));
  },
  goto: (rec, ch, id) => recReq(rec, `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=GotoPreset&arg1=0&arg2=${id}&arg3=0`),
  setPreset: (rec, ch, name, id = 1) => recReq(rec, `/cgi-bin/ptz.cgi?action=start&channel=${ch}&code=SetPreset&arg1=0&arg2=${id}&arg3=0`),
};

function route(cam) {
  if (cam.recorder_id) {
    const rec = q.get('SELECT * FROM recorders WHERE id=?', cam.recorder_id);
    if (rec?.vendor === 'hikvision') return { kind: 'nvr', impl: hik, rec };
    if (rec?.vendor === 'dahua') return { kind: 'nvr', impl: dh, rec };
  }
  if (cam.host) return { kind: 'onvif' };
  throw new Error('PTZ za to kamero ni na voljo');
}

export async function ptzCommand(camId, cmd) {
  const cam = q.get('SELECT * FROM cameras WHERE id=?', camId);
  if (!cam) throw new Error('Kamera ne obstaja');
  if (cam.source === 'demo') return { ok: true, demo: true };
  const r = route(cam);
  const clamp = v => Math.max(-1, Math.min(1, Number(v) || 0));
  const mv = { x: clamp(cmd.x), y: clamp(cmd.y), zoom: clamp(cmd.zoom) };
  if (r.kind === 'nvr') {
    const { impl, rec } = r, ch = cam.channel;
    switch (cmd.action) {
      case 'move': await impl.move(rec, ch, mv); break;
      case 'stop': await impl.stop(rec, ch); break;
      case 'goto': await impl.goto(rec, ch, cmd.preset); break;
      case 'presets': return impl.presets(rec, ch);
      case 'set_preset': await impl.setPreset(rec, ch, cmd.name || 'Položaj', cmd.preset || 1); break;
      case 'home': await impl.goto(rec, ch, 1); break;
    }
    return { ok: true };
  }
  const { dev, token } = await onvifFor(cam);
  switch (cmd.action) {
    case 'move': await dev.ptzMove(token, mv); break;
    case 'stop': await dev.ptzStop(token); break;
    case 'goto': await dev.ptzGoto(token, cmd.preset); break;
    case 'presets': return dev.ptzPresets(token);
    case 'set_preset': return { ok: true, token: await dev.ptzSetPreset(token, cmd.name || 'Položaj') };
    case 'home': await dev.ptzHome(token); break;
  }
  return { ok: true };
}
