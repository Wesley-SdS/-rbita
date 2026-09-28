import { z } from "zod";
import { lerDeTodasAsContas } from "../connectors/multi";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { buscarNaAgenda, chaveDe, juntarContas, normalizarTelefone, type ContatoAgenda } from "./casar";
import { listarContatosGoogle } from "./google";

/**
 * A agenda do dono (Google Contatos), com cache em memória.
 *
 * Em memória e não numa tabela de propósito: é uma CÓPIA de dado pessoal que
 * já mora no Google, e guardar de novo no banco seria mais uma coisa para
 * exportar, apagar e vazar. O custo é buscar de novo quando o processo sobe,
 * uma chamada por conta (mil contatos por página).
 *
 * É ela que faz "manda para a Maria" achar a Maria que nunca escreveu no
 * WhatsApp, "e-mail pro João" achar o e-mail, e o briefing lembrar aniversário.
 */

/** Leitura que falhou (sem escopo, Google lento) ou veio pela metade: tenta de novo logo, não em horas. */
const FALHA_MS = 5 * 60_000;

const cache = new Map<string, { em: number; validoPorMs: number; contatos: ContatoAgenda[] }>();
/** a leitura em andamento: o briefing e o chat pedindo juntos fazem UMA ida ao Google */
const lendo = new Map<string, Promise<ContatoAgenda[]>>();

/** "Atualizar agora", desconectar o Google, apagar a conta: a próxima leitura vai ao Google. */
export function esquecerAgenda(userId?: string): void {
  if (userId) {
    cache.delete(userId);
    lendo.delete(userId);
  } else {
    cache.clear();
    lendo.clear();
  }
}

export async function contatosDaAgenda(userId: string): Promise<ContatoAgenda[]> {
  const cfg = await settings.getMany(["contatos.usarGoogle", "contatos.cacheMinutos", "contatos.maximo"]);
  if (!cfg["contatos.usarGoogle"]) return [];
  const guardado = cache.get(userId);
  if (guardado && Date.now() - guardado.em < guardado.validoPorMs) return guardado.contatos;
  const emAndamento = lendo.get(userId);
  if (emAndamento) return emAndamento;

  const leitura = (async () => {
    try {
      const r = await lerDeTodasAsContas("google", userId, async (t) => {
        try {
          return await listarContatosGoogle(t, cfg["contatos.maximo"]);
        } catch (e) {
          // o multi engole o motivo; sem isto um 403 de escopo seria invisível
          log.warn("contatos.conta_falhou", { userId, motivo: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
          throw e;
        }
      });
      const contatos = juntarContas(r.itens);
      // Leitura pela metade (uma conta falhou) vale pouco tempo: a "Maria" da
      // conta que falhou sumiria por horas, e a outra Maria viraria acerto único
      const validoPorMs = r.falhas.length ? FALHA_MS : cfg["contatos.cacheMinutos"] * 60_000;
      if (r.contas > 0) cache.set(userId, { em: Date.now(), validoPorMs, contatos });
      return contatos;
    } catch (e) {
      log.warn("contatos.leitura_falhou", { userId, motivo: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
      // fail-soft: sem a agenda, a Órbita só perde o atalho, não o pedido. E a
      // falha também fica guardada um pouco, para não martelar o Google a cada chamada
      const antigos = guardado?.contatos ?? [];
      cache.set(userId, { em: Date.now(), validoPorMs: FALHA_MS, contatos: antigos });
      return antigos;
    } finally {
      lendo.delete(userId);
    }
  })();
  lendo.set(userId, leitura);
  return leitura;
}

const listaCurta = (cs: readonly ContatoAgenda[], detalhe: (c: ContatoAgenda) => string) =>
  cs.slice(0, 8).map((c) => `${c.nome}${detalhe(c) ? ` (${detalhe(c)})` : ""}`).join("; ");

const Email = z.string().email().max(320);

/**
 * "o João" → o e-mail dele. Endereço de e-mail passa direto (validado). Só
 * casamento FORTE (apelido, nome, palavra inteira): "Ana" não vira "Juliana".
 * Ambíguo nunca escolhe: dois Joões, ou um João com dois e-mails, viram pergunta.
 */
export async function resolverEmail(userId: string, para: string): Promise<{ ok: true; email: string; nome: string | null } | { ok: false; erro: string }> {
  const p = para.trim();
  // "João <joao@x.com>" ou só o endereço: já está resolvido
  const endereco = /<([^>]+@[^>]+)>/.exec(p)?.[1] ?? (p.includes("@") ? p : null);
  if (endereco) {
    const e = Email.safeParse(endereco.trim());
    if (!e.success) return { ok: false, erro: `"${endereco.trim()}" não é um endereço de e-mail válido.` };
    // o nome do resumo vem da AGENDA, nunca do que o modelo escreveu
    const dono = (await contatosDaAgenda(userId)).find((c) => c.emails.some((x) => x.toLowerCase() === e.data.toLowerCase()));
    return { ok: true, email: e.data, nome: dono?.nome ?? null };
  }
  const achados = buscarNaAgenda(await contatosDaAgenda(userId), p, { soForte: true }).filter((c) => c.emails.length);
  if (!achados.length) return { ok: false, erro: `Não achei e-mail de "${p}" nos contatos do Google. Peça o endereço ao dono.` };
  if (achados.length > 1) return { ok: false, erro: `Há mais de um contato para "${p}": ${listaCurta(achados, (c) => c.emails[0])}. Pergunte qual.` };
  const c = achados[0];
  if (c.emails.length > 1) return { ok: false, erro: `${c.nome} tem mais de um e-mail na agenda: ${c.emails.join(", ")}. Pergunte qual.` };
  return { ok: true, email: c.emails[0], nome: c.nome };
}

/** Celular brasileiro: 55 + DDD + 9 + oito dígitos. */
const ehCelularBr = (n: string) => /^55\d{2}9\d{8}$/.test(n);

export interface CandidatoDaAgenda {
  nome: string;
  /** os números desta pessoa que servem para WhatsApp (celular primeiro) */
  numeros: string[];
  /** a pessoa só tem fixo: o resumo da aprovação precisa dizer */
  soFixo: boolean;
}

/**
 * Quem na agenda casa com o nome, e por quais números. Só casamento FORTE:
 * quem chama é o ENVIO, e "Ana" contida em "Juliana" não pode decidir sozinha.
 */
export async function candidatosDaAgenda(userId: string, termo: string): Promise<CandidatoDaAgenda[]> {
  return buscarNaAgenda(await contatosDaAgenda(userId), termo, { soForte: true })
    .map((c) => {
      const numeros = [...new Map(c.telefones.map(normalizarTelefone).filter((n): n is string => !!n).map((n) => [chaveDe(n), n])).values()];
      // fixo e celular na mesma ficha é o caso comum: o WhatsApp é o celular
      const celulares = numeros.filter(ehCelularBr);
      return { nome: c.nome, numeros: celulares.length ? celulares : numeros, soFixo: !celulares.length && numeros.length > 0 && numeros.every((n) => n.startsWith("55")) };
    })
    .filter((x) => x.numeros.length);
}

/**
 * Para as tools de e-mail (Gmail e Outlook): recusa ANTES de enfileirar
 * quando "o João" não vira um endereço só. Assim a proposta ambígua nem chega
 * à fila de aprovação.
 */
export async function conferirEmail(input: { para: string }, ctx: { userId: string }): Promise<string | null> {
  const r = await resolverEmail(ctx.userId, input.para);
  return r.ok ? null : r.erro;
}

/**
 * Fixa o endereço na hora de PROPOR: o dono aprova "João Silva
 * <joao@x.com>", e é esse endereço que sai, mesmo que a agenda mude entre
 * propor e aprovar (o mesmo motivo do `preparar` do WhatsApp).
 *
 * O `para_nome` do modelo é DESCARTADO sempre: um e-mail com injeção fazia o
 * modelo propor `para: "x@golpe.com", para_nome: "Mãe"`, e o dono aprovaria
 * "Mãe <x@golpe.com>" confiando no nome. O nome do resumo é só o da agenda.
 */
export async function fixarEmail<T extends { para: string; para_nome?: string | null }>(input: T, ctx: { userId: string }): Promise<T> {
  const r = await resolverEmail(ctx.userId, input.para);
  return r.ok ? { ...input, para: r.email, para_nome: r.nome } : { ...input, para_nome: null };
}

/** "João Silva <joao@x.com>" para o resumo da fila; só o endereço quando não há nome. */
export const destinoDoEmail = (i: { para: string; para_nome?: string | null }) => (i.para_nome ? `${i.para_nome} <${i.para}>` : i.para);
