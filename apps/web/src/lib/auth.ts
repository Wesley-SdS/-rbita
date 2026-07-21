import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/lib/db";
import { user, session, account, verification } from "@/lib/db/auth-schema";
import { log } from "@/lib/observability/logger";
import { trustedOrigins } from "@/lib/auth-origins";

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
