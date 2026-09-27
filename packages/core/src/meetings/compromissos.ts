import { z } from "zod";

/** Um compromisso/ação extraído de uma reunião (MTG.2). */
export interface Compromisso {
  descricao: string;
  responsavel?: string;
  prazo?: string;
}

/** Teto de compromissos por bloco de transcrição. */
export const MAX_COMPROMISSOS = 20;

/**
 * Texto OPCIONAL vindo de um modelo.
 *
 * Existe por um defeito medido em 26/09/2026, e ele custou a funcionalidade
 * inteira: o modelo devolveu os dois compromissos da reunião perfeitos, com
 * `"prazo": null`. `z.string().optional()` aceita o campo AUSENTE, mas recusa
 * `null` — então a lista toda falhava na validação e o `.catch([])` do schema a
 * trocava por vazia, sem um log. O dono via um resumo impecável, nenhum
 * compromisso e nenhuma tarefa, sem nada indicando por quê.
 *
 * Mandar `null` no lugar de omitir o campo é o comportamento COMUM dos modelos,
 * não uma exceção de um deles. Então quem se adapta é o schema.
 */
const textoOpcional = (max: number) =>
  z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional()
    .transform((v) => {
      const s = v == null ? "" : String(v).trim();
      return s ? s.slice(0, max) : undefined;
    });

/**
 * Texto OBRIGATÓRIO: corta no limite em vez de recusar. Perder o compromisso
 * inteiro porque a descrição passou de 300 caracteres é pior do que guardá-la
 * truncada.
 */
const textoObrigatorio = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().slice(0, max))
    .refine((s) => s.length > 0, "descrição vazia");

export const CompromissoSchema = z.object({
  descricao: textoObrigatorio(300),
  responsavel: textoOpcional(120).describe('quem se comprometeu (o nome, "Locutor A", ou vazio se não ficou claro)'),
  prazo: textoOpcional(60).describe("prazo mencionado, em ISO (AAAA-MM-DD) se houver data explícita; vazio se não houver"),
});

/**
 * Os compromissos que o modelo devolveu, validados UM A UM.
 *
 * Deliberadamente não é `z.array(CompromissoSchema).catch([])`: ali um único
 * item torto joga fora todos os outros. Aqui o que presta passa e o que não
 * presta é CONTADO, para a perda ser parcial e visível em vez de total e muda.
 *
 * Aceita também um objeto solto no lugar da lista, que é o que alguns modelos
 * mandam quando existe só um compromisso.
 *
 * Puro de propósito: quem registra o log é quem chama.
 */
export function compromissosDoModelo(bruto: unknown): { compromissos: Compromisso[]; descartados: number } {
  const itens = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" ? [bruto] : [];
  const compromissos: Compromisso[] = [];
  let descartados = 0;
  for (const item of itens.slice(0, MAX_COMPROMISSOS)) {
    const r = CompromissoSchema.safeParse(item);
    if (r.success) compromissos.push(r.data);
    else descartados++;
  }
  return { compromissos, descartados };
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
