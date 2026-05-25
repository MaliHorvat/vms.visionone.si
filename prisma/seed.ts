import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../src/lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const plans = [
    { code: "vms-4", name: "VMS 4", cameraLimit: 4, userLimit: 2, playbackEnabled: false },
    { code: "vms-8", name: "VMS 8", cameraLimit: 8, userLimit: 3, playbackEnabled: true },
    { code: "vms-16", name: "VMS 16", cameraLimit: 16, userLimit: 5, playbackEnabled: true },
    { code: "vms-32", name: "VMS 32", cameraLimit: 32, userLimit: 10, playbackEnabled: true },
  ];

  for (const plan of plans) {
    await prisma.vmsLicensePlan.upsert({
      where: { code: plan.code },
      update: plan,
      create: plan,
    });
  }

  const plan = await prisma.vmsLicensePlan.findUniqueOrThrow({ where: { code: "vms-4" } });
  const customer = await prisma.vmsCustomer.upsert({
    where: { slug: "demo-stranka" },
    update: { planId: plan.id },
    create: {
      slug: "demo-stranka",
      name: "Demo Stranka",
      contact: "Demo uporabnik",
      email: "demo@visionone.si",
      planId: plan.id,
    },
  });

  const user = await prisma.vmsUser.upsert({
    where: { email: "demo@visionone.si" },
    update: { customerId: customer.id, role: "owner", isActive: true },
    create: {
      customerId: customer.id,
      email: "demo@visionone.si",
      name: "Demo uporabnik",
      passwordHash: hashSecret("visionone123"),
      role: "owner",
    },
  });

  const site = await prisma.vmsSite.upsert({
    where: { id: "demo-site-main" },
    update: {
      customerId: customer.id,
      name: "Glavni objekt",
      address: "Demo lokacija 1",
      nvrName: "Demo NVR",
      nvrIp: "192.168.1.10",
      nvrModel: "Hikvision/Dahua demo",
    },
    create: {
      id: "demo-site-main",
      customerId: customer.id,
      name: "Glavni objekt",
      address: "Demo lokacija 1",
      nvrName: "Demo NVR",
      nvrIp: "192.168.1.10",
      nvrModel: "Hikvision/Dahua demo",
    },
  });

  for (const channel of [1, 2, 3, 4]) {
    await prisma.vmsCamera.upsert({
      where: { id: `demo-camera-${channel}` },
      update: { siteId: site.id, channel, name: `Kamera ${channel}`, status: channel <= 3 ? "online" : "unknown" },
      create: {
        id: `demo-camera-${channel}`,
        siteId: site.id,
        channel,
        name: `Kamera ${channel}`,
        ip: `192.168.1.10${channel}`,
        status: channel <= 3 ? "online" : "unknown",
      },
    });
  }

  await prisma.vmsGateway.upsert({
    where: { externalId: "demo-gateway-001" },
    update: { siteId: site.id, name: "Demo Raspberry Pi Gateway", status: "pending" },
    create: {
      siteId: site.id,
      externalId: "demo-gateway-001",
      name: "Demo Raspberry Pi Gateway",
      status: "pending",
    },
  });

  await prisma.vmsGatewayClaim.upsert({
    where: { code: "VMS-DEMO-CLAIM" },
    update: {
      siteId: site.id,
      externalId: "demo-gateway-001",
      name: "Demo Raspberry Pi Gateway",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
      consumedAt: null,
      gatewayId: null,
    },
    create: {
      code: "VMS-DEMO-CLAIM",
      siteId: site.id,
      externalId: "demo-gateway-001",
      name: "Demo Raspberry Pi Gateway",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  console.log(`Seeded VisionOne VMS demo user: ${user.email} / visionone123`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
