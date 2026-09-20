/**
 * Linha rótulo → valor. Arquivo próprio para não arrastar o `side-panels.tsx`
 * inteiro (Persona, Economia, Push) para o bundle de quem só quer a linha.
 */
export function Stat({ label, value, accent, good }: { label: string; value: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <b className={good ? "bom" : accent ? "acento" : ""}>{value}</b>
    </div>
  );
}
