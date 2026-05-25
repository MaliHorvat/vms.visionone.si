import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { timingSafeEqual } from "@/lib/crypto";

export const VMS_SESSION_COOKIE = "vo_vms_session";

export type VmsSessionPayload = {
  userId: string;
  customerId: string;
  email: string;
  role: "owner" | "admin" | "viewer";
  exp: number;
};

function sessionSecret() {
  const value = process.env.VMS_SESSION_SECRET || process.env.NEXTAUTH_SECRET || "dev-vms-session-secret";
  if (process.env.NODE_ENV === "production" && value === "dev-vms-session-secret") {
    throw new Error("VMS_SESSION_SECRET is required in production.");
  }
  return value;
}

function base64UrlJson(payload: VmsSessionPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signBody(body: string) {
  return crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
}

export function signSession(payload: Omit<VmsSessionPayload, "exp">, maxAgeSec = 60 * 60 * 8) {
  const body = base64UrlJson({ ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSec });
  return `v1.${body}.${signBody(body)}`;
}

export function verifySessionToken(token?: string): VmsSessionPayload | null {
  if (!token?.startsWith("v1.")) return null;
  const rest = token.slice(3);
  const dot = rest.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  if (!timingSafeEqual(signBody(body), sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as VmsSessionPayload;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
    if (!payload.userId || !payload.customerId || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  return verifySessionToken(store.get(VMS_SESSION_COOKIE)?.value);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function getCurrentUser() {
  const session = await requireSession();
  if (!prisma) return { session, user: null };
  const user = await prisma.vmsUser.findFirst({
    where: { id: session.userId, customerId: session.customerId, isActive: true },
    include: { customer: { include: { plan: true } } },
  });
  if (!user) redirect("/login");
  return { session, user };
}
