import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";
import { aniversariantes, buscarNaAgenda, chaveDoTelefone } from "../../contatos/casar";
import { casarContato, listarContatos } from "../../whatsapp/store";
import { embrulhar } from "../../whatsapp/formatar";
import { contatosDaAgenda, esquecerAgenda } from "../../contatos/agenda";
import { agoraLocal } from "../../whatsapp/horario";

/**
 * Domínio: contatos (a agenda do Google e as conversas do WhatsApp). Só leitura: quem ESCREVE
 * para alguém são as tools de e-mail e de WhatsApp, e elas usam a agenda para
 * achar o destino (ver `contatos/agenda.ts`), sempre pelo gate.
 */

const Buscar = z.object({
  nome: z.string().min(1).max(120).describe("Nome, apelido ou parte do nome."),
  atualizar: z.boolean().optional().describe("Ler a agenda de novo no Google (contato acabou de ser criado)."),
});

export const buscar_contato: ToolDef<typeof Buscar> = {
  name: "buscar_contato",
  domain: "contatos",
  description: "Procura alguém nos contatos do dono (agenda do Google e conversas do WhatsApp): telefones, e-mails, empresa e aniversário. Use para 'qual o telefone da Maria?', 'qual o e-mail do João?', 'quando é o aniversário da minha mãe?'. Para MANDAR algo não precisa procurar antes: as ferramentas de envio acham a pessoa pelo nome.",
  risk: "leitura",
  keywords: ["contato", "telefone", "numero", "celular", "email", "e-mail", "agenda", "aniversario", "quem"],
  inputSchema: Buscar,
  run: async ({ nome, atualizar }, { userId }) => {
    if (atualizar) esquecerAgenda(userId);
    const contatos = await contatosDaAgenda(userId);
    const achados = buscarNaAgenda(contatos, nome);
    // As conversas do WhatsApp também são contatos: a Anna estava lá como
    // "Anna Santos" e não na agenda, e com a busca só na agenda a Órbita
    // respondeu "não achei a Anna" em vez de mandar o áudio (27/09/2026).
    const doWhatsapp = casarContato(await listarContatos(userId, 2000).catch(() => []), nome)
      .filter((c) => !c.grupo)
      .filter((c) => !achados.some((a) => a.telefones.some((t) => chaveDoTelefone(t) === chaveDoTelefone(c.jid.split("@")[0]))));
    const linhasWhatsapp = doWhatsapp.slice(0, 10).map((c) => `${c.apelido ?? c.nome ?? "?"}${c.apelido && c.nome ? ` (${c.nome})` : ""} · WhatsApp: ${c.jid.split("@")[0]}`);
    if (!achados.length && !linhasWhatsapp.length) {
      return contatos.length ? `Ninguém chamado "${nome}" na agenda nem nas conversas do WhatsApp.` : `Ninguém chamado "${nome}" nas conversas do WhatsApp (a agenda do Google não está disponível).`;
    }
    // embrulhado: o nome das conversas do WhatsApp é o que a PESSOA escolheu (§5.2)
    return embrulhar(achados.slice(0, 10).map((c) =>
      [
        c.nome + (c.apelidos.length ? ` (${c.apelidos.join(", ")})` : ""),
        c.telefones.length ? `telefone: ${c.telefones.join(", ")}` : null,
        c.emails.length ? `e-mail: ${c.emails.join(", ")}` : null,
        c.empresa ? `empresa: ${c.empresa}` : null,
        c.aniversario ? `aniversário: ${String(c.aniversario.dia).padStart(2, "0")}/${String(c.aniversario.mes).padStart(2, "0")}${c.aniversario.ano ? `/${c.aniversario.ano}` : ""}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    ).concat(linhasWhatsapp)) + (achados.length > 10 ? `\n(e mais ${achados.length - 10})` : "");
  },
};

const Aniversarios = z.object({
  dias: z.number().int().min(0).max(366).optional().describe("Olhar de hoje até N dias à frente (padrão 7; 0 = só hoje)."),
});

export const aniversarios: ToolDef<typeof Aniversarios> = {
  name: "aniversarios",
  domain: "contatos",
  description: "Quem da agenda de contatos do Google faz aniversário hoje e nos próximos dias, com a idade quando se sabe o ano. Use no briefing e para 'tem aniversário essa semana?'.",
  risk: "leitura",
  keywords: ["aniversario", "aniversariante", "parabens", "nasceu", "idade", "agenda", "contato"],
  requires: { connector: "google" },
  inputSchema: Aniversarios,
  run: async ({ dias }, { userId }) => {
    const contatos = await contatosDaAgenda(userId);
    if (!contatos.length) return "Não consegui ler os contatos do Google.";
    // "hoje" é o dia da CASA, não do servidor: às 22h de Brasília o UTC já virou
    const hoje = agoraLocal(new Date(), await settings.get("connectors.fusoHorario")).dia;
    const lista = aniversariantes(contatos, hoje, dias ?? 7);
    if (!lista.length) return dias === 0 ? "Ninguém da agenda faz aniversário hoje." : `Nenhum aniversário nos próximos ${dias ?? 7} dias.`;
    return lista
      .map((a) => {
        const quando = a.emDias === 0 ? "HOJE" : a.emDias === 1 ? "amanhã" : `em ${a.emDias} dias (${String(a.dia).padStart(2, "0")}/${String(a.mes).padStart(2, "0")})`;
        return `${a.nome}: ${quando}${a.idade ? `, faz ${a.idade} anos` : ""}`;
      })
      .join("\n");
  },
};

registerTools([buscar_contato, aniversarios]);
