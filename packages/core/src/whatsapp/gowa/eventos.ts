import { z } from "zod";

/**
 * Payloads do webhook do GOWA, portados do `whatsapp-workspace`
 * (packages/contracts/src/gowa-events.ts), onde foram escritos a partir do
 * `docs/webhook-payload.md` do go-whatsapp-web-multidevice.
 *
 * Envelope: `{ event, device_id, session_id, timestamp?, payload }`. O
 * `device_id` é o JID do número; `session_id` é o id que registramos em
 * `POST /devices` (o nosso `wa_sessao.deviceId`).
 *
 * Validado na borda com `safeParse`: evento que não casa com nenhum schema
 * específico cai no envelope genérico e NUNCA derruba o resto.
 */
const envelopeSchema = z.object({
  event: z.string(),
  device_id: z.string().optional(),
  session_id: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

/**
 * Mídia chega de três jeitos: caminho local (`statics/media/...`) quando o
 * download automático está ligado e não há legenda; objeto com `path` e
 * `caption` quando há legenda; objeto com `url` quando o download está
 * desligado.
 */
export const gowaMediaRefSchema = z.union([
  z.string(),
  z.object({
    path: z.string().optional(),
    url: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
    mime_type: z.string().optional(),
  }),
]);
export type GowaMediaRef = z.infer<typeof gowaMediaRefSchema>;

export const GOWA_MEDIA_FIELDS = ["image", "video", "audio", "document", "sticker", "video_note"] as const;
export type GowaMediaKind = (typeof GOWA_MEDIA_FIELDS)[number];

const ts = z.union([z.string(), z.number()]).optional();

export const gowaMessagePayloadSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  from: z.string().optional(),
  from_lid: z.string().optional(),
  from_name: z.string().optional(),
  sender_display_name: z.string().optional(),
  timestamp: ts,
  is_from_me: z.boolean().optional(),
  body: z.string().optional(),
  replied_to_id: z.string().optional(),
  quoted_body: z.string().optional(),
  forwarded: z.boolean().optional(),
  view_once: z.boolean().optional(),
  image: gowaMediaRefSchema.optional(),
  video: gowaMediaRefSchema.optional(),
  audio: gowaMediaRefSchema.optional(),
  document: gowaMediaRefSchema.optional(),
  sticker: gowaMediaRefSchema.optional(),
  video_note: gowaMediaRefSchema.optional(),
  contact: z.unknown().optional(),
  contacts: z.unknown().optional(),
  location: z.unknown().optional(),
  live_location: z.unknown().optional(),
});
export type GowaMessagePayload = z.infer<typeof gowaMessagePayloadSchema>;

export const gowaMessageEventSchema = envelopeSchema.extend({ event: z.literal("message"), payload: gowaMessagePayloadSchema });

export const gowaRevokedEventSchema = envelopeSchema.extend({
  event: z.literal("message.revoked"),
  payload: z.object({ chat_id: z.string().optional(), revoked_message_id: z.string(), timestamp: ts }),
});

export const gowaEditedEventSchema = envelopeSchema.extend({
  event: z.literal("message.edited"),
  payload: z.object({ id: z.string(), chat_id: z.string().optional(), original_message_id: z.string(), body: z.string().optional(), timestamp: ts }),
});

/** Reação. `emoji` vazio é REMOÇÃO: é assim que o WhatsApp desfaz uma reação. */
export const gowaReactionEventSchema = envelopeSchema.extend({
  event: z.literal("message.reaction"),
  payload: z.object({ chat_id: z.string().optional(), from: z.string().optional(), reacted_message_id: z.string(), emoji: z.string().default("") }),
});

/** Ordem importa: os específicos primeiro, o envelope genérico por último. */
export const gowaEventSchema = z.union([gowaMessageEventSchema, gowaRevokedEventSchema, gowaEditedEventSchema, gowaReactionEventSchema, envelopeSchema]);
export type GowaEvent = z.infer<typeof gowaEventSchema>;

/**
 * Chave de idempotência do evento `(deviceId, tipo, externalId)`. Nulo é
 * "efêmero, não guarde" (presença, ack: a Órbita não mostra tique de entrega).
 */
export function gowaEventExternalId(ev: GowaEvent): string | null {
  const p = ev.payload as Record<string, unknown>;
  switch (ev.event) {
    case "message":
      return String(p.id);
    case "message.revoked":
      return String(p.revoked_message_id);
    case "message.edited":
      return String(p.id);
    case "message.reaction":
      // quem reagiu entra na chave: duas pessoas reagindo à mesma mensagem são
      // dois eventos, não uma reentrega
      return `${String(p.reacted_message_id)}:${typeof p.from === "string" ? p.from : ""}`;
    default:
      return null;
  }
}

/** Primeira mídia presente no payload, com o campo de origem. */
export function gowaMediaOf(payload: GowaMessagePayload): { kind: GowaMediaKind; ref: GowaMediaRef } | null {
  for (const kind of GOWA_MEDIA_FIELDS) {
    const ref = payload[kind];
    if (ref !== undefined) return { kind, ref };
  }
  return null;
}
