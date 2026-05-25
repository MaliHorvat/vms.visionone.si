import Link from "next/link";
import { Camera, Gauge, KeyRound, LogOut, Router, ShieldCheck } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/cameras", label: "Kamere", icon: Camera },
  { href: "/gateway", label: "Gateway", icon: Router },
  { href: "/account", label: "Licenca", icon: KeyRound },
];

export function VmsShell({
  children,
  customerName,
}: {
  children: React.ReactNode;
  customerName: string;
}) {
  return (
    <div className="page-shell">
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <aside
          style={{
            width: 260,
            borderRight: "1px solid var(--border)",
            background: "rgba(255,255,255,0.86)",
            padding: 20,
            position: "sticky",
            top: 0,
            height: "100vh",
          }}
        >
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800 }}>
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 38,
                height: 38,
                borderRadius: 14,
                background: "linear-gradient(135deg, var(--accent), #22d3ee)",
                color: "white",
              }}
            >
              <ShieldCheck size={20} />
            </span>
            <span>VisionOne VMS</span>
          </Link>
          <p style={{ margin: "12px 0 26px", color: "var(--muted)", fontSize: 13 }}>{customerName}</p>
          <nav style={{ display: "grid", gap: 8 }}>
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 12,
                    color: "var(--fg)",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <form action="/api/auth/logout" method="post" style={{ marginTop: 28 }}>
            <button
              type="submit"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                borderRadius: 12,
                padding: "9px 12px",
                cursor: "pointer",
                color: "var(--muted)",
              }}
            >
              <LogOut size={16} />
              Odjava
            </button>
          </form>
        </aside>
        <main style={{ flex: 1, padding: 28, minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
