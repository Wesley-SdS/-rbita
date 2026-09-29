import { lerDeTodasAsContas } from "../connectors/multi";
import { listarEventosEntre as doGoogle, type EventoDaAgenda } from "../connectors/google";
import { listarEventosEntre as doOutlook } from "../connectors/microsoft";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * A agenda na TELA: Visão geral ("A seguir · Hoje") e Reuniões ("Próximas").
 *
 * Até aqui a agenda só existia para o modelo (tools) e para o aviso de
 * reunião; o bloco "A seguir" da Visão geral era texto fixo do protótipo.
 * Junta TODAS as contas do Google e da Microsoft (leitura varre todas, CLAUDE.md
 * §9), com a conta de cada evento, porque "a reunião do trabalho" está na
 * conta do trabalho.
 */

export interface EventoNaTela extends EventoDaAgenda {
  provedor: "google" | "microsoft";
  /** rótulo da conta (e-mail); com o mesmo evento em duas agendas, as duas */
  contas: string[];
}

const LINK_DE_CHAMADA = /https:\/\/(?:[\w-]+\.)?(?:zoom\.us\/j|teams\.microsoft\.com\/l\/meetup-join|teams\.live\.com\/meet|meet\.google\.com)\/[^\s<>"')]+/i;

/** Link de chamada colado no local do evento (Zoom e Teams costumam vir assim). PURA. */
export function linkDeChamada(texto?: string): string | undefined {
  return texto ? LINK_DE_CHAMADA.exec(texto)?.[0] : undefined;
}

/**
 * Ordena por início e junta o MESMO compromisso visto em duas agendas (convite
 * aceito na pessoal e na do trabalho): mesmo título e mesmo instante viram uma
 * linha com as duas contas. PURA.
 */
export function juntarEventos(eventos: EventoNaTela[]): EventoNaTela[] {
  const instante = (e: EventoNaTela) => (e.diaInteiro ? Date.parse(`${e.inicio}T00:00:00`) : Date.parse(e.inicio));
  const ordenados = [...eventos].filter((e) => !Number.isNaN(instante(e))).sort((a, b) => instante(a) - instante(b));
  const porChave = new Map<string, EventoNaTela>();
  const saida: EventoNaTela[] = [];
  for (const e of ordenados) {
    const chave = `${e.titulo.trim().toLowerCase()}|${instante(e)}`;
    const ja = porChave.get(chave);
    if (ja) {
      for (const c of e.contas) if (!ja.contas.includes(c)) ja.contas.push(c);
      ja.entrar ??= e.entrar;
      continue;
    }
    const novo = { ...e, contas: [...e.contas], entrar: e.entrar ?? linkDeChamada(e.local) };
    porChave.set(chave, novo);
    saida.push(novo);
  }
  return saida;
}

const cache = new Map<string, { em: number; valor: Agenda }>();

/** Só para testes. */
export function esquecerAgendaDaTela(): void {
  cache.clear();
}

export interface Agenda {
  eventos: EventoNaTela[];
  /** contas que falharam ao ler (a tela diz "faltou a agenda de X") */
  falhas: string[];
  /** quantas agendas estão ligadas: zero é "conecte", não "dia livre" */
  conectadas: number;
}

export async function proximosEventos(userId: string, agora = new Date()): Promise<Agenda> {
  const cfg = await settings.getMany(["meetings.agendaDias", "meetings.agendaCacheSegundos"]);
  const chave = `${userId}|${cfg["meetings.agendaDias"]}`;
  const guardado = cache.get(chave);
  // a tela pede a cada navegação: sem isto, cada volta à Visão geral custava
  // uma ida ao Google e outra à Microsoft
  if (guardado && agora.getTime() - guardado.em < cfg["meetings.agendaCacheSegundos"] * 1000) return guardado.valor;

  // desde o começo de hoje: o que já começou (e o dia inteiro) ainda é "hoje"
  const de = new Date(agora);
  de.setHours(0, 0, 0, 0);
  const ate = new Date(agora.getTime() + cfg["meetings.agendaDias"] * 24 * 3600 * 1000);
  const [g, m] = await Promise.all([
    lerDeTodasAsContas("google", userId, (t) => doGoogle(t, de, ate)),
    lerDeTodasAsContas("microsoft", userId, (t) => doOutlook(t, de, ate)),
  ]);
  const eventos = juntarEventos([
    ...g.itens.map(({ conta, ...e }) => ({ ...e, provedor: "google" as const, contas: [conta] })),
    ...m.itens.map(({ conta, ...e }) => ({ ...e, provedor: "microsoft" as const, contas: [conta] })),
  ]).filter((e) => (e.diaInteiro ? e.fim > agora.toISOString().slice(0, 10) : Date.parse(e.fim || e.inicio) > agora.getTime()));
  const falhas = [...g.falhas, ...m.falhas];
  if (falhas.length) log.warn("agenda.conta_falhou", { userId, contas: falhas.length });
  const valor = { eventos, falhas, conectadas: g.contas + m.contas };
  cache.set(chave, { em: agora.getTime(), valor });
  return valor;
}
