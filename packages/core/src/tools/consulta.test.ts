import { describe, expect, it } from "vitest";
import { consultaDasTools } from "./consulta";
import { selectRelevant, type ToolDef } from "./registry";
import { z } from "zod";

const tool = (name: string, keywords: string[]): ToolDef => ({
  name, domain: "x", description: name.replace(/_/g, " "), risk: "leitura", keywords, inputSchema: z.object({}), run: async () => null,
});

describe("consulta das tools", () => {
  const historico = [
    { role: "user", content: "Quais são as minhas próximas tarefas" },
    { role: "assistant", content: "Você tem três tarefas pendentes: revisar o fornecedor novo." },
  ];

  it("pedido de continuação herda o assunto da conversa", () => {
    // o caso real: sem o histórico, nada aqui casa com editar_tarefa
    const atual = "atualize essa do fornecedor o nome é melhor do grão";
    // no fim da lista: com tudo empatado em zero, a seleção fica com as primeiras
    const defs = [
      ...Array.from({ length: 10 }, (_, i) => tool(`outra_${i}`, [`coisa${i}`])),
      tool("editar_tarefa", ["editar", "tarefa"]),
    ];
    expect(selectRelevant(defs, atual, 3).map((d) => d.name)).not.toContain("editar_tarefa");
    expect(selectRelevant(defs, consultaDasTools(atual, historico, 2), 3).map((d) => d.name)).toContain("editar_tarefa");
  });

  it("zero turnos é só a mensagem atual; leva as N últimas, sem system nem conteúdo que não é texto", () => {
    expect(consultaDasTools("oi", historico, 0)).toBe("oi");
    const comLixo = [{ role: "system", content: "resumo" }, { role: "user", content: [{ type: "image" }] }, ...historico];
    expect(consultaDasTools("oi", comLixo, 1)).toBe("oi\nVocê tem três tarefas pendentes: revisar o fornecedor novo.");
    expect(consultaDasTools("oi", comLixo, 10).split("\n")).toHaveLength(3);
  });
});
