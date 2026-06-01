import { demoReminders } from "@/lib/moj-demo-data";

export default function VzdrzevanjePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Vzdrževanje</h1>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {demoReminders.map((r) => (
          <li key={r.id} className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <strong>{r.title}</strong>
              <p style={{ fontSize: 12, color: "var(--vo-muted)", marginTop: 4 }}>{r.kind}</p>
            </div>
            <span style={{ fontWeight: 700, color: "var(--vo-accent)" }}>{r.dueDate}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
