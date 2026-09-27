import type { WaMensagem } from "@orbita/db/whatsapp-schema";

/**
 * Como uma mensagem do WhatsApp vira texto para o modelo ler. PURO.
 *
 * Todo texto de terceiro sai embrulhado como DADO (§5.2): quem escreveu no
 * WhatsApp não dá ordem à Órbita.
 */

/** O texto do terceiro não pode fechar o embrulho por conta própria. */
const semFechar = (s: string) => s.replace(/<\/?dado_externo[^>]*>/gi, "");

export function hora(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: process.env.TZ || "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Uma mensagem em uma linha legível, PURA. */
export function linhaDaMensagem(m: Pick<WaMensagem, "id" | "em" | "deMim" | "autorNome" | "tipo" | "texto" | "transcricao" | "descricaoImagem" | "apagada" | "editada" | "reacao" | "enviadaPelaOrbita">, nomeDoChat: string | null): string {
  const quem = m.deMim ? (m.enviadaPelaOrbita ? "Você (pela Órbita)" : "Você") : m.autorNome || nomeDoChat || "Contato";
  const partes: string[] = [];
  if (m.tipo === "audio") partes.push(m.transcricao ? `[áudio] ${m.transcricao}` : "[áudio sem transcrição]");
  else if (m.tipo === "imagem") partes.push(`[imagem id=${m.id}]` + (m.descricaoImagem ? ` (${m.descricaoImagem})` : ""));
  else if (m.tipo !== "texto") partes.push(`[${m.tipo}]`);
  if (m.texto && m.tipo !== "audio") partes.push(m.texto);
  if (m.apagada) partes.push("(apagada)");
  if (m.editada) partes.push("(editada)");
  if (m.reacao) partes.push(`(reação: ${m.reacao})`);
  return `[${hora(m.em)}] ${quem}: ${semFechar(partes.join(" "))}`;
}

export function embrulhar(linhas: string[]): string {
  return `<dado_externo origem="whatsapp">\n${linhas.map(semFechar).join("\n")}\n</dado_externo>`;
}

