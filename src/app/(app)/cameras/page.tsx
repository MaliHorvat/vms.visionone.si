import { redirect } from "next/navigation";
import { CamerasTable } from "@/components/CamerasTable";
import { getCurrentUser } from "@/lib/session";
import { getDashboardData } from "@/lib/vms-data";

export default async function CamerasPage() {
  const { session, user } = await getCurrentUser();
  const data = await getDashboardData(session.customerId);
  if (!data || !user) redirect("/login");

  const rows = data.sites.flatMap((site) =>
    site.cameras.map((camera) => ({
      id: camera.id,
      name: camera.name,
      siteName: site.name,
      channel: camera.channel,
      status: camera.status,
    })),
  );

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>Kamere</p>
        <h1 style={{ margin: "6px 0", fontSize: 32 }}>Kamere v licenci</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Uporaba: {data.counts.cameras} od {data.customer.cameraLimit} kamer.
          {user.customer.plan.liveEnabled ? " Live view je na voljo za online kamere." : " Live view ni vključen v licenco."}
        </p>
      </header>
      <section className="card" style={{ padding: 22 }}>
        <CamerasTable rows={rows} liveEnabled={user.customer.plan.liveEnabled} />
      </section>
    </div>
  );
}
