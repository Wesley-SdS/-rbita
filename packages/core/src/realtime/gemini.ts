/**
 * Montagem da sessão do Gemini Live (voz em tempo real, WebSocket).
 *
 * Tudo aqui é PURO: recebe modelo, voz, instruções e as funções já em JSON
 * Schema, devolve a mensagem `setup` que abre a sessão. O que fala com a rede
 * mora na rota (`apps/api/src/routes/realtime-session.ts`).
 *
 * Formato conferido contra a API real em 21/09/2026 (não só contra a doc, que
 * está desatualizada em dois pontos — ver a rota): setup aceito com tools e
 * transcrição, `toolCall.functionCalls[{id,name,args}]` na volta e áudio de
 * saída em `audio/pcm;rate=24000`.
 */

/** Uma função que a Órbita oferece à sessão, já em JSON Schema. */
export interface FuncaoDeclarada {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * O `Schema` do Gemini é um SUBCONJUNTO do JSON Schema, e campo que ele não
 * conhece não é ignorado: a API recusa a mensagem inteira (foi assim que
 * `liveConnectConstraints` derrubou o pedido de token). O `z.toJSONSchema`
 * emite vários desses — `$schema`, `additionalProperties`, `const`,
 * `format: "uuid"` — então o esquema passa por esta peneira antes de subir.
 *
 * Lista de permitidos em vez de lista de proibidos de propósito: uma tool nova
 * com um campo exótico do zod falharia calada com a lista invertida, e o modo
 * de falha aqui é a sessão de voz inteira não abrir.
 */
const CAMPOS_ACEITOS = new Set([
  "type",
  "description",
  "enum",
  "items",
  "properties",
  "required",
  "nullable",
  "anyOf",
  "minItems",
  "maxItems",
]);

export function limparSchemaParaGemini(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const entrada = schema as Record<string, unknown>;
  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(entrada)) {
    if (chave === "properties" && valor && typeof valor === "object") {
      const props: Record<string, unknown> = {};
      for (const [nome, sub] of Object.entries(valor as Record<string, unknown>)) props[nome] = limparSchemaParaGemini(sub);
      saida.properties = props;
      continue;
    }
    if (chave === "items") {
      saida.items = limparSchemaParaGemini(valor);
      continue;
    }
    if (chave === "anyOf" && Array.isArray(valor)) {
      saida.anyOf = valor.map((v) => limparSchemaParaGemini(v));
      continue;
    }
    // `const` do zod (z.literal) não existe no Gemini; o equivalente é um enum de um.
    if (chave === "const") {
      saida.enum = [valor];
      continue;
    }
    if (CAMPOS_ACEITOS.has(chave)) saida[chave] = valor;
  }

  // `type: ["string","null"]` (opcional do zod) vira tipo simples + nullable.
  if (Array.isArray(saida.type)) {
    const tipos = (saida.type as unknown[]).filter((t) => t !== "null");
    if (tipos.length !== saida.type.length) saida.nullable = true;
    saida.type = tipos[0] ?? "string";
  }
  // um enum sem tipo é recusado; o caso real é sempre string
  if (saida.enum && !saida.type) saida.type = "string";

  return saida;
}

export interface OpcoesSetupGemini {
  modelo: string;
  voz: string;
  instrucoes: string;
  funcoes: FuncaoDeclarada[];
}

/**
 * A mensagem `setup`, primeira coisa que trafega na sessão.
 *
 * `inputAudioTranscription` e `outputAudioTranscription` entram vazios de
 * propósito: sem eles a conversa por voz não deixa rastro nenhum na tela, e
 * o log do que foi dito é o que permite conferir depois o que a Órbita
 * entendeu (e é o mesmo que o caminho da OpenAI já dava).
 */
export function montarSetupGemini(o: OpcoesSetupGemini): Record<string, unknown> {
  const setup: Record<string, unknown> = {
    model: o.modelo.startsWith("models/") ? o.modelo : `models/${o.modelo}`,
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voz } } },
    },
    systemInstruction: { parts: [{ text: o.instrucoes }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
  };
  // sem tool nenhuma, `tools: [{functionDeclarations: []}]` é recusado
  if (o.funcoes.length) {
    setup.tools = [
      {
        functionDeclarations: o.funcoes.map((f) => ({
          name: f.name,
          description: f.description,
          parameters: limparSchemaParaGemini(f.parameters),
        })),
      },
    ];
  }
  return setup;
}

/** URL do WebSocket da sessão. O token efêmero vai na query porque o WebSocket do navegador não manda header. */
export function urlSessaoGemini(token: string): string {
  return (
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
    encodeURIComponent(token)
  );
}

/** Origem do WebSocket, para a CSP liberar exatamente este destino e nada mais. */
export const ORIGEM_GEMINI_LIVE = "wss://generativelanguage.googleapis.com";
