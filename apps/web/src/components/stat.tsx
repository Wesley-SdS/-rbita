/** Linha rótulo→valor usada nos painéis de sessão/economia. Arquivo próprio p/
 *  não puxar todo o side-panels.tsx (Persona/Economia/Push) pro bundle principal. */
export function Stat({ label, value, accent, good }: { label: string; value: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
      <span>{label}</span>
      <b className="font-mono" style={{ color: good ? "#8ac98f" : accent ? "var(--color-gold)" : "var(--color-ink)" }}>{value}</b>
    </div>
  );
}
