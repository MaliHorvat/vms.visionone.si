import { redirect } from "next/navigation";
import { StatusPill } from "@/components/StatusPill";
import { getCurrentUser } from "@/lib/session";
import { getDashboardData } from "@/lib/vms-data";

export default async function CamerasPage() {
  const { session } = await getCurrentUser();
  const data = await getDashboardData(session.customerId);
  if (!data) redirect("/login");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>Kamere</p>
        <h1 style={{ margin: "6px 0", fontSize: 32 }}>Kamere v licenci</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Uporaba: {data.counts.cameras} od {data.customer.cameraLimit} kamer. Live view bo dodan v naslednji fazi.
        </p>
      </header>
      <section className="card" style={{ padding: 22 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ color: "var(--muted)", fontSize: 12, textAlign: "left" }}>
                <th style={{ padding: "10px 8px" }}>Kamera</th>
                <th style={{ padding: "10px 8px" }}>Objekt</th>
                <th style={{ padding: "10px 8px" }}>Kanal</th>
                <th style={{ padding: "10px 8px" }}>Status</th>
                <th style={{ padding: "10px 8px" }}>Live</th>
                <th style={{ padding: "10px 8px" }}>Posnetki</th>
              </tr>
            </thead>
            <tbody>
              {data.sites.flatMap((site) =>
                site.cameras.map((camera) => (
                  <tr key={camera.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 8px", fontWeight: 800 }}>{camera.name}</td>
                    <td style={{ padding: "14px 8px", color: "var(--muted)" }}>{site.name}</td>
                    <td style={{ padding: "14px 8px" }}>{camera.channel}</td>
                    <td style={{ padding: "14px 8px" }}>
                      <StatusPill status={camera.status} />
                    </td>
                    <td style={{ padding: "14px 8px", color: "var(--muted)" }}>Faza 2</td>
                    <td style={{ padding: "14px 8px", color: "var(--muted)" }}>Faza 3</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
