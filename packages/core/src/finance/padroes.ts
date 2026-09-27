/**
 * O que um financeiro novo recebe na primeira abertura (PRD §3.13) e os
 * modelos de meta (§6.5.3). São SEMENTES: depois de criadas, categorias e
 * contas são dados do dono, editáveis na tela. Nada aqui limita o que ele
 * pode ter.
 */

/** Paleta de 12 cores para categorias, contas, cartões e metas (§11.3). */
export const PALETA = [
  "#0E5A5E", "#A6382B", "#1B6B45", "#8E5D0C", "#4A5EA8", "#7A3B7E",
  "#2F7D8C", "#9B4A1F", "#5B6E2A", "#8A3556", "#3D6B8E", "#6B4E9B",
] as const;

/** A próxima cor da paleta, dado quantas já foram usadas (recomeça quando acaba). */
export const corDaVez = (usadas: number) => PALETA[((usadas % PALETA.length) + PALETA.length) % PALETA.length]!;

export const CONTAS_INICIAIS = [
  { nome: "Conta corrente", tipo: "corrente" as const, cor: "#0E5A5E" },
  { nome: "Dinheiro", tipo: "dinheiro" as const, cor: "#8E5D0C" },
];

export const CATEGORIAS_DE_SAIDA = [
  "Mercado", "Delivery e restaurante", "Transporte", "Moradia", "Contas da casa", "Saúde", "Assinaturas",
  "Lazer", "Compras", "Educação", "Cuidados pessoais", "Pets", "Dívidas e juros", "Outros gastos",
];
export const CATEGORIAS_DE_ENTRADA = ["Salário", "Freelance", "Reembolso", "Outras entradas"];

/** Categorias que o sistema cria sozinho na primeira vez que precisa (§3.14). */
export const CATEGORIA_SISTEMA = {
  dividas: { nome: "Dívidas e juros", tipo: "despesa" },
  transferenciaSaida: { nome: "Transferência", tipo: "despesa" },
  transferenciaEntrada: { nome: "Transferência", tipo: "receita" },
  fatura: { nome: "Pagamento de fatura", tipo: "despesa" },
  outrosGastos: { nome: "Outros gastos", tipo: "despesa" },
  outrasEntradas: { nome: "Outras entradas", tipo: "receita" },
} as const;

export const categoriaDaMeta = (nomeDaMeta: string) => ({ nome: `Projeto · ${nomeDaMeta}`, tipo: "despesa" as const });

/** Juros do rotativo quando o dono ainda não disse quanto o banco cobra (§7.8). Editável na dívida. */
export const JUROS_ROTATIVO_PADRAO = 14.9;

type Etapas = Record<string, string[]>;

const IMOVEL: Etapas = {
  "Aquisição": [
    "Entrada / sinal", "ITBI", "Escritura em cartório de notas", "Registro do imóvel", "Certidões e documentação",
    "Avaliação e laudo do banco", "Taxas do financiamento", "Corretagem", "Seguro do imóvel",
  ],
  "Mudança": ["Frete da mudança", "Caixas e embalagem", "Limpeza pós-obra", "Taxa de mudança no condomínio"],
};

const REFORMA: Etapas = {
  "Projeto": ["Arquiteto e projeto executivo", "ART / RRT", "Projeto elétrico e hidráulico"],
  "Demolição e alvenaria": ["Demolição", "Remoção de entulho", "Alvenaria e paredes", "Contrapiso", "Reboco e emboço"],
  "Hidráulica": [
    "Tubulação e ramais", "Registros e acabamentos", "Vaso sanitário", "Caixa acoplada e assento", "Cuba e pia",
    "Torneiras", "Chuveiro e ducha", "Aquecedor",
  ],
  "Elétrica": [
    "Fiação", "Quadro de distribuição", "Tomadas e interruptores", "Pontos de luz", "Infra de ar-condicionado",
    "Aparelhos de ar-condicionado",
  ],
  "Revestimentos": [
    "Piso (material)", "Piso (mão de obra)", "Argamassa e rejunte", "Rodapé", "Porcelanato de parede",
    "Bancadas em granito ou quartzo", "Soleiras e peitoris",
  ],
  "Forro e gesso": ["Forro de gesso", "Sanca e molduras"],
  "Pintura": ["Massa corrida", "Tinta", "Mão de obra de pintura"],
  "Esquadrias": ["Portas internas", "Porta de entrada", "Janelas", "Box do banheiro", "Fechaduras e ferragens", "Espelhos"],
  "Marcenaria": ["Cozinha planejada", "Dormitório planejado", "Home e rack", "Gabinete do banheiro", "Closet"],
  "Iluminação": ["Spots e trilhos", "Luminárias e pendentes", "Fita de LED", "Lâmpadas"],
  "Eletrodomésticos": ["Cooktop", "Forno", "Coifa", "Geladeira", "Máquina de lavar", "Micro-ondas"],
  "Mobiliário": ["Sofá", "Mesa de jantar e cadeiras", "Cama e colchão", "Cortinas e persianas", "Tapetes"],
  "Mão de obra": ["Pedreiro", "Ajudante", "Eletricista", "Encanador", "Gesseiro", "Marido de aluguel e ajustes"],
  "Reserva": ["Reserva para imprevistos"],
};

export const MODELOS_DE_META = {
  imovel: { rotulo: "Compra de imóvel", etapas: IMOVEL },
  reforma: { rotulo: "Reforma completa", etapas: REFORMA },
  "imovel-reforma": { rotulo: "Imóvel + reforma", etapas: { ...IMOVEL, ...REFORMA } },
} as const;
export type ModeloDeMeta = keyof typeof MODELOS_DE_META;

/** Os itens de um modelo, na ordem das etapas. */
export function itensDoModelo(modelo: ModeloDeMeta): { grupo: string; nome: string }[] {
  return Object.entries(MODELOS_DE_META[modelo].etapas).flatMap(([grupo, nomes]) => nomes.map((nome) => ({ grupo, nome })));
}
