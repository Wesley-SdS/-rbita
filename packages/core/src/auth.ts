import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@orbita/db";
import { user, session, account, verification } from "@orbita/db/auth-schema";
import { log } from "./observability/logger";
import { trustedOrigins } from "./auth-origins";
import { settings } from "./settings";
import { getOwnerId } from "./owner";

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
 * CADASTRO FECHADO POR PADRÃO (Onda 1, B0.2). Sem isso, qualquer pessoa com a
 * URL cria conta num assistente pessoal (que acessa e-mail, agenda e finanças)
 * e ainda consome a assinatura de IA do dono.
 *
 * Modo `auth.signupMode` (tela de ajustes):
 *   auto   → o PRIMEIRO cadastro é o dono; depois só e-mails da lista
 *   open   → aberto (aceitável só na rede local)
 *   closed → só e-mails da lista
 * A lista `auth.allowedEmails` vive no banco; `ALLOWED_EMAILS` do .env entra
 * como bootstrap (somado à lista). Vale para todos os caminhos (senha, social
 * e magic link), pois todos passam pela criação do usuário.
 */
const ENV_ALLOWED = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export async function signupAllowed(email: string): Promise<boolean> {
  const cfg = await settings.getMany(["auth.signupMode", "auth.allowedEmails"]);
  const allowed = new Set([...ENV_ALLOWED, ...cfg["auth.allowedEmails"].map((s) => s.toLowerCase())]);
  const e = email.trim().toLowerCase();
  if (allowed.has(e)) return true;
  // recuperação de instância órfã: quem o ambiente aponta como dono precisa conseguir criar a conta
  if (process.env.ORBITA_OWNER_EMAIL && process.env.ORBITA_OWNER_EMAIL.trim().toLowerCase() === e) return true;
  if (cfg["auth.signupMode"] === "open") return true;
  if (cfg["auth.signupMode"] === "closed") return false;
  // auto: aberto só enquanto não existe ninguém (o dono ainda não se cadastrou)
  const [primeiro] = await db.select({ id: user.id }).from(user).limit(1);
  return !primeiro;
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins,
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          if (!(await signupAllowed(newUser.email))) {
            log.warn("auth.signup_blocked", { email: newUser.email });
            throw new APIError("FORBIDDEN", { message: "Cadastro restrito ao dono desta instância." });
          }
          return { data: newUser };
        },
        // grava a posse já no primeiro cadastro (RV.1): sem linha em instance_owner,
        // apagar a conta do dono antes de alguém abrir os ajustes promoveria outra conta
        after: async () => {
          await getOwnerId().catch((e) => log.warn("owner.claim_falhou", { error: e instanceof Error ? e.message : String(e) }));
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
