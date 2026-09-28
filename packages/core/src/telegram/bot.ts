import { settings } from "../settings";
import { definirComandos, eu, TelegramErro } from "./api";
import * as store from "./store";

/**
 * Ligar e desligar o bot do dono. O token é conferido no próprio Telegram
 * (`getMe`) antes de ser gravado, cifrado: token errado é recado na tela, não
 * um laço que falha a cada volta.
 */

const FORMATO_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

export class BotInvalido extends Error {}

export async function conectarBot(userId: string, token: string): Promise<{ username: string }> {
  const t = token.trim();
  if (!FORMATO_TOKEN.test(t)) throw new BotInvalido("Isso não parece um token de bot. Copie do @BotFather a linha inteira (números, dois-pontos e letras).");
  let info;
  try {
    info = await eu(t);
  } catch (e) {
    if (e instanceof TelegramErro && e.codigo === 401) throw new BotInvalido("O Telegram recusou esse token. Gere outro no @BotFather (/token).");
    throw e;
  }
  if (!info.is_bot || !info.username) throw new BotInvalido("Esse token não é de um bot.");
  await store.salvarBot(userId, t, { id: info.id, username: info.username });
  await definirComandos(t);
  return { username: info.username };
}

export async function desconectarBot(userId: string): Promise<void> {
  // os contatos e as mensagens ficam (são a conversa do dono); só o bot sai
  await store.apagarBot(userId);
}

/** Link de convite t.me/<bot>?start=<código>: o dono abre no próprio celular, ou manda para a pessoa da casa. */
export async function criarLinkDeConvite(userId: string, papel: "dono" | "pessoa", personId: string | null): Promise<{ link: string; expiraEm: Date }> {
  const bot = await store.botDe(userId);
  if (!bot) throw new BotInvalido("Conecte o bot primeiro.");
  if (papel === "pessoa" && !personId) throw new BotInvalido("Escolha a pessoa da casa.");
  const { codigo, expiraEm } = await store.criarConvite(userId, papel, personId, await settings.get("telegram.conviteMinutos"));
  return { link: `https://t.me/${bot.username}?start=${codigo}`, expiraEm };
}
