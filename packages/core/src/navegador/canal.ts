import { randomUUID } from "node:crypto";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { registrarEspelho, type EventoDoEspelho } from "../controle/espelho";
import { registrarBloco, registrarEstadoDaExtensao } from "../controle/estado";
import { pararTudo } from "../controle/parar";
import { pausarSessao, sessaoParaTipo, sessaoPorId } from "../controle/sessao";
import { consumirCodigo, extensaoDoToken, marcarVista, registrarExtensao, revogarPorId } from "./pareamento";
import {
  MAX_MENSAGEM_BYTES, MensagemDaExtensao, VERSAO_DO_PROTOCOLO,
  type EnvelopeDaExtensao, type MensagemParaExtensao, type Ordem, type OrigemDaOrdem, type ResultadoDaOrdem,
} from "./protocolo";
import { regraParaExtensao, regrasDeSite } from "./sites";

/**
 * O CANAL DA EXTENSÃO (PRD §5.2, B1), sem saber de transporte: o gateway
 * WebSocket do apps/api e a ponte de native messaging (B7) entregam aqui as
 * mensagens cruas e um jeito de responder. Tudo que decide (quem pode
 * conectar, o que a extensão espelha, o que fazer quando o dono mexe) mora
 * aqui, testável sem rede.
 *
 * Quem pode conectar:
 *   - pelo WebSocket, só com `Origin: chrome-extension://<navegador.extensaoId>`
 *     (uma página web não consegue mentir o Origin, e é a página que ataca:
 *     CVE-2026-25253) E com o token pareado na primeira mensagem;
 *   - pela ponte de native messaging (o Chrome só a inicia para a extensão de
 *     `allowed_origins`), sem Origin, com o segredo de arquivo da ponte
 *     (conferido no upgrade) e com o MESMO token. A ponte repassa a origem que
 *     o Chrome lhe deu, e ela tem de ser a da extensão configurada.
 * Sem token válido, nada: nem a ponte passa sozinha.
 */

export interface Transporte {
  enviar(m: MensagemParaExtensao): void;
  fechar(codigo: number, motivo: string): void;
}

export interface MetaDaConexao {
  /** cabeçalho Origin da conexão (null quando não veio) */
  origin: string | null;
  /** veio pela ponte de native messaging (sem Origin, com o segredo da ponte já conferido no upgrade) */
  ponte: boolean;
  /** a origem da extensão que o Chrome passou à ponte ("chrome-extension://<id>") */
  origemDaPonte?: string | null;
}

interface Pendente {
  resolve: (r: ResultadoDaOrdem) => void;
  reject: (e: Error) => void;
  relogio: ReturnType<typeof setTimeout>;
}

export class ErroDaExtensao extends Error {
  constructor(
    message: string,
    public readonly codigo: string = "falhou",
  ) {
    super(message);
    this.name = "ErroDaExtensao";
  }
}

class Conexao {
  readonly id = randomUUID();
  userId: string | null = null;
  extensaoId: string | null = null;
  versao = "";
  nome = "";
  conectadaEm = Date.now();
  vistaEm = Date.now();
  /** o transporte fechou: nada que termine um `await` depois disto pode pôr a conexão no conjunto */
  fechada = false;
  readonly pendentes = new Map<string, Pendente>();
  constructor(
    readonly transporte: Transporte,
    readonly meta: MetaDaConexao,
  ) {}
}

const conexoes = new Set<Conexao>();

/** Há uma extensão autenticada agora? É o `requires.available` das tools do navegador. Síncrono. */
export function extensaoConectada(userId?: string): boolean {
  for (const c of conexoes) if (c.userId && (!userId || c.userId === userId)) return true;
  return false;
}

/**
 * O estado da extensão para o `/api/health` (PRD §13): `up` com uma conectada
 * agora, `down` com uma pareada (token valendo) que não está conectada, e
 * `nao_usado` quando nunca houve pareamento: "down" num Chrome que a casa não
 * usa ensinaria a ignorar o painel.
 */
export async function estadoDaExtensaoParaOHealth(): Promise<"up" | "down" | "nao_usado"> {
  if (extensaoConectada()) return "up";
  const { db } = await import("@orbita/db");
  const { navegadorExtensao } = await import("@orbita/db/navegador-schema");
  const { isNull } = await import("drizzle-orm");
  const [linha] = await db.select({ id: navegadorExtensao.id }).from(navegadorExtensao).where(isNull(navegadorExtensao.revogadaEm)).limit(1);
  return linha ? "down" : "nao_usado";
}

/** Alguma extensão autenticada fala pela ponte de native messaging agora? (para a tela mostrar "ativa") */
export function conectadaPelaPonte(userId?: string): boolean {
  for (const c of conexoes) if (c.userId && c.meta.ponte && (!userId || c.userId === userId)) return true;
  return false;
}

function conexaoDoDono(userId: string): Conexao | null {
  let melhor: Conexao | null = null;
  for (const c of conexoes) if (c.userId === userId && (!melhor || c.conectadaEm > melhor.conectadaEm)) melhor = c;
  return melhor;
}

function enviar(c: Conexao, m: MensagemParaExtensao): void {
  try {
    c.transporte.enviar(m);
  } catch (e) {
    log.warn("navegador.envio_falhou", { conexao: c.id, t: m.t, erro: e instanceof Error ? e.message : String(e) });
  }
}

function encerrar(c: Conexao, codigo: number, motivo: string): void {
  c.fechada = true;
  for (const [, p] of c.pendentes) {
    clearTimeout(p.relogio);
    p.reject(new ErroDaExtensao(`A extensão desconectou: ${motivo}`, "desconectou"));
  }
  c.pendentes.clear();
  conexoes.delete(c);
  try {
    c.transporte.fechar(codigo, motivo.slice(0, 120));
  } catch {
    /* já fechada */
  }
}

/** O envelope ativo do dono no formato da extensão, ou null. */
async function envelopeDoDono(userId: string): Promise<EnvelopeDaExtensao | null> {
  const s = await sessaoParaTipo(userId, "navegador").catch(() => null);
  return s ? { sessaoId: s.id, objetivo: s.objetivo, sites: s.sites, expiraEm: s.expiraEm.toISOString(), tetoPassos: s.tetoPassos, passosUsados: s.passosUsados } : null;
}

/** O ID que o Origin precisa ter. Puro. */
export function origemEsperada(extensaoId: string): string | null {
  return /^[a-p]{32}$/.test(extensaoId) ? `chrome-extension://${extensaoId}` : null;
}

/**
 * Pode conectar? Pelo WebSocket, o Origin precisa ser o da extensão
 * configurada. Sem ID configurado, só o PAREAMENTO passa (é ele que grava o
 * ID), e só se o Origin for de uma extensão. Puro.
 */
export function conferirOrigem(meta: MetaDaConexao, extensaoId: string, pareando: boolean): { ok: true; idVisto: string | null } | { ok: false; motivo: string } {
  if (meta.ponte) {
    if (meta.origin) return { ok: false, motivo: "A ponte não manda Origin." };
    // a ponte diz para qual extensão o Chrome a iniciou; com o ID configurado tem de ser ele, inclusive para PAREAR
    const id = meta.origemDaPonte?.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1] ?? null;
    const esperadaPonte = origemEsperada(extensaoId);
    if (esperadaPonte) return id && `chrome-extension://${id}` === esperadaPonte ? { ok: true, idVisto: id } : { ok: false, motivo: "A ponte não veio da extensão configurada em Ajustes." };
    return pareando && id ? { ok: true, idVisto: id } : { ok: false, motivo: "Nenhuma extensão configurada ainda: pareie pelo código da tela." };
  }
  const m = meta.origin?.match(/^chrome-extension:\/\/([a-p]{32})$/);
  if (!m) return { ok: false, motivo: "Origem recusada: só a extensão da Órbita conecta aqui." };
  const esperada = origemEsperada(extensaoId);
  if (esperada) return meta.origin === esperada ? { ok: true, idVisto: m[1]! } : { ok: false, motivo: "Esta extensão não é a configurada em Ajustes (ID da extensão da Órbita)." };
  return pareando ? { ok: true, idVisto: m[1]! } : { ok: false, motivo: "Nenhuma extensão configurada ainda: pareie pelo código da tela." };
}

async function aposAutenticar(c: Conexao): Promise<void> {
  const userId = c.userId!;
  // o socket pode ter fechado enquanto o token era conferido: sem isto ele entrava no conjunto e
  // `extensaoConectada` dizia "conectada" para uma conexão que não existe mais
  if (c.fechada) return;
  conexoes.add(c);
  const [envelope, regras, cfg] = await Promise.all([envelopeDoDono(userId), regrasDeSite(userId), settings.getMany(["navegador.corDoGrupo", "navegador.keepaliveSeg", "navegador.agindoMs"])]);
  enviar(c, { t: "bem_vindo", versao: VERSAO_DO_PROTOCOLO, envelope, sites: regraParaExtensao(regras), corDoGrupo: cfg["navegador.corDoGrupo"], keepaliveSeg: cfg["navegador.keepaliveSeg"], agindoMs: cfg["navegador.agindoMs"] });
  log.info("navegador.extensao_conectada", { userId, conexao: c.id, via: c.meta.ponte ? "nativo" : "websocket", versao: c.versao });
}

export interface ManipuladorDaConexao {
  receber(bruto: string): Promise<void>;
  fechou(): void;
}

/** Prazo para a primeira mensagem (o token): conexão muda é derrubada. */
export const PRAZO_DO_OLA_MS = 10_000;

/** Uma conexão nova (WebSocket ou ponte). O transporte entrega cada mensagem em `receber`. */
export function aoConectar(transporte: Transporte, meta: MetaDaConexao): ManipuladorDaConexao {
  const c = new Conexao(transporte, meta);
  const prazo = setTimeout(() => {
    if (!c.userId) encerrar(c, 4001, "sem autenticação a tempo");
  }, PRAZO_DO_OLA_MS);

  return {
    fechou() {
      clearTimeout(prazo);
      if (conexoes.has(c)) log.info("navegador.extensao_desconectada", { userId: c.userId, conexao: c.id });
      encerrar(c, 1000, "fechada");
    },
    async receber(bruto) {
      if (bruto.length > MAX_MENSAGEM_BYTES) return encerrar(c, 1009, "mensagem grande demais");
      let json: unknown;
      try {
        json = JSON.parse(bruto);
      } catch {
        return encerrar(c, 4002, "mensagem que não é JSON");
      }
      const m = MensagemDaExtensao.safeParse(json);
      if (!m.success) {
        // antes de autenticar, qualquer coisa fora do formato derruba; depois, só ignora e registra
        if (!c.userId) return encerrar(c, 4002, "mensagem fora do protocolo");
        log.warn("navegador.mensagem_invalida", { conexao: c.id });
        return;
      }
      const msg = m.data;
      c.vistaEm = Date.now();

      if (!c.userId) {
        if (msg.t === "ola") {
          const extensaoId = await settings.get("navegador.extensaoId");
          const o = conferirOrigem(meta, extensaoId, false);
          if (!o.ok) {
            enviar(c, { t: "recusado", motivo: o.motivo });
            return encerrar(c, 4003, o.motivo);
          }
          const validade = await settings.get("navegador.tokenValidadeDias").catch(() => 90);
          const e = await extensaoDoToken(msg.token, validade);
          if (c.fechada) return;
          if (!e) {
            enviar(c, { t: "recusado", motivo: "Token inválido ou revogado. Pareie de novo pela tela." });
            return encerrar(c, 4003, "token inválido");
          }
          clearTimeout(prazo);
          c.userId = e.userId;
          c.extensaoId = e.id;
          c.versao = msg.versao;
          c.nome = msg.nome;
          await marcarVista(e.id, msg.versao).catch(() => undefined);
          return aposAutenticar(c);
        }
        if (msg.t === "parear") {
          const extensaoId = await settings.get("navegador.extensaoId");
          const o = conferirOrigem(meta, extensaoId, true);
          if (!o.ok) {
            enviar(c, { t: "recusado", motivo: o.motivo });
            return encerrar(c, 4003, o.motivo);
          }
          // o erro conta para QUEM errou: uma extensão estranha errando não mata o código do dono
          const userId = consumirCodigo(msg.codigo, Date.now(), meta.ponte ? `ponte:${meta.origemDaPonte ?? "?"}` : (meta.origin ?? "sem-origem"));
          if (!userId) {
            enviar(c, { t: "recusado", motivo: "Código errado ou vencido. Gere outro na tela (vale 5 minutos)." });
            return encerrar(c, 4003, "código inválido");
          }
          // o primeiro pareamento grava o ID: daqui em diante só esta extensão conecta
          if (!origemEsperada(extensaoId) && o.idVisto) await settings.set("navegador.extensaoId", o.idVisto);
          const { token, extensao, revogadas } = await registrarExtensao(userId, msg.nome, msg.versao, msg.tokenAnterior ?? null);
          // o token anterior desta extensão foi revogado: a conexão velha dele (se houver) cai junto
          for (const id of revogadas) derrubarExtensao(id, "Pareada de novo: este token foi substituído.");
          // fechou no meio: o token novo nunca chegou a ninguém, então não fica valendo
          if (c.fechada) {
            await revogarPorId(extensao.id).catch(() => false);
            return;
          }
          clearTimeout(prazo);
          c.userId = userId;
          c.extensaoId = extensao.id;
          c.versao = msg.versao;
          c.nome = msg.nome;
          enviar(c, { t: "pareado", token, extensao: extensao.id });
          return aposAutenticar(c);
        }
        return encerrar(c, 4001, "autentique primeiro");
      }

      switch (msg.t) {
        case "ping":
          return enviar(c, { t: "pong" });
        case "resposta": {
          const p = c.pendentes.get(msg.id);
          if (!p) return;
          c.pendentes.delete(msg.id);
          clearTimeout(p.relogio);
          if (msg.ok) p.resolve((msg.dados ?? {}) as ResultadoDaOrdem);
          else p.reject(new ErroDaExtensao(msg.erro ?? "A extensão recusou.", msg.codigo ?? "recusado"));
          return;
        }
        case "evento":
          await tratarEvento(c, msg);
          // a confirmação tira o evento da fila da extensão (sem ela, ela reenvia a cada reconexão)
          if (msg.id && !c.fechada) enviar(c, { t: "evento_recebido", id: msg.id });
          return;
        case "esquecer": {
          // "Esquecer" no popup: o token desta conexão é revogado no servidor, não só apagado da extensão
          if (c.extensaoId) await revogarPorId(c.extensaoId).catch(() => false);
          enviar(c, { t: "revogado", motivo: "Você esqueceu o pareamento nesta extensão." });
          return encerrar(c, 4004, "esquecida");
        }
        default:
          return;
      }
    },
  };
}

/** Até quanto tempo depois de apertado o Parar guardado ainda vale para tudo (queda de canal dura segundos). */
export const PARAR_RECENTE_MS = 10 * 60_000;

/**
 * Um evento da extensão. O Parar e o "o dono mexeu" podem chegar ATRASADOS (a
 * extensão os guarda enquanto o canal está caído e reenvia logo depois de
 * autenticar, B-3). Com `sessaoId` valem só para aquela sessão: um Parar velho
 * nunca para a sessão que o dono abriu depois.
 */
async function tratarEvento(c: Conexao, e: Extract<MensagemDaExtensao, { t: "evento" }>): Promise<void> {
  const userId = c.userId!;
  log.info("navegador.evento", { userId, tipo: e.tipo, aba: e.aba, dominio: e.dominio, sessaoId: e.sessaoId });
  if (e.tipo === "parar") {
    // O dono apertou Parar: a intenção é parar TUDO, inclusive uma sessão que o api abriu enquanto o canal
    // estava caído. Só o Parar VELHO (reenviado horas depois, sem confirmação) vale apenas para a sessão dele.
    const recente = typeof e.em === "number" && Math.abs(Date.now() - e.em) < PARAR_RECENTE_MS;
    if (e.sessaoId && !recente) {
      const s = await sessaoPorId(userId, e.sessaoId).catch(() => null);
      if (!s || (s.status !== "ativa" && s.status !== "pausada")) return;
    }
    // a extensão JÁ parou do lado dela (soltou o debugger, tirou a borda); agora o resto
    await pararTudo(userId, "botão Parar na aba do Chrome").catch((err) => log.warn("navegador.parar_falhou", { erro: String(err) }));
    return;
  }
  if (e.tipo === "dono_mexeu" || e.tipo === "redirecionou" || e.tipo === "borda_escondida") {
    const motivo =
      e.tipo === "dono_mexeu" ? "o dono mexeu na aba" : e.tipo === "borda_escondida" ? "a página escondeu a borda da Órbita (o dono não veria que ela está no controle)" : `a aba foi para fora do envelope (${(e.dominio ?? "").slice(0, 80)})`;
    // pausar só muda sessão ATIVA: o pendente de uma sessão que já acabou não faz nada
    if (e.sessaoId) {
      await pausarSessao(userId, e.sessaoId, motivo).catch(() => null);
      return;
    }
    const s = await sessaoParaTipo(userId, "navegador").catch(() => null);
    if (s) await pausarSessao(userId, s.id, motivo);
  }
}

/**
 * Manda uma ordem ao Chrome do dono e espera a resposta. Lança
 * `ErroDaExtensao` com a frase da recusa (para o modelo repassar), ou quando
 * não há extensão ou ela não responde a tempo.
 */
export async function ordemAExtensao(userId: string, ordem: Ordem, origem: OrigemDaOrdem, timeoutMs?: number): Promise<ResultadoDaOrdem> {
  const c = conexaoDoDono(userId);
  if (!c) throw new ErroDaExtensao("A extensão do Chrome não está conectada. Abra o Chrome e confira a extensão da Órbita.", "desconectada");
  const prazo = timeoutMs ?? (await settings.get("navegador.ordemTimeoutMs").catch(() => 15000));
  const id = randomUUID();
  return new Promise<ResultadoDaOrdem>((resolve, reject) => {
    const relogio = setTimeout(() => {
      c.pendentes.delete(id);
      reject(new ErroDaExtensao(`O Chrome não respondeu em ${Math.round(prazo / 1000)} s.`, "sem_resposta"));
    }, prazo);
    c.pendentes.set(id, { resolve, reject, relogio });
    enviar(c, { t: "ordem", id, origem, ordem });
  });
}

/** Revogar na tela derruba a extensão na hora. */
export function derrubarExtensao(extensaoId: string, motivo = "O token foi revogado na tela."): number {
  let n = 0;
  for (const c of [...conexoes]) {
    if (c.extensaoId !== extensaoId) continue;
    enviar(c, { t: "revogado", motivo });
    encerrar(c, 4004, "revogada");
    n++;
  }
  return n;
}

/** Espelho do envelope (PRD §5.1): a extensão recusa, do lado dela, o que sair dele. */
async function notificar(e: EventoDoEspelho): Promise<void> {
  const destino = [...conexoes].filter((c) => c.userId === e.userId);
  if (!destino.length) return;
  if (e.tipo === "envelope") {
    if (e.envelope.alvo === "computador") return;
    const sites = regraParaExtensao(await regrasDeSite(e.userId));
    const env: EnvelopeDaExtensao = { sessaoId: e.envelope.sessaoId, objetivo: e.envelope.objetivo, sites: e.envelope.sites, expiraEm: e.envelope.expiraEm, tetoPassos: e.envelope.tetoPassos, passosUsados: e.envelope.passosUsados };
    for (const c of destino) enviar(c, { t: "envelope", envelope: env, sites });
  } else if (e.tipo === "fim") {
    for (const c of destino) enviar(c, { t: "fim", sessaoId: e.sessaoId, status: e.status, motivo: e.motivo });
  } else {
    for (const c of destino) enviar(c, { t: "parar", origem: e.origem });
  }
}

/** Avisa a extensão que a lista de sites mudou (a tela de Sites chama isto). */
export async function reenviarSites(userId: string): Promise<void> {
  const destino = [...conexoes].filter((c) => c.userId === userId);
  if (!destino.length) return;
  const [envelope, regras] = await Promise.all([envelopeDoDono(userId), regrasDeSite(userId)]);
  const sites = regraParaExtensao(regras);
  for (const c of destino) {
    if (envelope) enviar(c, { t: "envelope", envelope, sites });
    else enviar(c, { t: "bem_vindo", versao: VERSAO_DO_PROTOCOLO, envelope: null, sites, ...(await extrasDoBemVindo()) });
  }
}

async function extrasDoBemVindo(): Promise<{ corDoGrupo: string; keepaliveSeg: number; agindoMs: number }> {
  const cfg = await settings.getMany(["navegador.corDoGrupo", "navegador.keepaliveSeg", "navegador.agindoMs"]);
  return { corDoGrupo: cfg["navegador.corDoGrupo"], keepaliveSeg: cfg["navegador.keepaliveSeg"], agindoMs: cfg["navegador.agindoMs"] };
}

let ligado = false;

/** Liga o canal no processo vivo: espelho, estado para a tela e os blocos de UI. Idempotente. */
export function ligarCanalDaExtensao(): void {
  if (ligado) return;
  ligado = true;
  registrarEspelho({ nome: "extensao", notificar });
  registrarEstadoDaExtensao({
    estado() {
      const lista = [...conexoes].filter((c) => c.userId);
      if (!lista.length) return { ligado: false, detalhe: "Nenhuma extensão conectada. Abra o Chrome com a extensão da Órbita pareada." };
      const c = lista.sort((a, b) => b.conectadaEm - a.conectadaEm)[0]!;
      return { ligado: true, versao: c.versao, detalhe: `${c.nome} (${c.meta.ponte ? "native messaging" : "WebSocket"})`, vistoEm: new Date(c.vistaEm).toISOString() };
    },
  });
  registrarBloco("pareamento");
  registrarBloco("sites");
}

/** Só para testes. */
export function _limparConexoes(): void {
  for (const c of [...conexoes]) encerrar(c, 1000, "teste");
  ligado = false;
}
