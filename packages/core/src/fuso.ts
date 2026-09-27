/**
 * Hora LOCAL da casa virando instante. PURO.
 *
 * "Me lembra às 15h" chega como "2026-09-27T15:00", sem fuso. O `new Date`
 * leria isso no fuso do PROCESSO, e a api pode rodar num contêiner em UTC: o
 * lembrete dispararia às 12h de Brasília. Aqui a hora é lida no fuso da casa
 * (`connectors.fusoHorario`), com o horário de verão que o fuso tiver.
 */

/** Quanto o fuso está à frente do UTC (em ms) naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instante));
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour") % 24, v("minute"), v("second")) - instante;
}

/**
 * "2026-09-27T15:00" (ou com segundos) no fuso da casa → Date. Texto com fuso
 * explícito ("Z", "-03:00") é respeitado como veio. Inválido → null.
 */
export function instanteLocal(texto: string, fuso: string): Date | null {
  const t = texto.trim();
  if (!t) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const [, a, mes, d, h, min, s] = m.map(Number);
  const comoUtc = Date.UTC(a, mes - 1, d, h, min, s || 0);
  let z = fuso || "America/Sao_Paulo";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: z });
  } catch {
    z = "America/Sao_Paulo";
  }
  // duas voltas acertam a hora perto de uma troca de horário de verão
  let inst = comoUtc - deslocamento(comoUtc, z);
  inst = comoUtc - deslocamento(inst, z);
  const r = new Date(inst);
  return Number.isNaN(r.getTime()) ? null : r;
}
