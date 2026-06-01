import { Mail, Phone } from "lucide-react";
import { demoClient } from "@/lib/moj-demo-data";

export default function KontaktPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Kontakt</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <a href="tel:+38640123456" className="card" style={{ padding: 20, display: "flex", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
          <Phone size={28} color="var(--vo-accent)" />
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--vo-muted)" }}>URGENTNO</p>
            <strong>+386 40 123 456</strong>
          </div>
        </a>
        <a href="mailto:info@visionone.si" className="card" style={{ padding: 20, display: "flex", gap: 12, alignItems: "center", textDecoration: "none", color: "inherit" }}>
          <Mail size={28} color="var(--vo-accent)" />
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--vo-muted)" }}>E-POŠTA</p>
            <strong>info@visionone.si</strong>
          </div>
        </a>
      </div>
      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Kontakt za objekt</h2>
        <p style={{ marginTop: 12 }}>{demoClient.contact}</p>
        <p>{demoClient.phone}</p>
        <p>{demoClient.email}</p>
        <p style={{ color: "var(--vo-muted)", fontSize: 14 }}>{demoClient.address}</p>
      </div>
    </div>
  );
}
