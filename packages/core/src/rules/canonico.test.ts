import { describe, expect, it } from "vitest";
import { jsonCanonico } from "./run";

describe("comparar o molde gravado com o do código", () => {
  it("a ordem das chaves não importa (o jsonb devolve em ordem alfabética)", () => {
    const doBanco = [{ body: "{{payload.assunto}}: {{payload.trecho}}", kind: "notify", title: "E-mail importante de {{payload.de}}" }];
    const doCodigo = [{ kind: "notify", title: "E-mail importante de {{payload.de}}", body: "{{payload.assunto}}: {{payload.trecho}}" }];
    expect(jsonCanonico(doBanco)).toBe(jsonCanonico(doCodigo));
  });

  it("conteúdo diferente continua diferente (a regra editada pelo dono não é trocada)", () => {
    expect(jsonCanonico([{ kind: "notify", title: "Meu título" }])).not.toBe(jsonCanonico([{ kind: "notify", title: "Outro" }]));
  });
});
