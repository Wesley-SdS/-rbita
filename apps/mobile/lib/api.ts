import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/**
 * Cliente da API da ÓRBITA. Aponta para o backend Next (o mesmo do web).
 * A sessão do Better Auth é um cookie: capturamos no login, guardamos no
 * SecureStore e reenviamos em cada request (o fetch do RN expõe Set-Cookie).
 */
const BASE_KEY = "orbita.baseUrl";
const COOKIE_KEY = "orbita.cookie";

/** Deriva o IP do dev server (Metro) e assume a porta 3000 do backend. */
function defaultBase(): string {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `http://${host}:3000` : "http://localhost:3000";
}

export async function getBaseUrl(): Promise<string> {
  return (await SecureStore.getItemAsync(BASE_KEY)) ?? defaultBase();
}
export async function setBaseUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(BASE_KEY, url.replace(/\/$/, ""));
}

async function getCookie(): Promise<string | null> {
  return SecureStore.getItemAsync(COOKIE_KEY);
}
export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(COOKIE_KEY);
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  // pega o par nome=valor do cookie de sessão do Better Auth
  const m = setCookie.match(/(better-auth\.session_token=[^;]+)/);
  return m ? m[1] : null;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<ApiResponse<T>> {
  const base = await getBaseUrl();
  const cookie = await getCookie();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.json);
  }
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(base + path, { ...init, headers });

  // persiste cookie de sessão se veio um novo
  const setCookie = res.headers.get("set-cookie");
  const session = extractSessionCookie(setCookie);
  if (session) await SecureStore.setItemAsync(COOKIE_KEY, session);

  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : (null as T);
  } catch {
    data = text as unknown as T;
  }
  return { ok: res.ok, status: res.status, data };
}
