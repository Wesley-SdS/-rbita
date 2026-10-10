import { instanteLocal, paraHoraLocal } from "../fuso";

/**
 * O que está COM o dono nos sistemas da Adalink, e o que está atrasado na
 * central de chamados. Puro: recebe o JSON que os servidores MCP devolvem
 * (gestão: `get_my_day`; tickets: `tickets_list`) e decide.
 *
 * Pedido do dono (08/10/2026): "às vezes colocam coisas para mim que não vejo".
 * Por isso a tela mostra tudo que está com ele, com prazo, e dois alertas da
 * equipe inteira: chamado atrasado sem tratativa e chamado com um
 * desenvolvedor, mas atrasado. E o PRAZO de cada coisa vem dito em gente
 * ("faltam 2 dias", "vence hoje às 18:00"), calculado aqui uma vez para a
 * tela, o chat e a voz dizerem o mesmo.
 */

// ── prazo ───────────────────────────────────────────────────────────────────

export type EstadoDoPrazo = "atrasado" | "perto" | "no_prazo" | "pausado" | "sem_prazo";

export interface Prazo {
  estado: EstadoDoPrazo;
  /** o instante do prazo (ISO) ou o dia ("AAAA-MM-DD") */
  quando: string | null;
  /** "faltam 2 dias, até sex 10/10 15:29", "vence hoje às 18:00", "venceu há 3 dias, em 17/09" */
  texto: string;
  /** quanto falta em ms (negativo: venceu); nulo sem prazo ou pausado. É por ele que se ordena. */
  restanteMs: number | null;
}

export interface RegraDoPrazo {
  fuso: string;
  /** "perto de vencer" é o último trecho do prazo: o mesmo "último quarto" que a central usa no SLA */
  percentualPerto: number;
  /** sem início conhecido, "perto" é faltar menos que isto */
  horasPerto: number;
}
export const REGRA_PADRAO: RegraDoPrazo = { fuso: "America/Sao_Paulo", percentualPerto: 25, horasPerto: 24 };

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const soDia = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const diaLocal = (d: Date, fuso: string) => paraHoraLocal(d, fuso).slice(0, 10);
const horaLocal = (d: Date, fuso: string) => paraHoraLocal(d, fuso).slice(11, 16);
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const diaDaSemana = (d: string) => DIAS_DA_SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]!;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** O instante em que o prazo vence: dia sem hora vale até o fim daquele dia, no fuso da casa. */
function vencimento(quando: string, fuso: string): Date | null {
  const d = soDia(quando) ? instanteLocal(`${quando}T23:59`, fuso) : new Date(quando);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/**
 * A situação de um prazo, em gente. `inicio` (abertura do chamado, início da
 * atividade) é o que permite dizer "perto de vencer" do mesmo jeito que a
 * central diz do SLA: no último quarto do tempo que havia.
 */
export function situacaoDoPrazo(quando: string | null | undefined, agora: Date, regra: RegraDoPrazo = REGRA_PADRAO, opts: { inicio?: string | null; pausado?: boolean } = {}): Prazo {
  const v = quando ? vencimento(quando, regra.fuso) : null;
  if (opts.pausado) {
    return { estado: "pausado", quando: quando ?? null, texto: "prazo pausado enquanto aguarda", restanteMs: null };
  }
  if (!v || !quando) return { estado: "sem_prazo", quando: null, texto: "sem prazo definido", restanteMs: null };

  const restanteMs = v.getTime() - agora.getTime();
  const hoje = diaLocal(agora, regra.fuso);
  const dia = soDia(quando) ? quando : diaLocal(v, regra.fuso);
  const comHora = soDia(quando) ? "" : ` às ${horaLocal(v, regra.fuso)}`;
  const dias = diasEntre(hoje, dia);

  if (restanteMs < 0) {
    const passados = -dias;
    const ms = -restanteMs;
    const texto =
      passados >= 2 ? `venceu há ${plural(passados, "dia", "dias")}, em ${ddmm(dia)}`
      : passados === 1 ? `venceu ontem${comHora}`
      : ms >= 3_600_000 ? `venceu há ${plural(Math.floor(ms / 3_600_000), "hora", "horas")}`
      : `venceu há ${plural(Math.max(1, Math.floor(ms / 60_000)), "minuto", "minutos")}`;
    return { estado: "atrasado", quando, texto, restanteMs };
  }

  let texto: string;
  if (dias === 0) {
    const falta = restanteMs >= 3_600_000 ? plural(Math.floor(restanteMs / 3_600_000), "hora", "horas") : plural(Math.max(1, Math.floor(restanteMs / 60_000)), "minuto", "minutos");
    texto = soDia(quando) ? "vence hoje" : `vence hoje${comHora} (faltam ${falta})`;
  } else if (dias === 1) {
    texto = `vence amanhã${comHora}`;
  } else {
    texto = `faltam ${dias} dias, até ${dias < 7 ? `${diaDaSemana(dia)} ` : ""}${ddmm(dia)}${comHora}`;
  }
  // a atividade começa no INÍCIO do dia de início (o fim vale até o fim do dia)
  const inicio = opts.inicio ? (soDia(opts.inicio) ? instanteLocal(`${opts.inicio}T00:00`, regra.fuso) : new Date(opts.inicio)) : null;
  const total = inicio && !Number.isNaN(inicio.getTime()) ? v.getTime() - inicio.getTime() : 0;
  const perto = total > 0 ? restanteMs <= (total * regra.percentualPerto) / 100 : restanteMs <= regra.horasPerto * 3_600_000;
  return { estado: perto ? "perto" : "no_prazo", quando, texto, restanteMs };
}

/** Do mais urgente para o menos: atrasado e mais perto primeiro, sem prazo por último. */
export const porUrgencia = (a: { prazoOrdem: Prazo }, b: { prazoOrdem: Prazo }) => (a.prazoOrdem.restanteMs ?? Infinity) - (b.prazoOrdem.restanteMs ?? Infinity);

// ── tickets ─────────────────────────────────────────────────────────────────

interface Nome {
  name?: string;
}
export interface ChamadoBruto {
  id?: string;
  code?: string;
  title?: string;
  status?: string;
  priority?: string;
  assignee?: Nome | null;
  organization?: Nome | null;
  createdBy?: Nome | null;
  createdAt?: string | null;
  sla?: { deadline?: string | null; paused?: boolean; firstResponseDeadline?: string | null; firstResponseAt?: string | null } | null;
}

export type MotivoDoAtraso = "prazo" | "primeira_resposta";

export interface Chamado {
  id: string;
  codigo: string;
  titulo: string;
  /** "aberto", "em andamento", "aguardando" */
  status: string;
  prioridade: string | null;
  responsavel: string | null;
  organizacao: string | null;
  /** quem abriu */
  solicitante: string | null;
  abertoEm: string | null;
  /** prazo de solução (SLA), cru */
  prazo: string | null;
  /** o prazo que venceu, quando venceu algum */
  vencidoEm: string | null;
  motivo: MotivoDoAtraso | null;
  /** o prazo de solução do SLA, dito em gente */
  prazoSolucao: Prazo;
  /** o prazo da primeira resposta, só enquanto ninguém respondeu */
  primeiraResposta: Prazo | null;
  /** o prazo que manda na ordem e na cor: o que vence primeiro entre os dois */
  prazoOrdem: Prazo;
}

const STATUS: Record<string, string> = { open: "aberto", in_progress: "em andamento", waiting: "aguardando", resolved: "resolvido", closed: "fechado" };
const PRIORIDADE: Record<string, string> = { low: "baixa", medium: "média", high: "alta", critical: "crítica" };

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * O responsável é o dono? Por parte do nome, nos dois sentidos: na central o
 * dono aparece como "Wesley" e na conta como "Wesley Santos" (medido em
 * 08/10/2026; filtrar por "Wesley Santos" devolvia zero chamados).
 */
export function ehMeuNome(responsavel: string | null | undefined, meuNome: string): boolean {
  const a = normalizar(responsavel ?? "");
  const b = normalizar(meuNome);
  if (a.length < 3 || b.length < 3) return false;
  const primeiro = (s: string) => s.split(/\s+/)[0]!;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `) || (primeiro(a) === primeiro(b) && (a === primeiro(a) || b === primeiro(b)));
}

function paraChamado(b: ChamadoBruto, agora: Date, regra: RegraDoPrazo): Chamado {
  const sla = b.sla ?? {};
  // "Aguardando" pausa o SLA: o prazo parado não é atraso de ninguém
  const prazoSolucao = situacaoDoPrazo(sla.deadline, agora, regra, { inicio: b.createdAt, pausado: sla.paused });
  // primeira resposta só importa enquanto ninguém pegou: a central não carimba
  // `firstResponseAt` (nenhum dos 51 chamados tinha, 08/10/2026), e "em andamento"
  // aparecia com "1ª resposta venceu há 17 dias" em vermelho sem ser verdade
  const primeiraResposta = b.status !== "open" || sla.firstResponseAt || !sla.firstResponseDeadline ? null : situacaoDoPrazo(sla.firstResponseDeadline, agora, regra, { inicio: b.createdAt, pausado: sla.paused });
  const motivo: MotivoDoAtraso | null = prazoSolucao.estado === "atrasado" ? "prazo" : primeiraResposta?.estado === "atrasado" ? "primeira_resposta" : null;
  const prazoOrdem = primeiraResposta && (primeiraResposta.restanteMs ?? Infinity) < (prazoSolucao.restanteMs ?? Infinity) ? primeiraResposta : prazoSolucao;
  return {
    id: b.id ?? b.code ?? "",
    codigo: b.code ?? "",
    titulo: (b.title ?? "").trim() || "(sem título)",
    status: STATUS[b.status ?? ""] ?? b.status ?? "?",
    prioridade: b.priority ? PRIORIDADE[b.priority] ?? b.priority : null,
    responsavel: b.assignee?.name?.trim() || null,
    organizacao: b.organization?.name?.trim() || null,
    solicitante: b.createdBy?.name?.trim() || null,
    abertoEm: b.createdAt ?? null,
    prazo: sla.deadline ?? null,
    vencidoEm: motivo === "prazo" ? sla.deadline ?? null : motivo === "primeira_resposta" ? sla.firstResponseDeadline ?? null : null,
    motivo,
    prazoSolucao,
    primeiraResposta,
    prazoOrdem,
  };
}

export interface ChamadosClassificados {
  /** atribuídos ao dono e ainda não resolvidos */
  comigo: Chamado[];
  /**
   * Atrasado e ninguém começou: aberto com o prazo de solução vencido ou sem
   * primeira resposta depois do prazo dela (decisão do dono: "qualquer um dos
   * dois"), e também o que está "em andamento" SEM responsável, porque ninguém
   * é dono dele.
   */
  semTratativa: Chamado[];
  /** com um desenvolvedor, em andamento, e o prazo de solução já venceu */
  comDevAtrasados: Chamado[];
  /** todos os não resolvidos, de qualquer pessoa: é daqui que sai o aviso de chamado novo */
  todos: Chamado[];
}

export function classificarChamados(brutos: ChamadoBruto[], meuNome: string, agora = new Date(), regra: RegraDoPrazo = REGRA_PADRAO): ChamadosClassificados {
  const vistos = new Set<string>();
  const chamados = brutos
    .filter((b) => b.status !== "resolved" && b.status !== "closed")
    .map((b) => paraChamado(b, agora, regra))
    .filter((c) => (vistos.has(c.id) ? false : (vistos.add(c.id), true)));
  const comigo = chamados.filter((c) => ehMeuNome(c.responsavel, meuNome));
  const semTratativa = chamados.filter((c) => c.motivo && (c.status === "aberto" || (c.status === "em andamento" && !c.responsavel)));
  const comDevAtrasados = chamados.filter((c) => c.motivo === "prazo" && c.status === "em andamento" && c.responsavel);
  return { comigo: comigo.sort(porUrgencia), semTratativa: semTratativa.sort(porUrgencia), comDevAtrasados: comDevAtrasados.sort(porUrgencia), todos: chamados };
}

// ── gestão ──────────────────────────────────────────────────────────────────

export interface Atividade {
  id: string;
  titulo: string;
  projeto: string | null;
  empresa: string | null;
  /** a coluna do kanban do dono: "Em andamento", "Backlog", "Sugeridas para hoje" */
  coluna: string;
  /** "AAAA-MM-DD" */
  inicio: string | null;
  fim: string | null;
  atrasada: boolean;
  critica: boolean;
  /** quem mais está na atividade */
  com: string[];
  /** o prazo para finalizar, dito em gente (o fim da atividade vale até o fim do dia) */
  prazo: Prazo;
  prazoOrdem: Prazo;
}

const COLUNAS: Record<string, string> = { doing: "Em andamento", backlog: "Backlog", suggestedToday: "Sugeridas para hoje", todo: "A fazer" };

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * As atividades com o dono, do "meu dia" da gestão: toda lista de atividades
 * do retorno é uma coluna do kanban dele, menos as já feitas (`done*`). A
 * mesma atividade em duas colunas aparece uma vez só.
 */
export function atividadesComigo(meuDia: unknown, agora = new Date(), regra: RegraDoPrazo = REGRA_PADRAO): Atividade[] {
  if (!ehObj(meuDia)) return [];
  const vistas = new Set<string>();
  const saida: Atividade[] = [];
  for (const [coluna, lista] of Object.entries(meuDia)) {
    if (!Array.isArray(lista) || /^done/i.test(coluna)) continue;
    for (const a of lista) {
      if (!ehObj(a)) continue;
      const id = texto(a.id);
      const titulo = texto(a.name) || texto(a.title);
      if (!id || !titulo || vistas.has(id)) continue;
      vistas.add(id);
      const inicio = texto(a.startDate) || null;
      const fim = texto(a.endDate) || null;
      const prazo = situacaoDoPrazo(fim, agora, regra, { inicio });
      const responsaveis = Array.isArray(a.responsibles) ? a.responsibles.filter(ehObj) : [];
      saida.push({
        id,
        titulo,
        projeto: texto(a.projectName) || null,
        empresa: texto(a.companyName) || null,
        coluna: COLUNAS[coluna] ?? coluna,
        inicio,
        fim,
        atrasada: a.overdue === true || prazo.estado === "atrasado",
        critica: a.isCritical === true,
        com: responsaveis.filter((r) => r.isMe !== true).map((r) => texto(r.name)).filter(Boolean),
        prazo,
        prazoOrdem: prazo,
      });
    }
  }
  return saida.sort(porUrgencia);
}

// ── o aviso ─────────────────────────────────────────────────────────────────

export interface Comigo {
  atividades: Atividade[];
  chamados: ChamadosClassificados;
}

export type NivelDoAviso = "atrasado" | "perto" | "novo";

export interface Ocorrencia {
  /** estável: é por ela que o mesmo fato não é avisado duas vezes ("tipo:id[:detalhe]") */
  chave: string;
  frase: string;
  nivel: NivelDoAviso;
  /** atraso e reta final avisam já na primeira volta */
  urgente: boolean;
}

/** "2026-09-17" ou instante ISO → "17/09" no fuso da casa. */
function dia(valor: string, fuso: string): string {
  return ddmm(soDia(valor) ? valor : diaLocal(new Date(valor), fuso));
}

const ocorrencia = (chave: string, frase: string, nivel: NivelDoAviso): Ocorrencia => ({ chave, frase, nivel, urgente: nivel !== "novo" });

/**
 * Cada fato que merece aviso, com a chave dele. Atividade e chamado NOVOS com
 * o dono avisam na chegada, com o prazo; o que é dele e entra na reta final
 * avisa uma vez (a chave leva o prazo: se mudarem o prazo, avisa de novo); o
 * atraso avisa quando começa (a chave leva o motivo, então passar de "sem
 * primeira resposta" para "prazo vencido" avisa de novo).
 */
export function ocorrencias(c: Comigo, fuso: string, opts: { meuNome?: string; novoDesde?: Date | null } = {}): Ocorrencia[] {
  const saida: Ocorrencia[] = [];
  // chamado NOVO na central, de qualquer pessoa (pedido do dono, 08/10/2026).
  // Só o aberto há pouco: um chamado antigo que reaparece (reaberto, ou lido
  // pela primeira vez) não é "novo"
  if (opts.novoDesde) {
    for (const t of c.chamados.todos ?? []) {
      if (!t.abertoEm || new Date(t.abertoEm).getTime() < opts.novoDesde.getTime()) continue;
      const quem = t.responsavel ? (opts.meuNome && ehMeuNome(t.responsavel, opts.meuNome) ? "com você" : `com ${t.responsavel}`) : "sem responsável";
      const detalhes = [t.organizacao, t.solicitante ? `aberto por ${t.solicitante}` : null, t.prioridade ? `prioridade ${t.prioridade}` : null, quem, `prazo do SLA: ${t.prazoSolucao.texto}`].filter(Boolean).join(", ");
      saida.push(ocorrencia(`aberto:${t.id}`, `Chamado novo: ${t.codigo} ${t.titulo} (${detalhes}).`, "novo"));
    }
  }
  for (const a of c.atividades) {
    const onde = [a.projeto, a.empresa].filter(Boolean).join(", ");
    const nome = `${a.titulo}${onde ? ` (${onde})` : ""}`;
    saida.push(ocorrencia(`atividade:${a.id}`, `Atividade com você: ${nome}, ${a.prazo.texto}.`, a.atrasada ? "atrasado" : "novo"));
    if (a.prazo.estado === "perto") saida.push(ocorrencia(`perto:${a.id}:${a.prazo.quando}`, `Reta final: ${nome}, ${a.prazo.texto}.`, "perto"));
  }
  for (const t of c.chamados.comigo) {
    const nome = `${t.codigo} ${t.titulo}${t.organizacao ? ` (${t.organizacao})` : ""}`;
    saida.push(ocorrencia(`chamado:${t.id}`, `Chamado com você: ${nome}, prazo do SLA: ${t.prazoSolucao.texto}.`, t.motivo ? "atrasado" : "novo"));
    if (t.prazoOrdem.estado === "perto") {
      const qual = t.prazoOrdem === t.primeiraResposta ? "primeira resposta" : "solução";
      saida.push(ocorrencia(`perto:${t.id}:${t.prazoOrdem.quando}`, `Reta final: ${nome}, prazo de ${qual}: ${t.prazoOrdem.texto}.`, "perto"));
    }
  }
  for (const t of c.chamados.semTratativa) {
    const porque = t.motivo === "prazo" ? `prazo venceu em ${dia(t.vencidoEm!, fuso)}` : `sem primeira resposta desde ${dia(t.vencidoEm!, fuso)}`;
    saida.push(ocorrencia(`sem-tratativa:${t.id}:${t.motivo}`, `${t.codigo} ${t.status} e sem tratativa, ${porque}: ${t.titulo}${t.responsavel ? ` (com ${t.responsavel})` : ", sem responsável"}.`, "atrasado"));
  }
  for (const t of c.chamados.comDevAtrasados) {
    saida.push(ocorrencia(`dev-atrasado:${t.id}`, `${t.codigo} com ${t.responsavel} está atrasado, prazo venceu em ${dia(t.vencidoEm!, fuso)}: ${t.titulo}.`, "atrasado"));
  }
  return saida;
}

export const tipoDaOcorrencia = (o: Ocorrencia) => o.chave.split(":")[0]!;
const idDaOcorrencia = (o: Ocorrencia) => o.chave.split(":")[1] ?? o.chave;

/**
 * O que vira aviso nesta volta: só o fato que acabou de entrar (`recemGravadas`).
 * Na primeira vez de um tipo, só guarda, sem avisar (ligar isto não pode virar
 * um aviso com tudo que já existia), menos o que já está ATRASADO ou na reta
 * final, que é justamente o que o dono não pode deixar passar.
 */
export function quaisAvisar(todas: Ocorrencia[], recemGravadas: Set<string>, tiposJaVistos: Set<string>): Ocorrencia[] {
  return todas.filter((o) => recemGravadas.has(o.chave) && (o.urgente || tiposJaVistos.has(tipoDaOcorrencia(o))));
}

const MAX_LINHAS = 8;
const PESO: Record<NivelDoAviso, number> = { atrasado: 2, perto: 1, novo: 0 };

export function textoDoAvisoComigo(todasAsNovas: Ocorrencia[]): { titulo: string; corpo: string } {
  // a mesma coisa vira UMA linha, a que diz mais: atraso antes de reta final, reta final antes de "chegou"
  // no empate, a linha do alerta ("sem tratativa", "reta final") vence a genérica "com você"
  const generica = (o: Ocorrencia) => (tipoDaOcorrencia(o) === "chamado" || tipoDaOcorrencia(o) === "atividade" ? 0 : 1);
  const melhor = new Map<string, Ocorrencia>();
  for (const o of todasAsNovas) {
    const atual = melhor.get(idDaOcorrencia(o));
    if (!atual || PESO[o.nivel] > PESO[atual.nivel] || (PESO[o.nivel] === PESO[atual.nivel] && generica(o) > generica(atual))) melhor.set(idDaOcorrencia(o), o);
  }
  const novas = todasAsNovas.filter((o) => melhor.get(idDaOcorrencia(o)) === o);
  const ordenadas = [...novas].sort((a, b) => PESO[b.nivel] - PESO[a.nivel]);
  const linhas = ordenadas.map((o) => o.frase);
  const corpo = linhas.slice(0, MAX_LINHAS).join("\n") + (linhas.length > MAX_LINHAS ? `\nE mais ${linhas.length - MAX_LINHAS} na tela inicial.` : "");
  const atrasadas = novas.filter((o) => o.nivel === "atrasado").length;
  const pertos = novas.filter((o) => o.nivel === "perto").length;
  const abertos = novas.filter((o) => tipoDaOcorrencia(o) === "aberto").length;
  const titulo = atrasadas
    ? atrasadas === 1 ? "Uma coisa atrasada na Adalink" : `${atrasadas} coisas atrasadas na Adalink`
    : pertos
      ? pertos === 1 ? "Uma coisa vence em breve" : `${pertos} coisas vencem em breve`
      : abertos === novas.length
        ? abertos === 1 ? "Chamado novo na central" : `${abertos} chamados novos na central`
        : abertos
          ? `${novas.length} novidades na Adalink`
          : novas.length === 1 ? "Colocaram algo com você" : `${novas.length} coisas novas com você`;
  // título de chamado e de atividade vêm de fora com travessão; no aviso, vírgula (§6)
  return { titulo, corpo: corpo.replace(/\s*[—–]\s*/g, ", ") };
}

// ── o comentário de "recebi" ───────────────────────────────────────────────

/**
 * Preenche o modelo do comentário, que o DONO escreve em Ajustes: só troca as
 * marcações conhecidas, nada vem do modelo de linguagem. `{saudacao}` vira
 * "Olá, Lucas!" ou "Olá!" quando não se sabe quem abriu.
 */
export function textoDoComentario(modelo: string, c: Pick<Chamado, "codigo" | "titulo" | "solicitante" | "prazoSolucao">): string {
  const primeiroNome = c.solicitante?.split(/\s+/)[0] ?? "";
  const valores: Record<string, string> = {
    saudacao: primeiroNome ? `Olá, ${primeiroNome}!` : "Olá!",
    solicitante: primeiroNome,
    codigo: c.codigo,
    titulo: c.titulo,
    prazo: c.prazoSolucao.texto,
  };
  return modelo.replace(/\{(saudacao|solicitante|codigo|titulo|prazo)\}/g, (_m, k: string) => valores[k] ?? "").replace(/\s{2,}/g, " ").trim();
}

/**
 * Quando comentar: o chamado acabou de chegar para o dono (não estava com ele
 * na volta anterior), não foi ele mesmo quem abriu (comentar para si mesmo é
 * ruído) e não está resolvido.
 */
export function deveComentar(c: Pick<Chamado, "solicitante" | "status">, meuNome: string): boolean {
  return !ehMeuNome(c.solicitante, meuNome) && c.status !== "resolvido" && c.status !== "fechado";
}
