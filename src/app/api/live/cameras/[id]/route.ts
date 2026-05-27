import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildCameraLiveSession } from "@/lib/live-stream";
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

  const sessionData = buildCameraLiveSession(
    {
      id: camera.id,
      name: camera.name,
      channel: camera.channel,
      ip: camera.ip,
      rtspUrl: camera.rtspUrl,
      status: camera.status,
    },
    {
      id: camera.site.id,
      name: camera.site.name,
      nvrIp: camera.site.nvrIp,
      streamBaseUrl: camera.site.streamBaseUrl,
    },
  );

  if (!sessionData) {
    return NextResponse.json(
      {
        error: "Live view še ni konfiguriran za ta objekt.",
        hint: "Admin mora v portalu nastaviti Stream URL in RTSP URL kamere.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, ...sessionData });
}
