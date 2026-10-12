import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SETTING_DEFS } from "./defs";

/**
 * Config sem uso é ruído (CLAUDE.md §5.6): uma chave na tela que não muda nada
 * engana o dono, que ajusta e não vê efeito. A auditoria de 11/10/2026 achou
 * três (`realtime.videoFps`, `realtime.videoLargura` e
 * `memory.candidateRetentionDays`). Este teste procura cada chave no código
 * de fora de `defs.ts` (core, api e web, sem os testes); a que não aparece em
 * lugar nenhum reprova.
 */

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../../..");
const PASTAS = ["packages/core/src", "packages/llm/src", "apps/api/src", "apps/web/src"].map((p) => path.join(RAIZ, p));

function fontes(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome.startsWith(".")) continue;
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) fontes(p, out);
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) && !p.endsWith(path.join("settings", "defs.ts"))) out.push(p);
  }
  return out;
}

describe("toda chave de configuração é lida em algum lugar", () => {
  it("nenhuma chave órfã", () => {
    const codigo = PASTAS.flatMap((d) => fontes(d)).map((f) => readFileSync(f, "utf-8")).join("\n");
    const orfas = Object.keys(SETTING_DEFS).filter((k) => !codigo.includes(`"${k}"`) && !codigo.includes(`'${k}'`) && !codigo.includes(`\`${k}\``));
    expect(orfas).toEqual([]);
  });
});
