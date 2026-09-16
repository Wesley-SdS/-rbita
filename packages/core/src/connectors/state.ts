import { createHmac, timingSafeEqual } from "node:crypto";

/** State OAuth anti-CSRF: "<userId>.<ts>.<hmac>" assinado com o segredo do app. */
function key(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET ausente");
  return s;
}

export function signState(userId: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}.${ts}`;
  const mac = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Valida o state e devolve o userId, ou null se inválido/expirado (10 min). */
export function verifyState(state: string | null): string | null {
  if (!state) return null;
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [userId, ts, mac] = parts;
  const expected = createHmac("sha256", key()).update(`${userId}.${ts}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(ts) > 10 * 60_000) return null;
  return userId;
}
