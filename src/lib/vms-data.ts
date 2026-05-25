import { prisma } from "@/lib/db";

export type VmsDashboardData = {
  customer: { id: string; name: string; planName: string; cameraLimit: number };
  counts: { sites: number; cameras: number; gateways: number; camerasOnline: number };
  sites: Array<{
    id: string;
    name: string;
    address: string;
    nvrName: string;
    cameras: Array<{ id: string; name: string; status: string; channel: number }>;
    gateways: Array<{ id: string; name: string; status: string; lastSeenAt: Date | null; localIp: string }>;
  }>;
  recentChecks: Array<{
    id: string;
    status: string;
    checkedAt: Date;
    cameraCount: number;
    camerasOnline: number;
    nvrReachable: boolean;
    gateway: { name: string };
  }>;
};

export async function getDashboardData(customerId: string): Promise<VmsDashboardData | null> {
  if (!prisma) return null;
  const customer = await prisma.vmsCustomer.findUnique({
    where: { id: customerId },
    include: {
      plan: true,
      sites: {
        include: {
          cameras: { orderBy: [{ channel: "asc" }, { name: "asc" }] },
          gateways: { orderBy: [{ lastSeenAt: "desc" }, { name: "asc" }] },
        },
        orderBy: { name: "asc" },
      },
    },
  });
  if (!customer) return null;

  const cameraRows = customer.sites.flatMap((site) => site.cameras);
  const gatewayRows = customer.sites.flatMap((site) => site.gateways);
  const recentChecks = await prisma.vmsGatewayCheck.findMany({
    where: { site: { customerId } },
    orderBy: { checkedAt: "desc" },
    take: 12,
    include: { gateway: { select: { name: true } } },
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      planName: customer.plan.name,
      cameraLimit: customer.plan.cameraLimit,
    },
    counts: {
      sites: customer.sites.length,
      cameras: cameraRows.length,
      gateways: gatewayRows.length,
      camerasOnline: cameraRows.filter((camera) => camera.status === "online").length,
    },
    sites: customer.sites.map((site) => ({
      id: site.id,
      name: site.name,
      address: site.address,
      nvrName: site.nvrName,
      cameras: site.cameras.map((camera) => ({
        id: camera.id,
        name: camera.name,
        status: camera.status,
        channel: camera.channel,
      })),
      gateways: site.gateways.map((gateway) => ({
        id: gateway.id,
        name: gateway.name,
        status: gateway.status,
        lastSeenAt: gateway.lastSeenAt,
        localIp: gateway.localIp,
      })),
    })),
    recentChecks: recentChecks.map((check) => ({
      id: check.id,
      status: check.status,
      checkedAt: check.checkedAt,
      cameraCount: check.cameraCount,
      camerasOnline: check.camerasOnline,
      nvrReachable: check.nvrReachable,
      gateway: check.gateway,
    })),
  };
}
