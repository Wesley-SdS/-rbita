import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { emailsDe } from "../../emails/servico";
import { enqueueJob } from "../../jobs/queue";
import { remetenteLegivel } from "../../meetings/aviso-de-email";
import type { Categoria } from "../../emails/triagem";

/**
 * Domínio: os e-mails já separados em ação, úteis e ruído, de todas as
 * caixas (`emails/servico.ts`). É a tool para "o que chegou de importante?",
 * "tenho e-mail para responder?": responde do que a triagem guardou, sem ler
 * as caixas de novo. `ler_emails` continua para o e-mail cru de uma busca.
 *
 * O resultado vem por aba, que é o formato que vira o cartão com abas na mesa
 * da voz e na conversa (`chat/cartoes-da-tela.ts`).
 */

const ABAS: Categoria[] = ["acao", "util", "ruido"];

const Consulta = z.object({
  aba: z.enum(["acao", "util", "ruido", "todas"]).optional().describe("acao (pede algo de você), util, ruido; sem aba, as três"),
});

export const meus_emails: ToolDef<typeof Consulta> = {
  name: "meus_emails",
  domain: "emails",
  description:
    "Os e-mails de todas as caixas do dono já separados em AÇÃO (pede algo dele), ÚTEIS e RUÍDO, com a tarefa que cada ação virou e as movimentações do banco. Use para \"tenho e-mail para responder?\", \"o que chegou de importante?\", \"meus e-mails\".",
  risk: "leitura",
  keywords: ["email", "e-mail", "emails", "caixa", "responder", "chegou", "importante", "ação", "inbox"],
  inputSchema: Consulta,
  run: async ({ aba }, { userId }) => {
    const pedidas = !aba || aba === "todas" ? ABAS : [aba];
    const porAba: Record<string, unknown[]> = {};
    let contagem: Record<Categoria, number> = { acao: 0, util: 0, ruido: 0 };
    for (const a of pedidas) {
      const r = await emailsDe(userId, a, a === "ruido" ? 10 : 15);
      contagem = r.contagem;
      porAba[a] = r.itens.map((e) => ({
        id: e.id,
        de: remetenteLegivel(e.de),
        assunto: e.assunto,
        resumo: e.resumo ?? e.trecho.slice(0, 200),
        recebido_em: e.recebidoEm.toISOString(),
        conta: e.conta,
        tarefa: e.oQueFazer,
        prazo: e.prazo,
        tarefa_criada: Boolean(e.tarefaId),
        movimentacao: e.movimentacao ? { ...e.movimentacao, situacao: e.lancamento } : null,
        link: e.link,
      }));
    }
    return { contagem, ...porAba };
  },
};

export const atualizar_meus_emails: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "atualizar_meus_emails",
  domain: "emails",
  description: "Lê as caixas agora, sem esperar a próxima volta, e separa o que chegou de novo.",
  risk: "escrita",
  keywords: ["atualizar", "email", "e-mail", "caixa", "agora"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    await enqueueJob(userId, { kind: "emails.triar", payload: {}, dedupKey: `emails-agora:${userId}` });
    return { mensagem: "Estou lendo as suas caixas agora. Em alguns instantes o que chegou aparece separado na tela inicial." };
  },
};

registerTools([meus_emails, atualizar_meus_emails]);
