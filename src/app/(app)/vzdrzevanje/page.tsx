import type { ReactNode } from "react";
import { HardDrive, Shield } from "lucide-react";
import { demoClient, demoPreventiveItems } from "@/lib/moj-demo-data";

function Section({ title, icon, items }: { title: string; icon: ReactNode; items: typeof demoPreventiveItems }) {
  if (items.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, margin: 0 }}>
        {icon}
        {title}
      </h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item) => (
          <li
            key={item.id}
            className="card"
            style={{
              padding: 16,
              borderColor: item.urgent ? "rgba(180, 83, 9, 0.35)" : undefined,
              background: item.urgent ? "rgba(180, 83, 9, 0.08)" : undefined,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>{item.title}</strong>
                <p style={{ fontSize: 12, color: "var(--vo-muted)", marginTop: 4 }}>{item.kindLabel}</p>
                {item.note ? <p style={{ fontSize: 13, color: "var(--vo-muted)", marginTop: 8 }}>{item.note}</p> : null}
              </div>
              <span style={{ fontWeight: 700, color: "var(--vo-accent)" }}>{item.dueDate}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function VzdrzevanjePage() {
  const disk = demoPreventiveItems.filter((i) => i.section === "disk");
  const inspection = demoPreventiveItems.filter((i) => i.section === "inspection");
  const other = demoPreventiveItems.filter((i) => i.section === "other");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Vzdrževanje &amp; preventiva</h1>
        <p style={{ marginTop: 8, color: "var(--vo-muted)", fontSize: 14 }}>
          Dogovorjeni obiski, menjava diska in preventivni pregledi — brez live videonadzora.
        </p>
      </div>

      <Section title="Varnost arhiva (disk)" icon={<HardDrive size={18} color="var(--vo-accent)" />} items={disk} />
      <Section title="Preventivni pregled" icon={<Shield size={18} color="var(--vo-accent)" />} items={inspection} />
      <Section title="Ostala vzdrževanja" icon={<Shield size={18} color="var(--vo-accent)" />} items={other} />

      {!demoClient.hasPackage && !demoClient.preventiveInspectionDueDate ? (
        <p
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(180, 83, 9, 0.35)",
            background: "rgba(180, 83, 9, 0.1)",
            fontSize: 14,
          }}
        >
          Brez vzdrževalnega paketa priporočamo letni preventivni pregled — rok nastavimo v internem portalu.
        </p>
      ) : null}
    </div>
  );
}
