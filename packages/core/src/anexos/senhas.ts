import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@orbita/db";
import { anexoSenha } from "@orbita/db/anexo-schema";
import { decryptSecret, encryptSecret } from "../crypto";
import { log } from "../observability/logger";
import { semPontuacaoFinal } from "../arquivos/texto";
import { autenticadoPor, mesmoDominio } from "../emails/banco";

/**
 * Senhas de anexo por remetente (PRD de anexos, C5).
 *
 * Fatura e extrato de banco chegam em PDF protegido (os primeiros dígitos do
 * CPF, a data de nascimento). O dono cadastra a senha UMA vez, na tela, para
 * o domínio do remetente, e a Órbita tenta sozinha as senhas daquele domínio.
 *
 * Três regras, todas de propósito:
 *   - a senha só entra pela TELA (rota com sessão), nunca por tool: pelo chat
 *     ou pela voz ela ficaria no histórico e passaria pelo modelo;
 *   - cifrada em repouso com a chave dos conectores (`crypto.ts`);
 *   - nunca volta para fora: a listagem mostra domínio e rótulo, o log não a
 *     registra, e a mensagem de "não abriu" não diz qual foi tentada.
 */

export class SenhaDeAnexoInvalidaError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SenhaDeAnexoInvalidaError";
  }
}

/** "Nubank <todomundo@nubank.com.br>" → "nubank.com.br". PURO. */
export function dominioDoRemetente(de: string | null | undefined): string | null {
  // o From é de quem mandou: nada de regex com repetição aqui. `/<([^>]+)>/` e
  // `/[>\s]+$/` recomeçavam a varredura a cada `<` ou espaço, e 40 mil deles
  // paravam o laço principal por 10 s (B2 da auditoria de 11/10/2026)
  const bruto = (de ?? "").slice(0, 2000);
  const abre = bruto.indexOf("<");
  const fecha = abre >= 0 ? bruto.indexOf(">", abre + 1) : -1;
  const m = abre >= 0 && fecha > abre + 1 ? bruto.slice(abre + 1, fecha) : bruto;
  const arroba = m.lastIndexOf("@");
  if (arroba < 0) return null;
  const d = semPontuacaoFinal(m.slice(arroba + 1).toLowerCase(), "> \t\r\n").trim();
  return d.length <= 253 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) ? d : null;
}

/**
 * O que o dono digitou vira um domínio: aceita "nubank.com.br",
 * "@nubank.com.br", "todomundo@nubank.com.br" e "https://www.nubank.com.br".
 * PURO; null quando não dá para entender.
 */
export function normalizarDominio(entrada: string): string | null {
  let s = entrada.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(s) ? s : null;
}

/** A senha cadastrada para "nubank.com.br" vale para "fatura.nubank.com.br", e não para "nubank.com.br.golpe.io". PURO. */
export function dominioCasa(cadastrado: string, remetente: string): boolean {
  return remetente === cadastrado || remetente.endsWith(`.${cadastrado}`);
}

export interface SenhaListada {
  id: string;
  dominio: string;
  rotulo: string | null;
  criadaEm: Date;
  usadaEm: Date | null;
}

export async function listarSenhas(userId: string): Promise<SenhaListada[]> {
  return db
    .select({ id: anexoSenha.id, dominio: anexoSenha.dominio, rotulo: anexoSenha.rotulo, criadaEm: anexoSenha.criadaEm, usadaEm: anexoSenha.usadaEm })
    .from(anexoSenha)
    .where(eq(anexoSenha.userId, userId))
    .orderBy(asc(anexoSenha.dominio), asc(anexoSenha.criadaEm));
}

export async function cadastrarSenha(userId: string, entrada: { dominio: string; senha: string; rotulo?: string | null }): Promise<SenhaListada> {
  const dominio = normalizarDominio(entrada.dominio);
  if (!dominio) throw new SenhaDeAnexoInvalidaError("Não entendi o remetente. Use o domínio do e-mail, como nubank.com.br.");
  if (!entrada.senha || entrada.senha.length > 200) throw new SenhaDeAnexoInvalidaError("Digite a senha (até 200 caracteres).");
  const [row] = await db
    .insert(anexoSenha)
    .values({ userId, dominio, rotulo: entrada.rotulo?.trim().slice(0, 80) || null, senhaEnc: encryptSecret(entrada.senha) })
    .returning({ id: anexoSenha.id, dominio: anexoSenha.dominio, rotulo: anexoSenha.rotulo, criadaEm: anexoSenha.criadaEm, usadaEm: anexoSenha.usadaEm });
  log.info("anexos.senha_cadastrada", { userId, dominio });
  return row!;
}

export async function apagarSenha(userId: string, id: string): Promise<boolean> {
  const r = await db.delete(anexoSenha).where(and(eq(anexoSenha.userId, userId), eq(anexoSenha.id, id))).returning({ id: anexoSenha.id });
  return r.length > 0;
}

/**
 * As senhas a tentar num anexo deste remetente, já decifradas, só em memória.
 * Uma senha que não decifra (chave trocada) é pulada em silêncio: o log diz
 * qual linha, nunca o conteúdo.
 */
export async function senhasDoRemetente(userId: string, remetente: string | null | undefined, opts: { autenticacao?: string | null } = {}): Promise<{ ids: string[]; senhas: string[]; naoAutenticado?: boolean }> {
  const dominio = dominioDoRemetente(remetente);
  if (!dominio) return { ids: [], senhas: [] };
  // O From é escrito por quem manda: sem conferir, qualquer um que escrevesse "@nubank.com.br"
  // faria a Órbita tentar a senha do dono no arquivo DELE, e o "abriu ou não" vira um oráculo
  // para adivinhar a senha (dígitos de CPF são poucos). Vale a mesma regra das movimentações
  // de banco (`emails/banco.ts`): DKIM `pass` DESSE domínio no `Authentication-Results` que o
  // servidor de quem recebeu escreveu. Sem o cabeçalho (e-mail interno, provedor que não o
  // entrega), a senha é tentada como antes (M13).
  const autenticacao = (opts.autenticacao ?? "").trim();
  if (autenticacao && !assinadoPeloRemetente(autenticacao, dominio)) return { ids: [], senhas: [], naoAutenticado: true };
  const linhas = await db.select({ id: anexoSenha.id, dominio: anexoSenha.dominio, senhaEnc: anexoSenha.senhaEnc }).from(anexoSenha).where(eq(anexoSenha.userId, userId));
  const ids: string[] = [];
  const senhas: string[] = [];
  for (const l of linhas) {
    if (!dominioCasa(l.dominio, dominio)) continue;
    try {
      senhas.push(decryptSecret(l.senhaEnc));
      ids.push(l.id);
    } catch {
      log.warn("anexos.senha_ilegivel", { id: l.id });
    }
  }
  return { ids, senhas };
}

/**
 * O e-mail veio assinado (DKIM `pass`) pelo domínio do From? Como o
 * `autenticadoPor` das movimentações de banco, e também no alinhamento
 * "relaxado" do DMARC: a fatura de "fatura.nubank.com.br" assinada por
 * "nubank.com.br" vale (o banco assina pelo domínio de cima). Quem assina com
 * o domínio dele (o golpista) não passa. PURO.
 */
export function assinadoPeloRemetente(authResults: string, dominio: string): boolean {
  if (autenticadoPor(authResults, dominio)) return true;
  for (const trecho of authResults.slice(0, 8000).split(";")) {
    if (!/\bdkim=pass\b/i.test(trecho)) continue;
    const d = /header\.d=([a-z0-9.-]{1,253})/i.exec(trecho)?.[1]?.toLowerCase();
    if (d && d.includes(".") && mesmoDominio(dominio, d)) return true;
  }
  return false;
}

export async function marcarSenhasUsadas(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db.update(anexoSenha).set({ usadaEm: new Date() }).where(and(eq(anexoSenha.userId, userId), inArray(anexoSenha.id, ids)));
}
