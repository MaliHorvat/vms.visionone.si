import { redirect } from "next/navigation";
import { StatCard } from "@/components/StatCard";
import { StatusPill } from "@/components/StatusPill";
import { getCurrentUser } from "@/lib/session";
import { getDashboardData } from "@/lib/vms-data";

function fmt(value: Date | null) {
  if (!value) return "nikoli";
  return new Intl.DateTimeFormat("sl-SI", { dateStyle: "short", timeStyle: "short" }).format(value);
}

export default async function DashboardPage() {
  const { session } = await getCurrentUser();
  const data = await getDashboardData(session.customerId);
  if (!data) redirect("/login");
  const cameraUsage = `${data.counts.cameras} / ${data.customer.cameraLimit}`;

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
        <div>
          <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>
            {data.customer.planName}
          </p>
          <h1 style={{ margin: "6px 0", fontSize: 34 }}>Pregled VMS</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            Live view in playback bosta dodana po gateway fazi. Trenutno spremljamo licence in status lokacij.
          </p>
        </div>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16 }}>
        <StatCard label="Objekti" value={data.counts.sites} />
        <StatCard label="Kamere v licenci" value={cameraUsage} detail="licenca omejuje VisionOne VMS prikaz" />
        <StatCard label="Kamere online" value={data.counts.camerasOnline} />
        <StatCard label="Gatewayi" value={data.counts.gateways} />
      </section>

      <section className="card" style={{ padding: 22 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Objekti in lokalni snemalniki</h2>
        <div style={{ display: "grid", gap: 14 }}>
          {data.sites.map((site) => (
            <div key={site.id} style={{ border: "1px solid var(--border)", borderRadius: 18, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{site.name}</h3>
                  <p style={{ margin: "5px 0 0", color: "var(--muted)", fontSize: 13 }}>
                    {site.address || "Naslov ni vpisan"} · NVR: {site.nvrName || "ni vpisan"}
                  </p>
                </div>
                <StatusPill status={site.gateways[0]?.status ?? "pending"} />
              </div>
              <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "var(--surface-soft)", borderRadius: 14, padding: 12 }}>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Kamere</p>
                  <p style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 800 }}>{site.cameras.length}</p>
                </div>
                <div style={{ background: "var(--surface-soft)", borderRadius: 14, padding: 12 }}>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>Zadnji gateway</p>
                  <p style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 700 }}>
                    {fmt(site.gateways[0]?.lastSeenAt ?? null)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card" style={{ padding: 22 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Zadnji gateway statusi</h2>
        {data.recentChecks.length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0 }}>Gateway še ni poslal statusa.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {data.recentChecks.map((check) => (
              <div
                key={check.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 12,
                  alignItems: "center",
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 10,
                }}
              >
                <div>
                  <strong>{check.gateway.name}</strong>
                  <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
                    {fmt(check.checkedAt)} · kamere {check.camerasOnline}/{check.cameraCount} · NVR{" "}
                    {check.nvrReachable ? "dosegljiv" : "ni dosegljiv"}
                  </p>
                </div>
                <StatusPill status={check.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
