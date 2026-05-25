import crypto from "crypto";

const ITERATIONS = 120_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashSecret(secret: string, salt = crypto.randomBytes(16).toString("base64url")) {
  const hash = crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export function verifySecret(secret: string, encoded: string) {
  const [scheme, iterRaw, salt, expected] = encoded.split("$");
  if (scheme !== "pbkdf2" || !iterRaw || !salt || !expected) return false;
  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations)) return false;
  const actual = crypto.pbkdf2Sync(secret, salt, iterations, KEY_LENGTH, DIGEST).toString("base64url");
  return timingSafeEqual(actual, expected);
}

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
