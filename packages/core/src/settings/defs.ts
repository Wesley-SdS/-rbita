import { z } from "zod";
// Import só de TIPO: `defs.ts` é folha, importada por quase tudo, e puxar o
// packages/llm em runtime daqui quebraria todo teste que simula aquele módulo.
// O `Record` continua garantindo, em tempo de compilação, que a tela ofereça
// exatamente as ordens que o failover conhece.
import type { FailoverOrder } from "@orbita/llm";

const FAILOVER_LABEL: Record<FailoverOrder, string> = {
  assinatura_local_paga: "Assinatura, depois local, depois nuvem paga",
  assinatura_paga_local: "Assinatura, depois nuvem paga, depois local",
  local_primeiro: "Local primeiro (máxima privacidade, lento sem GPU)",
};
const FAILOVER_OPTIONS = (Object.entries(FAILOVER_LABEL) as [FailoverOrder, string][]).map(([value, label]) => ({ value, label }));

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
  | { kind: "text"; maxLength?: number; minLength?: number; multiline?: boolean }
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
  /** dado pessoal da casa: quem não é o dono vê a chave, mas não o valor (RV.1) */
  sensitive?: boolean;
}

export const SETTING_GROUPS = {
  chat: { label: "Motor do chat", order: 10 },
  prompt: { label: "Prompt", order: 20 },
  rag: { label: "Conhecimento (RAG)", order: 30 },
  memory: { label: "Memória", order: 40 },
  embeddings: { label: "Embeddings", order: 45 },
  models: { label: "Modelos", order: 47 },
  resilience: { label: "Resiliência", order: 50 },
  routines: { label: "Rotinas e regras", order: 60 },
  tools: { label: "Ferramentas", order: 62 },
  meetings: { label: "Reuniões e agenda", order: 63 },
  home: { label: "Casa (Home Assistant)", order: 64 },
  cameras: { label: "Câmeras", order: 64.5 },
  vision: { label: "Visão: objetos e gestos", order: 64.8 },
  guided: { label: "Acompanhar tarefa (receita passo a passo)", order: 64.9 },
  jobs: { label: "Trabalhos em segundo plano", order: 65.5 },
  events: { label: "Eventos", order: 65 },
  connectors: { label: "Conectores", order: 70 },
  finance: { label: "Finanças", order: 75 },
  limits: { label: "Limites", order: 80 },
  graph: { label: "Grafo de conhecimento", order: 85 },
  identity: { label: "Identidade e biometria", order: 66 },
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
const list = (group: SettingGroupId, label: string, description: string, def: string[] = [], extra: { sensitive?: boolean } = {}): SettingDef<string[]> => ({
  group,
  label,
  description,
  default: def,
  sensitive: extra.sensitive,
  type: { kind: "list", maxItems: 200, itemMaxLength: 200 },
});
const bool = (group: SettingGroupId, label: string, description: string, def: boolean): SettingDef<boolean> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "boolean" },
});
const text = (group: SettingGroupId, label: string, description: string, def: string, maxLength = 200, multiline = false, minLength?: number): SettingDef<string> => ({
  group,
  label,
  description,
  default: def,
  type: { kind: "text", maxLength, minLength, multiline: multiline || undefined },
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
  "chat.trivialMaxChars": num("chat", "Mensagem trivial até", "Mensagens mais curtas que isso começam a responder sem esperar a busca de contexto (RAG). O modelo ainda pode buscar sob demanda.", 14, 0, 200, { unit: "chars" }),
  "chat.conversationalMaxChars": num("chat", "Saudação curta até", "Saudações e agradecimentos até este tamanho, sem indício de assunto pessoal, também pulam a busca de contexto.", 40, 0, 400, { unit: "chars" }),
  "chat.summaryEnabled": bool("chat", "Resumo da conversa", "Conversa longa não esquece nada: o que sai da janela de histórico é resumido e continua indo para o modelo. Desligado, o que sai da janela some.", true),
  "chat.summaryBatch": num("chat", "Resumo: mensagens por vez", "Quantas mensagens o resumo junta em cada chamada ao modelo.", 40, 5, 200, { unit: "mensagens" }),
  "chat.summaryMaxChars": num("chat", "Resumo: tamanho máximo", "Teto do resumo acumulado de uma conversa. Maior guarda mais detalhe e pesa mais em cada mensagem.", 6000, 500, 40000, { unit: "chars" }),
  "chat.summaryModel": text("chat", "Resumo: modelo", "Modelo usado para resumir a conversa. Vazio usa o modelo reserva.", ""),
  "chat.summaryMaxPending": num("chat", "Resumo: teto de mensagens não resumidas por turno", "Só vale para conversa antiga, de antes do resumo existir: o turno leva estas mais recentes e o resto é resumido logo em seguida.", 60, 10, 500, { unit: "mensagens" }),
  "chat.fastPathEnabled": bool("chat", "Caminho rápido para comando da casa", "Comando curto de casa (\"apaga a luz da sala\") vai direto, só com as ferramentas da casa, sem buscar na memória nem carregar extensões. Responde bem mais rápido.", true),
  "chat.fastPathMaxChars": num("chat", "Caminho rápido: tamanho máximo", "Mensagem mais longa que isto nunca vai pelo caminho rápido: pedido longo costuma precisar de contexto.", 80, 10, 400, { unit: "chars" }),
  "chat.fastPathHistory": num("chat", "Caminho rápido: mensagens de histórico", "Quantas mensagens anteriores o comando de casa leva (\"e a do quarto também\" precisa da anterior).", 2, 0, 20, { unit: "mensagens" }),
  "chat.rateLimitPerMinute": num("chat", "Limite de turnos por minuto", "Proteção contra loop de custo: cada turno dispara LLM, embeddings e RAG.", 30, 1, 600, { unit: "/min" }),

  // ── prompt (chat/compose.ts) ──
  "prompt.budgetTokens": num("prompt", "Orçamento do system prompt", "Acima disso, os blocos compressíveis de menor prioridade (RAG, skills) são cortados.", 3200, 500, 50000, { unit: "tokens" }),
  "prompt.prioritySummary": num("prompt", "Prioridade: resumo da conversa", "O que já foi conversado e saiu da janela de histórico.", 110, 0, 129),
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

  // ── modelos (packages/llm/src/policy.ts, via settings/apply.ts) ──
  "llm.failoverOrder": sel(
    "models",
    "Ordem do failover",
    "Quando o modelo escolhido falha antes de começar a responder, a Órbita tenta outro nesta ordem. Nuvem que não informa preço fica sempre depois da nuvem com preço.",
    "assinatura_local_paga",
    FAILOVER_OPTIONS,
  ),
  "llm.defaultPreference": sel(
    "models",
    "Modelo pré-selecionado",
    "Qual modelo já vem escolhido no chat. Sem GPU, um modelo local pode levar de 30 segundos a minutos por resposta.",
    "nuvem",
    [
      { value: "nuvem", label: "O melhor de nuvem (responde rápido)" },
      { value: "local", label: "O melhor local (tudo fica em casa)" },
    ],
  ),
  "llm.fallbackModel": text("models", "Modelo reserva", "Chave do modelo (ex.: local/qwen2.5:3b) usada quando nada foi descoberto e por resumos, extratos e rotinas sem modelo definido. Vazio usa o padrão de instalação.", ""),
  "llm.discoveryTtlMinutes": num("models", "Renovar a lista de modelos a cada", "A lista vencida continua valendo e é renovada em segundo plano, sem atrasar a resposta.", 5, 1, 1440, { unit: "min" }),
  "llm.discoveryTimeoutMs": num("models", "Timeout por provedor na descoberta", "Quanto esperar cada provedor responder a lista de modelos.", 4000, 500, 30000, { unit: "ms" }),

  // ── resiliência (packages/llm/src/failover.ts) ──
  "resilience.cbThreshold": num("resilience", "Falhas para abrir o disjuntor", "Falhas seguidas de um provedor antes de pulá-lo por um tempo.", 3, 1, 20),
  "resilience.healthPingMs": num("resilience", "Timeout do teste de saúde", "Quanto o /api/health espera o serviço de voz e o Ollama responderem antes de marcar como fora do ar. Com a CPU ocupada, 1,5 s dava falso negativo.", 3000, 200, 30000, { unit: "ms" }),
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
  "cameras.ingestRateLimitPerMinute": num("cameras", "Eventos por minuto (por câmera)", "Acima disso, o webhook de ingestão recusa novos eventos da mesma câmera. Protege o banco e evita disparar regra automática em excesso (cada evento pode virar uma chamada de modelo).", 60, 5, 600, { unit: "/min" }),

  // ── reuniões e agenda (packages/core/src/meetings/*, apps/api) ──
  "meetings.calendarPollMinutes": num("meetings", "Verificar agenda a cada", "De quanto em quanto tempo o processo persistente olha a Google Agenda em busca de reuniões próximas. Sem URL pública ainda, é polling, não push do Google.", 5, 1, 60, { unit: "min" }),
  "meetings.warnMinutesBefore": num("meetings", "Avisar reunião com antecedência de", "Quantos minutos antes do início a Órbita avisa sobre uma reunião.", 15, 1, 120, { unit: "min" }),
  "meetings.gmailPollMinutes": num("meetings", "Verificar e-mail importante a cada", "De quanto em quanto tempo o processo persistente procura e-mails novos marcados como importantes pelo próprio Gmail.", 5, 1, 60, { unit: "min" }),
  "meetings.mapChunkChars": num("meetings", "Tamanho do bloco no resumo longo", "Reunião maior que o limite de resumo direto é dividida em blocos deste tamanho, resumida por bloco e depois consolidada (mapa-redução).", 15000, 2000, 100000, { unit: "chars" }),

  // ── eventos (apps/api) ──
  "events.pollMs": num("events", "Intervalo de leitura de eventos", "Frequência com que o processo persistente lê eventos novos gravados por outros processos.", 2000, 500, 60000, { unit: "ms" }),
  "events.pruneEveryHours": num("events", "Limpeza de retenção a cada", "De quanto em quanto tempo o processo persistente apaga eventos e eventos de câmera vencidos.", 6, 1, 168, { unit: "h" }),
  "events.pendingMaxAgeHours": num("events", "Idade máxima de evento pendente", "Evento gravado enquanto o processo persistente estava parado é despachado quando ele volta, desde que seja mais novo que isso. Mais velho é só marcado, para não disparar aviso atrasado.", 24, 1, 720, { unit: "h" }),
  "events.retentionDays": num("events", "Retenção da trilha de eventos", "Eventos mais antigos que isso são apagados.", 30, 1, 3650, { unit: "dias" }),

  // ── conectores (apps/api) ──
  "connectors.refreshCheckMinutes": num("connectors", "Verificação de tokens", "De quanto em quanto tempo o processo persistente procura tokens perto de expirar.", 10, 1, 1440, { unit: "min" }),
  "connectors.refreshBackoffMaxHours": num("connectors", "Espera máxima após falha de renovação", "Conexão que falha ao renovar é tentada de novo com espera crescente, até este teto. O aviso \"reconecte\" sai uma vez só.", 24, 1, 168, { unit: "h" }),
  "connectors.refreshAheadMinutes": num("connectors", "Renovar com antecedência de", "Tokens que expiram dentro desse prazo são renovados em segundo plano.", 15, 1, 1440, { unit: "min" }),

  // ── finanças (aviso de vencimento) ──
  "finance.billDueDays": num("finance", "Avisar contas que vencem em", "Horizonte do aviso proativo de contas a vencer.", 3, 0, 60, { unit: "dias" }),
  "finance.billCheckMinutes": num("finance", "Checar a hora do aviso a cada", "Granularidade com que o processo persistente confere se chegou a hora do aviso diário de contas.", 1, 1, 60, { unit: "min" }),
  "finance.statementBlockChars": num("finance", "Tamanho do bloco do extrato", "Extrato em PDF é lido pelo modelo em blocos deste tamanho.", 6000, 1000, 50000, { unit: "chars" }),
  "finance.statementMaxBlocks": num("finance", "Blocos máximos por extrato", "Teto de segurança: acima disso o resto do extrato é ignorado, para um PDF enorme não virar dezenas de chamadas de modelo.", 12, 1, 200),
  "finance.billDueHour": num("finance", "Hora do aviso de contas", "Hora local em que o aviso diário é gerado.", 8, 0, 23, { unit: "h" }),

  // ── limites de entrada ──
  "limits.uploadMaxMb": num("limits", "Arquivo máximo enviado", "Tamanho máximo de arquivo para indexar, comprovante e extrato. O arquivo fica guardado até o trabalho terminar, e é apagado em seguida.", 25, 1, 200, { unit: "MB" }),
  "limits.sttMaxMb": num("limits", "Áudio máximo para transcrição", "Tamanho máximo aceito em /api/stt.", 120, 1, 1024, { unit: "MB" }),
  "limits.ingestPerMinute": num("limits", "Documentos indexados por minuto", "Limite de /api/ingest por conta (cada documento gera embeddings).", 20, 1, 600, { unit: "/min" }),
  "limits.reindexPerMinute": num("limits", "Reindexações por minuto", "Limite do botão Reindexar (refaz todos os embeddings da conta).", 3, 1, 60, { unit: "/min" }),
  "limits.summaryMaxChars": num("limits", "Limiar do resumo em blocos", "Até este tamanho a reunião é resumida em uma passada só. Acima disso, o resumo vira mapa-redução (por blocos, depois consolidado) em vez de cortar a transcrição.", 100000, 1000, 2000000, { unit: "chars" }),

  // ── grafo (api/knowledge/graph) ──
  "graph.nodeLimit": num("graph", "Nós no grafo", "Quantos trechos entram no grafo de conhecimento.", 60, 5, 500),
  "graph.edgeMinSim": num("graph", "Similaridade mínima de aresta", "Só pares acima disso viram ligação.", 0.55, 0, 1, { step: 0.01 }),
  "graph.edgeLimit": num("graph", "Arestas no grafo", "Teto de ligações desenhadas.", 150, 5, 2000),

  // ── ferramentas (tools/registry.ts) ──
  "tools.maxPerTurn": num("tools", "Ferramentas por turno", "Acima disso, só as mais relevantes para o pedido vão ao modelo (seleção por palavras, sem LLM). Muitas ferramentas pioram custo e precisão.", 30, 5, 200),

  "meetings.sttCloud": sel(
    "meetings",
    "Transcrever reunião na nuvem",
    "Com a chave do AssemblyAI configurada, a transcrição vai para a nuvem (melhor separação de quem falou). Desligado, transcreve aqui com o whisper local, mais lento e sem diarização tão boa. O RECONHECIMENTO de quem é quem é sempre local, nos dois casos.",
    "quando_houver_chave",
    [
      { value: "quando_houver_chave", label: "Sim, quando houver chave" },
      { value: "nunca", label: "Não, só nesta casa" },
    ],
  ),

  // ── servidores MCP: conexão só quando precisa ──
  "mcp.connectTimeoutMs": num("tools", "MCP: tempo para conectar", "Quanto esperar um servidor MCP responder ao conectar. Servidor fora do ar custa no máximo isto, e só quando uma tool dele é usada.", 5000, 500, 60000, { unit: "ms" }),
  "mcp.callTimeoutMs": num("tools", "MCP: tempo máximo de uma chamada", "Quanto esperar a resposta de uma tool MCP.", 60000, 1000, 600000, { unit: "ms" }),
  "mcp.idleMinutes": num("tools", "MCP: fechar conexão parada após", "Conexão sem uso por este tempo é fechada. A próxima chamada reabre sozinha.", 15, 1, 1440, { unit: "min" }),
  "mcp.catalogRefreshHours": num("tools", "MCP: atualizar a lista de tools a cada", "A lista de tools de cada servidor fica guardada e é o que o modelo enxerga, sem conectar a cada mensagem. De tempos em tempos ela é buscada de novo.", 24, 1, 720, { unit: "h" }),
  "mcp.retryAfterSeconds": num("tools", "MCP: esperar antes de tentar de novo", "Servidor que nunca respondeu (sem lista de tools guardada) espera isto antes de uma nova tentativa, para não custar um timeout em toda mensagem.", 60, 5, 3600, { unit: "s" }),

  // ── fila de trabalho pesado ──
  "jobs.pollSeconds": num("jobs", "Conferir a fila a cada", "Piso de segurança: o trabalho novo acorda o processo na hora, então isto só pega retentativa agendada e fila herdada de um processo que caiu.", 3, 1, 300, { unit: "s" }),
  "jobs.maxAttempts": num("jobs", "Tentativas por trabalho", "Quantas vezes tentar antes de desistir e mostrar o erro na tela. Erro de validação ou falta de consentimento não retenta nunca, independente disto.", 3, 1, 10),
  "jobs.retryBaseSeconds": num("jobs", "Espera base da retentativa", "A espera é sorteada entre zero e o dobro da anterior, a partir desta base (backoff com jitter).", 10, 1, 600, { unit: "s" }),
  "jobs.retryMaxSeconds": num("jobs", "Espera máxima da retentativa", "Teto da espera entre tentativas.", 600, 5, 86400, { unit: "s" }),
  "jobs.staleMinutes": num("jobs", "Trabalho parado vira zumbi após", "Trabalho que está rodando mas parou de dar sinal de vida por este tempo é recuperado. O sinal vem junto com o progresso, então trabalho vivo nunca é morto por engano.", 5, 1, 240, { unit: "min" }),
  "jobs.keepDoneDays": num("jobs", "Guardar trabalhos concluídos por", "Depois disso a Órbita apaga o registro dos que deram certo.", 7, 1, 365, { unit: "dias" }),
  "jobs.keepFailedDays": num("jobs", "Guardar trabalhos que falharam por", "Falha fica mais tempo que sucesso: é o que explica o que deu errado.", 30, 1, 365, { unit: "dias" }),

  // ── acompanhar tarefa passo a passo (PRD §5.4) ──
  "guided.intervalSeconds": num("guided", "Olhar a cada", "De quanto em quanto tempo a Órbita olha a câmera para ver se você terminou o passo. Muito curto pesa na máquina (cada olhada é uma chamada ao modelo de visão); muito longo faz ela avisar tarde.", 45, 10, 600, { unit: "s" }),
  "guided.maxMinutes": num("guided", "Prazo da tarefa", "Toda tarefa acompanhada encerra sozinha depois disso. É a trava para acompanhamento esquecido não virar câmera vigiando o cômodo.", 120, 5, 480, { unit: "min" }),
  "guided.maxSteps": num("guided", "Máximo de passos", "Teto de passos por tarefa. Receita com mais que isso vira lista impossível de acompanhar por voz.", 30, 1, 100),
  "guided.retentionDays": num("guided", "Guardar tarefas encerradas por", "Depois disso a Órbita apaga o histórico de tarefas acompanhadas.", 30, 1, 365, { unit: "dias" }),
  "guided.question": text(
    "guided",
    "Pergunta feita à câmera",
    "O que a Órbita pergunta ao modelo de visão a cada olhada. Use {passo} para o passo atual e {tarefa} para o nome da tarefa. Modelo de visão pequeno responde melhor com pergunta curta e fechada.",
    "Nesta imagem, a pessoa já terminou este passo: \"{passo}\"? Responda começando com SIM ou NÃO, e depois uma frase curta dizendo o que você está vendo. Se a imagem não deixar claro, comece com NÃO DÁ PARA SABER.",
    400,
    true,
  ),

  // ── visão: memória de objetos e gestos (Onda 11) ──
  "vision.trackedObjects": list(
    "vision",
    "Objetos que a Órbita lembra onde viu",
    "Só estes rótulos entram na memória visual (\"onde deixei a chave?\"). O rótulo é o que a câmera manda: chave, mochila, celular, carteira, controle. Lista vazia desliga a memória visual.",
    ["chave", "mochila", "celular", "carteira", "óculos", "controle"],
  ),
  "vision.retentionHours": num("vision", "Memória visual dura", "Depois disso a Órbita esquece onde viu o objeto.", 48, 1, 720, { unit: "h" }),
  "vision.objectResults": num("vision", "Avistamentos por objeto na resposta", "Quantos avistamentos a Órbita lista ao responder onde um objeto foi visto. Mais que isso vira texto longo demais para ouvir.", 5, 1, 50),
  "vision.digestMaxEvents": num("vision", "Eventos no resumo das câmeras", "Teto de eventos lidos ao resumir o que as câmeras viram num período. Período movimentado é cortado neste número, do mais recente para trás.", 200, 10, 2000),
  "vision.localModel": text("vision", "Modelo de visão local", "Modelo do Ollama que descreve a imagem quando a resposta precisa ficar nesta casa (câmera com identificação, modo privacidade). Precisa estar instalado no Ollama.", "moondream"),
  "vision.cloudModel": text("vision", "Modelo de visão de nuvem", "Modelo usado quando a nuvem é permitida (ver a tela, câmera sem identificação, com chave da OpenAI configurada).", "gpt-4o"),
  "vision.gestures": list(
    "vision",
    "Gestos reconhecidos",
    "Gestos que viram evento (o que cada um FAZ é a regra que você cadastra, e pode ser diferente por pessoa). Vazio aceita todos os que o serviço conhece.",
    ["mao_levantada", "joinha", "paz"],
  ),

  // ── identidade e biometria (packages/core/src/identity, Fase 2) ──
  "identity.consentTerm": text(
    "identity",
    "Termo de consentimento biométrico",
    "Texto que a pessoa (ou o responsável, se for menor) lê e aceita antes de qualquer cadastro de voz ou rosto. O texto exato aceito fica guardado com o consentimento; mudar o termo não altera consentimentos antigos.",
    [
      "Autorizo a Órbita, assistente pessoal desta casa, a guardar uma assinatura da minha voz e/ou do meu rosto para me reconhecer em reuniões, comandos de voz e câmeras da casa.",
      "Essa assinatura e as amostras usadas para criá-la ficam apenas nos computadores desta casa e nunca são enviadas a serviços de nuvem.",
      "Cada reconhecimento fica registrado. Ninguém pergunta sobre mim sem permissão.",
      "Posso revogar este consentimento a qualquer momento. Ao apagar minha biometria, amostras, assinaturas e referências a mim são removidas.",
      "Menores de idade só são cadastrados com o consentimento do responsável.",
    ].join("\n\n"),
    4000,
    true,
    // termo vazio gravaria consentimento sobre nada
    40,
  ),
  "identity.askAboutOthersDefault": sel(
    "identity",
    "Perguntar sobre outra pessoa",
    "Regra quando não há permissão explícita cadastrada. O dono sempre pode, cada um pode sobre si, e o responsável pode sobre o menor dele.",
    "negado",
    [
      { value: "negado", label: "Negado sem permissão explícita (padrão)" },
      { value: "moradores_entre_si", label: "Moradores adultos podem perguntar uns sobre os outros" },
    ],
  ),

  "identity.perceptionUrl": text("identity", "Serviço de percepção", "Endereço do apps/perception nesta casa. Só aceita endereço local: biometria nunca sai de casa.", "http://127.0.0.1:8002"),
  "identity.perceptionTimeoutMs": num("identity", "Timeout do serviço de percepção", "Quanto esperar o cálculo de assinaturas. Reunião longa leva mais.", 60000, 1000, 600000, { unit: "ms" }),
  "identity.voiceModel": sel(
    "identity",
    "Modelo de assinatura de voz",
    "Escolhido pela medição nesta máquina. Trocar exige recalcular as assinaturas a partir das amostras guardadas.",
    // medição de 17/09 com a voz do dono: único que separou das vozes sintéticas
    "wespeaker_resnet34",
    [
      { value: "wespeaker_resnet34", label: "WeSpeaker ResNet34 (256 d, escolhido na medição)" },
      { value: "titanet_small", label: "TitaNet small (192 d, rápido, erra frase curta)" },
      { value: "campplus_voxceleb", label: "CAM++ VoxCeleb (512 d)" },
    ],
    "As assinaturas de outro modelo deixam de valer até recalcular.",
  ),
  "identity.voiceMatchThreshold": num("identity", "Voz: limiar para afirmar", "Similaridade mínima para dizer quem falou. Medição de 17/09: suas frases ficaram entre 0,81 e 0,94; vozes sintéticas até 0,62.", 0.75, 0, 1, { step: 0.01 }),
  "identity.voiceProbableThreshold": num("identity", "Voz: limiar de \"provavelmente\"", "Abaixo disso a voz é desconhecida; entre este e o limiar de afirmar, a Órbita diz \"provavelmente\".", 0.62, 0, 1, { step: 0.01 }),
  "identity.voiceMargin": num("identity", "Voz: folga sobre a segunda pessoa", "Se duas pessoas ficam perto demais (parentes, vozes parecidas), não afirma.", 0.08, 0, 1, { step: 0.01 }),
  "identity.voiceMinSpeechSeconds": num("identity", "Voz: fala mínima para afirmar", "Fala mais curta que isso sai no máximo como \"provavelmente\". Na medição, frases abaixo de 1 s de fala foram as que mais erraram.", 1, 0.5, 30, { step: 0.5, unit: "s" }),
  "identity.voiceEnrollMinSeconds": num("identity", "Voz: fala mínima no cadastro", "Gravação de cadastro com menos fala que isso é recusada.", 20, 5, 300, { unit: "s" }),
  "identity.voiceEnrollRecordSeconds": num("identity", "Voz: duração da gravação de cadastro", "Quanto tempo a tela grava ao cadastrar uma voz. Precisa ser maior que a fala mínima, porque gravação tem pausa e respiração.", 45, 10, 600, { unit: "s" }),
  "identity.voiceTestRecordSeconds": num("identity", "Voz: duração do teste", "Quanto tempo a tela grava ao testar se a Órbita reconhece a voz.", 4, 2, 60, { unit: "s" }),
  "identity.meetingSpeakerMaxSeconds": num("identity", "Reunião: fala usada por locutor", "Quantos segundos das falas mais longas de cada locutor entram no reconhecimento.", 40, 5, 300, { unit: "s" }),
  "identity.speakerRefTtlMinutes": num("identity", "Reunião: janela para usar a fala como amostra", "Por quanto tempo depois da transcrição dá para nomear um locutor e usar a fala dele como amostra de voz.", 120, 5, 1440, { unit: "min" }),
  "identity.commandTimeoutMs": num("identity", "Voz do comando: tempo máximo", "Quanto esperar para saber quem pediu. Passou disso, segue sem identificar (e, na política restrita, como visitante).", 3000, 500, 30000, { unit: "ms" }),
  "identity.enrollMaxMb": num("identity", "Voz: tamanho máximo do cadastro", "Gravação de cadastro maior que isso é recusada (o áudio fica cifrado no banco para recalcular assinaturas).", 10, 1, 100, { unit: "MB" }),
  "identity.faceBackend": sel(
    "identity",
    "Backend de reconhecimento de rosto",
    "Escolhido pela medição nesta máquina. Trocar exige recalcular as assinaturas a partir das fotos guardadas.",
    "insightface_s",
    [
      { value: "insightface_s", label: "InsightFace S (512 d, escolhido na medição)" },
      { value: "opencv", label: "OpenCV YuNet + SFace (128 d, degrada menos com o modelo local rodando)" },
      { value: "insightface_l", label: "InsightFace L (512 d, mais pesado)" },
    ],
    "As assinaturas do outro backend deixam de valer até recalcular.",
  ),
  "identity.faceMatchThreshold": num("identity", "Rosto: limiar para afirmar", "Medição de 17/09: suas fotos ficaram acima de 0,77; 60 rostos públicos ficaram abaixo de 0,22.", 0.5, 0, 1, { step: 0.01 }),
  "identity.faceProbableThreshold": num("identity", "Rosto: limiar de \"provavelmente\"", "Abaixo disso o rosto é desconhecido.", 0.35, 0, 1, { step: 0.01 }),
  "identity.faceMargin": num("identity", "Rosto: folga sobre a segunda pessoa", "Parentes parecidos não podem virar afirmação.", 0.06, 0, 1, { step: 0.01 }),
  "identity.faceMinSizePx": num("identity", "Rosto: tamanho mínimo", "Rosto menor que isso na imagem identifica mal e é ignorado.", 60, 20, 500, { unit: "px" }),
  "identity.faceEnrollMaxMb": num("identity", "Rosto: tamanho máximo da foto", "Foto de cadastro maior que isso é recusada (fica cifrada no banco para recalcular).", 8, 1, 50, { unit: "MB" }),
  "identity.identifyMinIntervalSeconds": num("identity", "Intervalo mínimo entre identificações", "O detector da câmera manda vários eventos por segundo quando alguém passa. A Órbita identifica no máximo uma vez por câmera nesse intervalo.", 5, 1, 300, { unit: "s" }),
  "identity.identifyLabels": list(
    "identity",
    "Rótulos que valem identificação",
    "Só eventos com estes rótulos (o que a câmera detectou) passam pelo reconhecimento de rosto e gesto. Evita rodar visão em carro e movimento. Vazio aceita todos.",
    ["person", "people", "pessoa"],
  ),
  "identity.presenceFreshMinutes": num("identity", "Presença: considerar \"agora\" por", "Depois disso, a Órbita responde \"visto por último\" em vez de afirmar onde a pessoa está.", 5, 1, 120, { unit: "min" }),
  "identity.presenceRecentMinutes": num("identity", "Presença: considerar \"recente\" por", "Acima disso o avistamento é tratado como antigo.", 60, 5, 1440, { unit: "min" }),
  "identity.unknownRetentionDays": num("identity", "Retenção de desconhecido", "Por quantos dias uma voz ou rosto desconhecido fica guardado para ser reconhecido de novo ou nomeado. Depois some sozinho.", 7, 1, 90, { unit: "dias" }),
  "identity.commandClipMaxKB": num("identity", "Trecho de voz do comando", "Tamanho máximo do trecho gravado junto do ditado para saber quem pediu.", 400, 50, 4000, { unit: "KB" }),
  "identity.commandClipSeconds": num("identity", "Duração do trecho de voz do comando", "Quantos segundos de voz o navegador guarda junto do ditado para a Órbita saber quem pediu. Muito curto não identifica; muito longo pesa no envio.", 6, 2, 30, { unit: "s" }),
  "identity.unknownVoicePolicy": sel(
    "identity",
    "Comando de voz não reconhecido",
    "Quando a voz de um comando não é reconhecida com confiança: tratar como a conta logada, ou com as permissões de visitante. Ação perigosa sempre vai para aprovação.",
    "conta",
    [
      { value: "conta", label: "Como a conta logada (padrão)" },
      { value: "restrito", label: "Como visitante (mais restrito)" },
    ],
  ),

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
  "auth.allowedEmails": list("auth", "E-mails autorizados", "Pessoas da casa que podem criar conta mesmo com o cadastro fechado. ALLOWED_EMAILS do .env entra como bootstrap.", [], { sensitive: true }),
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
      return z.string().min(t.minLength ?? 0).max(t.maxLength ?? 200);
    case "list":
      return z.array(z.string().trim().min(1).max(t.itemMaxLength ?? 200)).max(t.maxItems ?? 200);
  }
}
