import type { ToolRisk } from "../tools/registry";
import { appNoEnvelope, normalizarSite, siteNoEnvelope } from "../controle/envelope";
import { rotuloDeEfeito } from "../navegador/risco";

/**
 * RISCO PELO ALVO no Windows (PRD §5.3, A7). Clicar em "Ver mais" e clicar
 * em "Enviar" são a mesma tool e riscos opostos: decide o que vai ser tocado,
 * e o que vai ser tocado é o que a árvore de acessibilidade DISSE que está
 * naquele ponto (o `preparar` pergunta às mãos), nunca o que o modelo diz.
 *
 * Tudo puro: a tool fixa o alvo e o `elevarRisco` e o `authorize` chamam isto.
 */

export const ACOES_DO_COMPUTADOR = ["clicar", "clique_duplo", "clique_direito", "clique_meio", "clique_triplo", "digitar", "tecla", "atalho", "rolar", "arrastar", "focar"] as const;
export type AcaoDoComputador = (typeof ACOES_DO_COMPUTADOR)[number];

/** Precisam de um alvo (elemento ou ponto); as outras agem no que tem o foco. */
export const PRECISAM_DE_ALVO: ReadonlySet<AcaoDoComputador> = new Set(["clicar", "clique_duplo", "clique_direito", "clique_meio", "clique_triplo", "arrastar", "focar"]);
const CLIQUES: ReadonlySet<AcaoDoComputador> = new Set(["clicar", "clique_duplo", "clique_meio", "clique_triplo"]);

/** O que as mãos disseram de um elemento (o do alvo, ou o que tem o foco). */
export interface ElementoVisto {
  papel: string;
  nome: string;
  assinatura: string;
  senha: boolean;
  app: string;
  /** os nomes do app que casam com o envelope (executável, descrição, apelidos) */
  nomesDoApp: string[];
  oculto: boolean;
  elevado: boolean;
  janela: number;
  /** pixel físico */
  ponto: [number, number] | null;
}

export interface PassoParaRisco {
  acao: AcaoDoComputador;
  alvo: ElementoVisto | null;
  /** para arrastar */
  destino?: ElementoVisto | null;
  /** o elemento com o foco, para digitar e tecla sem alvo */
  focado: ElementoVisto | null;
  texto?: string | null;
  tecla?: string | null;
}

export interface DecisaoDeRisco {
  risco: ToolRisk;
  motivo: string | null;
}

const teclasDe = (t: string | null | undefined) =>
  (t ?? "")
    .toLowerCase()
    .split("+")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * A ação aperta Enter? Tecla ou atalho com Enter, ou um texto a digitar com
 * quebra de linha (o `digitar` das mãos manda Enter para cada `\n`): os dois
 * enviam a mensagem num app de conversa. Puro.
 */
export function apertaEnter(p: Pick<PassoParaRisco, "acao" | "texto" | "tecla">): boolean {
  if (p.acao === "tecla" || p.acao === "atalho") return teclasDe(p.tecla).some((k) => k === "enter" || k === "return");
  if (p.acao === "digitar") return /[\r\n]/.test(p.texto ?? "");
  return false;
}

/** Colar é digitar: o que está na área de transferência vai para o campo. */
function cola(p: Pick<PassoParaRisco, "acao" | "tecla">): boolean {
  if (p.acao !== "atalho" && p.acao !== "tecla") return false;
  const k = teclasDe(p.tecla).join("+");
  return k === "ctrl+v" || k === "control+v" || k === "shift+insert";
}

/** O elemento que a ação toca de verdade: o alvo, ou o que tem o foco. */
export function elementoTocado(p: Pick<PassoParaRisco, "alvo" | "focado">): ElementoVisto | null {
  return p.alvo ?? p.focado;
}

/**
 * O que as mãos NUNCA fazem, nem com aprovação: digitar ou colar em campo de
 * senha, agir em app oculto ou em janela de administrador, e agir em app fora
 * do envelope aprovado. Devolve a frase da recusa, ou null. Puro.
 */
export function recusaDoPasso(p: PassoParaRisco, appsDoEnvelope: readonly string[], appsRecusados: readonly string[] = []): string | null {
  if (PRECISAM_DE_ALVO.has(p.acao) && !p.alvo) return `A ação ${p.acao} precisa de um alvo: o número do elemento (de computador_ver) ou um ponto da captura.`;
  if (p.acao === "arrastar" && !p.destino) return "Diga para onde arrastar (destino).";
  const tocados = [elementoTocado(p), p.destino ?? null].filter((x): x is ElementoVisto => !!x);
  if (!tocados.length) return "Não há elemento com o foco para receber a ação. Veja a janela de novo e diga o alvo.";
  for (const e of tocados) {
    if (e.oculto) return "Esse app está na lista de apps ocultos: a Órbita não age nele.";
    if (e.elevado) return "Essa janela roda como administrador: a Órbita nunca age em janela elevada.";
    // navegador: máscara de senha, sites e crítico próprios moram na frente do Chrome, não aqui
    if (e.nomesDoApp.some((n) => appNoEnvelope(n, appsRecusados))) return `O app "${e.app || e.nomesDoApp[0] || "desconhecido"}" está na lista de apps que a Órbita não toca na tela (computador.appsRecusados). Para o Chrome, o caminho é navegador_tarefa.`;
    if (!e.nomesDoApp.some((n) => appNoEnvelope(n, appsDoEnvelope))) {
      return `O app "${e.app || e.nomesDoApp[0] || "desconhecido"}" não está no envelope aprovado (${appsDoEnvelope.join(", ") || "nenhum app"}). Para usá-lo, proponha um envelope novo.`;
    }
  }
  const escreve = p.acao === "digitar" || cola(p);
  if (escreve && elementoTocado(p)?.senha) return "Este é um campo de senha: a Órbita nunca digita senha. Peça ao dono para digitar.";
  return null;
}

/** O risco de um passo. Nunca abaixo de `escrita` (agir na tela sempre muda alguma coisa). Puro. */
export function riscoDoPasso(p: PassoParaRisco, rotulos: readonly string[]): DecisaoDeRisco {
  if (CLIQUES.has(p.acao) && p.alvo) {
    const r = rotuloDeEfeito(p.alvo.nome, rotulos);
    if (r) return { risco: "efeito_externo", motivo: `${p.alvo.papel} "${p.alvo.nome.slice(0, 60)}" (${r})` };
  }
  if (p.acao === "arrastar") {
    for (const e of [p.alvo, p.destino]) {
      const r = e ? rotuloDeEfeito(e.nome, rotulos) : null;
      if (r) return { risco: "efeito_externo", motivo: `arrastar envolvendo "${e!.nome.slice(0, 60)}" (${r})` };
    }
  }
  if (apertaEnter(p)) {
    const e = elementoTocado(p);
    // Enter num botão é clicar nele
    const r = e && e.papel === "botao" ? rotuloDeEfeito(e.nome, rotulos) : null;
    if (r) return { risco: "efeito_externo", motivo: `Enter no botão "${e!.nome.slice(0, 60)}" (${r})` };
    // num documento de várias linhas (editor de texto) Enter é quebra de linha;
    // em campo de conversa ou formulário, Enter ENVIA, e quem decide é o dono
    if (e?.papel !== "documento") return { risco: "efeito_externo", motivo: "Enter pode enviar (mensagem ou formulário)" };
  }
  return { risco: "escrita", motivo: null };
}

/** O maior risco de um lote, com o motivo do passo que o levou lá. Puro. */
export function riscoDoLote(passos: readonly PassoParaRisco[], rotulos: readonly string[]): DecisaoDeRisco & { passo: number | null } {
  let melhor: DecisaoDeRisco & { passo: number | null } = { risco: "escrita", motivo: null, passo: null };
  passos.forEach((p, i) => {
    const d = riscoDoPasso(p, rotulos);
    if (d.risco !== "escrita" && melhor.risco === "escrita") melhor = { ...d, passo: i };
  });
  return melhor;
}

// ── abrir ───────────────────────────────────────────────────────────────────

export interface PedidoDeAbrir {
  tipo: "app" | "arquivo" | "url";
  alvo: string;
}

/**
 * Abrir app, arquivo ou endereço (PRD A7): `escrita` com o alvo no envelope,
 * `efeito_externo` fora dele. Arquivo abre com o programa padrão, que pode ser
 * qualquer app: sempre `efeito_externo` (como o "abrir anexo" da C4).
 * Endereço com parâmetros vai para a fila (o canal de vazamento do PRD B3). Puro.
 */
export function riscoDeAbrir(p: PedidoDeAbrir, envelope: { apps: readonly string[]; sites: readonly string[] } | null): DecisaoDeRisco {
  if (!envelope) return { risco: "efeito_externo", motivo: "sem sessão de controle aberta" };
  if (p.tipo === "arquivo") return { risco: "efeito_externo", motivo: "abre com o programa padrão do Windows" };
  if (p.tipo === "app") return appNoEnvelope(p.alvo, envelope.apps) ? { risco: "escrita", motivo: null } : { risco: "efeito_externo", motivo: "app fora do envelope da sessão" };
  let u: URL;
  try {
    u = new URL(p.alvo);
  } catch {
    return { risco: "perigoso", motivo: "endereço que não dá para ler" };
  }
  if (u.search.length > 1) return { risco: "efeito_externo", motivo: "endereço com parâmetros" };
  return siteNoEnvelope(normalizarSite(p.alvo), envelope.sites) ? { risco: "escrita", motivo: null } : { risco: "efeito_externo", motivo: "site fora do envelope da sessão" };
}
