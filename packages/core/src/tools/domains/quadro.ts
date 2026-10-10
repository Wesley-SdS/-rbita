import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { lerQuadro, moverCard } from "../../quadro/servico";
import { acharCard, acharColuna, NOME_DO_QUADRO, QUADROS, quadroParaOModelo, type QualQuadro } from "../../quadro/regras";

/**
 * Domínio: o quadro da Adalink (`quadro/`), o mesmo da tela Quadro. Ver é
 * leitura; MOVER muda o sistema de verdade, então pelo chat e pela voz vira
 * proposta que o dono aprova (botão, ou "manda"). Card e coluna são resolvidos
 * pelo código ao propor (`preparar`), e é exatamente isso que o resumo mostra e
 * que roda depois: um card novo com o mesmo nome entre propor e aprovar não
 * muda o alvo.
 */

const Qual = z.enum(QUADROS as [QualQuadro, ...QualQuadro[]]).describe("\"chamados\" (central de chamados, colunas por status) ou \"gestao\" (suas atividades na gestão, colunas por fase).");

const VerQuadro = z.object({ quadro: Qual });

export const ver_quadro: ToolDef<typeof VerQuadro> = {
  name: "ver_quadro",
  domain: "quadro",
  description: "Mostra o quadro (kanban) da Adalink com os cards em cada coluna: o dos chamados (por status) ou o da gestão (suas atividades por fase), com responsável e prazo. Use para \"como está o quadro?\", \"o que está em homologação?\", \"o que está aguardando?\".",
  risk: "leitura",
  keywords: ["quadro", "kanban", "coluna", "colunas", "card", "cards", "chamados", "gestão", "fase", "status", "homologação", "andamento"],
  inputSchema: VerQuadro,
  run: async ({ quadro }, { userId }) => quadroParaOModelo(await lerQuadro(userId, quadro)),
};

const MoverCard = z.object({
  quadro: Qual,
  card: z.string().min(1).max(200).describe("O código (\"TCK-0048\") ou parte do título do card."),
  para: z.string().min(1).max(80).describe("O nome da coluna de destino, como o dono disse (\"em andamento\", \"homologação\")."),
  card_id: z.string().max(80).nullish().describe("Preenchido pela Órbita; não informe."),
  coluna_id: z.string().max(80).nullish().describe("Preenchido pela Órbita; não informe."),
  card_nome: z.string().max(300).nullish().describe("Preenchido pela Órbita; não informe."),
  coluna_nome: z.string().max(80).nullish().describe("Preenchido pela Órbita; não informe."),
});

export const mover_card: ToolDef<typeof MoverCard> = {
  name: "mover_card",
  domain: "quadro",
  description: "Propõe mover um card do quadro da Adalink para outra coluna (chamado para outro status, atividade para outra fase). Não move direto: o dono aprova. Use para \"passa o TCK-0048 para em andamento\", \"move a atividade de relatório para homologação\".",
  risk: "efeito_externo",
  keywords: ["mover", "move", "passa", "coluna", "quadro", "kanban", "card", "status", "fase", "andamento", "homologação", "concluído", "resolvido"],
  inputSchema: MoverCard,
  summarize: (i) => `Mover ${i.card_nome ?? i.card} para "${i.coluna_nome ?? i.para}" no quadro de ${NOME_DO_QUADRO[i.quadro]}`,
  // recusa ANTES de enfileirar: proposta ambígua nem chega à fila
  authorize: async ({ quadro, card, para }, { userId }) => {
    const q = await lerQuadro(userId, quadro, { fresco: true });
    const c = acharCard(q, card);
    if (!c.ok) return c.erro;
    const col = acharColuna(q, para);
    if (!col.ok) return col.erro;
    if (c.valor.coluna === col.valor.rotulo) return `${c.valor.codigo ?? c.valor.titulo} já está em "${col.valor.rotulo}".`;
    return null;
  },
  preparar: async (i, { userId }) => {
    const q = await lerQuadro(userId, i.quadro);
    const c = acharCard(q, i.card);
    const col = acharColuna(q, i.para);
    // o que o modelo pôs nos campos "da Órbita" é ignorado: o alvo sai daqui
    if (!c.ok || !col.ok) return { ...i, card_id: null, coluna_id: null, card_nome: null, coluna_nome: null };
    return { ...i, card_id: c.valor.id, coluna_id: col.valor.id, card_nome: `${c.valor.codigo ? `${c.valor.codigo} ` : ""}${c.valor.titulo}`, coluna_nome: col.valor.rotulo };
  },
  run: async ({ quadro, card_id, coluna_id }, { userId }) => {
    if (!card_id || !coluna_id) return { erro: "Não deu para saber qual card ou coluna; peça de novo com o código do card." };
    const r = await moverCard(userId, quadro, card_id, coluna_id);
    return `Movi ${r.card} para "${r.coluna}".`;
  },
};

registerTools([ver_quadro, mover_card]);
