"use client";

import { StatusPill } from "@/components/StatusPill";
import { LiveStreamPanel } from "@/components/LiveStreamPanel";

type Row = {
  id: string;
  name: string;
  siteName: string;
  channel: number;
  status: string;
};

export function CamerasTable({ rows, liveEnabled }: { rows: Row[]; liveEnabled: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead>
          <tr style={{ color: "var(--muted)", fontSize: 12, textAlign: "left" }}>
            <th style={{ padding: "10px 8px" }}>Kamera</th>
            <th style={{ padding: "10px 8px" }}>Objekt</th>
            <th style={{ padding: "10px 8px" }}>Kanal</th>
            <th style={{ padding: "10px 8px" }}>Status</th>
            <th style={{ padding: "10px 8px" }}>Live</th>
            <th style={{ padding: "10px 8px" }}>Posnetki</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((camera) => (
            <tr key={camera.id} style={{ borderTop: "1px solid var(--border)" }}>
              <td style={{ padding: "14px 8px", fontWeight: 800 }}>{camera.name}</td>
              <td style={{ padding: "14px 8px", color: "var(--muted)" }}>{camera.siteName}</td>
              <td style={{ padding: "14px 8px" }}>{camera.channel}</td>
              <td style={{ padding: "14px 8px" }}>
                <StatusPill status={camera.status} />
              </td>
              <td style={{ padding: "14px 8px" }}>
                {liveEnabled && camera.status === "online" ? (
                  <LiveStreamPanel cameraId={camera.id} />
                ) : (
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>{liveEnabled ? "Offline" : "Ni v licenci"}</span>
                )}
              </td>
              <td style={{ padding: "14px 8px", color: "var(--muted)" }}>Faza 3</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
