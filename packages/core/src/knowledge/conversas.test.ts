import { describe, it, expect } from "vitest";
import { paginasDaConversa, tituloDoArquivo, valeArquivar } from "./conversas";

/**
 * A conversa de outro dia virando contexto de hoje.
 *
 * Isto não é memória (fato curto que a Órbita carrega sempre). É acesso ao que
 * já foi dito: a busca do chat roda sobre `chunk`, então conversa que não foi
 * recortada e vetorizada é invisível, por mais que esteja no banco. Em
 * 22/09/2026 havia 110 conversas e 4 documentos.
 */

const u = (content: string) => ({ role: "user", content });
const a = (content: string) => ({ role: "assistant", content });

describe("a conversa virando páginas", () => {
  it("uma página por PAR de pergunta e resposta", () => {
    // o corte do RAG respeita limites de página: separar a pergunta da
    // resposta produziria trechos que respondem sem dizer a que
    const p = paginasDaConversa([u("como faço X?"), a("assim"), u("e Y?"), a("assado")]);
    expect(p).toHaveLength(2);
    expect(p[0]).toBe("Wesley: como faço X?\n\nÓrbita: assim");
    expect(p[1]).toBe("Wesley: e Y?\n\nÓrbita: assado");
  });

  it("mensagem de sistema fica fora", () => {
    // é instrução nossa, não conversa: indexar encheria a busca do prompt
    const p = paginasDaConversa([{ role: "system", content: "você é a Órbita" }, u("oi"), a("olá")]);
    expect(p.join()).not.toContain("você é a Órbita");
  });

  it("mensagem vazia não vira linha solta", () => {
    const p = paginasDaConversa([u("pergunta"), a("   "), u("outra"), a("resposta")]);
    expect(p[0]).toBe("Wesley: pergunta");
  });

  it("resposta sem pergunta antes não quebra", () => {
    expect(paginasDaConversa([a("aviso proativo")])).toEqual(["Órbita: aviso proativo"]);
  });

  it("conversa vazia não vira página nenhuma", () => {
    expect(paginasDaConversa([])).toEqual([]);
  });

  it("várias respostas seguidas ficam na mesma página", () => {
    const p = paginasDaConversa([u("e aí?"), a("primeiro"), a("segundo")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toContain("primeiro");
    expect(p[0]).toContain("segundo");
  });
});

describe("vale a pena guardar?", () => {
  const longa = (n: number) => "x".repeat(n);

  it("conversa de verdade vale", () => {
    expect(valeArquivar([u(longa(80)), a(longa(80)), u(longa(40)), a(longa(40))])).toBe(true);
  });

  it('"oi" e "olá" não é conhecimento, é ruído', () => {
    expect(valeArquivar([u("oi"), a("olá")])).toBe(false);
  });

  it("muitas mensagens curtas também não valem", () => {
    // passa no contador de mensagens e não tem conteúdo nenhum: indexar encheria
    // a busca de trechos vazios e pioraria as respostas
    expect(valeArquivar([u("oi"), a("oi"), u("tudo bem?"), a("sim")])).toBe(false);
  });

  it("mensagem de sistema não conta para o mínimo", () => {
    const so_sistema = [{ role: "system", content: longa(500) }, u("oi"), a("olá")];
    expect(valeArquivar(so_sistema)).toBe(false);
  });

  it("o mínimo é configurável", () => {
    expect(valeArquivar([u(longa(150)), a(longa(150))], 2)).toBe(true);
    expect(valeArquivar([u(longa(150)), a(longa(150))], 4)).toBe(false);
  });
});

describe("o título do que foi arquivado", () => {
  const dia = new Date(2026, 8, 22);

  it("usa o título da conversa quando ele diz alguma coisa", () => {
    expect(tituloDoArquivo("Custo do realtime", dia)).toBe("Conversa: Custo do realtime");
  });

  it('"Nova conversa" não é título: vira a data', () => {
    expect(tituloDoArquivo("Nova conversa", dia)).toBe("Conversa de 22/09/2026");
    expect(tituloDoArquivo(null, dia)).toBe("Conversa de 22/09/2026");
    expect(tituloDoArquivo("   ", dia)).toBe("Conversa de 22/09/2026");
  });
});
