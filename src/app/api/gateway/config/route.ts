import { NextResponse } from "next/server";
import { requireGateway } from "@/lib/gateway-auth";
import { cameraStreamName, resolveRtspUrl } from "@/lib/live-stream";

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
    stream: {
      baseUrl: gateway.site.streamBaseUrl,
    },
    cameras: gateway.site.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      channel: camera.channel,
      ip: camera.ip,
      enabled: camera.enabled,
      streamName: cameraStreamName(camera.channel),
      rtspUrl: resolveRtspUrl(
        { rtspUrl: camera.rtspUrl, ip: camera.ip, channel: camera.channel },
        gateway.site.nvrIp,
      ),
    })),
  });
}
