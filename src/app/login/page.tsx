import { redirect } from "next/navigation";
import { Camera, CheckCircle2, Headphones, LockKeyhole, Router } from "lucide-react";
import { getSession } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/dashboard");
  const params = await searchParams;

  const errorText =
    params.error === "db"
      ? "Povezava z bazo trenutno ni nastavljena. Poskusi znova kasneje ali kontaktiraj podporo."
      : "Email ali geslo ni pravilno. Preveri podatke in poskusi znova.";

  return (
    <main className="page-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.08fr) minmax(360px, 440px)",
          width: "100%",
          maxWidth: 1040,
          overflow: "hidden",
          border: "1px solid var(--vo-border)",
          borderRadius: 22,
          background: "var(--vo-surface)",
          boxShadow: "var(--vo-card-shadow)",
        }}
      >
        <section
          style={{
            padding: 38,
            background:
              "linear-gradient(135deg, rgba(13,122,122,.96), rgba(12,18,34,.94)), radial-gradient(circle at top right, rgba(255,255,255,.22), transparent 28rem)",
            color: "white",
            minHeight: 560,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 850 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "rgba(255,255,255,.14)",
                }}
              >
                <Camera size={21} />
              </span>
              VisionOne VMS
            </div>
            <h1 style={{ margin: "58px 0 12px", fontSize: 44, lineHeight: 1.05, letterSpacing: "-0.04em" }}>
              Varen dostop do vaših kamer.
            </h1>
            <p style={{ margin: 0, maxWidth: 500, color: "rgba(255,255,255,.78)", fontSize: 16, lineHeight: 1.65 }}>
              Pregled objektov, status Raspberry Pi gatewaya, licenca in pripravljena osnova za live view ter posnetke
              za nazaj.
            </p>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {[
              { icon: Router, text: "Gateway spremlja lokalni NVR in kamere" },
              { icon: LockKeyhole, text: "Prijava je vezana na uporabnika stranke" },
              { icon: CheckCircle2, text: "Licenca omejuje prikaz kamer v VMS portalu" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.text} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}>
                  <Icon size={18} />
                  <span>{item.text}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section style={{ padding: 34, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <p style={{ margin: 0, color: "var(--vo-accent)", fontWeight: 850, fontSize: 13 }}>Portal za stranke</p>
          <h2 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-0.03em" }}>Prijava</h2>
          <p style={{ margin: "0 0 24px", color: "var(--vo-muted)", lineHeight: 1.5 }}>
            Vpišite email in geslo, ki ste ga prejeli ob aktivaciji VisionOne VMS licence.
          </p>
          {params.error ? (
            <div
              style={{
                border: "1px solid rgba(192,38,38,.25)",
                background: "var(--vo-danger-muted)",
                color: "var(--vo-danger)",
                borderRadius: 10,
                padding: 12,
                marginBottom: 16,
                fontSize: 14,
              }}
            >
              {errorText}
            </div>
          ) : null}
          <form action="/api/auth/login" method="post" style={{ display: "grid", gap: 14 }}>
            <input type="hidden" name="next" value={params.next ?? "/dashboard"} />
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
              Email
              <input
                className="vo-input"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="ime@podjetje.si"
                required
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 700 }}>
              Geslo
              <input
                className="vo-input"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Vnesite geslo"
                required
              />
            </label>
            <button
              className="vo-button-primary"
              type="submit"
              style={{
                marginTop: 6,
                padding: "13px 16px",
                fontSize: 15,
              }}
            >
              Vstop v VMS
            </button>
          </form>
          <div
            style={{
              marginTop: 22,
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderTop: "1px solid var(--vo-border)",
              paddingTop: 18,
              color: "var(--vo-muted)",
              fontSize: 13,
            }}
          >
            <Headphones size={18} />
            Težave s prijavo? Kontaktirajte VisionOne podporo.
          </div>
        </section>
      </div>
    </main>
  );
}
