import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;

  return (
    <main
      className="page-shell"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 440, padding: 32 }}>
        <p style={{ margin: 0, color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>VisionOne VMS</p>
        <h1 style={{ margin: "10px 0 8px", fontSize: 30 }}>Prijava stranke</h1>
        <p style={{ margin: "0 0 24px", color: "var(--muted)" }}>
          Dostop do kamer, statusa objekta in licence na `vms.visionone.si`.
        </p>
        {params.error ? (
          <div
            style={{
              border: "1px solid rgba(239,68,68,.28)",
              background: "rgba(239,68,68,.08)",
              color: "#b91c1c",
              borderRadius: 12,
              padding: 12,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            Prijava ni uspela. Preveri email in geslo.
          </div>
        ) : null}
        <form action="/api/auth/login" method="post" style={{ display: "grid", gap: 14 }}>
          <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "12px 14px",
                background: "var(--surface-soft)",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
            Geslo
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "12px 14px",
                background: "var(--surface-soft)",
              }}
            />
          </label>
          <button
            type="submit"
            style={{
              marginTop: 6,
              border: 0,
              borderRadius: 14,
              padding: "12px 16px",
              background: "var(--accent)",
              color: "white",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Vstopi
          </button>
        </form>
      </div>
    </main>
  );
}
