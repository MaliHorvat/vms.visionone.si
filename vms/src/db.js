// VisionOne VMS – baza podatkov (SQLite, vgrajen v Node.js)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'visionone.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

const migrations = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT,
    email TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',          -- admin | operator | viewer
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    all_cameras INTEGER DEFAULT 1,
    enabled INTEGER DEFAULT 1,
    last_login INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );
  CREATE TABLE user_cameras (user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, camera_id INTEGER, PRIMARY KEY(user_id, camera_id));

  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT, token_hash TEXT UNIQUE, role TEXT DEFAULT 'viewer',
    created_at INTEGER DEFAULT (unixepoch()), last_used INTEGER
  );

  CREATE TABLE sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, notes TEXT);

  CREATE TABLE camera_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, site_id INTEGER, sort INTEGER DEFAULT 0);

  CREATE TABLE recorders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vendor TEXT NOT NULL DEFAULT 'onvif',          -- hikvision | dahua | uniview | onvif | generic
    host TEXT NOT NULL, http_port INTEGER DEFAULT 80, rtsp_port INTEGER DEFAULT 554,
    username TEXT, password TEXT,
    https INTEGER DEFAULT 0,
    model TEXT, serial TEXT, firmware TEXT, mac TEXT,
    channels INTEGER DEFAULT 0,
    site_id INTEGER,
    status TEXT DEFAULT 'unknown', last_seen INTEGER,
    disks_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE storage_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    quota_gb REAL DEFAULT 0,          -- 0 = brez omejitve (do min. prostega)
    min_free_percent REAL DEFAULT 5,
    enabled INTEGER DEFAULT 1
  );

  CREATE TABLE cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'manual',     -- manual | onvif | recorder | demo
    vendor TEXT,
    host TEXT, http_port INTEGER DEFAULT 80, rtsp_port INTEGER DEFAULT 554,
    username TEXT, password TEXT,
    onvif_port INTEGER,
    main_url TEXT, sub_url TEXT,
    snapshot_url TEXT,
    recorder_id INTEGER REFERENCES recorders(id) ON DELETE CASCADE,
    channel INTEGER,
    group_id INTEGER REFERENCES camera_groups(id) ON DELETE SET NULL,
    model TEXT, serial TEXT, firmware TEXT, mac TEXT,
    resolution TEXT, codec TEXT,
    ptz INTEGER DEFAULT 0,
    audio INTEGER DEFAULT 0,
    two_way_audio INTEGER DEFAULT 0,
    fisheye INTEGER DEFAULT 0,
    -- snemanje
    rec_location TEXT DEFAULT 'server', -- server | recorder | both | off
    rec_mode TEXT DEFAULT 'continuous', -- continuous | events | schedule
    rec_schedule TEXT,                  -- 168 znakov (7 dni x 24 ur), '1' = snemaj
    rec_stream TEXT DEFAULT 'main',     -- main | sub
    pre_seconds INTEGER DEFAULT 10,
    post_seconds INTEGER DEFAULT 30,
    retention_days INTEGER DEFAULT 30,
    pool_id INTEGER REFERENCES storage_pools(id) ON DELETE SET NULL,
    -- pametne funkcije
    ai_enabled INTEGER DEFAULT 0,
    ai_classes TEXT DEFAULT 'person,car,truck,bus,motorcycle,bicycle,dog,cat',
    ai_min_score REAL DEFAULT 0.5,
    ai_fps REAL DEFAULT 2,
    tamper_detect INTEGER DEFAULT 1,
    zones_json TEXT DEFAULT '[]',      -- [{id,name,type:'zone'|'line',points:[[x,y]..],classes,loiter_seconds,direction}]
    masks_json TEXT DEFAULT '[]',      -- maske zasebnosti [{x,y,w,h}] v relativnih koordinatah
    onvif_events INTEGER DEFAULT 1,
    -- stanje
    status TEXT DEFAULT 'unknown', last_seen INTEGER, status_detail TEXT,
    plan_x REAL, plan_y REAL, plan_id INTEGER,
    sort INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER NOT NULL,
    pool_id INTEGER,
    path TEXT NOT NULL,
    start_ts REAL NOT NULL,
    end_ts REAL NOT NULL,
    size INTEGER DEFAULT 0,
    keep INTEGER DEFAULT 0,        -- 1 = vsebuje dogodek (za način "ob dogodku")
    locked INTEGER DEFAULT 0       -- zaklenjen posnetek (se ne briše)
  );
  CREATE INDEX idx_seg_cam_time ON segments(camera_id, start_ts);
  CREATE INDEX idx_seg_end ON segments(end_ts);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    end_ts REAL,
    camera_id INTEGER,
    recorder_id INTEGER,
    type TEXT NOT NULL,       -- motion | object | zone | line | loiter | tamper | camera_offline | camera_online | disk | system | manual | onvif
    label TEXT,               -- person, car ...
    score REAL,
    zone TEXT,
    severity TEXT DEFAULT 'info', -- info | warning | alarm
    data_json TEXT,
    snapshot TEXT,
    acknowledged INTEGER DEFAULT 0,
    ack_by TEXT, ack_at INTEGER, ack_comment TEXT
  );
  CREATE INDEX idx_ev_ts ON events(ts);
  CREATE INDEX idx_ev_cam ON events(camera_id, ts);
  CREATE INDEX idx_ev_label ON events(label, ts);

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    trigger_json TEXT NOT NULL,   -- {types:[], cameras:[], labels:[], zones:[], schedule:'168 znakov'}
    actions_json TEXT NOT NULL,   -- [{type:'severity',value:'alarm'},{type:'popup'},{type:'mqtt'},{type:'webhook',url},{type:'ptz_preset',camera_id,preset},{type:'ntfy',topic},{type:'lock'}]
    cooldown_seconds INTEGER DEFAULT 30,
    last_fired INTEGER
  );

  CREATE TABLE layouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER,          -- NULL = skupen
    grid INTEGER DEFAULT 4,
    cells_json TEXT DEFAULT '[]',
    tour_seconds INTEGER DEFAULT 0
  );

  CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image TEXT,
    site_id INTEGER
  );

  CREATE TABLE exports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER, start_ts REAL, end_ts REAL,
    source TEXT, watermark INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued', file TEXT, sha256 TEXT, size INTEGER, error TEXT,
    created_by TEXT, created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    camera_id INTEGER, start_ts REAL, end_ts REAL, title TEXT, locked INTEGER DEFAULT 1,
    created_by TEXT, created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER DEFAULT (unixepoch()),
    username TEXT, ip TEXT, action TEXT, target TEXT, detail TEXT
  );
  CREATE INDEX idx_audit_ts ON audit(ts);
  `,
  `
  ALTER TABLE recorders ADD COLUMN main_template TEXT;
  ALTER TABLE recorders ADD COLUMN sub_template TEXT;
  `,
];

db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)');
const current = db.prepare('SELECT MAX(version) v FROM _migrations').get().v ?? 0;
for (let i = current; i < migrations.length; i++) {
  db.exec('BEGIN');
  try {
    db.exec(migrations[i]);
    db.prepare('INSERT INTO _migrations(version) VALUES (?)').run(i + 1);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- pomožne funkcije ---
export const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};

export function getSetting(key, def = null) {
  const r = q.get('SELECT value FROM settings WHERE key=?', key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch { return r.value; }
}
export function setSetting(key, value) {
  q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
}

// Vstavi/posodobi samo dovoljene stolpce
export function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}
export function insert(table, data) {
  const keys = Object.keys(data);
  if (!keys.length) return q.run(`INSERT INTO ${table} DEFAULT VALUES`).lastInsertRowid;
  const r = q.run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => norm(data[k])));
  return Number(r.lastInsertRowid);
}
export function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  q.run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, ...keys.map(k => norm(data[k])), id);
}
function norm(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
