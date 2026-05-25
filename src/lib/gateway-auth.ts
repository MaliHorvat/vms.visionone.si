import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/crypto";

export function parseBearerToken(headerValue: string | null) {
  if (!headerValue) return "";
  const [type, token] = headerValue.split(" ");
  if (type?.toLowerCase() !== "bearer") return "";
  return token?.trim() ?? "";
}

export async function requireGateway(request: Request) {
  if (!prisma) {
    return { ok: false as const, response: NextResponse.json({ error: "DB ni nastavljena." }, { status: 500 }) };
  }
  const token = parseBearerToken(request.headers.get("authorization"));
  if (!token) {
    return { ok: false as const, response: NextResponse.json({ error: "Neavtorizirano." }, { status: 401 }) };
  }
  const gateway = await prisma.vmsGateway.findFirst({
    where: { tokenHash: sha256(token) },
    include: {
      site: {
        include: {
          customer: { include: { plan: true } },
          cameras: true,
        },
      },
    },
  });
  if (!gateway) {
    return { ok: false as const, response: NextResponse.json({ error: "Neavtorizirano." }, { status: 401 }) };
  }
  return { ok: true as const, gateway };
}
