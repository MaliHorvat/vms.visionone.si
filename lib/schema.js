'use strict';
// Shema baze + migracije (idempotentno). Kliče jo /api/setup.
const { getPool } = require('./db');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    contact_email VARCHAR(190),
    contact_phone VARCHAR(60),
    notes TEXT,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(80) NOT NULL UNIQUE,
    email VARCHAR(190),
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin','tech','customer') NOT NULL DEFAULT 'tech',
    customer_id INT NULL,
    totp_secret VARCHAR(64) NULL,
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
    telegram_chat_id VARCHAR(40) NULL,
    telegram_link_code VARCHAR(16) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until DATETIME NULL,
    last_login DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (customer_id),
    CONSTRAINT fk_users_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id CHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    ip VARCHAR(64),
    user_agent VARCHAR(255),
    INDEX (user_id), INDEX (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    address VARCHAR(255),
    agent_token_hash CHAR(64) NULL,
    agent_token_prefix VARCHAR(12) NULL,
    agent_last_seen DATETIME NULL,
    agent_version VARCHAR(40) NULL,
    agent_ip VARCHAR(64) NULL,
    license_id INT NULL,
    status ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (customer_id), INDEX (agent_token_hash),
    CONSTRAINT fk_loc_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    kind VARCHAR(30) NOT NULL DEFAULT 'other',
    ip VARCHAR(64),
    mac VARCHAR(32),
    vendor VARCHAR(80),
    model VARCHAR(120),
    firmware VARCHAR(80),
    monitor JSON NULL,
    settings JSON NULL,
    status ENUM('unknown','online','offline','warn') NOT NULL DEFAULT 'unknown',
    last_seen DATETIME NULL,
    last_latency_ms INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (location_id), INDEX (status),
    CONSTRAINT fk_dev_loc FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS metrics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    up TINYINT(1) NOT NULL DEFAULT 1,
    latency_ms INT NULL,
    cpu FLOAT NULL,
    mem FLOAT NULL,
    disk FLOAT NULL,
    extra JSON NULL,
    INDEX (device_id, ts),
    CONSTRAINT fk_metric_dev FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS incidents (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    device_id INT NULL,
    kind VARCHAR(40) NOT NULL,
    severity ENUM('info','warn','crit') NOT NULL DEFAULT 'warn',
    message VARCHAR(255),
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    notified TINYINT(1) NOT NULL DEFAULT 0,
    INDEX (location_id), INDEX (device_id), INDEX (resolved_at),
    CONSTRAINT fk_inc_loc FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS licenses (
    id VARCHAR(24) PRIMARY KEY,
    customer_id INT NOT NULL,
    location_id INT NULL,
    plan VARCHAR(20) NOT NULL,
    max_devices INT NOT NULL DEFAULT 0,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    claims JSON NOT NULL,
    signature TEXT NOT NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (customer_id), INDEX (location_id), INDEX (expires_at),
    CONSTRAINT fk_lic_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS commands (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    device_id INT NULL,
    action VARCHAR(40) NOT NULL,
    params JSON NULL,
    status ENUM('pending','sent','done','error','canceled','expired') NOT NULL DEFAULT 'pending',
    result JSON NULL,
    created_by VARCHAR(80),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    picked_at DATETIME NULL,
    done_at DATETIME NULL,
    INDEX (location_id, status),
    CONSTRAINT fk_cmd_loc FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS device_secrets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_id INT NOT NULL,
    label VARCHAR(80) NOT NULL DEFAULT 'privzeto',
    username VARCHAR(120),
    secret_enc TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (device_id),
    CONSTRAINT fk_secret_dev FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id INT NULL,
    username VARCHAR(80),
    role VARCHAR(20),
    ip VARCHAR(64),
    action VARCHAR(60) NOT NULL,
    target VARCHAR(120),
    detail JSON NULL,
    INDEX (ts), INDEX (user_id), INDEX (action)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS settings (
    k VARCHAR(60) PRIMARY KEY,
    v TEXT,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function migrate() {
  const pool = getPool();
  for (const sql of TABLES) {
    await pool.query(sql);
  }
  await pool.query(
    `INSERT INTO settings (k, v) VALUES ('schema_version','1')
     ON DUPLICATE KEY UPDATE v=VALUES(v)`
  );
  return { tables: TABLES.length };
}

module.exports = { migrate, TABLES };
