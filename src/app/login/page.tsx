import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/session";

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <main className="page-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ width: "100%", maxWidth: 440, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <ShieldCheck size={28} color="var(--vo-accent)" />
          <strong style={{ fontSize: 20 }}>Moj VisionOne</strong>
        </div>
        <p style={{ fontSize: 13, color: "var(--vo-muted)", lineHeight: 1.5, marginBottom: 20 }}>
          <strong>Predogled</strong> portala za stranke na <code>vms.visionone.si</code>. Dejanski dostop:{" "}
          <a href="https://moj.visionone.si" style={{ color: "var(--vo-accent)" }}>
            moj.visionone.si
          </a>
        </p>
        <Link href="/dashboard" className="btn btn-primary" style={{ display: "block", textAlign: "center", width: "100%" }}>
          Vstopi v predogled
        </Link>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--vo-muted)", textAlign: "center" }}>
          Brez prijave — demo podatki. Live video in RTSP nista več del tega vmesnika.
        </p>
      </div>
    </main>
  );
}
