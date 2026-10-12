import { z } from "zod";
import type { DescricaoDoAlvo, Leitura } from "./pagina";

/**
 * PROTOCOLO entre o api e as mãos do Chrome (PRD §5.2, B1): a extensão no
 * perfil real (WebSocket ou native messaging) e o perfil dedicado (B6) falam a
 * MESMA língua. O que chega da extensão é entrada não confiável e passa por
 * zod aqui; o que vai para ela é montado pelo core.
 *
 * O token vai na PRIMEIRA mensagem, nunca na URL (a URL aparece em log de
 * proxy e no histórico). Mensagem que não seja `ola` ou `parear` antes da
 * autenticação derruba a conexão.
 */

export const VERSAO_DO_PROTOCOLO = 1;

/** Origem de quem mandou a ordem. A extensão no perfil real RECUSA `rotina` e `regra` (B6). */
export const ORIGENS = ["dono", "rotina", "regra"] as const;
export type OrigemDaOrdem = (typeof ORIGENS)[number];

export const ACOES_DE_AGIR = ["clicar", "clique_duplo", "clique_triplo", "clique_direito", "clique_meio", "preencher", "digitar", "selecionar", "marcar", "rolar", "tecla", "passar_mouse"] as const;
export type AcaoDeAgir = (typeof ACOES_DE_AGIR)[number];

export interface AbaVista {
  aba: number;
  titulo: string;
  url: string;
  ativa: boolean;
  /** está no grupo "Órbita: …" (escopo da sessão) */
  noGrupo: boolean;
  /** de categoria bloqueada ou `bloqueado` na lista do dono: sem título nem URL */
  bloqueada?: boolean;
}

/** A ordem que o core manda às mãos. */
export type Ordem =
  | { tipo: "abas" }
  | { tipo: "ler"; aba?: number | null; modo: "texto" | "arvore" | "ambos"; filtro: "interativos" | "visiveis" | "tudo"; maxElementos: number; maxCaracteres: number; ref?: string | null }
  | { tipo: "ver"; aba?: number | null; larguraMax: number; regiao?: [number, number, number, number] | null; miniatura?: boolean }
  | { tipo: "descrever"; aba?: number | null; ref?: string | null; x?: number | null; y?: number | null }
  | { tipo: "focado"; aba?: number | null }
  /** o alvo semântico de um roteiro: papel e nome, com o seletor de reserva */
  | { tipo: "achar"; aba?: number | null; papel?: string | null; nome?: string | null; texto?: string | null; seletor?: string | null }
  /** `aprovada`: o dono aprovou na fila; `paraLer`: abrir só para ler (vale site liberado para leitura) */
  | { tipo: "abrir"; url: string; aba?: number | null; nova: boolean; grupo: { titulo: string; cor: string }; aprovada?: boolean; paraLer?: boolean }
  | { tipo: "historico"; aba?: number | null; direcao: "voltar" | "avancar" | "recarregar" }
  | { tipo: "fechar"; aba: number }
  | { tipo: "focar"; aba: number }
  | {
      tipo: "agir";
      aba?: number | null;
      acao: AcaoDeAgir;
      ref?: string | null;
      /** a assinatura do alvo que foi conferido (e aprovado): a página recusa se mudou */
      assinatura?: { papel: string; nome: string } | null;
      texto?: string | null;
      valor?: string | number | boolean | null;
      tecla?: string | null;
      direcao?: "cima" | "baixo" | "esquerda" | "direita" | null;
      quantidade?: number | null;
      ponto?: { x: number; y: number } | null;
      /** o dono aprovou na fila uma ação fora do envelope: a extensão deixa passar só com isto */
      aprovada?: boolean;
      modificadores?: string | null;
      /**
       * O endereço da aba quando a ação foi proposta (o que o dono viu na fila).
       * A mão recusa com `tela_mudou` se a aba estiver noutra página: sem isto,
       * a ordem aprovada valia para o site que estivesse aberto na hora.
       */
      urlEsperada?: string | null;
      /**
       * Para `digitar` e `tecla`: o campo que tinha o foco ao propor (null:
       * nenhum). Outro campo com o foco agora é `tela_mudou`. Ausente: não confere.
       */
      focado?: { papel: string; nome: string } | null;
    };

export interface ResultadoDaOrdem {
  abas?: AbaVista[];
  leitura?: Leitura;
  alvo?: DescricaoDoAlvo | null;
  /** `miniatura`: data URL pequena (JPEG), já mascarada, para a trilha e o cartão quando o dono deixa guardar */
  imagem?: { base64: string; mediaType: "image/png" | "image/jpeg"; largura: number; altura: number; escala: number; miniatura?: string };
  aba?: number;
  url?: string;
  titulo?: string;
  /** o domínio final saiu do pedido (redirecionamento) */
  redirecionou?: string | null;
  feito?: string;
  bloqueada?: boolean;
  ms?: number;
}

/** O que a extensão recusa do lado dela, sem perguntar ao api (a checagem se repete no core). */
export interface RegraDeSitesDaExtensao {
  bloqueados: string[];
  liberados: string[];
  /** os que o dono liberou para AGIR (modo escrita): valem como envelope */
  escrita: string[];
  padraoBloqueado: boolean;
  /** as portas em que a Órbita responde nesta máquina: loopback nelas é sempre recusado (I-1) */
  portasDaOrbita?: number[];
}

/** O envelope que a extensão espelha (sem o dono: a conexão já é dele). */
export interface EnvelopeDaExtensao {
  sessaoId: string;
  objetivo: string;
  sites: string[];
  expiraEm: string;
  tetoPassos: number;
  passosUsados: number;
}

export type MensagemParaExtensao =
  | { t: "bem_vindo"; versao: number; envelope: EnvelopeDaExtensao | null; sites: RegraDeSitesDaExtensao; corDoGrupo: string; keepaliveSeg: number; agindoMs: number }
  | { t: "pareado"; token: string; extensao: string }
  | { t: "recusado"; motivo: string }
  | { t: "revogado"; motivo: string }
  | { t: "ordem"; id: string; origem: OrigemDaOrdem; ordem: Ordem }
  | { t: "envelope"; envelope: EnvelopeDaExtensao; sites: RegraDeSitesDaExtensao }
  | { t: "fim"; sessaoId: string; status: string; motivo: string }
  | { t: "parar"; origem: string }
  /** o core tratou o evento (o Parar e o "o dono mexeu" que a extensão guardou enquanto o canal estava caído) */
  | { t: "evento_recebido"; id: string }
  | { t: "pong" };

const MAX_STR = 4000;

export const MensagemDaExtensao = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ola"), token: z.string().min(20).max(200), versao: z.string().max(40), nome: z.string().max(120).default("Chrome"), perfil: z.literal("real").default("real") }),
  // `tokenAnterior`: parear de novo na mesma extensão revoga o token que ela tinha (senão os dois valiam)
  z.object({ t: z.literal("parear"), codigo: z.string().regex(/^\d{6}$/), nome: z.string().max(120).default("Chrome"), versao: z.string().max(40), tokenAnterior: z.string().min(20).max(200).optional() }),
  z.object({ t: z.literal("ping") }),
  // "Esquecer" no popup: o token desta conexão é revogado no servidor, não só apagado da extensão
  z.object({ t: z.literal("esquecer") }),
  z.object({
    t: z.literal("resposta"),
    id: z.string().max(64),
    ok: z.boolean(),
    erro: z.string().max(MAX_STR).optional(),
    codigo: z.string().max(40).optional(),
    // o conteúdo é conferido por quem pediu (cada ordem sabe o que espera); aqui só o teto de tamanho
    dados: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    t: z.literal("evento"),
    // `borda_escondida`: a página tirou a borda da Órbita de novo e de novo (o dono deixa de ver que ela está no controle)
    tipo: z.enum(["dono_mexeu", "parar", "redirecionou", "aba_no_grupo", "borda_escondida"]),
    aba: z.number().int().optional(),
    dominio: z.string().max(253).optional(),
    detalhe: z.string().max(300).optional(),
    /** com id, o core confirma (`evento_recebido`) e a extensão para de reenviar */
    id: z.string().max(64).optional(),
    /** a sessão em que o dono apertou Parar ou mexeu: o pendente de uma sessão que já acabou não para a seguinte */
    sessaoId: z.string().uuid().optional(),
    /** quando o dono apertou (relógio desta máquina, ms): Parar recente vale para tudo, Parar velho só para a sessão dele */
    em: z.number().int().nonnegative().optional(),
  }),
  // native messaging: a ponte junta os pedaços antes de repassar, então isto nunca chega aqui inteiro
]);
export type MensagemDaExtensao = z.infer<typeof MensagemDaExtensao>;

/** Tamanho máximo de uma mensagem vinda da extensão (screenshot incluído). */
export const MAX_MENSAGEM_BYTES = 12 * 1024 * 1024;
