"use client";

import { useEffect, useState } from "react";

type LiveSession = {
  playerUrl: string;
  camera: { name: string };
  site: { name: string };
};

export function LiveStreamPanel({ cameraId }: { cameraId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<LiveSession | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSession(null);
    void fetch(`/api/live/cameras/${encodeURIComponent(cameraId)}`, { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as LiveSession & { error?: string; hint?: string };
        if (!res.ok) throw new Error(data.hint ? `${data.error} ${data.hint}` : data.error ?? "Live ni na voljo.");
        setSession(data);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Live ni na voljo.");
      })
      .finally(() => setLoading(false));
  }, [open, cameraId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent-muted)]"
      >
        Live
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(0,0,0,.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="card"
            style={{ width: "min(960px, 100%)", padding: 20, background: "var(--surface)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Live view</p>
                <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{session?.camera.name ?? "Kamera"}</h2>
                {session?.site.name ? <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>{session.site.name}</p> : null}
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                ×
              </button>
            </div>
            {loading ? <p style={{ color: "var(--muted)" }}>Pripravljam predvajanje…</p> : null}
            {error ? <p style={{ color: "var(--danger, #c0392b)" }}>{error}</p> : null}
            {session?.playerUrl ? (
              <iframe
                title={`Live ${session.camera.name}`}
                src={session.playerUrl}
                style={{ width: "100%", height: 480, border: "1px solid var(--border)", borderRadius: 12, background: "#000" }}
                allow="autoplay; fullscreen"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
