import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildGo2rtcPlayerUrl, cameraStreamName, isLiveConfigured, resolveRtspUrl } from "@/lib/live-stream";
import { getSession } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  if (!prisma) return NextResponse.json({ error: "DB ni nastavljena." }, { status: 500 });

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Neavtorizirano." }, { status: 401 });

  const user = await prisma.vmsUser.findFirst({
    where: { id: session.userId, customerId: session.customerId, isActive: true },
    include: { customer: { include: { plan: true } } },
  });
  if (!user) return NextResponse.json({ error: "Neavtorizirano." }, { status: 401 });

  const { id } = await ctx.params;

  const camera = await prisma.vmsCamera.findFirst({
    where: { id, site: { customerId: user.customerId }, enabled: true },
    include: { site: true },
  });
  if (!camera) return NextResponse.json({ error: "Kamera ne obstaja." }, { status: 404 });

  if (!user.customer.plan.liveEnabled) {
    return NextResponse.json({ error: "Live view ni vključen v licenco." }, { status: 403 });
  }

  const streamName = cameraStreamName(camera.channel);
  const rtspUrl = resolveRtspUrl(
    { rtspUrl: camera.rtspUrl, ip: camera.ip, channel: camera.channel },
    camera.site.nvrIp,
  );
  const streamBaseUrl = camera.site.streamBaseUrl.trim();

  if (!isLiveConfigured(streamBaseUrl, rtspUrl)) {
    return NextResponse.json(
      {
        error: "Live view še ni konfiguriran za ta objekt.",
        hint: "Admin mora nastaviti Stream URL (go2rtc tunel) in preveriti RTSP vir kamere.",
        rtspUrl,
        streamBaseUrl,
        streamName,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    camera: { id: camera.id, name: camera.name, channel: camera.channel, status: camera.status },
    site: { id: camera.site.id, name: camera.site.name },
    streamName,
    rtspUrl,
    playerUrl: buildGo2rtcPlayerUrl(streamBaseUrl, streamName),
  });
}
