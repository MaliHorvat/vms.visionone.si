import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildCameraLiveSession } from "@/lib/live-stream";
import { getSession } from "@/lib/session";

export async function GET() {
  if (!prisma) return NextResponse.json({ error: "DB ni nastavljena." }, { status: 500 });

  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Neavtorizirano." }, { status: 401 });

  const user = await prisma.vmsUser.findFirst({
    where: { id: session.userId, customerId: session.customerId, isActive: true },
    include: { customer: { include: { plan: true } } },
  });
  if (!user) return NextResponse.json({ error: "Neavtorizirano." }, { status: 401 });

  if (!user.customer.plan.liveEnabled) {
    return NextResponse.json({ error: "Live view ni vključen v licenci." }, { status: 403 });
  }

  const cameras = await prisma.vmsCamera.findMany({
    where: { site: { customerId: user.customerId }, enabled: true, status: "online" },
    include: { site: true },
    orderBy: [{ site: { name: "asc" } }, { channel: "asc" }, { name: "asc" }],
  });

  const sessions = cameras
    .map((camera) =>
      buildCameraLiveSession(
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
      ),
    )
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (sessions.length === 0) {
    return NextResponse.json(
      {
        error: "Live view še ni konfiguriran.",
        hint: "Admin mora v portalu nastaviti Stream URL in RTSP URL-je kamer.",
        cameras: [],
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true, cameras: sessions });
}
