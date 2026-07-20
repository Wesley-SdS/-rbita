import { Linking } from "react-native";
import { api, clearSession, getBaseUrl } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

/** Extrai a mensagem de erro real do backend (Better Auth) e traduz p/ pt-BR. */
function authError(res: { status: number; data: unknown }, fallback: string): Error {
  const d = res.data as { message?: string; code?: string } | null;
  const map: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha inválidos.",
    INVALID_ORIGIN: "Origem não autorizada — verifique o servidor em ⚙ configurar servidor.",
    USER_ALREADY_EXISTS: "Já existe uma conta com esse e-mail.",
    PASSWORD_TOO_SHORT: "A senha precisa ter ao menos 8 caracteres.",
  };
  const msg = (d?.code && map[d.code]) || d?.message || `${fallback} (HTTP ${res.status})`;
  return new Error(msg);
}

export async function signUp(name: string, email: string, password: string) {
  const res = await api("/api/auth/sign-up/email", { method: "POST", json: { name, email, password } });
  if (!res.ok) throw authError(res, "Falha ao criar conta");
  return res.data;
}

export async function signIn(email: string, password: string) {
  const res = await api("/api/auth/sign-in/email", { method: "POST", json: { email, password } });
  if (!res.ok) throw authError(res, "Falha ao entrar");
  return res.data;
}

export async function getSession(): Promise<SessionUser | null> {
  const res = await api<{ user?: SessionUser }>("/api/auth/get-session", { method: "GET" });
  return res.ok && res.data?.user ? res.data.user : null;
}

export async function signOut() {
  await api("/api/auth/sign-out", { method: "POST", json: {} }).catch(() => {});
  await clearSession();
}

/** Link mágico por email (mesma API do web). O link chega no email do usuário. */
export async function sendMagicLink(email: string) {
  const res = await api("/api/auth/sign-in/magic-link", { method: "POST", json: { email, callbackURL: "/app" } });
  if (!res.ok) throw new Error("Falha ao enviar o link mágico");
  return res.data;
}

/**
 * Login social: abre o fluxo OAuth do backend no navegador do sistema.
 * (A conclusão nativa via deep-link é um próximo passo; por ora abre no browser.)
 */
export async function socialSignIn(provider: "google" | "github") {
  const base = await getBaseUrl();
  await Linking.openURL(`${base}/login`);
  void provider;
}
