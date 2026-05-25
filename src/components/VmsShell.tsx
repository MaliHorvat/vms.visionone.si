import Link from "next/link";
import { Bell, Camera, Gauge, KeyRound, LogOut, Router, Search, Video } from "lucide-react";

const navSections = [
  {
    title: "PREGLED",
    items: [{ href: "/dashboard", label: "Nadzorna plošča", icon: Gauge }],
  },
  {
    title: "VIDEO",
    items: [
      { href: "/cameras", label: "Kamere", icon: Camera },
      { href: "/gateway", label: "Gateway", icon: Router },
    ],
  },
  {
    title: "SISTEM",
    items: [{ href: "/account", label: "Račun & licenca", icon: KeyRound }],
  },
];

export function VmsShell({
  children,
  customerName,
}: {
  children: React.ReactNode;
  customerName: string;
}) {
  return (
    <div className="page-shell" style={{ height: "100vh", overflow: "hidden" }}>
      <div style={{ display: "flex", minHeight: "100vh", height: "100vh" }}>
        <aside
          style={{
            width: 256,
            borderRight: "1px solid var(--vo-border)",
            background: "var(--vo-surface)",
            position: "sticky",
            top: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              borderBottom: "1px solid var(--vo-border)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 850 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--vo-accent-muted)",
                  color: "var(--vo-accent)",
                }}
              >
                <Video size={19} />
              </span>
              <span>VisionOne VMS</span>
            </Link>
          </div>
          <nav
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "14px 8px",
              flex: 1,
              overflowY: "auto",
            }}
          >
            {navSections.map((section) => (
              <div key={section.title}>
                <div
                  style={{
                    padding: "0 12px 6px",
                    color: "var(--vo-muted)",
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.11em",
                  }}
                >
                  {section.title}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          padding: "7px 12px",
                          borderRadius: 7,
                          color: "var(--vo-muted)",
                          fontSize: 13,
                          fontWeight: 650,
                        }}
                      >
                        <Icon size={16} />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div style={{ borderTop: "1px solid var(--vo-border)", padding: 12 }}>
            <div
              style={{
                border: "1px solid rgba(21,128,61,.25)",
                background: "var(--vo-ok-muted)",
                color: "var(--vo-ok)",
                borderRadius: 999,
                padding: "5px 10px",
                textAlign: "center",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              ● VMS Online
            </div>
          </div>
        </aside>
        <div style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column", overflow: "hidden" }}>
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              borderBottom: "1px solid var(--vo-border)",
              background: "var(--vo-surface)",
              padding: "8px 16px",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, color: "var(--vo-fg)", fontSize: 14, fontWeight: 750 }}>VisionOne VMS</p>
              <p style={{ margin: "2px 0 0", color: "var(--vo-muted)", fontSize: 12 }}>
                Stranka: <span style={{ color: "var(--vo-accent)", fontWeight: 700 }}>{customerName}</span>
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid var(--vo-border)",
                  borderRadius: 10,
                  padding: "7px 10px",
                  color: "var(--vo-muted)",
                  fontSize: 12,
                }}
              >
                <Search size={14} />
                Iskanje kmalu
              </div>
              <button
                type="button"
                title="Obvestila"
                style={{
                  border: "1px solid var(--vo-border)",
                  borderRadius: 10,
                  background: "transparent",
                  color: "var(--vo-muted)",
                  padding: 7,
                }}
              >
                <Bell size={16} />
              </button>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    border: "1px solid var(--vo-border)",
                    background: "transparent",
                    borderRadius: 10,
                    padding: "7px 10px",
                    cursor: "pointer",
                    color: "var(--vo-muted)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  <LogOut size={14} />
                  Odjava
                </button>
              </form>
            </div>
          </header>
          <main style={{ flex: 1, padding: "18px 24px 24px", minWidth: 0, overflowY: "auto" }}>{children}</main>
        </div>
      </div>
    </div>
  );
}
