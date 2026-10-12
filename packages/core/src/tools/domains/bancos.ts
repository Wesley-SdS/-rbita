import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { enqueueJob } from "../../jobs/queue";
import { visaoDoBanco } from "../../pluggy/servico";
import { paresSugeridosDoDono } from "../../finance/transferencias";
import { carregar, hojeDoServidor } from "../../finance/store";
import { limiaresDaConfig } from "../../finance/config";
import { executar } from "../../finance/comandos";
import { RegraFinanceiraError } from "../../finance/operacoes";
import { brl, dataCurta } from "../../finance/formato";

/**
 * Domínio: bancos conectados pelo Open Finance (Pluggy) e transferências entre
 * as contas do dono. A leitura do extrato roda na fila (pode passar de dez
 * segundos), e o reconhecimento de transferência é o mesmo da tela.
 *
 * Marcar transferência é `escrita` e desfazível, e só acontece com o pedido do
 * dono: o modelo não escolhe sozinho que dois lançamentos são a mesma coisa.
 * Os pares vêm do código (`paresSugeridosDoDono`), então o modelo não inventa id.
 */

const Nada = z.object({});

export const situacao_dos_bancos: ToolDef<typeof Nada> = {
  name: "situacao_dos_bancos",
  domain: "bancos",
  description: "Mostra os bancos conectados pelo Open Finance: quando o banco foi lido pela última vez, se algum precisa de atenção (login recusado, aprovação pendente) e, por conta, o saldo no banco contra o saldo na Órbita. Use para \"meus bancos estão sincronizando?\", \"o saldo do Itaú bate?\".",
  risk: "leitura",
  keywords: ["bancos", "banco", "open finance", "pluggy", "sincroniz", "saldo do banco", "itaú", "nubank", "conectado"],
  requires: { connector: "pluggy" },
  inputSchema: Nada,
  run: async (_i, { userId }) => {
    const v = await visaoDoBanco(userId);
    if (!v.itens.length) return { mensagem: "Nenhum banco conectado ainda. Conecte em Finanças, Ajustes, Bancos." };
    return {
      bancos: v.itens.map((i) => ({
        banco: i.banco,
        lido_pelo_banco_em: i.atualizadoNoBancoEm,
        lido_pela_orbita_em: i.sincronizadoEm,
        precisa_de_atencao: i.aviso ?? i.erro,
        contas: i.contas.map((c) => ({
          nome: c.nome,
          tipo: c.tipo === "CREDIT" ? "cartão de crédito" : "conta",
          sincronizando: !!(c.tipo === "CREDIT" ? c.cartaoId : c.contaId) && c.ativa,
          saldo_no_banco: c.saldoBanco === null ? null : brl(c.saldoBanco),
          saldo_na_orbita: c.saldoOrbita === null ? null : brl(c.saldoOrbita),
          bate: c.saldoBanco !== null && c.saldoOrbita !== null ? c.saldoBanco === c.saldoOrbita : null,
        })),
      })),
    };
  },
};

export const sincronizar_bancos: ToolDef<typeof Nada> = {
  name: "sincronizar_bancos",
  domain: "bancos",
  description: "Lê agora o extrato dos bancos conectados (conta corrente, poupança e cartão) e lança o que for novo, reconhecendo transferências entre as contas do dono. A leitura roda em segundo plano; o resultado aparece nas Finanças. Use para \"atualiza meus bancos\", \"puxa o extrato\".",
  risk: "escrita",
  keywords: ["sincronizar", "atualizar", "extrato", "puxar", "bancos", "open finance", "lançar o que entrou"],
  requires: { connector: "pluggy" },
  inputSchema: Nada,
  run: async (_i, { userId }) => {
    // dois pedidos seguidos não viram duas leituras: o trabalho em andamento responde
    await enqueueJob(userId, { kind: "pluggy.sincronizar", payload: {}, dedupKey: `pluggy-agora:${userId}` });
    return { mensagem: "Pronto, estou lendo seus bancos agora. O que for novo entra nas Finanças em instantes." };
  },
};

async function nomesDasContas(userId: string): Promise<Map<string, string>> {
  const hoje = hojeDoServidor();
  const d = await carregar(userId, hoje, (await limiaresDaConfig()).mesesSemeados);
  return new Map(d.contas.map((c) => [c.id, c.nome]));
}

export const transferencias_sugeridas: ToolDef<typeof Nada> = {
  name: "transferencias_sugeridas",
  domain: "bancos",
  description: "Lista saídas e entradas de mesmo valor em contas diferentes do dono que provavelmente são a MESMA transferência (hoje contam como gasto e como renda). Só sugere; pergunte se ele quer marcar antes de usar marcar_transferencias.",
  risk: "leitura",
  keywords: ["transferência", "transferi", "entre minhas contas", "negativo", "aparece como gasto", "mesmo valor"],
  inputSchema: Nada,
  run: async (_i, { userId }) => {
    const pares = await paresSugeridosDoDono(userId, hojeDoServidor());
    if (!pares.length) return { mensagem: "Não achei saída e entrada de mesmo valor em contas diferentes que pareçam uma transferência." };
    const nomes = await nomesDasContas(userId);
    return {
      total: pares.length,
      pares: pares.map((p) => ({
        saida_id: p.saida.id,
        valor: brl(p.saida.valor),
        saiu_de: nomes.get(p.saida.contaId) ?? "conta apagada",
        saiu_em: dataCurta(p.saida.data),
        entrou_em_conta: nomes.get(p.entrada.contaId) ?? "conta apagada",
        entrou_em: dataCurta(p.entrada.data),
      })),
    };
  },
};

const Marcar = z.object({
  todas: z.boolean().optional().describe("true marca todos os pares sugeridos"),
  saida_ids: z.array(z.string().uuid()).max(200).optional().describe("só os pares destas saídas (os saida_id de transferencias_sugeridas)"),
});

export const marcar_transferencias: ToolDef<typeof Marcar> = {
  name: "marcar_transferencias",
  domain: "bancos",
  description: "Marca como transferência entre contas os pares sugeridos que o dono confirmou: deixam de contar como gasto e como renda e só movem o saldo. Use depois de transferencias_sugeridas e do \"sim\" do dono. Devolve os grupos para desmarcar_transferencias, se ele se arrepender.",
  risk: "escrita",
  keywords: ["marcar transferência", "é transferência", "converter em transferência", "foi só uma movimentação"],
  inputSchema: Marcar,
  summarize: (i) => (i.todas ? "Marcar todos os pares sugeridos como transferência" : `Marcar ${i.saida_ids?.length ?? 0} par(es) como transferência`),
  run: async ({ todas, saida_ids }, { userId }) => {
    if (!todas && !saida_ids?.length) return { erro: "Diga quais: todas as sugeridas, ou os saida_id escolhidos." };
    const sugeridos = await paresSugeridosDoDono(userId, hojeDoServidor());
    const escolhidos = todas ? sugeridos : sugeridos.filter((p) => saida_ids!.includes(p.saida.id));
    if (!escolhidos.length) return { erro: "Esses pares não estão mais entre as sugestões." };
    try {
      const r = await executar(userId, { tipo: "juntar_transferencia", pares: escolhidos.map((p) => ({ saidaId: p.saida.id, entradaId: p.entrada.id })) }, hojeDoServidor());
      return { mensagem: r.mensagem, grupos: r.grupos };
    } catch (e) {
      if (e instanceof RegraFinanceiraError) return { erro: e.message };
      throw e;
    }
  },
};

const Desmarcar = z.object({ grupos: z.array(z.string().uuid()).min(1).max(200).describe("os grupos devolvidos por marcar_transferencias") });

export const desmarcar_transferencias: ToolDef<typeof Desmarcar> = {
  name: "desmarcar_transferencias",
  domain: "bancos",
  description: "Desfaz a marcação de transferência feita agora há pouco: as duas pontas voltam a ser saída e entrada comuns. Só com os grupos devolvidos por marcar_transferencias.",
  risk: "escrita",
  keywords: ["desfazer transferência", "desmarcar", "não era transferência"],
  inputSchema: Desmarcar,
  run: async ({ grupos }, { userId }) => {
    try {
      return { mensagem: (await executar(userId, { tipo: "desjuntar_transferencia", grupos }, hojeDoServidor())).mensagem };
    } catch (e) {
      if (e instanceof RegraFinanceiraError) return { erro: e.message };
      throw e;
    }
  },
};

registerTools([situacao_dos_bancos, sincronizar_bancos, transferencias_sugeridas, marcar_transferencias, desmarcar_transferencias]);
