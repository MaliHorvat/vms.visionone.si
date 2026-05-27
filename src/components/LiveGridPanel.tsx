"use client";

import { useEffect, useState } from "react";

type LiveSession = {
  playerUrl: string;
  camera: { id: string; name: string; channel: number };
  site: { name: string };
};

export function LiveGridPanel({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSessions([]);
    void fetch("/api/live/cameras", { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { cameras?: LiveSession[]; error?: string; hint?: string };
        if (!res.ok) throw new Error(data.hint ? `${data.error} ${data.hint}` : data.error ?? "Live ni na voljo.");
        setSessions(data.cameras ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Live ni na voljo.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Live vse kamere
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
            style={{
              width: "min(1400px, 100%)",
              maxHeight: "92vh",
              overflow: "auto",
              padding: 20,
              background: "var(--surface)",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Live view</p>
                <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>Vse kamere</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>
                ×
              </button>
            </div>
            {loading ? <p style={{ color: "var(--muted)" }}>Pripravljam predvajanje…</p> : null}
            {error ? <p style={{ color: "var(--danger, #c0392b)" }}>{error}</p> : null}
            {!loading && !error && sessions.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                }}
              >
                {sessions.map((session) => (
                  <div key={session.camera.id} style={{ display: "grid", gap: 8 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 800 }}>{session.camera.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--muted)" }}>
                        {session.site.name} · kanal {session.camera.channel}
                      </p>
                    </div>
                    <iframe
                      title={`Live ${session.camera.name}`}
                      src={session.playerUrl}
                      style={{
                        width: "100%",
                        height: 220,
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        background: "#000",
                      }}
                      allow="autoplay; fullscreen"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
