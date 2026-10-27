'use strict';
// Avtorizacija, vloge, večnajemniško ločevanje in revizijski dnevnik.
const db = require('./db');
const session = require('./session');
const { bad, clientIp } = require('./http');

// Vrne uporabnika ali pošlje 401 in vrne null.
async function requireAuth(req, res) {
  const u = await session.current(req);
  if (!u) { bad(res, 'Prijava je potrebna', 401); return null; }
  return u;
}

// Zahtevaj eno od vlog. Vrne uporabnika ali pošlje 403 in vrne null.
async function requireRole(req, res, roles) {
  const u = await requireAuth(req, res);
  if (!u) return null;
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(u.role)) { bad(res, 'Nimate dovoljenja', 403); return null; }
  return u;
}

const isStaff = (u) => u && (u.role === 'admin' || u.role === 'tech');

// Ali uporabnik vidi stranko?
function canCustomer(u, customerId) {
  if (isStaff(u)) return true;
  return u.role === 'customer' && Number(u.customer_id) === Number(customerId);
}

// WHERE fragment za lokacije glede na uporabnika (varno ločevanje strank).
// Vrne {sql, params} – vkey v params je 'tenantCustomer'.
function locationScope(u, alias = 'l') {
  if (isStaff(u)) return { sql: '1=1', params: {} };
  return { sql: `${alias}.customer_id = :tenantCustomer`, params: { tenantCustomer: u.customer_id } };
}

// Preveri dostop do lokacije; vrne vrstico lokacije ali null.
async function locationFor(u, locationId) {
  const row = await db.one(`SELECT * FROM locations WHERE id = :id`, { id: locationId });
  if (!row) return null;
  if (!isStaff(u) && Number(row.customer_id) !== Number(u.customer_id)) return null;
  return row;
}

// Preveri dostop do naprave; vrne {device, location} ali null.
async function deviceFor(u, deviceId) {
  const row = await db.one(
    `SELECT d.*, l.customer_id AS loc_customer FROM devices d JOIN locations l ON l.id = d.location_id WHERE d.id = :id`,
    { id: deviceId }
  );
  if (!row) return null;
  if (!isStaff(u) && Number(row.loc_customer) !== Number(u.customer_id)) return null;
  return row;
}

async function audit(req, u, action, target, detail) {
  try {
    await db.run(
      `INSERT INTO audit (user_id, username, role, ip, action, target, detail)
       VALUES (:uid, :un, :role, :ip, :action, :target, :detail)`,
      {
        uid: u ? u.id : null, un: u ? u.username : null, role: u ? u.role : null,
        ip: clientIp(req).slice(0, 64), action: String(action).slice(0, 60),
        target: target ? String(target).slice(0, 120) : null,
        detail: detail ? JSON.stringify(detail) : null,
      }
    );
  } catch (e) { console.error('[audit]', e.message); }
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email || null, role: u.role,
    customer_id: u.customer_id, totp_enabled: !!u.totp_enabled,
    telegram_linked: !!u.telegram_chat_id,
  };
}

module.exports = { requireAuth, requireRole, isStaff, canCustomer, locationScope, locationFor, deviceFor, audit, publicUser };
