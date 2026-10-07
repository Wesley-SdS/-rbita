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

async function postar<T>(url: string, corpo: unknown): Promise<Resposta<T> & { repetido?: { novos: number } }> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." };
  }
  const dado = (await r.json().catch(() => null)) as (T & { error?: string; repetido?: boolean; novos?: number }) | null;
  if (r.status === 409 && dado?.repetido) return { ok: false, erro: dado.error ?? "Já tem um lançamento igual.", repetido: { novos: dado.novos ?? 0 } };
  if (!r.ok || !dado) return { ok: false, erro: dado?.error ?? "Não consegui salvar agora." };
  return { ok: true, dado };
}

/**
 * Manda um comando e, se deu certo, marca as vistas como velhas.
 *
 * Lançamento igual a um que já existe volta como PERGUNTA (409), como o banco
 * faz num Pix repetido: aqui ela vira a confirmação do sistema (§6.0.8) e, se
 * a pessoa disser que sim, o comando vai de novo com `repetir`. No lote
 * (ditado) dá para escolher lançar só os que não estavam lançados.
 */
export async function enviarComando(cmd: { tipo: string } & Record<string, unknown>): Promise<Resposta<Resultado>> {
  let r = await postar<Resultado>("/api/financas", cmd);
  if (!r.ok && r.repetido && typeof window !== "undefined") {
    if (window.confirm(`${r.erro}\n\nOK lança de novo. Cancelar não lança${r.repetido.novos ? " os repetidos" : ""}.`)) {
      r = await postar<Resultado>("/api/financas", { ...cmd, repetir: true });
    } else if (r.repetido.novos && window.confirm(`Lançar só os outros ${r.repetido.novos}, que ainda não estavam lançados?`)) {
      r = await postar<Resultado>("/api/financas", { ...cmd, pularRepetidos: true });
    } else {
      return { ok: false, erro: "Nada foi lançado." };
    }
  }
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
