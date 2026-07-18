import { api, clearSession } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export async function signUp(name: string, email: string, password: string) {
  const res = await api("/api/auth/sign-up/email", { method: "POST", json: { name, email, password } });
  if (!res.ok) throw new Error("Falha ao criar conta");
  return res.data;
}

export async function signIn(email: string, password: string) {
  const res = await api("/api/auth/sign-in/email", { method: "POST", json: { email, password } });
  if (!res.ok) throw new Error("E-mail ou senha inválidos");
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
