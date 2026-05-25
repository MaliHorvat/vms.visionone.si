import { redirect } from "next/navigation";
import { Activity, Camera, Download, HardDrive, LayoutDashboard, RefreshCw, Router, Video } from "lucide-react";
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
  const gatewayOnline = data.sites.flatMap((site) => site.gateways).filter((gateway) => gateway.status === "online").length;
  const camerasOffline = Math.max(data.counts.cameras - data.counts.camerasOnline, 0);

  return (
    <div style={{ display: "grid", gap: 28, paddingBottom: 32 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "flex-start",
          borderBottom: "1px solid var(--vo-border)",
          paddingBottom: 20,
        }}
      >
        <div>
          <h1 style={{ margin: 0, color: "var(--vo-fg)", fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Pregled sistema
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--vo-muted)", fontSize: 14 }}>
            Dobrodošli nazaj. Trenutno spremljamo licence, objekte, kamere in gateway statuse.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--vo-border)",
              borderRadius: 9,
              background: "transparent",
              padding: "6px 9px",
              color: "var(--vo-fg)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={14} />
            Osveži
          </button>
          <button
            type="button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--vo-border)",
              borderRadius: 9,
              background: "transparent",
              padding: "6px 9px",
              color: "var(--vo-fg)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            CSV
          </button>
        </div>
      </header>

      <section>
        <h2
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 0 12px",
            color: "var(--vo-muted)",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          <LayoutDashboard size={16} />
          Status objektov & kamer
        </h2>
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {data.sites.map((site) => {
            const online = site.cameras.filter((camera) => camera.status === "online").length;
            const gateway = site.gateways[0];
            return (
              <article
                key={site.id}
                style={{
                  minWidth: 300,
                  border: "1px solid var(--vo-border)",
                  borderRadius: 14,
                  background: "var(--vo-surface)",
                  boxShadow: "var(--vo-card-shadow)",
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{site.name}</h3>
                    <p style={{ margin: "3px 0 0", color: "var(--vo-muted)", fontSize: 12 }}>
                      {site.address || "Naslov ni vpisan"}
                    </p>
                  </div>
                  <StatusPill status={gateway?.status ?? "pending"} />
                </div>
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ border: "1px solid var(--vo-border)", borderRadius: 10, background: "var(--vo-bg)", padding: 10 }}>
                    <p style={{ margin: 0, color: "var(--vo-muted)", fontSize: 11 }}>Kamere</p>
                    <p style={{ margin: "5px 0 0", color: "var(--vo-fg)", fontSize: 18, fontWeight: 800 }}>
                      {online}/{site.cameras.length}
                    </p>
                  </div>
                  <div style={{ border: "1px solid var(--vo-border)", borderRadius: 10, background: "var(--vo-bg)", padding: 10 }}>
                    <p style={{ margin: 0, color: "var(--vo-muted)", fontSize: 11 }}>NVR</p>
                    <p style={{ margin: "5px 0 0", color: "var(--vo-fg)", fontSize: 13, fontWeight: 750 }}>
                      {site.nvrName || "Ni vpisan"}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)", gap: 24 }}>
        <section className="card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, color: "var(--vo-fg)", fontSize: 15, fontWeight: 800 }}>Hiter pregled</h2>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
            <StatCard label="Objekti" value={data.counts.sites} />
            <StatCard label="Kamere v licenci" value={cameraUsage} detail={`${data.customer.planName}`} />
            <StatCard label="Kamere" value={`${data.counts.camerasOnline} online`} detail={`${camerasOffline} offline`} />
            <StatCard label="Gatewayi" value={`${gatewayOnline}/${data.counts.gateways}`} detail="online / skupaj" />
          </div>
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, color: "var(--vo-fg)", fontSize: 15, fontWeight: 800 }}>Zadnje aktivnosti</h2>
          {data.recentChecks.length === 0 ? (
            <p style={{ margin: "16px 0 0", display: "flex", gap: 8, color: "var(--vo-muted)", fontSize: 14 }}>
              <Activity size={16} />
              Gateway še ni poslal statusa.
            </p>
          ) : (
            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
              {data.recentChecks.slice(0, 6).map((check) => (
                <div
                  key={check.id}
                  style={{
                    borderBottom: "1px solid var(--vo-border)",
                    paddingBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <strong style={{ fontSize: 13 }}>{check.gateway.name}</strong>
                    <StatusPill status={check.status} />
                  </div>
                  <p style={{ margin: "5px 0 0", color: "var(--vo-muted)", fontSize: 12 }}>
                    {fmt(check.checkedAt)} · kamere {check.camerasOnline}/{check.cameraCount} · NVR{" "}
                    {check.nvrReachable ? "dosegljiv" : "ni dosegljiv"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, color: "var(--vo-fg)", fontSize: 15, fontWeight: 800 }}>Moduli VMS</h2>
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {[
            { icon: Video, title: "Live view", text: "Pripravljeno za fazo 2", color: "var(--vo-accent)" },
            { icon: HardDrive, title: "Playback", text: "Povezava na lokalni NVR", color: "var(--vo-warn)" },
            { icon: Router, title: "Gateway", text: "Status in diagnostika", color: "var(--vo-ok)" },
            { icon: Camera, title: "Kamere", text: `${data.counts.cameras} v licenci`, color: "var(--vo-fg)" },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} style={{ border: "1px solid var(--vo-border)", borderRadius: 12, background: "var(--vo-bg)", padding: 14 }}>
                <Icon size={18} color={item.color} />
                <h3 style={{ margin: "10px 0 4px", fontSize: 14 }}>{item.title}</h3>
                <p style={{ margin: 0, color: "var(--vo-muted)", fontSize: 12 }}>{item.text}</p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
