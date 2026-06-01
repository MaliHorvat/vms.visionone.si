import Link from "next/link";
import { ArrowRight, Calendar, Package, Phone, Wrench } from "lucide-react";
import { demoClient, demoReminders, demoRequests } from "@/lib/moj-demo-data";

export default function DashboardPage() {
  const next = demoReminders[0];
  const openCount = demoRequests.filter((r) => r.status !== "Zaključeno").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Pozdravljeni</h1>
        <p style={{ marginTop: 8, color: "var(--vo-muted)", fontSize: 14 }}>
          Pregled dogovorjenih storitev — brez tehničnega nadzora naprav.
        </p>
      </div>

      <div
        style={{
          padding: 16,
          borderRadius: 14,
          border: "1px solid rgba(13,122,122,.25)",
          background: "var(--vo-accent-muted)",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <strong>24/7 skrb v ozadju.</strong> Tehnično stanje spremljamo mi. Ob potrebi vas kontaktiramo.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <Calendar size={24} color="var(--vo-accent)" />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--vo-muted)", marginTop: 12 }}>
            Naslednji dogodek
          </p>
          {next ? (
            <>
              <p style={{ fontWeight: 700, marginTop: 4 }}>{next.title}</p>
              <p style={{ fontSize: 13, color: "var(--vo-muted)" }}>{next.dueDate}</p>
            </>
          ) : null}
          <Link href="/vzdrzevanje" style={{ fontSize: 13, fontWeight: 600, color: "var(--vo-accent)", marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4 }}>
            Vsi termini <ArrowRight size={14} />
          </Link>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <Package size={24} color="var(--vo-accent)" />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--vo-muted)", marginTop: 12 }}>
            Paket
          </p>
          <p style={{ fontWeight: 700, marginTop: 4 }}>{demoClient.packageName}</p>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <Wrench size={24} color="var(--vo-accent)" />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--vo-muted)", marginTop: 12 }}>
            Odprti zahtevki
          </p>
          <p style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{openCount}</p>
          <Link href="/zahtevki" style={{ fontSize: 13, fontWeight: 600, color: "var(--vo-accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            Zahtevki <ArrowRight size={14} />
          </Link>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <Phone size={24} color="var(--vo-accent)" />
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--vo-muted)", marginTop: 12 }}>
            Kontakt
          </p>
          <p style={{ fontWeight: 600, marginTop: 4 }}>{demoClient.phone}</p>
          <Link href="/kontakt" style={{ fontSize: 13, fontWeight: 600, color: "var(--vo-accent)" }}>
            Vse možnosti
          </Link>
        </div>
      </div>
    </div>
  );
}
