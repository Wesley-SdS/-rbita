import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@orbita/db";
import { navegadorExtensao, type NavegadorExtensao } from "@orbita/db/navegador-schema";
import { log } from "../observability/logger";

/**
 * PAREAMENTO DA EXTENSÃO (PRD §5.2, B1).
 *
 * O dono clica "Parear extensão" na tela e recebe um código de 6 dígitos que
 * vale 5 minutos e serve UMA vez. Digita no popup da extensão, e a extensão
 * troca o código por um token longo (32 bytes aleatórios). Só o hash do token
 * vai para o banco.
 *
 * O código fica em memória, de propósito: ele vive 5 minutos, e um reinício do
 * api (o `tsx watch` a cada arquivo salvo) só obriga a gerar outro. Gravar no
 * banco um segredo de vida curta seria mais um lugar para ele vazar.
 *
 * Contra adivinhar: um milhão de códigos, e cada tentativa errada conta, por
 * QUEM tentou (a origem da conexão) e no total. Uma origem que erra
 * `ERROS_POR_ORIGEM` vezes não tenta mais até o próximo código; o código só
 * morre com `ERROS_GLOBAIS` erros somados. Antes era um contador só, de 10:
 * uma extensão qualquer errava dez vezes e matava o código do dono (I-2).
 * A conexão que errou é derrubada por quem chama.
 */

export const VALIDADE_DO_CODIGO_MS = 5 * 60_000;
export const ERROS_POR_ORIGEM = 5;
export const ERROS_GLOBAIS = 60;

interface CodigoVivo {
  userId: string;
  codigo: string;
  expiraEm: number;
}

let vivo: CodigoVivo | null = null;
let errosNaJanela = 0;
const errosPorOrigem = new Map<string, number>();

export function hashDoToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Gera (e substitui) o código do dono. Um código por vez: o novo mata o anterior. */
export function gerarCodigo(userId: string, agora = Date.now()): { codigo: string; expiraEm: string } {
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  vivo = { userId, codigo, expiraEm: agora + VALIDADE_DO_CODIGO_MS };
  errosNaJanela = 0;
  errosPorOrigem.clear();
  log.info("navegador.codigo_gerado", { userId });
  return { codigo, expiraEm: new Date(vivo.expiraEm).toISOString() };
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Confere o código e o CONSOME. Devolve o dono, ou null (errado, vencido, já
 * usado, ou a origem já errou demais). `quem` é a origem da conexão
 * ("chrome-extension://…", "ponte").
 */
export function consumirCodigo(codigo: string, agora = Date.now(), quem = "desconhecido"): string | null {
  const v = vivo;
  if (!v || agora > v.expiraEm) {
    vivo = null;
    return null;
  }
  const deste = errosPorOrigem.get(quem) ?? 0;
  // quem já errou demais não chega nem a comparar: nem acerta por sorte, nem gasta o limite do dono
  if (deste >= ERROS_POR_ORIGEM) return null;
  if (!iguais(v.codigo, codigo)) {
    errosPorOrigem.set(quem, deste + 1);
    errosNaJanela++;
    if (deste + 1 >= ERROS_POR_ORIGEM) log.warn("navegador.codigo_origem_barrada", { origem: quem.slice(0, 80) });
    if (errosNaJanela >= ERROS_GLOBAIS) {
      log.warn("navegador.codigo_invalidado", { motivo: "tentativas erradas demais" });
      vivo = null;
    }
    return null;
  }
  vivo = null;
  return v.userId;
}

/** Para a tela: há um código valendo agora? (nunca devolve o código) */
export function codigoPendente(userId: string, agora = Date.now()): { expiraEm: string } | null {
  return vivo && vivo.userId === userId && agora <= vivo.expiraEm ? { expiraEm: new Date(vivo.expiraEm).toISOString() } : null;
}

/** Só para testes. */
export function _limparCodigo(): void {
  vivo = null;
  errosNaJanela = 0;
  errosPorOrigem.clear();
}

/**
 * Cria a extensão pareada e devolve o token (a única vez em que ele existe por
 * inteiro). `tokenAnterior`: o token que esta mesma extensão tinha; ele é
 * revogado, senão parear de novo deixava o velho valendo.
 */
export async function registrarExtensao(userId: string, nome: string, versao: string, tokenAnterior?: string | null): Promise<{ token: string; extensao: NavegadorExtensao; revogadas: string[] }> {
  const token = randomBytes(32).toString("base64url");
  const [extensao] = await db
    .insert(navegadorExtensao)
    .values({ userId, nome: nome.slice(0, 120) || "Chrome", tokenHash: hashDoToken(token), versao: versao.slice(0, 40) || null, vistaEm: new Date() })
    .returning();
  const revogadas = tokenAnterior
    ? (
        await db
          .update(navegadorExtensao)
          .set({ revogadaEm: new Date() })
          .where(and(eq(navegadorExtensao.userId, userId), eq(navegadorExtensao.tokenHash, hashDoToken(tokenAnterior)), isNull(navegadorExtensao.revogadaEm)))
          .returning({ id: navegadorExtensao.id })
      ).map((r) => r.id)
    : [];
  log.info("navegador.extensao_pareada", { userId, extensaoId: extensao!.id, revogadas: revogadas.length });
  return { token, extensao: extensao!, revogadas };
}

/** O token venceu? `validadeDias` vem de `navegador.tokenValidadeDias`. Puro. */
export function tokenVencido(criadaEm: Date, validadeDias: number, agora = Date.now()): boolean {
  return validadeDias > 0 && agora - criadaEm.getTime() > validadeDias * 86_400_000;
}

/** A extensão deste token, se não foi revogada nem venceu. */
export async function extensaoDoToken(token: string, validadeDias = 0): Promise<NavegadorExtensao | null> {
  const [e] = await db
    .select()
    .from(navegadorExtensao)
    .where(and(eq(navegadorExtensao.tokenHash, hashDoToken(token)), isNull(navegadorExtensao.revogadaEm)))
    .limit(1);
  if (!e) return null;
  if (tokenVencido(e.criadaEm, validadeDias)) {
    log.info("navegador.token_vencido", { extensaoId: e.id });
    return null;
  }
  return e;
}

export async function marcarVista(id: string, versao: string): Promise<void> {
  await db.update(navegadorExtensao).set({ vistaEm: new Date(), versao: versao.slice(0, 40) || null }).where(eq(navegadorExtensao.id, id));
}

export async function listarExtensoes(userId: string): Promise<NavegadorExtensao[]> {
  return db.select().from(navegadorExtensao).where(eq(navegadorExtensao.userId, userId)).orderBy(desc(navegadorExtensao.criadaEm));
}

/** Revoga pelo id da linha, sem conferir o dono: é a própria conexão autenticada pedindo ("Esquecer" no popup). */
export async function revogarPorId(id: string): Promise<boolean> {
  const r = await db.update(navegadorExtensao).set({ revogadaEm: new Date() }).where(and(eq(navegadorExtensao.id, id), isNull(navegadorExtensao.revogadaEm))).returning({ id: navegadorExtensao.id });
  if (r.length) log.info("navegador.extensao_esquecida", { extensaoId: id });
  return r.length > 0;
}

/** Revoga (não apaga: a tela mostra quando foi). Devolve a linha revogada, ou null. */
export async function revogarExtensao(userId: string, id: string): Promise<NavegadorExtensao | null> {
  const [e] = await db
    .update(navegadorExtensao)
    .set({ revogadaEm: new Date() })
    .where(and(eq(navegadorExtensao.id, id), eq(navegadorExtensao.userId, userId), isNull(navegadorExtensao.revogadaEm)))
    .returning();
  if (e) log.info("navegador.extensao_revogada", { userId, extensaoId: id });
  return e ?? null;
}
