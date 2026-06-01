"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ExternalLink,
  LayoutDashboard,
  LogOut,
  Phone,
  UserCircle,
  Wrench,
} from "lucide-react";

const nav = [
  { href: "/dashboard", label: "Pregled", icon: LayoutDashboard, exact: true },
  { href: "/zahtevki", label: "Zahtevki", icon: Wrench },
  { href: "/vzdrzevanje", label: "Vzdrževanje", icon: CalendarClock },
  { href: "/kontakt", label: "Kontakt", icon: Phone },
  { href: "/racun", label: "Račun", icon: UserCircle },
];

export function MojDemoShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", background: "var(--vo-bg)" }}>
      <div
        style={{
          borderBottom: "1px solid rgba(180, 83, 9, 0.35)",
          background: "rgba(180, 83, 9, 0.12)",
          padding: "10px 16px",
          textAlign: "center",
          fontSize: 13,
          fontWeight: 600,
          color: "#92400e",
        }}
      >
        Predogled portala za stranke — dejanski dostop bo na{" "}
        <a href="https://moj.visionone.si" style={{ color: "var(--vo-accent)", textDecoration: "underline" }}>
          moj.visionone.si
        </a>
        . Brez live videonadzora in RTSP.
      </div>

      <header
        style={{
          borderBottom: "1px solid var(--vo-border)",
          background: "var(--vo-surface)",
          padding: "12px 20px",
        }}
      >
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <strong style={{ fontSize: 18 }}>Moj VisionOne</strong>
            <div style={{ fontSize: 12, color: "var(--vo-muted)" }}>Demo Logistika d.o.o.</div>
          </div>
          <Link
            href="/login"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--vo-muted)",
            }}
          >
            <LogOut size={14} /> Odjava (demo)
          </Link>
        </div>
      </header>

      <div style={{ maxWidth: 960, margin: "0 auto", width: "100%", flex: 1, display: "flex", gap: 24, padding: "24px 20px" }}>
        <nav style={{ width: 180, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {nav.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: active ? "var(--vo-accent)" : "var(--vo-muted)",
                  background: active ? "var(--vo-accent-muted)" : "transparent",
                }}
              >
                <Icon size={16} /> {label}
              </Link>
            );
          })}
          <a
            href="https://portal.visionone.si/portal"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--vo-accent)",
            }}
          >
            <ExternalLink size={14} /> Interni portal
          </a>
        </nav>
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>

      <footer style={{ borderTop: "1px solid var(--vo-border)", padding: 16, textAlign: "center", fontSize: 12, color: "var(--vo-muted)" }}>
        VisionOne skrbi za tehnično stanje — stranka vidi le servis in komunikacijo.
      </footer>
    </div>
  );
}
