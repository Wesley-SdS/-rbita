import { invalidar } from "@/lib/dados/cache";
import type { Proposta } from "@orbita/core/finance/ditado";
import type { BoletoLido, LinhaParaImportar } from "@orbita/core/finance/entradas";

/**
 * A única porta da tela para GRAVAR dinheiro: `POST /api/financas` com um
 * comando (o mesmo que o chat e a voz usam). A validação e as mensagens são
 * do backend; aqui só se transporta e se avisa o cache.
 */

export interface Resultado {
  mensagem: string;
  desfazerId?: string | null;
  mes?: string | null;
  id?: string | null;
  aviso?: string | null;
}

export type Resposta<T> = { ok: true; dado: T } | { ok: false; erro: string };

/**
 * As leituras que um comando pode ter mudado. Lista, e não o prefixo
 * `/api/financas/`, porque as FOTOS moram sob o mesmo prefixo e pesam: um
 * lançamento de café não pode rebaixar de novo a galeria da reforma.
 */
export const VISTAS = ["painel", "extrato", "contas", "cartoes", "metas", "meta", "previsao", "historico", "cadastros"] as const;
export type Vista = (typeof VISTAS)[number];

export function invalidarFinancas(): void {
  invalidar(...VISTAS.map((v) => `/api/financas/${v}`));
}

async function postar<T>(url: string, corpo: unknown): Promise<Resposta<T>> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." };
  }
  const dado = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !dado) return { ok: false, erro: dado?.error ?? "Não consegui salvar agora." };
  return { ok: true, dado };
}

/** Manda um comando e, se deu certo, marca as vistas como velhas. */
export async function enviarComando(cmd: { tipo: string } & Record<string, unknown>): Promise<Resposta<Resultado>> {
  const r = await postar<Resultado>("/api/financas", cmd);
  if (r.ok) invalidarFinancas();
  return r;
}

/** Ditado, boleto e extrato: entendem, NÃO gravam (a pessoa confere antes). */
export const entender = (texto: string) => postar<{ propostas: Proposta[] }>("/api/financas/entrada", { acao: "ditado", texto });
export const lerBoletoPelaLinha = (linha: string) => postar<BoletoLido>("/api/financas/entrada", { acao: "boleto", linha });
export const lerBoletoPeloPdf = (pdf: string) => postar<BoletoLido>("/api/financas/entrada", { acao: "boleto_pdf", pdf });
export const lerExtrato = (conteudo: string) =>
  postar<{ linhas: LinhaParaImportar[]; repetidas: number }>("/api/financas/entrada", { acao: "extrato", conteudo });

export async function restaurarBackup(backup: unknown): Promise<Resposta<{ mensagem: string }>> {
  const r = await postar<{ mensagem: string }>("/api/financas/restaurar", { backup });
  if (r.ok) invalidarFinancas();
  return r;
}

/** URL de uma leitura, com os parâmetros vazios de fora (a chave do cache é a própria URL). */
export function urlDaVista(vista: Vista, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return `/api/financas/${vista}${s ? `?${s}` : ""}`;
}
