import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import {
  finPerfil, finConta, finCartao, finCategoria, finLancamento, finCompromisso, finPagamentoFatura, finDivida,
  finDividaPagamento, finDividaRolagem, finMeta, finMetaItem, finMetaFoto, finAtalho, finRegra, finDesfazer,
} from "@orbita/db/finance-schema";
import { planoDeRestauracao, exportarBackup, type BackupAntigo } from "./backup";
import { carregar } from "./store";
import { CONTAS_INICIAIS } from "./padroes";
import type { Ymd } from "./calendario";

/**
 * Backup JSON (PRD §9.2 e §9.4). O formato é o do app antigo, de propósito:
 * é por ele que os dados que o dono já tinha no "Freio de Mão" entram na
 * Órbita, e o backup daqui volta para lá (critério 14.13).
 */

export async function backupDoDono(userId: string, hoje: Ymd): Promise<BackupAntigo> {
  const dados = await carregar(userId, hoje, 0);
  const fotos = await db.select({ id: finMetaFoto.id, itemId: finMetaFoto.itemId, dado: finMetaFoto.dado }).from(finMetaFoto).where(eq(finMetaFoto.userId, userId));
  return exportarBackup(dados, fotos);
}

/**
 * Substitui TODO o financeiro do dono pelo backup, numa transação só: um
 * backup que quebra na metade não pode deixar o dono sem nada. A validação
 * (e a manutenção da §4.3) roda antes de apagar qualquer coisa.
 */
export async function restaurarBackup(userId: string, json: unknown): Promise<{ mensagem: string; lancamentos: number }> {
  const p = planoDeRestauracao(json, () => crypto.randomUUID());
  const comDono = <T extends object>(ls: T[]) => ls.map((l) => ({ ...l, userId }));
  await db.transaction(async (tx) => {
    // filhos com cascade (itens, fotos, pagamentos de dívida) caem junto com o pai
    for (const t of [finLancamento, finCompromisso, finPagamentoFatura, finDivida, finMeta, finAtalho, finRegra, finDesfazer, finCartao, finConta, finCategoria, finPerfil]) {
      await tx.delete(t).where(eq(t.userId, userId));
    }
    // a linha de perfil já marca o legado como importado: a tabela antiga não volta por cima do backup
    await tx.insert(finPerfil).values({ userId, renda: p.perfil.renda, teto: p.perfil.teto, boasVindasVistas: true, legadoImportadoEm: new Date() });
    const inserir = async <T extends object>(tabela: Parameters<typeof tx.insert>[0], linhas: T[]) => {
      // em lotes: um backup de anos passa do limite de parâmetros de uma consulta só
      for (let i = 0; i < linhas.length; i += 500) await tx.insert(tabela).values(comDono(linhas.slice(i, i + 500)) as never);
    };
    // um backup sem conta deixaria o app sem onde lançar (a tela exige pelo menos uma)
    await inserir(finConta, p.contas.length ? p.contas : CONTAS_INICIAIS.map((c, i) => ({ ...c, saldoInicial: 0, ordem: i })));
    await inserir(finCartao, p.cartoes);
    await inserir(finCategoria, p.categorias);
    await inserir(finLancamento, p.lancamentos);
    await inserir(finCompromisso, p.compromissos);
    await inserir(finPagamentoFatura, p.pagamentosFatura);
    await inserir(finDivida, p.dividas);
    await inserir(finDividaPagamento, p.dividaPagamentos);
    await inserir(finDividaRolagem, p.dividaRolagens);
    await inserir(finMeta, p.metas);
    await inserir(finMetaItem, p.metaItens);
    await inserir(finMetaFoto, p.metaFotos);
    await inserir(finAtalho, p.atalhos);
    await inserir(finRegra, p.regras);
  });
  return { mensagem: "Backup restaurado.", lancamentos: p.lancamentos.length };
}
