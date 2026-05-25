import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySecret } from "@/lib/crypto";
import { signSession, VMS_SESSION_COOKIE } from "@/lib/session";

export async function POST(request: Request) {
  if (!prisma) return NextResponse.redirect(new URL("/login?error=db", request.url));
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/dashboard");

  const user = await prisma.vmsUser.findUnique({ where: { email } });
  if (!user?.isActive || !verifySecret(password, user.passwordHash)) {
    return NextResponse.redirect(new URL("/login?error=1", request.url));
  }

  await prisma.vmsUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const token = signSession({
    userId: user.id,
    customerId: user.customerId,
    email: user.email,
    role: user.role,
  });

  const store = await cookies();
  store.set(VMS_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  return NextResponse.redirect(new URL(target, request.url));
}
