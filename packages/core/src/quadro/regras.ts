import { situacaoDoPrazo, REGRA_PADRAO, type Prazo, type RegraDoPrazo } from "../comigo/regras";

/**
 * O QUADRO da Adalink dentro da Órbita (pedido do dono, 09/10/2026): os cards
 * como estão lá, para ver e mover pela tela, pelo chat ou pela voz. Puro: recebe
 * o JSON dos servidores MCP e monta as colunas.
 *
 * Chamados: uma coluna por status (`tickets_board`). Gestão: as atividades DO
 * DONO nas FASES do projeto (catálogo `activity_phase`), e não nas três
 * colunas do "meu dia": lá "fazendo" aponta para a fase Planejamento, e mover
 * para ela jogaria uma atividade em Desenvolvimento de volta (medido em
 * 09/10/2026). Mover aqui muda exatamente a fase da coluna.
 */

export type QualQuadro = "chamados" | "gestao";
export const QUADROS: readonly QualQuadro[] = ["chamados", "gestao"];
export const NOME_DO_QUADRO: Record<QualQuadro, string> = { chamados: "chamados", gestao: "gestão" };

export interface CardDoQuadro {
  id: string;
  codigo: string | null;
  titulo: string;
  /** organização (chamado) ou "projeto · empresa" (atividade) */
  subtitulo: string | null;
  /** cor da empresa na gestão, para o ponto do card */
  cor: string | null;
  prioridade: string | null;
  responsaveis: string[];
  comVoce: boolean;
  prazo: Prazo | null;
  critico: boolean;
  /** horas feitas e previstas (atividade) */
  horas: { feitas: number; previstas: number } | null;
}

export interface ColunaDoQuadro {
  id: string;
  rotulo: string;
  /** o total real da coluna (a central pode mandar a lista cortada) */
  total: number;
  cards: CardDoQuadro[];
}

export interface Quadro {
  qual: QualQuadro;
  colunas: ColunaDoQuadro[];
  lidoEm: string;
}

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(ehObj) : []);
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// ── chamados ────────────────────────────────────────────────────────────────

export const COLUNAS_DE_CHAMADO: { id: string; rotulo: string }[] = [
  { id: "open", rotulo: "Aberto" },
  { id: "in_progress", rotulo: "Em andamento" },
  { id: "waiting", rotulo: "Aguardando" },
  { id: "resolved", rotulo: "Resolvido" },
  { id: "closed", rotulo: "Fechado" },
];
const PRIORIDADE: Record<string, string> = { low: "baixa", medium: "média", high: "alta", critical: "crítica" };
const FINAIS = new Set(["resolved", "closed"]);

const primeiroNome = (s: string) => normalizar(s).split(" ")[0] ?? "";
const ehDoDono = (responsavel: string, meuNome: string) => Boolean(responsavel && meuNome) && primeiroNome(responsavel) === primeiroNome(meuNome);

/** O quadro da central (`tickets_board`): as cinco colunas, na ordem da central, mesmo vazias. */
export function quadroDeChamados(board: unknown, meuNome: string, agora = new Date(), regra: RegraDoPrazo = REGRA_PADRAO): Quadro {
  const colunasLidas = ehObj(board) ? lista(board.columns) : [];
  const colunas = COLUNAS_DE_CHAMADO.map(({ id, rotulo }) => {
    const lida = colunasLidas.find((c) => c.status === id);
    const cards = lista(lida?.tickets).map((t): CardDoQuadro => {
      const responsavel = texto(t.assignee);
      return {
        id: texto(t.id) || texto(t.code),
        codigo: texto(t.code) || null,
        titulo: texto(t.title) || "(sem título)",
        subtitulo: texto(t.organization) || null,
        cor: null,
        prioridade: PRIORIDADE[texto(t.priority)] ?? (texto(t.priority) || null),
        responsaveis: responsavel ? [responsavel] : [],
        comVoce: ehDoDono(responsavel, meuNome),
        // chamado resolvido ou fechado não tem mais prazo correndo
        prazo: FINAIS.has(id) ? null : situacaoDoPrazo(texto(t.slaDeadline) || null, agora, regra, { pausado: t.slaPaused === true }),
        critico: texto(t.priority) === "critical",
        horas: null,
      };
    });
    const total = typeof lida?.total === "number" ? lida.total : cards.length;
    return { id, rotulo, total: Math.max(total, cards.length), cards };
  });
  return { qual: "chamados", colunas, lidoEm: agora.toISOString() };
}

// ── gestão ──────────────────────────────────────────────────────────────────

export interface FaseDaGestao {
  id: string;
  label: string;
}

/**
 * As atividades do dono nas fases do projeto. `atividades` são as do "meu dia"
 * já com a `phase` de cada uma (lida por `get_activity`); fase que o catálogo
 * não conhece cai numa coluna "Outra fase" no fim, para nenhuma sumir.
 */
export function quadroDaGestao(fases: FaseDaGestao[], atividades: unknown[], agora = new Date(), regra: RegraDoPrazo = REGRA_PADRAO): Quadro {
  const vistas = new Set<string>();
  const cards = new Map<string, CardDoQuadro[]>();
  for (const a of atividades.filter(ehObj)) {
    const id = texto(a.id);
    if (!id || vistas.has(id)) continue;
    vistas.add(id);
    const fase = texto(a.phase) || "?";
    const responsaveis = lista(a.responsibles);
    const card: CardDoQuadro = {
      id,
      codigo: texto(a.code) || null,
      titulo: texto(a.name) || "(sem nome)",
      subtitulo: [texto(a.projectName), texto(a.companyName)].filter(Boolean).join(" · ") || null,
      cor: /^#[0-9a-f]{3,8}$/i.test(texto(a.companyColor)) ? texto(a.companyColor) : null,
      prioridade: null,
      responsaveis: responsaveis.map((r) => texto(r.name)).filter(Boolean),
      comVoce: responsaveis.some((r) => r.isMe === true) || responsaveis.length === 0,
      prazo: situacaoDoPrazo(texto(a.endDate) || null, agora, regra, { inicio: texto(a.startDate) || null }),
      critico: a.isCritical === true,
      horas: typeof a.estimatedHours === "number" ? { feitas: typeof a.realizadoTotal === "number" ? a.realizadoTotal : 0, previstas: a.estimatedHours } : null,
    };
    cards.set(fase, [...(cards.get(fase) ?? []), card]);
  }
  const colunas: ColunaDoQuadro[] = fases.map((f) => {
    const daFase = (cards.get(f.id) ?? []).sort(porPrazo);
    return { id: f.id, rotulo: f.label, total: daFase.length, cards: daFase };
  });
  const conhecidas = new Set(fases.map((f) => f.id));
  const orfas = [...cards.entries()].filter(([fase]) => !conhecidas.has(fase)).flatMap(([, cs]) => cs);
  if (orfas.length) colunas.push({ id: "?", rotulo: "Outra fase", total: orfas.length, cards: orfas });
  return { qual: "gestao", colunas, lidoEm: agora.toISOString() };
}

const porPrazo = (a: CardDoQuadro, b: CardDoQuadro) => (a.prazo?.restanteMs ?? Infinity) - (b.prazo?.restanteMs ?? Infinity);

/**
 * O quadro no formato que vai ao modelo e vira cartão (`ver_quadro`, e o
 * `tickets_board` cru da central quando o modelo escolhe ele): uma lista por
 * coluna, com o prazo já em texto.
 */
export function quadroParaOModelo(q: Quadro) {
  return {
    quadro: q.qual,
    colunas: q.colunas.map((c) => ({
      coluna: c.rotulo,
      total: c.total,
      cards: c.cards.map((k) => ({ codigo: k.codigo, titulo: k.titulo, onde: k.subtitulo, com: k.responsaveis.join(", ") || null, prioridade: k.prioridade, prazo: k.prazo?.texto ?? null, atrasado: k.prazo?.estado === "atrasado" })),
    })),
  };
}

// ── mover ───────────────────────────────────────────────────────────────────

/** O quadro com o card na coluna nova (a tela mostra na hora e desfaz se o sistema recusar). */
export function moverNoQuadro(q: Quadro, cardId: string, colunaId: string): Quadro {
  const card = q.colunas.flatMap((c) => c.cards).find((c) => c.id === cardId);
  const origem = q.colunas.find((c) => c.cards.some((x) => x.id === cardId));
  if (!card || !origem || origem.id === colunaId || !q.colunas.some((c) => c.id === colunaId)) return q;
  return {
    ...q,
    colunas: q.colunas.map((c) =>
      c.id === origem.id ? { ...c, total: Math.max(0, c.total - 1), cards: c.cards.filter((x) => x.id !== cardId) }
      : c.id === colunaId ? { ...c, total: c.total + 1, cards: [card, ...c.cards] }
      : c,
    ),
  };
}

export type Achado<T> = { ok: true; valor: T } | { ok: false; erro: string };

/**
 * O card pelo que o dono disse: o código ("TCK-0048", "0048", "48") ou parte do
 * título. Mais de um com o mesmo pedaço de título devolve a lista para ele
 * escolher: mover o card errado muda o sistema de verdade.
 */
export function acharCard(q: Quadro, pedido: string): Achado<CardDoQuadro & { coluna: string }> {
  const todos = q.colunas.flatMap((c) => c.cards.map((card) => ({ ...card, coluna: c.rotulo })));
  const p = normalizar(pedido);
  if (!p) return { ok: false, erro: "Diga qual card." };
  const soDigitos = p.replace(/\D/g, "");
  const porCodigo = todos.filter((c) => {
    const cod = normalizar(c.codigo ?? "");
    return cod === p || (soDigitos.length >= 2 && cod.replace(/\D/g, "").replace(/^0+/, "") === soDigitos.replace(/^0+/, ""));
  });
  if (porCodigo.length === 1) return { ok: true, valor: porCodigo[0]! };
  const porTitulo = todos.filter((c) => normalizar(c.titulo).includes(p));
  if (porTitulo.length === 1) return { ok: true, valor: porTitulo[0]! };
  const candidatos = porCodigo.length ? porCodigo : porTitulo;
  if (candidatos.length > 1) {
    return { ok: false, erro: `Mais de um card combina com "${pedido}": ${candidatos.slice(0, 6).map((c) => `${c.codigo ? `${c.codigo} ` : ""}${c.titulo}`).join("; ")}. Qual deles?` };
  }
  return { ok: false, erro: `Não achei "${pedido}" no quadro de ${NOME_DO_QUADRO[q.qual]}.` };
}

/** A coluna pelo nome falado ("em andamento", "homologação", "concluído"), sem acento nem caixa. */
export function acharColuna(q: Quadro, pedido: string): Achado<ColunaDoQuadro> {
  const p = normalizar(pedido);
  const reais = q.colunas.filter((c) => c.id !== "?");
  const exata = reais.find((c) => normalizar(c.rotulo) === p || c.id === pedido.trim());
  if (exata) return { ok: true, valor: exata };
  const parecidas = reais.filter((c) => normalizar(c.rotulo).includes(p) || (p.length >= 4 && p.includes(normalizar(c.rotulo))));
  if (parecidas.length === 1) return { ok: true, valor: parecidas[0]! };
  return { ok: false, erro: `Não sei qual coluna é "${pedido}". As colunas são: ${reais.map((c) => c.rotulo).join(", ")}.` };
}
