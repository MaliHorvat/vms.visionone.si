import { NextResponse } from "next/server";
import { requireGateway } from "@/lib/gateway-auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const auth = await requireGateway(request);
  if (!auth.ok) return auth.response;
  const { gateway } = auth;

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    localIp?: string;
    publicIp?: string;
    version?: string;
    uptimeSec?: number;
    nvrReachable?: boolean;
    cameras?: Array<{ id?: string; name?: string; channel?: number; reachable?: boolean; status?: string }>;
    error?: string;
    checkedAt?: string;
  };

  const checkedAt = body.checkedAt ? new Date(body.checkedAt) : new Date();
  const validCheckedAt = Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt;
  const cameras = Array.isArray(body.cameras) ? body.cameras : [];
  const camerasOnline = cameras.filter((camera) => camera.reachable || camera.status === "online").length;
  const status = String(body.status ?? (body.error ? "warn" : "online"));

  if (!prisma) return NextResponse.json({ error: "DB ni nastavljena." }, { status: 500 });

  for (const camera of gateway.site.cameras) {
    const incoming = cameras.find(
      (item) =>
        (item.id && item.id === camera.id) ||
        (item.channel != null && Number(item.channel) === camera.channel) ||
        (item.name && item.name === camera.name),
    );
    if (!incoming) continue;
    const cameraStatus = incoming.reachable || incoming.status === "online" ? "online" : "offline";
    await prisma.vmsCamera.update({
      where: { id: camera.id },
      data: { status: cameraStatus, lastSeenAt: validCheckedAt },
    });
  }

  await prisma.vmsGateway.update({
    where: { id: gateway.id },
    data: {
      status,
      localIp: String(body.localIp ?? gateway.localIp ?? ""),
      publicIp: String(body.publicIp ?? gateway.publicIp ?? ""),
      version: String(body.version ?? gateway.version ?? ""),
      lastError: String(body.error ?? ""),
      lastSeenAt: validCheckedAt,
    },
  });

  await prisma.vmsGatewayCheck.create({
    data: {
      gatewayId: gateway.id,
      siteId: gateway.siteId,
      status,
      localIp: String(body.localIp ?? ""),
      uptimeSec: typeof body.uptimeSec === "number" && Number.isFinite(body.uptimeSec) ? body.uptimeSec : null,
      cameraCount: cameras.length || gateway.site.cameras.length,
      camerasOnline,
      nvrReachable: Boolean(body.nvrReachable),
      errorText: String(body.error ?? ""),
      checkedAt: validCheckedAt,
    },
  });

  return NextResponse.json({ ok: true });
}
