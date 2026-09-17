/** Um compromisso/ação extraído de uma reunião (MTG.2). */
export interface Compromisso {
  descricao: string;
  responsavel?: string;
  prazo?: string;
}

/**
 * Junta os compromissos extraídos de vários blocos (mapa-redução), removendo
 * duplicatas: a mesma ação costuma ser mencionada em mais de um trecho da
 * reunião. Dedup por texto normalizado (minúsculo, sem acento, espaços
 * colapsados) — simples e sem custo de embedding, adequado ao volume (poucas
 * dezenas de itens por reunião).
 */
export function dedupeCompromissos(items: Compromisso[], max = 30): Compromisso[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const seen = new Set<string>();
  const out: Compromisso[] = [];
  for (const c of items) {
    const key = norm(c.descricao);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Converte um prazo em texto livre (o que o modelo extraiu, ex.: "2026-09-20",
 * "amanhã") numa data, quando dá para interpretar com segurança. Só aceita
 * formas explícitas (ISO ou dd/mm/aaaa) — texto relativo ("amanhã") o modelo já
 * deveria ter resolvido usando o contexto temporal do prompt; aqui não
 * adivinhamos fuso nem "daqui a uma semana" para não criar uma tarefa com data
 * errada silenciosamente.
 */
export function parsePrazo(prazo: string | undefined, now = new Date()): Date | null {
  if (!prazo?.trim()) return null;
  const s = prazo.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    return Number.isNaN(d.getTime()) || d.getFullYear() < now.getFullYear() - 1 ? null : d;
  }
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (br) {
    const [, dd, mm, yy] = br;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(year, Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
