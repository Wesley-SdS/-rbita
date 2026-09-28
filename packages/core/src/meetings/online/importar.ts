import type { Connection } from "@orbita/db/connector-schema";
import * as registro from "./registro";
import { tokensDeTodasAsContas, usersConnected } from "../../connectors/store";
import { rotuloDeExibicao } from "../../connectors/identidade";
import type { ConnectorId } from "../../connectors/registry";
import { enqueueJob } from "../../jobs/queue";
import { settings } from "../../settings";
import { log } from "../../observability/logger";
import { gravacoesDoMeet, gravacoesDoTeams, gravacoesDoZoom, type Gravacao } from "./fontes";

/**
 * Reunião online vira resumo sozinha (item 3 dos conectores, 27/09/2026).
 *
 * Antes, reunião só virava resumo se a Órbita GRAVASSE. Reunião do Meet, do
 * Teams ou do Zoom com transcrição ligada já tem o texto pronto no provedor:
 * o laço pergunta o que há de novo e manda para a MESMA fila de resumo da
 * reunião gravada (`reuniao.resumir`), então resumo, compromissos, tarefas e
 * o aviso no WhatsApp saem iguais, sem um segundo caminho para manter.
 *
 * Nasce DESLIGADO (as três chaves `meetings.importar*`): a transcrição tem a
 * fala de clientes e colegas, e ela vai para o modelo configurado e para a
 * base. Quem liga é o dono.
 */

export type FonteId = "meet" | "teams" | "zoom";

interface Fonte {
  id: FonteId;
  nome: string;
  conector: ConnectorId;
  ligada: "meetings.importarMeet" | "meetings.importarTeams" | "meetings.importarZoom";
  /** o escopo sem o qual a API recusa; conta sem ele pede reconexão, não erro */
  escopo?: string;
  listar: (token: string, desde: Date, agora: Date, reserva: (d: Date | null) => string, maxPaginas: number) => Promise<Gravacao[]>;
}

export const FONTES: Fonte[] = [
  {
    id: "meet",
    nome: "Meet",
    conector: "google",
    ligada: "meetings.importarMeet",
    escopo: "meetings.space.readonly",
    listar: (t, desde, _a, reserva, maxPaginas) => gravacoesDoMeet(t, desde, { maxPaginas, nomeReserva: reserva }),
  },
  {
    id: "teams",
    nome: "Teams",
    conector: "microsoft",
    ligada: "meetings.importarTeams",
    escopo: "OnlineMeetingTranscript.Read",
    listar: (t, desde, agora, reserva) => gravacoesDoTeams(t, desde, agora, { nomeReserva: reserva }),
  },
  { id: "zoom", nome: "Zoom", conector: "zoom", ligada: "meetings.importarZoom", listar: (t, desde, agora) => gravacoesDoZoom(t, desde, new Date(agora.getTime() + 86_400_000)) },
];

/** A conta tem o escopo? PURA. Sem escopo registrado (provedor que não devolve), confia e tenta. */
export function temEscopo(conexao: Pick<Connection, "scope">, escopo: string | undefined): boolean {
  if (!escopo || !conexao.scope) return true;
  return conexao.scope.toLowerCase().includes(escopo.toLowerCase());
}

export interface Registro {
  externalId: string;
  situacao: string;
  proximaTentativa: Date | null;
}

/**
 * O que ainda deve ser tentado, do mais antigo ao mais novo. PURA. Fica de
 * fora o que já foi para a fila, o curto, o que desistiu e o que falhou e
 * ainda está esperando a vez de tentar de novo.
 */
export function aTentar(gravacoes: readonly Gravacao[], registros: readonly Registro[], agora: Date): Gravacao[] {
  const bloqueadas = new Set(registros.filter((r) => r.situacao !== "falhou" || (r.proximaTentativa && r.proximaTentativa > agora)).map((r) => r.externalId));
  const vistas = new Set<string>();
  return gravacoes
    .filter((g) => !bloqueadas.has(g.externalId) && !vistas.has(g.externalId) && vistas.add(g.externalId))
    .sort((a, b) => (a.inicio?.getTime() ?? 0) - (b.inicio?.getTime() ?? 0));
}

/** Espera antes da próxima tentativa: 15 min, 30, 1 h, 2 h… PURA. */
export const esperaDaTentativa = (tentativas: number) => 15 * 60_000 * 2 ** Math.max(0, tentativas - 1);

export interface ResultadoDaImportacao {
  /** títulos que foram para o resumo */
  importadas: string[];
  /** transcrição com pouco texto: registrada, sem resumo */
  curtas: string[];
  /** contas que precisam ser reconectadas (ou ter a permissão ligada) */
  semPermissao: string[];
  /** contas ou transcrições que falharam nesta volta (voltam depois, até o teto) */
  falhas: string[];
  /** quantas fontes o dono ligou (zero: nada foi nem olhado) */
  fontesLigadas: number;
}

function nomeReserva(fonte: string, fuso: string) {
  return (d: Date | null) => {
    if (!d) return `Reunião do ${fonte}`;
    try {
      return `Reunião do ${fonte} de ${d.toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    } catch {
      return `Reunião do ${fonte} de ${d.toISOString().slice(0, 16).replace("T", " ")}`;
    }
  };
}

/** Uma volta para UM dono: todas as fontes ligadas, todas as contas de cada uma. */
export async function importarReunioesOnline(userId: string, agora = new Date()): Promise<ResultadoDaImportacao> {
  const cfg = await settings.getMany([
    "meetings.importarMeet",
    "meetings.importarTeams",
    "meetings.importarZoom",
    "meetings.importarDias",
    "meetings.importarMaxPorVolta",
    "meetings.importarMinCaracteres",
    "meetings.importarMaxPaginas",
    "meetings.importarTentativas",
    "connectors.fusoHorario",
  ]);
  const ligadas = FONTES.filter((f) => cfg[f.ligada]);
  const r: ResultadoDaImportacao = { importadas: [], curtas: [], semPermissao: [], falhas: [], fontesLigadas: ligadas.length };
  if (!ligadas.length) return r;
  await registro.reconciliar(userId, cfg["meetings.importarTentativas"], agora, esperaDaTentativa).catch((e) => log.warn("reunioes_online.reconciliar_falhou", { erro: String(e).slice(0, 200) }));

  const desde = new Date(agora.getTime() - cfg["meetings.importarDias"] * 86_400_000);
  // a vaga só é gasta com SUCESSO: três transcrições que sempre falham não
  // podem ocupar todas as vagas de todas as voltas
  let restantes = cfg["meetings.importarMaxPorVolta"];

  for (const f of ligadas) {
    if (restantes <= 0) break;
    const contas = await tokensDeTodasAsContas(f.conector, userId).catch(() => []);
    for (const [i, { conexao, token }] of contas.entries()) {
      if (restantes <= 0) break;
      const rotulo = `${f.nome} (${rotuloDeExibicao(conexao.accountLabel, i + 1)})`;
      if (!temEscopo(conexao, f.escopo)) {
        r.semPermissao.push(rotulo);
        continue;
      }
      let lista: Gravacao[];
      try {
        lista = await f.listar(token, desde, agora, nomeReserva(f.nome, cfg["connectors.fusoHorario"]), cfg["meetings.importarMaxPaginas"]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 403 é quase sempre permissão (escopo sem consentimento do admin, API
        // desligada no projeto): o dono precisa agir, não adianta tentar de novo
        if (/\b(401|403)\b/.test(msg)) r.semPermissao.push(rotulo);
        else r.falhas.push(rotulo);
        log.warn("reunioes_online.listar_falhou", { fonte: f.id, erro: msg.slice(0, 300) });
        continue;
      }
      if (!lista.length) continue;
      const registros = await registro.registrosDaFonte(userId, f.id, lista.map((g) => g.externalId));

      for (const g of aTentar(lista, registros, agora)) {
        if (restantes <= 0) break;
        const deu = await importarUma(userId, f, g, cfg["meetings.importarMinCaracteres"], cfg["meetings.importarTentativas"], agora, r);
        if (deu) restantes--;
        else r.falhas.push(rotulo);
      }
    }
  }
  if (r.importadas.length || r.curtas.length) log.info("reunioes_online.importadas", { userId, importadas: r.importadas.length, curtas: r.curtas.length });
  return r;
}

/** true = foi para o resumo (ou era curta); false = falhou e ficou registrada para tentar depois. */
async function importarUma(userId: string, f: Fonte, g: Gravacao, minimo: number, maxTentativas: number, agora: Date, r: ResultadoDaImportacao): Promise<boolean> {
  let texto: string;
  let titulo: string;
  try {
    [texto, titulo] = await Promise.all([g.baixar(), g.titulo()]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("reunioes_online.baixar_falhou", { fonte: f.id, erro: msg.slice(0, 300) });
    await registro.registrarFalha(userId, f.id, g, `Reunião do ${f.nome}`, msg, maxTentativas, agora).catch(() => undefined);
    return false;
  }
  const tituloFinal = `${titulo} (${f.nome})`.slice(0, 200);
  const curta = texto.trim().length < minimo;
  // Registra ANTES de enfileirar: a linha é a trava. Nova, ou uma que falhou e
  // chegou a vez; se outro processo (o `tsx watch` reiniciando) pegou primeiro,
  // não devolve linha e não é nosso.
  const linha = await registro.travar(userId, f.id, g, tituloFinal, curta);
  if (!linha) return true;
  if (curta) {
    r.curtas.push(tituloFinal);
    return true;
  }
  try {
    const { job: j } = await enqueueJob(userId, {
      kind: "reuniao.resumir",
      input: texto,
      payload: { title: tituloFinal },
      dedupKey: `online:${userId}:${f.id}:${g.externalId}`,
    });
    await registro.anotarTrabalho(linha, j.id);
    r.importadas.push(tituloFinal);
    return true;
  } catch (e) {
    // sem fila, vira falha com espera: a próxima volta tenta de novo
    await registro.registrarFalha(userId, f.id, g, tituloFinal, e instanceof Error ? e.message : String(e), maxTentativas, agora).catch(() => undefined);
    return false;
  }
}

/** Quem já foi avisado de que falta permissão (por conta), para o aviso sair uma vez só. */
const avisados = new Set<string>();

/** A volta do laço: todo dono com Google, Microsoft ou Zoom conectado. */
export async function importarDeTodos(agora = new Date()): Promise<number> {
  const donos = new Set<string>();
  for (const c of new Set(FONTES.map((f) => f.conector))) for (const u of await usersConnected(c).catch(() => [])) donos.add(u);
  let total = 0;
  for (const u of donos) {
    try {
      const r = await importarReunioesOnline(u, agora);
      total += r.importadas.length;
      // sem permissão, a tool diria na hora; o laço roda sozinho, então avisa (uma vez)
      const novos = r.semPermissao.filter((c) => !avisados.has(`${u}:${c}`));
      if (novos.length) {
        novos.forEach((c) => avisados.add(`${u}:${c}`));
        const { notifyUser } = await import("../../routines/run");
        await notifyUser(
          u,
          "Reuniões online sem permissão",
          `Não consigo ler as transcrições de: ${novos.join(", ")}. Reconecte a conta em Conectores (no Meet, ligue também a Google Meet REST API no projeto do Google Cloud; no Teams, o administrador precisa aprovar a permissão de transcrição).`,
          null,
          { destino: "/app/conexoes" },
        ).catch(() => undefined);
      }
    } catch (e) {
      log.warn("reunioes_online.volta_falhou", { userId: u, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  return total;
}
