import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { toToolSet, type ToolDef } from "./registry";

/**
 * O gancho `preparar` (PRD-WHATSAPP, auditoria): o que o dono aprova é
 * exatamente o que roda. A entrada é fixada ANTES de enfileirar, e é ela que
 * vai para a fila e para o resumo.
 */
const Entrada = z.object({ para: z.string(), para_nome: z.string().nullish() });
const enviar: ToolDef<typeof Entrada> = {
  name: "enviar_teste",
  domain: "teste",
  description: "Envia.",
  risk: "efeito_externo",
  inputSchema: Entrada,
  summarize: (i) => `Enviar para ${i.para_nome ?? "?"} (${i.para})`,
  preparar: async (i) => ({ ...i, para: "5511922222222@s.whatsapp.net", para_nome: "Maria" }),
  run: async () => "enviado",
};

describe("preparar", () => {
  it("a entrada FIXADA vai para a fila e para o resumo", async () => {
    const enqueue = vi.fn(async (_d, _i, resumo: string) => ({ proposta_enfileirada: true as const, aguardando_aprovacao: true as const, resumo }));
    const set = toToolSet([enviar], { userId: "u1" }, { enqueue });
    const r = await set.enviar_teste!.execute!({ para: "maria" }, { toolCallId: "t", messages: [] });
    expect(enqueue).toHaveBeenCalledWith(enviar, { para: "5511922222222@s.whatsapp.net", para_nome: "Maria" }, "Enviar para Maria (5511922222222@s.whatsapp.net)");
    expect(r).toMatchObject({ resumo: "Enviar para Maria (5511922222222@s.whatsapp.net)" });
  });

  it("recusa do authorize vem antes: nada é preparado nem enfileirado", async () => {
    const preparar = vi.fn(enviar.preparar!);
    const enqueue = vi.fn();
    const set = toToolSet([{ ...enviar, preparar, authorize: async () => "ambíguo" }], { userId: "u1" }, { enqueue });
    expect(await set.enviar_teste!.execute!({ para: "maria" }, { toolCallId: "t", messages: [] })).toEqual({ permitido: false, erro: "ambíguo" });
    expect(preparar).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
