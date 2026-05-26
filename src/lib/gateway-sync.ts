import type { PrismaClient, VmsCamera } from "@prisma/client";

export type DiscoveredDevice = {
  ip: string;
  ports?: number[];
  role?: string;
};

export type IncomingCamera = {
  id?: string;
  name?: string;
  channel?: number;
  ip?: string;
  reachable?: boolean;
  status?: string;
};

type GatewaySiteContext = {
  id: string;
  siteId: string;
  site: {
    id: string;
    customerId: string;
    nvrIp: string;
    cameras: VmsCamera[];
    customer: { plan: { cameraLimit: number } };
  };
};

function ipSortKey(ip: string) {
  return ip
    .split(".")
    .map((part) => part.padStart(3, "0"))
    .join(".");
}

function isOnline(item: IncomingCamera) {
  return Boolean(item.reachable || item.status === "online");
}

function pickDiscoveredCameras(discovered: DiscoveredDevice[], nvrIp: string) {
  return discovered
    .filter((device) => device.ip && device.ip !== nvrIp)
    .filter((device) => device.role === "camera" || device.ports?.includes(554))
    .sort((a, b) => ipSortKey(a.ip).localeCompare(ipSortKey(b.ip)));
}

function pickDiscoveredNvr(discovered: DiscoveredDevice[], hintedIp?: string) {
  if (hintedIp) {
    const hinted = discovered.find((device) => device.ip === hintedIp);
    if (hinted) return hintedIp;
  }
  const nvr = discovered.find((device) => device.role === "nvr");
  if (nvr) return nvr.ip;
  const candidate = discovered.find((device) => device.role === "nvr_candidate" || device.ports?.includes(8000) || device.ports?.includes(37777));
  if (candidate) return candidate.ip;
  const httpOnly = discovered.find((device) => device.ports?.includes(80) && !device.ports?.includes(554));
  return httpOnly?.ip ?? "";
}

export async function syncGatewaySiteTelemetry(
  prisma: PrismaClient,
  gateway: GatewaySiteContext,
  input: {
    cameras: IncomingCamera[];
    discovered?: DiscoveredDevice[];
    nvrIp?: string;
    nvrReachable?: boolean;
    checkedAt: Date;
  },
) {
  const discovered = Array.isArray(input.discovered) ? input.discovered : [];
  const resolvedNvrIp = pickDiscoveredNvr(discovered, input.nvrIp?.trim() || gateway.site.nvrIp) || input.nvrIp?.trim() || gateway.site.nvrIp;
  const discoveredCameras = pickDiscoveredCameras(discovered, resolvedNvrIp);

  if (resolvedNvrIp && resolvedNvrIp !== gateway.site.nvrIp) {
    await prisma.vmsSite.update({
      where: { id: gateway.site.id },
      data: { nvrIp: resolvedNvrIp },
    });
  }

  const siteCameras = [...gateway.site.cameras].sort((a, b) => a.channel - b.channel || ipSortKey(a.ip).localeCompare(ipSortKey(b.ip)));
  const incomingCameras = [...input.cameras];

  if (discoveredCameras.length > 0) {
    const totalCamerasBefore = await prisma.vmsCamera.count({
      where: { site: { customerId: gateway.site.customerId } },
    });
    let totalCameras = totalCamerasBefore;

    for (let index = 0; index < discoveredCameras.length; index += 1) {
      const discoveredDevice = discoveredCameras[index];
      const channel = index + 1;
      const matchedIncoming = incomingCameras.find((item) => item.ip === discoveredDevice.ip) ?? {
        ip: discoveredDevice.ip,
        channel,
        reachable: true,
        status: "online",
        name: `Kamera ${channel}`,
      };

      const camera =
        siteCameras.find((row) => row.id === matchedIncoming.id) ??
        siteCameras.find((row) => row.channel === channel) ??
        siteCameras.find((row) => row.ip === discoveredDevice.ip);

      if (camera) {
        await prisma.vmsCamera.update({
          where: { id: camera.id },
          data: {
            ip: discoveredDevice.ip,
            status: isOnline(matchedIncoming) ? "online" : "offline",
            lastSeenAt: input.checkedAt,
          },
        });
        continue;
      }

      if (totalCameras >= gateway.site.customer.plan.cameraLimit) continue;

      await prisma.vmsCamera.create({
        data: {
          siteId: gateway.site.id,
          name: matchedIncoming.name?.trim() || `Kamera ${channel}`,
          channel,
          ip: discoveredDevice.ip,
          status: isOnline(matchedIncoming) ? "online" : "offline",
          lastSeenAt: input.checkedAt,
        },
      });
      totalCameras += 1;
    }

    const discoveredIps = new Set(discoveredCameras.map((device) => device.ip));
    for (const camera of siteCameras) {
      if (camera.ip && !discoveredIps.has(camera.ip)) {
        await prisma.vmsCamera.update({
          where: { id: camera.id },
          data: { status: "offline", lastSeenAt: input.checkedAt },
        });
      }
    }
    return;
  }

  for (const camera of siteCameras) {
    const incoming = incomingCameras.find(
      (item) =>
        (item.id && item.id === camera.id) ||
        (item.channel != null && Number(item.channel) === camera.channel) ||
        (item.name && item.name === camera.name) ||
        (item.ip && camera.ip && item.ip.trim() === camera.ip.trim()),
    );
    if (!incoming) continue;
    await prisma.vmsCamera.update({
      where: { id: camera.id },
      data: {
        ip: incoming.ip?.trim() || camera.ip,
        status: isOnline(incoming) ? "online" : "offline",
        lastSeenAt: input.checkedAt,
      },
    });
  }
}
