import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { user, session, account, verification } from "@/lib/db/auth-schema";
import { log } from "@/lib/observability/logger";

/** Provedores sociais ativados conforme as credenciais presentes no ambiente. */
function socialProviders() {
  const p: Record<string, { clientId: string; clientSecret: string }> = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    p.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    p.github = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET };
  }
  return Object.keys(p).length ? p : undefined;
}

/** Envia o link mágico por email (Resend se configurado; senão loga no servidor — dev). */
async function sendMagicLink(email: string, url: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.info("auth.magiclink.dev", { email, url }); // sem email configurado → link vai pro log
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Órbita <onboarding@resend.dev>",
      to: email,
      subject: "Seu link de acesso à Órbita",
      html: `<p>Toque para entrar na Órbita:</p><p><a href="${url}">${url}</a></p><p>O link expira em breve. Se não foi você, ignore.</p>`,
    }),
  });
}

/**
 * Origens confiáveis (anti-CSRF do Better Auth). Além do baseURL, confia em
 * localhost e em IPs da REDE LOCAL (LAN) — o app mobile acessa o backend pelo
 * IP do PC (ex.: http://192.168.x.x:3000), que é uma origem diferente e sem
 * isso é rejeitada com "Invalid origin". App pessoal local-first → confiar na
 * LAN é aceitável. Extra: `TRUSTED_ORIGINS` (lista separada por vírgula).
 */
const LAN_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;
/** Remove barra final: o Better Auth compara origens como string exata. */
const cleanOrigin = (u: string) => u.trim().replace(/\/+$/, "");

function trustedOrigins(request?: Request): string[] {
  const list = new Set<string>(["http://localhost:3000", "http://127.0.0.1:3000"]);
  if (process.env.BETTER_AUTH_URL) list.add(cleanOrigin(process.env.BETTER_AUTH_URL));
  // Vercel: a MESMA app responde por vários domínios (produção, branch e cada
  // deploy). Sem isso, acessar por um alias diferente do BETTER_AUTH_URL dá
  // "Invalid origin". Estas variáveis são fornecidas pela Vercel em runtime.
  for (const host of [
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ]) {
    if (host) list.add(`https://${cleanOrigin(host)}`);
  }
  for (const o of (process.env.TRUSTED_ORIGINS ?? "").split(",").map(cleanOrigin).filter(Boolean)) list.add(o);
  const origin = request?.headers.get("origin");
  if (origin && LAN_ORIGIN.test(origin)) list.add(origin);
  return [...list];
}

/**
 * Allowlist de CADASTRO. Sem ela, qualquer pessoa com a URL cria conta num
 * assistente pessoal (que acessa e-mail, agenda e finanças) e ainda consome a
 * assinatura de IA do dono. Defina `ALLOWED_EMAILS` (separados por vírgula) em
 * qualquer deploy público. Lista vazia = aberto, aceitável só no self-host local.
 * Vale para todos os caminhos (senha, social e magic link), pois todos passam
 * pela criação do usuário.
 */
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function signupAllowed(email: string): boolean {
  if (!ALLOWED_EMAILS.length) return true;
  return ALLOWED_EMAILS.includes(email.trim().toLowerCase());
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          if (!signupAllowed(newUser.email)) {
            log.warn("auth.signup_blocked", { email: newUser.email });
            throw new APIError("FORBIDDEN", { message: "Cadastro restrito ao dono desta instância." });
          }
          return { data: newUser };
        },
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders: socialProviders(),
  plugins: [magicLink({ sendMagicLink: async ({ email, url }) => sendMagicLink(email, url) })],
});

export type Session = typeof auth.$Infer.Session;
