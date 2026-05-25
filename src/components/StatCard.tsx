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
    <div className="card" style={{ padding: 20 }}>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>{label}</p>
      <p style={{ margin: "10px 0 0", fontSize: 34, fontWeight: 850 }}>{value}</p>
      {detail ? <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>{detail}</p> : null}
    </div>
  );
}
