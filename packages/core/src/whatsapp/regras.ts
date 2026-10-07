/**
 * As decisões do WhatsApp que não podem errar, PURAS (sem banco, sem rede) para
 * ficarem travadas em teste: antibanimento, aprovar por frase e as travas da
 * resposta automática. Quem aplica é `enviar.ts`, `rotear.ts` e `automatico.ts`.
 */

// ── antibanimento (portado de domain/antiban/outbound-policy.ts do workspace) ──

/**
 * O que queima número em canal não oficial não é volume, é INICIATIVA. Quem só
 * responde quem escreveu primeiro fica na casa de 2% de banimento em 12 meses;
 * quem aborda contato novo vai a 15 a 30% (medição citada no workspace). A
 * Órbita fica na primeira faixa: abordagem fria só com aprovação humana.
 *
 * Sem o aquecimento por idade do número do workspace: aqui o número é o
 * pessoal do dono, com anos de uso. O teto diário cobre o mesmo risco e é
 * config.
 */
export interface ContextoDeEnvio {
  /** o contato já escreveu alguma vez para este número */
  contatoEscreveu: boolean;
  /** um humano aprovou ESTE envio (tela, frase, voz) */
  aprovacaoHumana: boolean;
  enviadasUltimoMinuto: number;
  enviadasUltimas24h: number;
}
export interface LimitesDeEnvio {
  porMinuto: number;
  porDia: number;
}
export type DecisaoDeEnvio = { ok: true } | { ok: false; motivo: "abordagem_fria" | "por_minuto" | "por_dia"; mensagem: string };

export function decidirEnvio(c: ContextoDeEnvio, l: LimitesDeEnvio): DecisaoDeEnvio {
  if (!c.contatoEscreveu && !c.aprovacaoHumana) {
    return { ok: false, motivo: "abordagem_fria", mensagem: "Esse número nunca escreveu para você. Puxar conversa só com a sua aprovação." };
  }
  if (c.enviadasUltimoMinuto >= l.porMinuto) {
    return { ok: false, motivo: "por_minuto", mensagem: `Limite de ${l.porMinuto} envios por minuto atingido (proteção contra banimento). Tente de novo em um minuto.` };
  }
  if (c.enviadasUltimas24h >= l.porDia) {
    return { ok: false, motivo: "por_dia", mensagem: `Limite de ${l.porDia} envios por dia atingido (proteção contra banimento).` };
  }
  return { ok: true };
}

// ── aprovar por frase (W6) ──

/** minúsculas, sem acento, sem pontuação, espaços únicos */
export function normalizarFrase(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// palavras que podem acompanhar a frase sem mudar o sentido ("manda sim", "pode mandar a 2")
const ENCHIMENTO = new Set(["sim", "ai", "ja", "entao", "por", "favor", "ok", "isso", "a", "o", "numero", "opcao", "essa", "esse", "la", "vai"]);

export interface RespostaInterpretada {
  acao: "confirmar" | "cancelar" | null;
  /** "manda a 2": qual da lista (1-based) */
  escolha?: number;
  /** "manda 1 manda 2", "manda 1 e 3": mais de uma da lista */
  escolhas?: number[];
  /** "manda tudo", "aprova os dois" */
  todas?: boolean;
}

// "manda tudo", "aprova as duas", "pode apagar ambos"
const TODAS = new Set(["tudo", "todas", "todos", "ambos", "ambas", "dois", "duas", "tres"]);
// o que pode ficar ENTRE os números sem mudar o sentido ("manda 1 e 2", "1, 2")
const LIGACAO = new Set(["e", "as", "os", "mais"]);

/**
 * A mensagem do dono é uma resposta a uma proposta? Estrito DE PROPÓSITO: a
 * mensagem tem de COMEÇAR pela frase e o resto tem de ser enchimento ou o
 * número da opção. "Não, manda amanhã às 8" não é cancelamento nem aprovação:
 * é pedido novo, e vira turno normal. Errar para "não é resposta" custa um
 * turno; errar para "aprovou" manda uma mensagem que não se desfaz.
 */
export function interpretarResposta(texto: string, confirmar: readonly string[], cancelar: readonly string[]): RespostaInterpretada {
  const t = normalizarFrase(texto);
  if (!t || t.split(" ").length > 8) return { acao: null };

  // as palavras das próprias frases podem se repetir: "manda 1 manda 2"
  const daFrase = (frases: readonly string[]) => new Set(frases.flatMap((f) => normalizarFrase(f).split(" ")));
  const casa = (frases: readonly string[]): { resto: string[] } | null => {
    // a frase mais longa primeiro: "nao manda" antes de "nao", "pode mandar" antes de "pode"
    for (const f of [...frases].map(normalizarFrase).filter(Boolean).sort((a, b) => b.length - a.length)) {
      if (t === f) return { resto: [] };
      if (t.startsWith(f + " ")) return { resto: t.slice(f.length + 1).split(" ") };
    }
    return null;
  };
  const avaliar = (m: { resto: string[] } | null, acao: "confirmar" | "cancelar", repetiveis: Set<string>): RespostaInterpretada | null => {
    if (!m) return null;
    const numeros: number[] = [];
    let todas = false;
    // Mais de um número numa mensagem só: "Manda 1 manda 2" não era entendido
    // (o segundo "manda" derrubava a leitura), caía no modelo, e ele, que não
    // pode aprovar, só repetia a lista (05/10/2026).
    for (const w of m.resto.join(" ").replace(/,/g, " ").split(" ").filter(Boolean)) {
      if (/^\d{1,2}$/.test(w)) {
        if (!numeros.includes(Number(w))) numeros.push(Number(w));
      } else if (TODAS.has(w)) todas = true;
      else if (!ENCHIMENTO.has(w) && !LIGACAO.has(w) && !repetiveis.has(w)) return null;
    }
    if (todas && !numeros.length) return { acao, todas: true };
    if (numeros.length > 1) return { acao, escolhas: numeros };
    return numeros.length ? { acao, escolha: numeros[0] } : { acao };
  };
  // cancelar é avaliado primeiro: "não manda" começa com "nao", não com "manda"
  return avaliar(casa(cancelar), "cancelar", daFrase(cancelar)) ?? avaliar(casa(confirmar), "confirmar", daFrase(confirmar)) ?? { acao: null };
}

export interface PropostaPendente {
  id: string;
  resumo: string;
  criadaEm: Date;
  expiraEm: Date | null;
}
export type Escolha =
  | { tipo: "uma"; id: string }
  | { tipo: "escolhidas"; ids: string[] }
  | { tipo: "varias"; lista: PropostaPendente[] }
  | { tipo: "nenhuma" }
  | { tipo: "fora_da_lista"; lista: PropostaPendente[] };

/**
 * Qual proposta a frase aprova. Vencida não conta: um "manda" solto horas
 * depois não pode disparar nada. Com mais de uma válida e sem número, a
 * resposta é a LISTA, nunca um palpite.
 */
export function escolherProposta(pendentes: readonly PropostaPendente[], agora: Date, escolha?: number, escolhas?: number[], todas?: boolean): Escolha {
  const validas = pendentes.filter((p) => !p.expiraEm || p.expiraEm.getTime() > agora.getTime()).sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime());
  if (!validas.length) return { tipo: "nenhuma" };
  if (todas) return { tipo: "escolhidas", ids: validas.map((p) => p.id) };
  if (escolhas?.length) {
    // um número fora da lista invalida o pedido inteiro: aprovar só parte do
    // que o dono disse seria pior do que mostrar a lista de novo
    if (escolhas.some((n) => !validas[n - 1])) return { tipo: "fora_da_lista", lista: validas };
    return { tipo: "escolhidas", ids: escolhas.map((n) => validas[n - 1]!.id) };
  }
  if (escolha !== undefined) {
    const p = validas[escolha - 1];
    return p ? { tipo: "uma", id: p.id } : { tipo: "fora_da_lista", lista: validas };
  }
  if (validas.length === 1) return { tipo: "uma", id: validas[0].id };
  return { tipo: "varias", lista: validas };
}

// ── resposta automática (W7) ──

export interface ContextoAutomatico {
  modo: "aprovar" | "automatico";
  grupo: boolean;
  pausadoAte: Date | null;
  agora: Date;
  /** respostas automáticas a este contato na última hora */
  respostasUltimaHora: number;
  /** trocas seguidas com cara de robô (ver `trocasRoboticas`) */
  trocasRoboticas: number;
}
export interface LimitesAutomatico {
  porHora: number;
  seguidas: number;
}
export type DecisaoAutomatica =
  | { responder: true }
  | { responder: false; motivo: "desligado" | "grupo" | "pausado" | "por_hora" | "laco"; pausar: boolean };

/**
 * Pode a Órbita responder sozinha a esta mensagem? Grupo NUNCA, mesmo com o
 * modo marcado por engano: numa conversa com várias pessoas, "quem é de
 * confiança" deixa de ser uma decisão sobre um contato.
 */
export function decidirAutomatico(c: ContextoAutomatico, l: LimitesAutomatico): DecisaoAutomatica {
  if (c.modo !== "automatico") return { responder: false, motivo: "desligado", pausar: false };
  if (c.grupo) return { responder: false, motivo: "grupo", pausar: false };
  if (c.pausadoAte && c.pausadoAte.getTime() > c.agora.getTime()) return { responder: false, motivo: "pausado", pausar: false };
  if (c.respostasUltimaHora >= l.porHora) return { responder: false, motivo: "por_hora", pausar: true };
  if (c.trocasRoboticas >= l.seguidas) return { responder: false, motivo: "laco", pausar: true };
  return { responder: true };
}

/**
 * Quantas trocas seguidas, do fim para trás, parecem ROBÔ: resposta automática
 * da Órbita seguida de mensagem do contato em menos de `janelaMs`.
 *
 * Contar só "respostas automáticas seguidas" pausaria uma conversa humana
 * comum depois de cinco trocas. O que distingue dois robôs conversando é a
 * VELOCIDADE: gente leva mais que alguns segundos para ler e digitar. A conta
 * para na primeira troca lenta e na primeira mensagem que o dono digitou.
 * Recebe a conversa em ordem cronológica.
 */
export function trocasRoboticas(conversa: readonly { deMim: boolean; automatica: boolean; enviadaPelaOrbita: boolean; em: Date }[], janelaMs: number): number {
  let n = 0;
  for (let i = conversa.length - 1; i >= 1; i--) {
    const m = conversa[i];
    if (m.deMim) {
      if (!m.enviadaPelaOrbita) break; // o dono falou à mão
      continue;
    }
    // mensagem do contato: a anterior foi resposta automática, rápida demais?
    const anterior = conversa[i - 1];
    if (!anterior.automatica || m.em.getTime() - anterior.em.getTime() > janelaMs) break;
    n++;
  }
  return n;
}
