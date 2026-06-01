import { demoRequests } from "@/lib/moj-demo-data";

export default function ZahtevkiPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Zahtevki</h1>
          <p style={{ color: "var(--vo-muted)", fontSize: 14, marginTop: 8 }}>Oddaja in spremljanje servisnih zahtevkov.</p>
        </div>
        <button type="button" className="btn btn-primary" style={{ cursor: "default", opacity: 0.85 }}>
          Nov zahtevek (demo)
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {demoRequests.map((r) => (
          <li key={r.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong>{r.title}</strong>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--vo-accent)" }}>{r.status}</span>
            </div>
            <p style={{ fontSize: 14, color: "var(--vo-muted)", marginTop: 8 }}>{r.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
