import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";

export async function POST(request: Request) {
  if (!prisma) return NextResponse.json({ error: "DB ni nastavljena." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as {
    claimCode?: string;
    gatewayName?: string;
    localIp?: string;
    version?: string;
  };
  const code = String(body.claimCode ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "claimCode je obvezen." }, { status: 400 });

  const claim = await prisma.vmsGatewayClaim.findUnique({
    where: { code },
    include: { site: { include: { customer: true } } },
  });
  if (!claim) return NextResponse.json({ error: "Claim koda ni veljavna." }, { status: 404 });
  if (claim.consumedAt) return NextResponse.json({ error: "Claim koda je že uporabljena." }, { status: 409 });
  if (claim.expiresAt.getTime() < Date.now()) return NextResponse.json({ error: "Claim koda je potekla." }, { status: 410 });

  const token = randomToken();
  const gateway = await prisma.vmsGateway.upsert({
    where: { externalId: claim.externalId },
    create: {
      siteId: claim.siteId,
      externalId: claim.externalId,
      name: String(body.gatewayName ?? claim.name).trim() || claim.name,
      status: "online",
      version: String(body.version ?? "").trim(),
      localIp: String(body.localIp ?? "").trim(),
      lastSeenAt: new Date(),
      tokenHash: sha256(token),
    },
    update: {
      siteId: claim.siteId,
      name: String(body.gatewayName ?? claim.name).trim() || claim.name,
      status: "online",
      version: String(body.version ?? "").trim(),
      localIp: String(body.localIp ?? "").trim(),
      lastSeenAt: new Date(),
      tokenHash: sha256(token),
      lastError: "",
    },
  });

  await prisma.vmsGatewayClaim.update({
    where: { id: claim.id },
    data: { consumedAt: new Date(), gatewayId: gateway.id },
  });

  return NextResponse.json({
    ok: true,
    config: {
      gateway_id: gateway.externalId,
      gateway_name: gateway.name,
      customer_id: claim.site.customerId,
      site_id: claim.siteId,
      site_name: claim.site.name,
      token,
      status_path: "/api/gateway/status",
      config_path: "/api/gateway/config",
      interval_seconds: 30,
    },
  });
}
