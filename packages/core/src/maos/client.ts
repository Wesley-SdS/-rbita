import { createHash, timingSafeEqual } from "node:crypto";
import { settings } from "../settings";
import { isLocalUrl } from "../privacy/egress";
import { log } from "../observability/logger";

/**
 * Cliente do apps/maos (PRD A1, §5.2): as mãos no Windows, em 127.0.0.1.
 *
 *   - só fala com endereço de LOOPBACK (não basta "local": a LAN não serve), e
 *     confere isso antes de montar qualquer pedido;
 *   - todo pedido leva `x-orbita-maos` com o `MAOS_TOKEN` do `.env` da raiz
 *     (o mesmo que o apps/maos lê), e tem prazo (`maos.timeoutMs`);
 *   - o último `/health` fica em memória (`ultimaSaude`), porque o
 *     `requires.available` das tools é SÍNCRONO: o laço `maos` do processo vivo
 *     atualiza, e a tool só aparece com as mãos de pé.
 *
 * Recusa das mãos (envelope, senha, "a tela mudou") volta como 409 e vira
 * `MaosError` com `recusada: true`: o motivo é para o modelo repassar.
 */

export class MaosError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly recusada = false,
  ) {
    super(message);
    this.name = "MaosError";
  }
}

export interface MonitorDasMaos {
  indice: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  dpi: number;
  escala: number;
  primario: boolean;
  nome: string;
}

export interface AvisoDasMaos {
  id: string;
  tipo: "parar" | "pausar";
  origem: string;
  motivo?: string;
  sessaoId?: string | null;
  em?: number;
}

export interface SaudeDasMaos {
  status: string;
  versao: string;
  maquina: string;
  sessao_windows: number;
  integridade: string;
  elevado: boolean;
  dpi: { por_monitor_v2: boolean };
  monitores: MonitorDasMaos[];
  shells: Record<string, string>;
  isolamento: { sandbox: boolean | null; docker: boolean | null; verificando?: boolean };
  espelho: { status: string; sessaoId: string | null; motivo: string | null };
  atalho: { texto: string; registrado: boolean; erro: string | null };
  bandeja: { erro: string | null };
  avisos: AvisoDasMaos[];
  terminal: { rodando: number; sessoes: number };
  ultimo_parar: { origem: string; ms: number } | null;
  config_hash: string;
}

export type EstadoDoServico = "up" | "down" | "mal_configurado";

interface Visto {
  estado: EstadoDoServico;
  saude: SaudeDasMaos | null;
  erro: string | null;
  em: number;
}

let visto: Visto | null = null;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** A URL é desta máquina (loopback)? O `isLocalUrl` aceita a LAN; as mãos não. */
export function ehLoopback(url: string): boolean {
  if (!isLocalUrl(url)) return false;
  try {
    return LOOPBACK.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function tokenDasMaos(): string | null {
  const t = process.env.MAOS_TOKEN?.trim();
  return t ? t : null;
}

/** Confere o token que as mãos mandaram ao api (`POST /api/maos/aviso`), em tempo constante. */
export function tokenConfere(recebido: string | null | undefined): boolean {
  const esperado = tokenDasMaos();
  if (!esperado || !recebido) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

async function base(): Promise<{ url: string; timeoutMs: number; token: string }> {
  const cfg = await settings.getMany(["maos.url", "maos.timeoutMs"]);
  const url = cfg["maos.url"].replace(/\/+$/, "");
  if (!ehLoopback(url)) throw new MaosError("O serviço local do Windows precisa estar nesta máquina (127.0.0.1).", 400);
  const token = tokenDasMaos();
  if (!token) throw new MaosError("MAOS_TOKEN não está no .env da raiz: rode apps/maos/scripts/instalar.ps1.", 400);
  return { url, timeoutMs: cfg["maos.timeoutMs"], token };
}

export interface OpcoesDoPedido {
  metodo?: "GET" | "POST" | "PUT";
  corpo?: unknown;
  /** sobrescreve `maos.timeoutMs` (comando que espera, captura de tela) */
  timeoutMs?: number;
}

export async function chamarMaos<T>(caminho: string, o: OpcoesDoPedido = {}): Promise<T> {
  const { url, timeoutMs, token } = await base();
  let r: Response;
  try {
    r = await fetch(url + caminho, {
      method: o.metodo ?? (o.corpo === undefined ? "GET" : "POST"),
      headers: { "x-orbita-maos": token, ...(o.corpo === undefined ? {} : { "content-type": "application/json" }) },
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
      signal: AbortSignal.timeout(o.timeoutMs ?? timeoutMs),
    });
  } catch (e) {
    throw new MaosError(`O serviço local do Windows não respondeu (${e instanceof Error ? e.message : String(e)}).`, 503);
  }
  if (r.ok) return (await r.json()) as T;
  const corpo = (await r.json().catch(() => ({}))) as { detail?: unknown };
  const detalhe = typeof corpo.detail === "string" ? corpo.detail : Array.isArray(corpo.detail) ? "pedido inválido para as mãos" : `mãos ${r.status}`;
  if (r.status === 401) throw new MaosError("O token das mãos não confere (o MAOS_TOKEN do .env mudou?). Reinicie o apps/maos.", 401);
  throw new MaosError(detalhe, r.status, r.status === 409);
}

/** O último /health, guardado pelo laço `maos`. */
export function ultimaSaude(): Visto | null {
  return visto;
}

/** As mãos estão de pé AGORA? Síncrono, para o `requires.available`. Visto há mais de 2 min não vale. */
export function maosDisponivel(agora = Date.now()): boolean {
  return !!visto && visto.estado === "up" && agora - visto.em < 120_000;
}

/** Só para testes. */
export function _definirSaude(v: Visto | null): void {
  visto = v;
}

export async function atualizarSaude(): Promise<Visto> {
  try {
    const saude = await chamarMaos<SaudeDasMaos>("/health", { timeoutMs: 8000 });
    // elevado nunca deveria acontecer (as mãos recusam subir assim), mas se acontecer, nada de tool
    visto = saude.elevado ? { estado: "mal_configurado", saude, erro: "as mãos estão rodando como administrador", em: Date.now() } : { estado: "up", saude, erro: null, em: Date.now() };
  } catch (e) {
    const err = e instanceof MaosError ? e : new MaosError(String(e), 500);
    const mal = err.status === 400 || err.status === 401;
    if (visto?.estado === "up") log.warn("maos.caiu", { erro: err.message });
    visto = { estado: mal ? "mal_configurado" : "down", saude: null, erro: err.message, em: Date.now() };
  }
  return visto;
}

/** O mesmo hash que o apps/maos calcula da config que recebeu: diferente, empurra de novo. */
export function hashDaConfig(atalho: string, ocultos: readonly string[]): string {
  return createHash("sha1").update(`${atalho}|${ocultos.join("|")}`).digest("hex").slice(0, 12);
}

/** Estado para o `/api/health`: sem token é mal configurado mesmo sem nunca ter tentado. */
export function estadoParaOHealth(): EstadoDoServico {
  if (!tokenDasMaos()) return "mal_configurado";
  if (!visto) return "down";
  if (visto.estado === "up" && !maosDisponivel()) return "down";
  return visto.estado;
}
