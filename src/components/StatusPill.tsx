export function StatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const cls =
    normalized === "online" || normalized === "ok"
      ? "pill pill-ok"
      : normalized === "pending" || normalized === "unknown" || normalized === "warn"
        ? "pill pill-warn"
        : "pill pill-bad";
  return <span className={cls}>{status}</span>;
}
