import { assertLocalOrPublicUrl } from "../net/ssrf";

/**
 * Cliente REST do Home Assistant (B3.3). O comando vai por REST (latência
 * baixa na LAN); o evento volta por WebSocket (`ws-watcher.ts`).
 *
 * `baseUrl` SEMPRE vem de `ha_connection` (digitado pelo dono numa tela
 * confiável), nunca de conteúdo externo — é isso que justifica usar
 * `assertLocalOrPublicUrl` (a exceção estreita de SSRF) em vez de recusar LAN.
 */
export class HomeAssistantError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "HomeAssistantError";
  }
}

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & { friendly_name?: string };
  last_changed: string;
}

function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

async function haFetch<T>(baseUrl: string, token: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  let res: Response;
  try {
    // reconfere a cada chamada: a URL salva pode ter sido trocada desde o cadastro
    await assertLocalOrPublicUrl(url);
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    // um erro só (SSRF ou rede): quem chama o cliente trata um tipo, não dois
    throw new HomeAssistantError(`Não foi possível conectar ao Home Assistant: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HomeAssistantError(`Home Assistant respondeu ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Testa a conexão e devolve um rótulo legível (versão/nome da instância). */
export async function pingHomeAssistant(baseUrl: string, token: string): Promise<{ ok: true; label: string }> {
  const cfg = await haFetch<{ version?: string; location_name?: string }>(baseUrl, token, "/api/config");
  const label = [cfg.location_name, cfg.version ? `HA ${cfg.version}` : null].filter(Boolean).join(" · ") || "Home Assistant";
  return { ok: true, label };
}

/** Todas as entidades e seu estado atual (para o sync do índice semântico). */
export async function listStates(baseUrl: string, token: string): Promise<HaState[]> {
  return haFetch<HaState[]>(baseUrl, token, "/api/states");
}

/** Estado de UMA entidade. */
export async function getState(baseUrl: string, token: string, entityId: string): Promise<HaState> {
  return haFetch<HaState>(baseUrl, token, `/api/states/${encodeURIComponent(entityId)}`);
}

/** Chama um serviço do HA (o "acionar" de verdade: light.turn_on, lock.unlock...). */
export async function callService(
  baseUrl: string,
  token: string,
  domain: string,
  service: string,
  data: Record<string, unknown>,
): Promise<HaState[]> {
  return haFetch<HaState[]>(baseUrl, token, `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
