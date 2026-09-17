import { z } from "zod";

/**
 * DEFINIÇÕES DE CONFIGURAÇÃO — a única lista de "constantes" do motor.
 *
 * Cada chave tem default sensato, tipo e faixa. O valor efetivo vem do banco
 * (tabela `setting`) quando o dono mudou pela tela; senão, o default. Nada aqui
 * é obrigatório: o app sobe e funciona sem nenhuma linha no banco.
 *
 * Regra do princípio zero hardcode (CLAUDE.md §5.6): constante de engenharia
 * nova entra AQUI, não como `const` no módulo que a usa. O `type` também
 * alimenta a tela de ajustes (campo numérico, seletor, lista…), então uma chave
 * definida aqui já aparece na UI sem código de front.
 */
export type SettingType =
  | { kind: "number"; min: number; max: number; step?: number; integer?: boolean }
  | { kind: "boolean" }
  | { kind: "select"; options: { value: string; label: string }[] }
  | { kind: "text"; maxLength?: number }
  | { kind: "list"; maxItems?: number; itemMaxLength?: number };

export interface SettingDef<T> {
  group: SettingGroupId;
  label: string;
  description: string;
  default: T;
  type: SettingType;
  unit?: string;
  /** aviso mostrado na tela quando o valor muda (ex.: exige reindexar) */
  warning?: string;
}

export const SETTING_GROUPS = {
  chat: { label: "Motor do chat", order: 10 },
  prompt: { label: "Prompt", order: 20 },
  rag: { label: "Conhecimento (RAG)", order: 30 },
  memory: { label: "Memória", order: 40 },
  embeddings: { label: "Embeddings", order: 45 },
  resilience: { label: "Resiliência", order: 50 },
  routines: { label: "Rotinas e regras", order: 60 },
  tools: { label: "Ferramentas", order: 62 },
  meetings: { label: "Reuniões e agenda", order: 63 },
  home: { label: "Casa (Home Assistant)", order: 64 },
  cameras: { label: "Câmeras", order: 64.5 },
  events: { label: "Eventos", order: 65 },
  connectors: { label: "Conectores", order: 70 },
  finance: { label: "Finanças", order: 75 },
  limits: { label: "Limites", order: 80 },
  graph: { label: "Grafo de conhecimento", order: 85 },
  auth: { label: "Acesso", order: 90 },
} as const;
export type SettingGroupId = keyof typeof SETTING_GROUPS;

interface NumExtra {
  unit?: string;
  warning?: string;
  step?: number;
  integer?: boolean;
}
const num = (group: SettingGroupId, label: string, description: string, def: number, min: number, max: number, extra: NumExtra = {}): SettingDef<number> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "number", min, max, step: extra.step, integer: extra.integer ?? Number.isInteger(def) },
  unit: extra.unit,
  warning: extra.warning,
});
// `const V` + array readonly: preserva os literais das opções na inferência
// (senão "auto" | "local" | "cloud" vira string e o tipo do valor se perde).
const sel = <const V extends string>(group: SettingGroupId, label: string, description: string, def: NoInfer<V>, options: readonly { value: V; label: string }[], warning?: string): SettingDef<V> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "select", options: [...options] },
  warning,
});
const list = (group: SettingGroupId, label: string, description: string, def: string[] = []): SettingDef<string[]> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "list", maxItems: 200, itemMaxLength: 200 },
});
const text = (group: SettingGroupId, label: string, description: string, def: string, maxLength = 200): SettingDef<string> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "text", maxLength },
});

export const SETTING_DEFS = {
  // ── motor do chat (api/chat/route.ts) ──
  "chat.historyWindow": num("chat", "Janela de histórico", "Quantas mensagens anteriores da conversa vão para o modelo a cada turno.", 24, 1, 200, { unit: "mensagens" }),
  "chat.ragTimeoutMs": num("chat", "Timeout do RAG", "Tempo máximo que o turno espera pela busca de contexto antes de começar a responder sem ela.", 3500, 0, 15000, { unit: "ms" }),
  // B3.10: 5 não bastava para "estou indo dormir" (apagar luzes de vários
  // cômodos + trancar + ajustar clima = 5+ chamadas). Default subiu para 12.
  "chat.maxSteps": num("chat", "Teto de passos de ferramenta", "Quantas chamadas de ferramenta encadeadas o modelo pode fazer num turno. Uma rotina de casa (\"estou indo dormir\") pode precisar de várias.", 12, 1, 40),
  "chat.maxRetries": num("chat", "Tentativas por provedor", "Retentativas do próprio provedor antes de passar para o próximo da cadeia.", 2, 0, 5),
  "chat.outputCapSmall": num("chat", "Resposta máxima (modelo leve)", "Tokens de saída para modelos de porte pequeno.", 1024, 128, 32768, { unit: "tokens" }),
  "chat.outputCapMedium": num("chat", "Resposta máxima (modelo médio)", "Tokens de saída para modelos de porte médio.", 2048, 128, 32768, { unit: "tokens" }),
  "chat.outputCapLarge": num("chat", "Resposta máxima (modelo forte)", "Tokens de saída para modelos de porte grande.", 4096, 128, 65536, { unit: "tokens" }),
  "chat.rateLimitPerMinute": num("chat", "Limite de turnos por minuto", "Proteção contra loop de custo: cada turno dispara LLM, embeddings e RAG.", 30, 1, 600, { unit: "/min" }),

  // ── prompt (chat/compose.ts) ──
  "prompt.budgetTokens": num("prompt", "Orçamento do system prompt", "Acima disso, os blocos compressíveis de menor prioridade (RAG, skills) são cortados.", 3200, 500, 50000, { unit: "tokens" }),
  "prompt.priorityPersona": num("prompt", "Prioridade: persona", "Maior sobrevive ao corte por mais tempo. Segurança e identidade são fixas em 130.", 120, 0, 129),
  "prompt.priorityTemporal": num("prompt", "Prioridade: contexto temporal", "Data, hora e dia da semana.", 90, 0, 129),
  "prompt.prioritySkills": num("prompt", "Prioridade: skills ativas", "Instruções das skills roteadas para o turno.", 70, 0, 129),
  "prompt.priorityRag": num("prompt", "Prioridade: contexto do usuário", "Trechos de documentos e memória encontrados pelo RAG.", 50, 0, 129),

  // ── RAG (rag/retrieve.ts, rag/chunk.ts) ──
  "rag.topK": num("rag", "Trechos por turno", "Quantos trechos de documento ou memória entram no contexto.", 4, 1, 20),
  "rag.chunkMinSim": num("rag", "Similaridade mínima (documentos)", "Abaixo disso o trecho é ruído e não entra (evita alucinação por RAG).", 0.35, 0, 1, { step: 0.01 }),
  "rag.memoryMinSim": num("rag", "Similaridade mínima (memória)", "Corte para fatos da memória de longo prazo.", 0.4, 0, 1, { step: 0.01 }),
  "rag.cacheTtlMs": num("rag", "Cache de busca", "Por quanto tempo a mesma pergunta reaproveita o resultado da busca.", 60000, 0, 3600000, { unit: "ms" }),
  "rag.cacheMax": num("rag", "Tamanho do cache de busca", "Entradas guardadas em memória por processo.", 200, 0, 10000),
  "rag.chunkSize": num("rag", "Tamanho do trecho", "Caracteres por trecho ao indexar um documento. Vale para documentos novos.", 1000, 100, 8000, { unit: "chars" }),
  "rag.chunkOverlap": num("rag", "Sobreposição entre trechos", "Caracteres repetidos entre trechos vizinhos, para não cortar contexto.", 150, 0, 2000, { unit: "chars" }),

  // ── memória (chat/tools.ts) ──
  "memory.dedupSim": num("memory", "Similaridade para deduplicar", "Fato novo com similaridade acima disso é considerado repetido e não é gravado.", 0.92, 0.5, 1, { step: 0.01 }),
  "memory.forgetMinSim": num("memory", "Similaridade mínima para esquecer", "Ao pedir para esquecer algo, só memórias acima disso são apagadas.", 0.4, 0, 1, { step: 0.01 }),

  // ── embeddings (packages/llm/src/embeddings.ts) ──
  "embeddings.provider": sel(
    "embeddings",
    "Onde gerar embeddings",
    "Local mantém tudo em casa (Ollama). Nuvem usa Gemini ou OpenAI se houver chave. Automático prefere a nuvem quando há chave.",
    "auto",
    [
      { value: "auto", label: "Automático (nuvem se houver chave)" },
      { value: "local", label: "Sempre local (Ollama)" },
      { value: "cloud", label: "Sempre nuvem" },
    ],
    "Trocar o provedor de embedding invalida os vetores já gravados. Depois de mudar, use \"Reindexar\" na conta.",
  ),

  // ── resiliência (packages/llm/src/failover.ts) ──
  "resilience.cbThreshold": num("resilience", "Falhas para abrir o disjuntor", "Falhas seguidas de um provedor antes de pulá-lo por um tempo.", 3, 1, 20),
  "resilience.cbCooldownMs": num("resilience", "Tempo de disjuntor aberto", "Quanto tempo o provedor fica fora da cadeia depois de abrir.", 30000, 1000, 600000, { unit: "ms" }),

  // ── rotinas e regras (apps/api) ──
  "routines.tickSeconds": num("routines", "Intervalo do agendador", "De quanto em quanto tempo o processo persistente verifica rotinas e regras devidas.", 60, 10, 3600, { unit: "s" }),
  "routines.model": text("routines", "Modelo das rotinas", "Chave do modelo usado por rotinas e regras (vazio = padrão local).", ""),
  "routines.rateLimitPerMinute": num("routines", "Execuções manuais por minuto", "Limite do botão \"rodar agora\".", 6, 1, 120, { unit: "/min" }),

  // ── casa (Home Assistant, packages/core/src/home/*, apps/api) ──
  "home.entitySyncMinutes": num("home", "Sincronizar entidades a cada", "De quanto em quanto tempo o processo persistente relê os estados e nomes das entidades do Home Assistant (para a busca semântica e o índice de estado).", 5, 1, 60, { unit: "min" }),
  "home.entityTopK": num("home", "Entidades por busca", "Quantas entidades a busca semântica (\"a luz da sala\") devolve por consulta.", 5, 1, 30),
  "home.entityMinSim": num("home", "Similaridade mínima da busca de entidade", "Abaixo disso a Órbita não arrisca um palpite de qual dispositivo você quis dizer.", 0.4, 0, 1, { step: 0.01 }),
  "home.wsReconnectMs": num("home", "Reconexão do WebSocket do HA", "Espera antes de tentar reconectar ao Home Assistant depois de uma queda de conexão.", 5000, 500, 120000, { unit: "ms" }),

  // ── câmeras (packages/core/src/cameras/*, apps/api) ──
  "cameras.narrationMode": sel(
    "cameras",
    "Narração de câmera",
    "Sob demanda só descreve a cena quando você pergunta (\"o que está acontecendo na sala?\"). Automática também narra todo evento de segurança, o que gasta mais chamadas de visão.",
    "sob_demanda",
    [
      { value: "sob_demanda", label: "Sob demanda (padrão)" },
      { value: "automatica", label: "Automática em todo evento" },
    ],
  ),
  "cameras.retentionDays": num("cameras", "Retenção de eventos de câmera", "Eventos (e o snapshot guardado com eles) mais antigos que isso são apagados.", 14, 1, 90, { unit: "dias" }),
  "cameras.snapshotMaxKB": num("cameras", "Tamanho máximo do snapshot", "Acima disso o evento é aceito mas sem a imagem, para não estourar o banco com um webhook mal configurado.", 400, 50, 4000, { unit: "KB" }),

  // ── reuniões e agenda (packages/core/src/meetings/*, apps/api) ──
  "meetings.calendarPollMinutes": num("meetings", "Verificar agenda a cada", "De quanto em quanto tempo o processo persistente olha a Google Agenda em busca de reuniões próximas. Sem URL pública ainda, é polling, não push do Google.", 5, 1, 60, { unit: "min" }),
  "meetings.warnMinutesBefore": num("meetings", "Avisar reunião com antecedência de", "Quantos minutos antes do início a Órbita avisa sobre uma reunião.", 15, 1, 120, { unit: "min" }),
  "meetings.gmailPollMinutes": num("meetings", "Verificar e-mail importante a cada", "De quanto em quanto tempo o processo persistente procura e-mails novos marcados como importantes pelo próprio Gmail.", 5, 1, 60, { unit: "min" }),
  "meetings.mapChunkChars": num("meetings", "Tamanho do bloco no resumo longo", "Reunião maior que o limite de resumo direto é dividida em blocos deste tamanho, resumida por bloco e depois consolidada (mapa-redução).", 15000, 2000, 100000, { unit: "chars" }),

  // ── eventos (apps/api) ──
  "events.pollMs": num("events", "Intervalo de leitura de eventos", "Frequência com que o processo persistente lê eventos novos gravados por outros processos.", 2000, 500, 60000, { unit: "ms" }),
  "events.retentionDays": num("events", "Retenção da trilha de eventos", "Eventos mais antigos que isso são apagados.", 30, 1, 3650, { unit: "dias" }),

  // ── conectores (apps/api) ──
  "connectors.refreshCheckMinutes": num("connectors", "Verificação de tokens", "De quanto em quanto tempo o processo persistente procura tokens perto de expirar.", 10, 1, 1440, { unit: "min" }),
  "connectors.refreshAheadMinutes": num("connectors", "Renovar com antecedência de", "Tokens que expiram dentro desse prazo são renovados em segundo plano.", 15, 1, 1440, { unit: "min" }),

  // ── finanças (aviso de vencimento) ──
  "finance.billDueDays": num("finance", "Avisar contas que vencem em", "Horizonte do aviso proativo de contas a vencer.", 3, 0, 60, { unit: "dias" }),
  "finance.billDueHour": num("finance", "Hora do aviso de contas", "Hora local em que o aviso diário é gerado.", 8, 0, 23, { unit: "h" }),

  // ── limites de entrada ──
  "limits.sttMaxMb": num("limits", "Áudio máximo para transcrição", "Tamanho máximo aceito em /api/stt.", 120, 1, 1024, { unit: "MB" }),
  "limits.summaryMaxChars": num("limits", "Limiar do resumo em blocos", "Até este tamanho a reunião é resumida em uma passada só. Acima disso, o resumo vira mapa-redução (por blocos, depois consolidado) em vez de cortar a transcrição.", 100000, 1000, 2000000, { unit: "chars" }),

  // ── grafo (api/knowledge/graph) ──
  "graph.nodeLimit": num("graph", "Nós no grafo", "Quantos trechos entram no grafo de conhecimento.", 60, 5, 500),
  "graph.edgeMinSim": num("graph", "Similaridade mínima de aresta", "Só pares acima disso viram ligação.", 0.55, 0, 1, { step: 0.01 }),
  "graph.edgeLimit": num("graph", "Arestas no grafo", "Teto de ligações desenhadas.", 150, 5, 2000),

  // ── ferramentas (tools/registry.ts) ──
  "tools.maxPerTurn": num("tools", "Ferramentas por turno", "Acima disso, só as mais relevantes para o pedido vão ao modelo (seleção por palavras, sem LLM). Muitas ferramentas pioram custo e precisão.", 30, 5, 200),

  // ── acesso ──
  "auth.signupMode": sel(
    "auth",
    "Cadastro de novas contas",
    "Automático fecha depois do primeiro usuário (o dono) e reabre só para e-mails da lista.",
    "auto",
    [
      { value: "auto", label: "Automático: fecha após o primeiro usuário" },
      { value: "open", label: "Aberto (só em rede local)" },
      { value: "closed", label: "Fechado (apenas a lista)" },
    ],
  ),
  "auth.allowedEmails": list("auth", "E-mails autorizados", "Pessoas da casa que podem criar conta mesmo com o cadastro fechado. ALLOWED_EMAILS do .env entra como bootstrap."),
} as const satisfies Record<string, SettingDef<unknown>>;

export type SettingKey = keyof typeof SETTING_DEFS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFS)[K]["default"];
export type SettingValues = { [K in SettingKey]: SettingValue<K> };

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_DEFS, key);
}

/** Schema zod derivado do tipo declarado: é o que valida o que vem do front. */
export function schemaFor(def: SettingDef<unknown>): z.ZodType<unknown> {
  const t = def.type;
  switch (t.kind) {
    case "number": {
      let s = z.number().min(t.min).max(t.max);
      if (t.integer) s = s.int();
      return s;
    }
    case "boolean":
      return z.boolean();
    case "select":
      return z.enum(t.options.map((o) => o.value) as [string, ...string[]]);
    case "text":
      return z.string().max(t.maxLength ?? 200);
    case "list":
      return z.array(z.string().trim().min(1).max(t.itemMaxLength ?? 200)).max(t.maxItems ?? 200);
  }
}
