import { NextResponse } from "next/server";
import { requireGateway } from "@/lib/gateway-auth";

export async function GET(request: Request) {
  const auth = await requireGateway(request);
  if (!auth.ok) return auth.response;
  const { gateway } = auth;

  return NextResponse.json({
    ok: true,
    gateway: {
      id: gateway.externalId,
      name: gateway.name,
      siteName: gateway.site.name,
      intervalSeconds: 30,
    },
    nvr: {
      name: gateway.site.nvrName,
      ip: gateway.site.nvrIp,
      model: gateway.site.nvrModel,
    },
    cameras: gateway.site.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      channel: camera.channel,
      ip: camera.ip,
      enabled: camera.enabled,
    })),
  });
}
