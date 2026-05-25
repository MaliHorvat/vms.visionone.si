import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getDashboardData } from "@/lib/vms-data";

export default async function AccountPage() {
  const { session, user } = await getCurrentUser();
  const data = await getDashboardData(session.customerId);
  if (!data || !user) redirect("/login");
  const overLimit = data.counts.cameras > data.customer.cameraLimit;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>Račun in licenca</p>
        <h1 style={{ margin: "6px 0", fontSize: 32 }}>{data.customer.name}</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>Prijavljen: {user.email}</p>
      </header>
      <section className="card" style={{ padding: 24, display: "grid", gap: 16 }}>
        <div>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, fontWeight: 800 }}>Paket</p>
          <h2 style={{ margin: "6px 0 0", fontSize: 28 }}>{data.customer.planName}</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Kamere</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 850 }}>
              {data.counts.cameras} / {data.customer.cameraLimit}
            </p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Objekti</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 850 }}>{data.counts.sites}</p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, fontWeight: 800 }}>Gatewayi</p>
            <p style={{ margin: "8px 0 0", fontSize: 24, fontWeight: 850 }}>{data.counts.gateways}</p>
          </div>
        </div>
        {overLimit ? (
          <div style={{ borderRadius: 14, background: "rgba(245,158,11,.14)", padding: 14, color: "#92400e" }}>
            Število kamer presega trenutno licenco. Nadgradi paket za prikaz vseh kamer v VisionOne VMS.
          </div>
        ) : null}
      </section>
    </div>
  );
}
