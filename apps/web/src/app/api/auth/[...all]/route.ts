import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { rateLimit, clientIp, tooMany } from "@/lib/ratelimit";

const handlers = toNextJsHandler(auth);

export const GET = handlers.GET;

/**
 * POST cobre sign-in/sign-up: rate limit por IP contra brute force /
 * credential stuffing (o Better Auth não faz lockout por conta própria).
 */
export async function POST(req: Request) {
  const r = rateLimit(`auth:${clientIp(req)}`, 10, 60_000); // 10/min por IP
  if (!r.ok) return tooMany(r.retryAfterSec);
  return handlers.POST(req);
}
