export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <p style={{ margin: 0, color: "var(--vo-muted)", fontSize: 12, fontWeight: 800 }}>{label}</p>
      <p style={{ margin: "8px 0 0", fontSize: 30, fontWeight: 850 }}>{value}</p>
      {detail ? <p style={{ margin: "6px 0 0", color: "var(--vo-muted)", fontSize: 12 }}>{detail}</p> : null}
    </div>
  );
}
