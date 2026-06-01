import { demoClient } from "@/lib/moj-demo-data";

export default function RacunPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Račun</h1>
      <dl className="card" style={{ padding: 0, overflow: "hidden" }}>
        {[
          ["Objekt", demoClient.name],
          ["Naslov", demoClient.address],
          ["Paket", demoClient.packageName],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, padding: "14px 18px", borderBottom: "1px solid var(--vo-border)" }}>
            <dt style={{ fontSize: 11, fontWeight: 700, color: "var(--vo-muted)", textTransform: "uppercase" }}>{k}</dt>
            <dd style={{ margin: 0, fontSize: 14 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
