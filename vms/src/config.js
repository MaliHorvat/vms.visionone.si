// Nastavitve iz okoljskih spremenljivk (docker-compose / .env)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const env = process.env;
const dataDir = env.DATA_DIR || path.resolve('data');

function secret() {
  if (env.SECRET_KEY) return env.SECRET_KEY;
  fs.mkdirSync(dataDir, { recursive: true });
  const f = path.join(dataDir, '.secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

export const config = {
  port: Number(env.PORT || 8080),
  dataDir,
  recordingsRoot: env.RECORDINGS_ROOT || '/recordings',
  go2rtcApi: env.GO2RTC_API || 'http://127.0.0.1:1984',
  go2rtcRtsp: env.GO2RTC_RTSP || 'rtsp://127.0.0.1:8554',
  ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
  segmentSeconds: Number(env.SEGMENT_SECONDS || 60),
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || 'admin',
  aiToken: env.AI_TOKEN || '',
  secret: secret(),
  webDir: env.WEB_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../web'),
  sessionHours: Number(env.SESSION_HOURS || 12),
  tz: env.TZ || 'Europe/Ljubljana',
};
