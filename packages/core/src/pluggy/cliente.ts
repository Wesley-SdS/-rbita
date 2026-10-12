import type { TransacaoBruta } from "./normalizar";

/**
 * O cliente HTTP da Pluggy. Só fala com a API: não conhece o financeiro.
 * Credenciais (clientId e clientSecret) chegam de quem chama, lidas do cofre de
 * conexões; nada aqui vai para o log.
 */

const BASE = "https://api.pluggy.ai";
const PRAZO_MS = 20_000;
/** a chave vale 2 h; renovar um pouco antes, porque o /auth tem limite de chamadas */
const VALIDADE_DA_CHAVE_MS = 100 * 60_000;
const MAX_PAGINAS = 40;

export class PluggyErro extends Error {
  constructor(message: string, readonly status: number | null = null, readonly codigo: string | null = null) {
    super(message);
    this.name = "PluggyErro";
  }
}

export interface Credenciais {
  clientId: string;
  clientSecret: string;
}

export interface ItemPluggy {
  id: string;
  status?: string | null;
  executionStatus?: string | null;
  lastUpdatedAt?: string | null;
  connector?: { name?: string | null } | null;
}

export interface ContaPluggy {
  id: string;
  type: "BANK" | "CREDIT" | string;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  number?: string | null;
  balance?: number | null;
  taxNumber?: string | null;
  owner?: string | null;
  currencyCode?: string | null;
  /** só em cartão: limite e as datas do ciclo atual (o dia de fechar e de vencer saem daqui) */
  creditData?: {
    creditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
  } | null;
}

/** Uma fatura de cartão. `billClosingDate` nem todo banco informa. */
export interface FaturaPluggy {
  id: string;
  dueDate: string;
  totalAmount: number;
  minimumPaymentAmount?: number | null;
  billClosingDate?: string | null;
}

const chaves = new Map<string, { apiKey: string; venceEm: number }>();

async function chamar(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PRAZO_MS) });
  } catch (e) {
    throw new PluggyErro(e instanceof Error && e.name === "TimeoutError" ? "A Pluggy demorou demais para responder." : "Não consegui falar com a Pluggy.");
  }
}

async function lerErro(res: Response): Promise<PluggyErro> {
  const corpo = (await res.json().catch(() => null)) as { message?: string; codeDescription?: string } | null;
  if (res.status === 401 || res.status === 403) {
    return new PluggyErro(
      corpo?.codeDescription === "CLIENT_KEYS_UNAUTHORIZED" ? "A Pluggy recusou o clientId e o clientSecret. Confira se foram copiados inteiros." : "A Pluggy recusou o acesso.",
      res.status,
      corpo?.codeDescription ?? null,
    );
  }
  return new PluggyErro(corpo?.message ? `A Pluggy respondeu: ${corpo.message}` : `A Pluggy respondeu ${res.status}.`, res.status, corpo?.codeDescription ?? null);
}

/** Troca clientId e clientSecret por uma chave de API (reaproveitada por ~100 min). */
export async function obterChave(c: Credenciais, forcar = false): Promise<string> {
  const guardada = chaves.get(c.clientId);
  if (!forcar && guardada && guardada.venceEm > Date.now()) return guardada.apiKey;
  const res = await chamar(`${BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret }),
  });
  if (!res.ok) throw await lerErro(res);
  const { apiKey } = (await res.json()) as { apiKey?: string };
  if (!apiKey) throw new PluggyErro("A Pluggy não devolveu a chave de acesso.");
  chaves.set(c.clientId, { apiKey, venceEm: Date.now() + VALIDADE_DA_CHAVE_MS });
  return apiKey;
}

export function esquecerChave(clientId: string): void {
  chaves.delete(clientId);
}

async function pegar<T>(c: Credenciais, caminho: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(`${BASE}${caminho}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await chamar(url.toString(), { headers: { "X-API-KEY": await obterChave(c, tentativa > 0), Accept: "application/json" } });
    // chave vencida antes da hora: renova uma vez e repete
    if (res.status === 401 && tentativa === 0) continue;
    if (!res.ok) throw await lerErro(res);
    return (await res.json()) as T;
  }
  throw new PluggyErro("A Pluggy recusou o acesso.", 401);
}

export const lerItem = (c: Credenciais, itemId: string) => pegar<ItemPluggy>(c, `/items/${encodeURIComponent(itemId)}`);

export async function lerContas(c: Credenciais, itemId: string): Promise<ContaPluggy[]> {
  const r = await pegar<{ results?: ContaPluggy[] }>(c, "/accounts", { itemId });
  return r.results ?? [];
}

/** O cursor do v2 vem como URL (`...?after=XYZ`) ou já como o valor; devolve o valor para o próximo pedido. */
export function cursorDoProximo(next: unknown): string | null {
  if (typeof next !== "string" || !next) return null;
  try {
    return new URL(next).searchParams.get("after") ?? next;
  } catch {
    return next;
  }
}

/**
 * Transações de uma conta desde `desde` (AAAA-MM-DD). Usa o v2 (por cursor,
 * `dateFrom` e `after`, como o SDK oficial), porque o `GET /transactions` está
 * marcado como obsoleto pela Pluggy (vale até 31/12/2026). Se o v2 recusar,
 * cai para o legado em vez de parar o financeiro. A data também é filtrada
 * aqui: uma leitura que ignorasse o filtro só traria linhas a mais, que a
 * trava de duplicidade já descarta.
 */
export async function lerTransacoes(c: Credenciais, accountId: string, desde: string): Promise<TransacaoBruta[]> {
  try {
    const todas = await lerTransacoesV2(c, accountId, desde);
    return todas.filter((t) => (t.date ?? "").slice(0, 10) >= desde);
  } catch (e) {
    if (!(e instanceof PluggyErro) || (e.status !== 400 && e.status !== 404)) throw e;
  }
  const todas = await lerTransacoesLegado(c, accountId, desde);
  return todas.filter((t) => (t.date ?? "").slice(0, 10) >= desde);
}

async function lerTransacoesV2(c: Credenciais, accountId: string, desde: string): Promise<TransacaoBruta[]> {
  const out: TransacaoBruta[] = [];
  let after: string | null = null;
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const r: { results?: TransacaoBruta[]; next?: unknown } = await pegar(c, "/v2/transactions", { accountId, dateFrom: desde, after: after ?? undefined });
    out.push(...(r.results ?? []));
    after = cursorDoProximo(r.next);
    if (!after) return out;
  }
  return out;
}

async function lerTransacoesLegado(c: Credenciais, accountId: string, desde: string): Promise<TransacaoBruta[]> {
  const out: TransacaoBruta[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await pegar<{ results?: TransacaoBruta[]; totalPages?: number }>(c, "/transactions", { accountId, from: desde, pageSize: "500", page: String(pagina) });
    out.push(...(r.results ?? []));
    if (pagina >= (r.totalPages ?? 1)) break;
  }
  return out;
}

/** As faturas de um cartão (a Pluggy devolve todas de uma vez, 500 por página). */
export async function lerFaturas(c: Credenciais, accountId: string): Promise<FaturaPluggy[]> {
  const out: FaturaPluggy[] = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const r = await pegar<{ results?: FaturaPluggy[]; totalPages?: number }>(c, "/bills", { accountId, pageSize: "500", page: String(pagina) });
    out.push(...(r.results ?? []));
    if (pagina >= (r.totalPages ?? 1)) break;
  }
  return out;
}

/**
 * Token curto para o widget de conexão abrir NO NAVEGADOR. O widget é a única
 * parte que roda fora do servidor, e por isso o token (30 min, só para o
 * widget) é o único segredo que sai daqui; o clientSecret nunca. Com `itemId`
 * o widget atualiza aquela conexão (renovar consentimento, refazer login).
 */
export async function criarConnectToken(c: Credenciais, opcoes: { itemId?: string; clientUserId: string }): Promise<string> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const res = await chamar(`${BASE}/connect_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-API-KEY": await obterChave(c, tentativa > 0) },
      body: JSON.stringify({ ...(opcoes.itemId ? { itemId: opcoes.itemId } : {}), options: { clientUserId: opcoes.clientUserId, avoidDuplicates: true } }),
    });
    if (res.status === 401 && tentativa === 0) continue;
    if (!res.ok) throw await lerErro(res);
    const { accessToken } = (await res.json()) as { accessToken?: string };
    if (!accessToken) throw new PluggyErro("A Pluggy não devolveu o token de conexão.");
    return accessToken;
  }
  throw new PluggyErro("A Pluggy recusou o acesso.", 401);
}

/** Saldo da Pluggy (reais, número) em centavos inteiros. */
export const saldoEmCentavos = (balance: number | null | undefined): number | null =>
  typeof balance === "number" && Number.isFinite(balance) ? Math.round(balance * 100) : null;
