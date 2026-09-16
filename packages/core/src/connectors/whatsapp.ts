/**
 * WhatsApp via Cloud API (Meta). Diferente dos conectores OAuth: usa um token
 * de sistema + phone number id (do app Meta), configurados por env. Por isso é
 * exposto como tool condicional a env, não pelo fluxo OAuth do registry.
 */
export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
}

/** Envia uma mensagem de texto. Chamar só após confirmação explícita. */
export async function sendWhatsApp(to: string, text: string): Promise<{ id: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error("WhatsApp não configurado");
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { messages?: { id: string }[] };
  return { id: data.messages?.[0]?.id ?? "" };
}
