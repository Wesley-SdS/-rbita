import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import type { ConnectorId } from "../connectors/registry";
import { ehToolSensivel } from "../controle/dominios";
import { saidaParaOModelo, type SaidaDoModelo } from "../controle/imagem";
import { contaminacaoPadrao, devolveuConteudo, ehFonteSensivel, motivoDaContaminacao, saiParaFora, type Contaminacao, type TurnoDeContaminacao } from "../controle/contaminacao";

/**
 * REGISTRO DE FERRAMENTAS (CLAUDE.md §5.7).
 *
 * Cada domínio (memória, finanças, web, comunicação…) declara as próprias tools
 * com `registerTools()`; não existe mais um arquivo central de mil linhas.
 * Toda tool declara RISCO, e o gate humano (§5.1) é DERIVADO do risco aqui, no
 * momento de montar o ToolSet: tool de `efeito_externo`/`perigoso` nunca recebe
 * o `run` como execute; recebe um `execute` que só ENFILEIRA a proposta. É
 * impossível registrar uma tool perigosa que "esqueça" a aprovação.
 *
 * Este módulo é PURO (sem banco): testável. Quem liga ao banco é tools/index.ts.
 */
export const TOOL_RISKS = ["leitura", "escrita", "efeito_externo", "perigoso"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];

/**
 * Quem está pedindo (Onda 9). `via: "voz"` só quando a voz foi RECONHECIDA com
 * confiança; senão vale a conta logada. Nunca libera ação perigosa sozinha: o
 * gate continua derivado do risco (decisão 9.5, voz + confirmação).
 */
export interface Requester {
  personId: string | null;
  name: string | null;
  role: "dono" | "morador" | "visitante";
  via: "voz" | "conta" | "telegram";
  confidence?: number;
}

/** De onde veio o pedido (B5.4): o cômodo do dispositivo que falou com a Órbita. */
export interface RequestOrigin {
  deviceId: string;
  name: string;
  roomId: string | null;
  roomName: string | null;
}

export interface ToolContext {
  userId: string;
  /**
   * Por onde o pedido chegou. Uma tool que ENTREGA algo (o extrato em PDF)
   * entrega onde o dono está: no WhatsApp, o arquivo vai na conversa; na tela
   * e na voz, vai o link.
   */
  canal?: "tela" | "whatsapp" | "voz" | "telegram";
  /** dispositivo de origem, resolvido uma vez por turno (preguiçoso como o requester) */
  origin?: () => Promise<RequestOrigin | null>;
  /**
   * Resolvido sob demanda e uma vez só por turno: a identificação por voz roda
   * em paralelo ao resto do turno e só é aguardada se uma tool precisar.
   */
  requester?: () => Promise<Requester | null>;
  /**
   * Referência efêmera da fala deste turno, quando houve trecho de voz. É o
   * que permite "pode guardar essa voz como minha" sem o áudio passar pela
   * tool: ela manda a referência, nunca o dado (PRD §4.1).
   */
  voiceRef?: () => Promise<string | null>;
  /**
   * O pedido do dono neste turno, LITERAL, quando o canal o entrega ao código
   * (a mensagem do chat, do WhatsApp, do Telegram, o prompt da rotina). Nunca
   * vem do modelo. A sessão de controle grava isto como "pedido original", e
   * é contra ele que o crítico confere cada passo (PRD F2, F4).
   */
  pedido?: string;
  /**
   * Quem disparou o turno quando NÃO é o dono falando: uma rotina ou uma regra
   * (ninguém olhando). Vem do código, nunca do modelo. O Chrome usa isto para
   * mandar a ordem ao perfil dedicado, nunca ao Chrome do dono (PRD B5 e B6).
   */
  origem?: "rotina" | "regra";
  /**
   * A proposta da fila que o dono APROVOU, quando o `run` é a execução dela
   * (`executeAction`). Vem do código, nunca do modelo: é o que liga a sessão de
   * controle à aprovação que a abriu (`controle_sessao.acao_id`).
   */
  acaoId?: string;
  /**
   * O turno, para a Regra de Dois (`controle/contaminacao.ts`): nasce no código
   * uma vez por mensagem (chat, WhatsApp) e guarda a primeira leitura de dado
   * sensível. Sem ele (voz, laços delegados), vale a marca pela chave do
   * usuário e do canal, com janela curta. Nunca vem do modelo.
   */
  turno?: TurnoDeContaminacao;
}

export interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  /** pt-BR snake_case, único no catálogo */
  name: string;
  /** domínio dono da tool: "memoria", "financas", "web", "agenda"… */
  domain: string;
  /** quando o modelo deve usá-la (vai para o provedor) */
  description: string;
  /** risco DECLARADO; o efetivo pode ser sobrescrito pela tela */
  risk: ToolRisk;
  inputSchema: I;
  /** palavras que ajudam a seleção por relevância a cada turno */
  keywords?: string[];
  /**
   * Só entra no ToolSet se a exigência valer para o usuário. `connector` como
   * lista é "qualquer um destes": ler um e-mail serve tanto para quem tem
   * Gmail quanto para quem tem Outlook.
   */
  requires?: {
    connector?: ConnectorId | readonly ConnectorId[];
    homeAssistant?: boolean;
    whatsapp?: boolean;
    whatsappPessoal?: boolean;
    available?: () => boolean;
    /**
     * Só o dono, só nos canais de `controle.canais`, nunca em turno de pessoa
     * da casa nem de evento de terceiro, e sempre pela guarda (trilha e
     * sessão). Os domínios do controle do PC já são assim pelo NOME
     * (`controle/dominios.ts`); isto é para outro domínio optar.
     */
    dono?: boolean;
  };
  /** a execução REAL. Para risco com gate, só roda após aprovação (POST /api/actions). */
  run: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
  /** resumo legível da proposta na fila de aprovação (`risco` é o EFETIVO, já elevado) */
  summarize?: (input: z.infer<I>, risco?: ToolRisk) => string;
  /**
   * Permissão de QUEM PEDE (pessoa e cômodo), checada pelo registro antes de
   * executar e antes de enfileirar. Devolve a mensagem de recusa ou null.
   */
  authorize?: (input: z.infer<I>, ctx: ToolContext) => Promise<string | null>;
  /**
   * Fixa a entrada ANTES de enfileirar ou executar (depois do `authorize`).
   * Existe para o que o dono aprova ser exatamente o que roda: "a Maria" vira
   * o JID dela na hora de propor, e o resumo da fila mostra nome e número. Sem
   * isso, o destino era resolvido de novo na hora de executar, e um contato
   * novo chamado "Maria" entre propor e aprovar mudava para quem ia.
   */
  preparar?: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<I>>;
  /**
   * Campos que o dono pode CORRIGIR no cartão da proposta antes de aprovar (o
   * texto do e-mail, o que digitar). Sem a lista, vale todo campo simples
   * (texto, número, sim/não) que o `preparar` não fixou e que o schema não
   * marca como da Órbita; com ela, só estes. Tool SENSÍVEL sem a lista não
   * edita nada (o diff, o comando e o alvo mudariam sem o resumo mudar).
   * Campo aninhado (`fixado`, listas) nunca se edita: o servidor reimpõe o
   * que estava gravado na fila (`actions/edicao.ts`).
   */
  camposEditaveis?: readonly string[];
  /**
   * RISCO PELO ALVO (PRD F1): olha a entrada JÁ FIXADA pelo `preparar` e pode
   * SUBIR o risco ("clicar" em "Pagar", comando fora da lista de leitura). O
   * efetivo é o maior entre o declarado, o override da tela e este; nunca
   * desce. Exceção aqui vira `perigoso` (falha fechada: na dúvida, só pela tela).
   */
  elevarRisco?: (fixo: z.infer<I>, ctx: ToolContext) => Promise<ToolRisk>;
  /**
   * Tool `escrita` de computador ou navegador que age SEM sessão de controle
   * (mídia, volume, bloquear a tela: reversível e sem terceiro, PRD A5). Sem
   * isto, a guarda recusa `escrita` desses domínios fora de uma sessão ativa,
   * mesmo que a tool esqueça o `autorizarNaSessao`.
   */
  semSessao?: boolean;
}

/** "(pedido por voz: Anna, 91%)" para a fila de aprovação mostrar quem pediu. Puro. */
export function requesterNote(r: Requester | null | undefined): string {
  if (!r || !r.name) return "";
  // pelo Telegram quem pede é conhecido pelo convite, não por palpite: sem porcentagem
  if (r.via === "telegram") return ` (pedido pelo Telegram: ${r.name})`;
  if (r.via !== "voz") return "";
  return ` (pedido por voz: ${r.name}${r.confidence !== undefined ? `, ${Math.round(r.confidence * 100)}%` : ""})`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDef = ToolDef<any>;

const registry = new Map<string, AnyToolDef>();

/** Registra as tools de um domínio. Nome repetido é erro de programação. */
export function registerTools(defs: AnyToolDef[]): void {
  for (const d of defs) {
    if (registry.has(d.name) && registry.get(d.name) !== d) throw new Error(`Tool duplicada no registro: ${d.name}`);
    // `risco` na proposta é gravado pelo registro (payload.risco) e lido pelo
    // "manda" e pelo botão do Telegram: um campo de entrada com esse nome seria
    // sobrescrito, ou, pior, viria do modelo
    for (const reservado of CAMPOS_DA_FILA) {
      if ((d.inputSchema as { shape?: Record<string, unknown> }).shape?.[reservado] !== undefined) throw new Error(`Campo "${reservado}" é reservado na entrada de tool: ${d.name}`);
    }
    // permissão por pessoa e cômodo não é opt-in esquecível: tool de casa que age
    // precisa declarar authorize (leitura fica isenta). MCP do HA passa por fora
    // do registro e não tem essa checagem: documentado em CLAUDE.md.
    if (d.requires?.homeAssistant && d.risk !== "leitura" && !d.authorize) throw new Error(`Tool de casa sem authorize: ${d.name}`);
    registry.set(d.name, d);
  }
}

export function listRegisteredTools(): AnyToolDef[] {
  return [...registry.values()];
}

export function getTool(name: string): AnyToolDef | undefined {
  return registry.get(name);
}

/** Só para testes: zera o registro. */
export function _resetRegistry(): void {
  registry.clear();
}

/** Risco que exige aprovação humana antes de executar. */
export function needsApproval(risk: ToolRisk): boolean {
  return risk === "efeito_externo" || risk === "perigoso";
}

export function isToolRisk(v: unknown): v is ToolRisk {
  return typeof v === "string" && (TOOL_RISKS as readonly string[]).includes(v);
}

/** Configuração por tool vinda da tela (linha ausente = ligada, risco declarado). */
export interface ToolOverride {
  enabled: boolean;
  riskOverride: ToolRisk | null;
}
export type ToolOverrides = ReadonlyMap<string, ToolOverride>;

const RISK_ORDER: Record<ToolRisk, number> = { leitura: 0, escrita: 1, efeito_externo: 2, perigoso: 3 };

/** `a` é pelo menos tão arriscado quanto `b`? */
export function riskAtLeast(a: ToolRisk, b: ToolRisk): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

/** O maior risco entre os dados. Puro. */
export function maiorRisco(primeiro: ToolRisk, ...outros: ToolRisk[]): ToolRisk {
  return outros.reduce((m, r) => (RISK_ORDER[r] > RISK_ORDER[m] ? r : m), primeiro);
}

/**
 * Risco efetivo: o override da tela só pode SUBIR o risco. Rebaixar uma tool
 * declarada com gate (efeito_externo/perigoso) tiraria a aprovação humana por
 * um clique na UI, e a UI não é defesa (achado da revisão da Onda 1). O clamp
 * vale aqui, no montador do ToolSet, não só na validação do endpoint.
 */
export function effectiveRisk(def: AnyToolDef, overrides?: ToolOverrides): ToolRisk {
  const o = overrides?.get(def.name)?.riskOverride;
  if (!o) return def.risk;
  return riskAtLeast(o, def.risk) ? o : def.risk;
}

export function isEnabled(def: AnyToolDef, overrides?: ToolOverrides): boolean {
  return overrides?.get(def.name)?.enabled ?? true;
}

/** Tools que valem para este usuário agora: ligadas e com exigências atendidas. */
export function availableFor(
  defs: AnyToolDef[],
  ctx: { connected: ReadonlySet<ConnectorId>; haConnected?: boolean; whatsappConnected?: boolean; whatsappPessoal?: boolean; overrides?: ToolOverrides },
): AnyToolDef[] {
  return defs.filter((d) => {
    if (!isEnabled(d, ctx.overrides)) return false;
    if (d.requires?.connector) {
      const exigidos: readonly ConnectorId[] = typeof d.requires.connector === "string" ? [d.requires.connector] : d.requires.connector;
      if (!exigidos.some((c) => ctx.connected.has(c))) return false;
    }
    if (d.requires?.homeAssistant && !ctx.haConnected) return false;
    if (d.requires?.whatsapp && !ctx.whatsappConnected) return false;
    // ler conversa só existe no número pessoal (a Cloud API não recebe nada)
    if (d.requires?.whatsappPessoal && !ctx.whatsappPessoal) return false;
    if (d.requires?.available && !d.requires.available()) return false;
    return true;
  });
}

const tokenize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);

/**
 * SELEÇÃO POR RELEVÂNCIA (TL.6): com poucas tools manda todas; acima de `max`,
 * pontua cada uma pela sobreposição entre o pedido e nome/keywords/descrição e
 * fica com as `max` melhores. Sem LLM no caminho quente. Sem pedido (rotinas),
 * devolve as primeiras `max` na ordem de registro (estável).
 */
/** `porRelevancia`: devolve da mais para a menos ligada ao pedido (para quem vai LER a lista, como a busca da voz). */
export function selectRelevant<T extends { name: string; description: string; keywords?: string[] }>(defs: T[], query: string, max: number, porRelevancia = false): T[] {
  if (defs.length <= max && !porRelevancia) return defs;
  const q = new Set(tokenize(query));
  if (!q.size) return defs.slice(0, max);
  // radical simples: "manda" casa "mandar", "reuniões" casa "reuniao" (sem stemmer)
  const hit = (list: string[], t: string) => list.some((w) => w === t || (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))));
  const scored = defs.map((d, i) => {
    const nameT = tokenize(d.name.replace(/_/g, " "));
    const kwT = (d.keywords ?? []).flatMap(tokenize);
    const descT = tokenize(d.description);
    let score = 0;
    for (const t of q) {
      if (hit(nameT, t)) score += 3;
      if (hit(kwT, t)) score += 2;
      if (hit(descT, t)) score += 1;
    }
    return { d, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => (porRelevancia ? 0 : a.i - b.i))
    .map((x) => x.d);
}

/** O que a tool devolve ao modelo quando só enfileirou a proposta (formato de sempre). */
export interface EnqueueResult {
  proposta_enfileirada: true;
  aguardando_aprovacao: true;
  id?: string;
  resumo: string;
}
export type Enqueue = (def: AnyToolDef, input: unknown, summary: string) => Promise<EnqueueResult>;

export function summaryFor(def: AnyToolDef, input: unknown, risco?: ToolRisk): string {
  try {
    if (def.summarize) return def.summarize(input, risco);
  } catch {
    /* cai no genérico */
  }
  return `${def.name}(${JSON.stringify(input).slice(0, 120)})`;
}

/**
 * Quem trata a chamada de uma tool SENSÍVEL (controle, terminal, arquivos,
 * computador, navegador): grava o passo antes de executar, confere a sessão e
 * o crítico, e atualiza o passo depois. A implementação com banco mora em
 * `controle/guarda.ts`; aqui fica só o contrato, para o registro continuar puro.
 */
export interface ChamadaSensivel {
  def: AnyToolDef;
  entrada: unknown;
  risco: ToolRisk;
  ctx: ToolContext;
  /** a proposta da fila (na fila, ou executando depois da aprovação) */
  acaoId?: string;
}
export interface GuardaSensivel {
  executar(c: ChamadaSensivel & { run: () => Promise<unknown> }): Promise<unknown>;
  enfileirada(c: ChamadaSensivel): Promise<void>;
  recusada(c: ChamadaSensivel & { motivo: string }): Promise<void>;
}

export interface OpcoesDaChamada {
  overrides?: ToolOverrides;
  enqueue: Enqueue;
  /** obrigatória para tool sensível: sem ela, a chamada é recusada (falha fechada) */
  guarda?: GuardaSensivel;
  /** Regra de Dois; sem ela vale a padrão, LIGADA (falha fechada). Produção passa a da casa, que lê Ajustes. */
  contaminacao?: Contaminacao;
}

/**
 * Risco EFETIVO desta chamada: declarado, override da tela e `elevarRisco`,
 * o maior dos três. `elevarRisco` que lança ou devolve lixo vira `perigoso`.
 */
export async function riscoDaChamada(def: AnyToolDef, fixo: unknown, ctx: ToolContext, overrides?: ToolOverrides): Promise<ToolRisk> {
  const base = effectiveRisk(def, overrides);
  if (!def.elevarRisco) return base;
  try {
    const elevado: unknown = await def.elevarRisco(fixo, ctx);
    return isToolRisk(elevado) ? maiorRisco(base, elevado) : "perigoso";
  } catch {
    return "perigoso";
  }
}

/**
 * Campos que o REGISTRO grava no payload da fila, ao lado da entrada da tool.
 * Nenhuma tool pode ter um campo com esses nomes (`registerTools` recusa), e a
 * execução aprovada os tira antes de validar.
 */
export const CAMPOS_DA_FILA = ["risco", "camposFixados"] as const;

/** Mesmo valor, com as chaves em qualquer ordem. Puro. */
function mesmoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => mesmoValor((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A descrição que os domínios põem no campo que a Órbita preenche ("Preenchido pela Órbita. Deixe vazio."). */
const DESCRICAO_DE_CAMPO_DA_ORBITA = /^Preenchido pela Órbita/i;

/**
 * Os campos que o SCHEMA da tool diz serem da Órbita (o modelo não preenche).
 * O `.describe()` pode estar no campo ou dentro do opcional; olha os dois. Puro.
 */
export function camposDaOrbita(def: Pick<AnyToolDef, "inputSchema">): string[] {
  const forma = (def.inputSchema as { shape?: Record<string, unknown> }).shape ?? {};
  const descricao = (s: unknown): string | undefined => {
    let atual = s as { description?: string; unwrap?: () => unknown } | undefined;
    for (let i = 0; i < 4 && atual; i++) {
      if (typeof atual.description === "string") return atual.description;
      atual = typeof atual.unwrap === "function" ? (atual.unwrap() as typeof atual) : undefined;
    }
    return undefined;
  };
  return Object.keys(forma).filter((k) => DESCRICAO_DE_CAMPO_DA_ORBITA.test(descricao(forma[k]) ?? ""));
}

/**
 * O que vai para `action_queue.payload`: a entrada fixada, o risco efetivo dela
 * e QUAIS campos o código fixou (`camposFixados`: os que o `preparar`
 * acrescentou ou trocou em relação ao que o modelo mandou, MAIS os que o schema
 * diz serem da Órbita). É essa lista que impede a edição no cartão de trocar o
 * que a Órbita resolveu ("a Maria" virou o número dela, o botão virou o alvo
 * conferido) pelo que o modelo escreveu. Sem a parte do schema, um campo da
 * Órbita que o modelo "acertava" com o mesmo valor ficava editável (linha 11
 * da auditoria de 11/10/2026).
 */
export function payloadDaProposta(fixo: unknown, risco: ToolRisk, doModelo?: unknown, def?: Pick<AnyToolDef, "inputSchema">): Record<string, unknown> {
  const f = (fixo && typeof fixo === "object" ? fixo : {}) as Record<string, unknown>;
  const m = (doModelo && typeof doModelo === "object" ? doModelo : {}) as Record<string, unknown>;
  const doSchema = new Set(def ? camposDaOrbita(def) : []);
  const camposFixados = doModelo === undefined ? [] : Object.keys(f).filter((k) => !(k in m) || !mesmoValor(m[k], f[k]) || doSchema.has(k));
  return { ...f, risco, ...(camposFixados.length ? { camposFixados } : {}) };
}

/**
 * UMA chamada de tool, do jeito que o registro manda: quem pede, permissão,
 * entrada fixada, risco efetivo, gate (fila) e, para tool sensível, a guarda.
 * É o único caminho: o chat (`toToolSet`), a voz em tempo real e os laços
 * delegados chamam isto, e a execução pós-aprovação usa a mesma guarda.
 */
export async function executarChamada(def: AnyToolDef, input: unknown, ctx: ToolContext, opts: OpcoesDaChamada): Promise<unknown> {
  const sensivel = ehToolSensivel(def);
  const guarda = opts.guarda;
  if (sensivel && !guarda) return { permitido: false, erro: "Esta ferramenta precisa da trilha do controle do PC, que não está ligada neste caminho." };
  if (sensivel) {
    // só o dono mexe no PC: a voz reconhecida de outra pessoa, ou um pedido
    // pelo Telegram da família, não chega nem à fila
    const quem = ctx.requester ? await ctx.requester().catch(() => null) : null;
    if (quem && quem.role !== "dono") {
      const motivo = "Só o dono pode pedir para a Órbita mexer no computador.";
      await guarda!.recusada({ def, entrada: input, risco: def.risk, ctx, motivo });
      return { permitido: false, erro: motivo };
    }
  }
  const negado = def.authorize ? await def.authorize(input, ctx) : null;
  if (negado) {
    if (sensivel) await guarda!.recusada({ def, entrada: input, risco: def.risk, ctx, motivo: negado });
    return { permitido: false, erro: negado };
  }
  const fixo = def.preparar ? await def.preparar(input, ctx) : input;
  let risco = await riscoDaChamada(def, fixo, ctx, opts.overrides);
  const contaminacao = opts.contaminacao ?? contaminacaoPadrao;
  // Regra de Dois: dado do dono já entrou neste turno, e esta chamada fala com a
  // rede ou com outra pessoa. Sobe para a fila, e o resumo diz por quê.
  const leitura = saiParaFora(def, fixo) ? await contaminacao.consultar(ctx) : null;
  if (leitura) risco = maiorRisco(risco, "efeito_externo");
  if (needsApproval(risco)) {
    const quem = ctx.requester ? await ctx.requester().catch(() => null) : null;
    // subiu para perigoso pela entrada: quem aprova precisa saber por que o
    // "manda" não serve para esta
    const elevada = risco === "perigoso" && effectiveRisk(def, opts.overrides) !== "perigoso";
    const resumo = summaryFor(def, fixo, risco) + (elevada ? " (só se aprova pela tela)" : "") + (leitura ? motivoDaContaminacao(leitura) : "");
    const proposta = await opts.enqueue(def, payloadDaProposta(fixo, risco, def.preparar ? input : undefined, def), resumo + requesterNote(quem));
    if (sensivel) await guarda!.enfileirada({ def, entrada: fixo, risco, ctx, acaoId: proposta?.id });
    // quem pediu fica na fila de aprovação (tela do dono), não volta ao modelo
    return proposta && typeof proposta === "object" && "resumo" in proposta ? { ...proposta, resumo } : proposta;
  }
  const r = sensivel ? await guarda!.executar({ def, entrada: fixo, risco, ctx, run: () => def.run(fixo, ctx) }) : await def.run(fixo, ctx);
  // a marca nasce DEPOIS de o conteúdo voltar: recusa e proposta não põem dado nenhum no contexto
  if (ehFonteSensivel(def, fixo) && devolveuConteudo(r)) await contaminacao.marcar(ctx, def.name);
  return r;
}

/** Marca das tools que nasceram do registro (as do MCP e as nativas do provedor não têm). */
const DO_REGISTRO = Symbol("orbita.do_registro");

/**
 * Converte definições em ToolSet do AI SDK, DERIVANDO o gate: risco com
 * aprovação → `execute` enfileira; senão → `execute` roda de verdade.
 *
 * `toModelOutput` vale para todas: sem imagem na saída, faz exatamente o que o
 * AI SDK faria sem ele; com imagem, manda a ALTERNATIVA em texto, porque aqui
 * não se sabe qual modelo vai ler. Quem sabe é o chat, que chama `comVisao`.
 */
export function toToolSet(defs: AnyToolDef[], ctx: ToolContext, opts: OpcoesDaChamada): ToolSet {
  const set: ToolSet = {};
  for (const d of defs) {
    const t = tool({
      description: d.description,
      inputSchema: d.inputSchema,
      execute: async (input: unknown) => executarChamada(d, input, ctx, opts),
      toModelOutput: ({ output }: { output: unknown }) => saidaParaOModelo(output, false) as never,
    });
    Object.defineProperty(t, DO_REGISTRO, { value: true });
    set[d.name] = t;
  }
  return set;
}

/**
 * O mesmo ToolSet, com a imagem das tools do registro indo para o modelo
 * quando ELE enxerga (`modeloRecebeImagem` em `controle/imagem.ts`). Tool de
 * fora do registro (MCP, busca nativa) fica como veio. Puro.
 */
export function comVisao(tools: ToolSet, enxerga: boolean): ToolSet {
  if (!enxerga) return tools;
  const out: ToolSet = {};
  for (const [nome, t] of Object.entries(tools)) {
    out[nome] = (t as unknown as Record<symbol, unknown>)[DO_REGISTRO]
      ? ({ ...t, toModelOutput: ({ output }: { output: unknown }): SaidaDoModelo => saidaParaOModelo(output, true) } as unknown as ToolSet[string])
      : t;
  }
  return out;
}
