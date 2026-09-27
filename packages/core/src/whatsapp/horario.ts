/**
 * Horário da casa, PURO: quando é "7h" e "dia útil" para o briefing, e se agora
 * está dentro do silêncio dos avisos. Tudo no fuso da casa
 * (`connectors.fusoHorario`), não no do processo: a api pode rodar num
 * contêiner em UTC, e um briefing das 7h chegaria às 4h.
 */

export interface AgoraLocal {
  /** "AAAA-MM-DD" no fuso da casa */
  dia: string;
  /** minutos desde a meia-noite local */
  minutos: number;
  /** 0 = domingo … 6 = sábado */
  diaDaSemana: number;
}

export function agoraLocal(agora: Date, fuso: string): AgoraLocal {
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso || "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(agora);
  } catch {
    // fuso inválido na config: cai no da casa padrão em vez de parar o laço
    return agoraLocal(agora, "America/Sao_Paulo");
  }
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const semana = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v("weekday"));
  const hora = Number(v("hour")) % 24; // "24" à meia-noite em alguns motores
  return { dia: `${v("year")}-${v("month")}-${v("day")}`, minutos: hora * 60 + Number(v("minute")), diaDaSemana: semana };
}

/** "07:30" → 450; inválido → null. */
export function minutosDe(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * Agora está no silêncio? "22:00-07:00" atravessa a meia-noite; "13:00-14:00"
 * não. Faixa vazia ou mal escrita é "sem silêncio" (errar para avisar é melhor
 * que errar para calar um aviso de conta vencendo).
 */
export function noSilencio(faixa: string, minutosAgora: number): boolean {
  const [ini, fim] = faixa.split("-").map((x) => minutosDe(x ?? ""));
  if (ini === null || fim === null || ini === undefined || fim === undefined || ini === fim) return false;
  return ini < fim ? minutosAgora >= ini && minutosAgora < fim : minutosAgora >= ini || minutosAgora < fim;
}

/**
 * O briefing de hoje está devido? Depois do horário, uma vez por dia, e só em
 * dia útil quando pedido. "Depois do horário" e não "no minuto": se a Órbita
 * estava desligada às 7h e sobe às 8h, o briefing ainda sai.
 */
export function briefingDevido(a: AgoraLocal, cfg: { ativo: boolean; horario: string; dias: string }, ultimo: string | null): boolean {
  if (!cfg.ativo || ultimo === a.dia) return false;
  const alvo = minutosDe(cfg.horario);
  if (alvo === null || a.minutos < alvo) return false;
  if (cfg.dias === "uteis" && (a.diaDaSemana === 0 || a.diaDaSemana === 6)) return false;
  // passou do meio-dia sem ter saído: briefing da manhã às 15h não é briefing
  return a.minutos < Math.max(alvo + 5 * 60, 12 * 60);
}
