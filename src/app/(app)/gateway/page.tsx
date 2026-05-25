import { redirect } from "next/navigation";
import { StatusPill } from "@/components/StatusPill";
import { getCurrentUser } from "@/lib/session";
import { getDashboardData } from "@/lib/vms-data";

function fmt(value: Date | null) {
  if (!value) return "nikoli";
  return new Intl.DateTimeFormat("sl-SI", { dateStyle: "short", timeStyle: "medium" }).format(value);
}

export default async function GatewayPage() {
  const { session } = await getCurrentUser();
  const data = await getDashboardData(session.customerId);
  if (!data) redirect("/login");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>Raspberry Pi Gateway</p>
        <h1 style={{ margin: "6px 0", fontSize: 32 }}>Gateway status</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Gateway je most med lokalnim NVR-jem in VisionOne VMS. V tej fazi pošilja status, kasneje live/playback.
        </p>
      </header>
      <section style={{ display: "grid", gap: 16 }}>
        {data.sites.map((site) => (
          <div key={site.id} className="card" style={{ padding: 22 }}>
            <h2 style={{ margin: "0 0 12px", fontSize: 18 }}>{site.name}</h2>
            {site.gateways.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)" }}>Ni registriranega gatewaya za ta objekt.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {site.gateways.map((gateway) => (
                  <div
                    key={gateway.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 16,
                      border: "1px solid var(--border)",
                      borderRadius: 16,
                      padding: 16,
                    }}
                  >
                    <div>
                      <strong>{gateway.name}</strong>
                      <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
                        Lokalni IP: {gateway.localIp || "ni znan"} · zadnji kontakt: {fmt(gateway.lastSeenAt)}
                      </p>
                    </div>
                    <StatusPill status={gateway.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
