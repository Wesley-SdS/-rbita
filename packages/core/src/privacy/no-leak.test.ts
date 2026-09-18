import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BIOMETRIC_HEADER, BiometricEgressError, guardFetch, isLocalHost, isLocalUrl } from "./egress";

/**
 * TESTE DE NÃO-VAZAMENTO (NV.1, PRD §4.9). Roda em toda onda e cresce com ela.
 * Falha se algum caminho permitir que dado biométrico chegue a provedor de nuvem:
 *
 *   1. guard de runtime: requisição marcada como biométrica só sai para host local
 *   2. fronteira no código: módulo que toca biometria não importa provedor de
 *      nuvem; módulo que fala com nuvem não importa tabela biométrica
 *
 * Quando uma onda adicionar um caminho novo (percepção, câmera, voz), ele entra
 * nas listas abaixo e o teste passa a vigiá-lo.
 */

const RAIZ = resolve(__dirname, "../../../..");

function fontes(dir: string): string[] {
  const abs = join(RAIZ, dir);
  let out: string[] = [];
  let entradas: string[];
  try {
    entradas = readdirSync(abs);
  } catch {
    return out;
  }
  for (const nome of entradas) {
    const p = join(abs, nome);
    if (statSync(p).isDirectory()) out = out.concat(fontes(relative(RAIZ, p)));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

/** `from "x"`, `import "x"`, `import("x")` e `require("x")`: import dinâmico também conta. */
const importsDe = (arquivo: string): string[] =>
  [...readFileSync(arquivo, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]!);

/** Pacotes/módulos que falam com provedor de nuvem (LLM, STT, conectores). */
const NUVEM = [/^@orbita\/llm/, /^ai$/, /^@ai-sdk\//, /^openai/, /stt\/assemblyai/, /connectors\/(google|microsoft|slack|notion|whatsapp)/, /cameras\/narrate/];

/**
 * Onde a biometria mora. Tabelas biométricas ficam em `biometric-schema`
 * (Onda 9) e os módulos que as leem, em `identity/biometric*`, `identity/voice*`,
 * `identity/face*` e no cliente de percepção. O barrel `@orbita/db/schema`
 * reexporta tudo, então importá-lo num módulo de nuvem também reprova.
 */
const BIOMETRIA = [/@orbita\/db\/biometric/, /@orbita\/db\/schema$/, /identity\/biometric/, /identity\/voice/, /identity\/face/, /perception\//];

/** Pastas que só podem conter lógica local de identidade/biometria. */
const PASTAS_BIOMETRICAS = ["packages/core/src/identity", "packages/core/src/perception"];

/**
 * Biometria só existe nos módulos listados em BIOMETRIA. Quem fala com nuvem
 * dispara operação de identidade por EVENTO (`identity/camera-listener`) ou pela
 * fachada `identity/actions`, que não devolve vetor, amostra nem recorte.
 */

/** Pastas que falam com a nuvem e nunca podem importar biometria. */
const PASTAS_NUVEM = [
  "packages/llm/src",
  "packages/core/src/stt",
  "packages/core/src/connectors",
  "packages/core/src/cameras",
  "packages/core/src/chat",
  "packages/core/src/rag",
  "packages/core/src/meetings",
  "packages/core/src/voice",
  "packages/core/src/tools",
  // fila de trabalho: dispara resumo e leitura de cupom (LLM e visão)
  "packages/core/src/jobs",
  // acompanhar tarefa: pergunta à câmera pelo modelo de visão
  "packages/core/src/guided",
  // cupom e extrato: OCR, visão e LLM
  "packages/core/src/finance",
];

describe("NV.1: guard de saída de biometria", () => {
  it("reconhece host da casa", () => {
    for (const h of ["localhost", "127.0.0.1", "192.168.0.20", "10.1.2.3", "172.20.0.5", "::1", "[::1]", "perception", "nas.local", "host.docker.internal"]) {
      expect(isLocalHost(h), h).toBe(true);
    }
  });

  it("reconhece host de nuvem", () => {
    // nomes DNS que COMEÇAM como IP privado continuam sendo da internet
    for (const h of ["api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "8.8.8.8", "172.32.0.1", "api.assemblyai.com", "10.evil.com", "192.168.1.1.attacker.net", "127.0.0.1.nip.io"]) {
      expect(isLocalHost(h), h).toBe(false);
    }
    expect(isLocalUrl("não é url")).toBe(false);
  });

  it("biometria para a nuvem é recusada antes de sair", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const bloqueios: string[] = [];
    const f = guardFetch(inner as unknown as typeof fetch, (h) => bloqueios.push(h));
    await expect(f("https://api.openai.com/v1/embeddings", { method: "POST", headers: { [BIOMETRIC_HEADER]: "voz" }, body: "amostra" })).rejects.toBeInstanceOf(BiometricEgressError);
    await expect(f(new Request("https://api.anthropic.com/x", { headers: { [BIOMETRIC_HEADER]: "rosto" } }))).rejects.toBeInstanceOf(BiometricEgressError);
    await expect(f("https://x.com", { headers: [[BIOMETRIC_HEADER.toUpperCase(), "1"]] })).rejects.toBeInstanceOf(BiometricEgressError);
    expect(inner).not.toHaveBeenCalled();
    expect(bloqueios).toEqual(["api.openai.com", "api.anthropic.com", "x.com"]);
  });

  it("biometria para o serviço local passa, sem seguir redirect", async () => {
    const inner = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response("ok"));
    const f = guardFetch(inner as unknown as typeof fetch);
    await f("http://127.0.0.1:8002/voice/embed", { method: "POST", headers: new Headers({ [BIOMETRIC_HEADER]: "voz" }) });
    expect(inner).toHaveBeenCalledTimes(1);
    // um 307 do "serviço local" reenviaria a amostra para outro host sem checagem
    expect(inner.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("tráfego sem biometria não é afetado", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = guardFetch(inner as unknown as typeof fetch);
    await f("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("NV.1: fronteira no código", () => {
  it("módulo de identidade/biometria não importa provedor de nuvem", () => {
    const violacoes: string[] = [];
    for (const pasta of PASTAS_BIOMETRICAS) {
      for (const arq of fontes(pasta)) {
        for (const imp of importsDe(arq)) if (NUVEM.some((r) => r.test(imp))) violacoes.push(`${relative(RAIZ, arq)} importa ${imp}`);
      }
    }
    expect(violacoes).toEqual([]);
  });

  it("módulo que fala com nuvem não importa biometria", () => {
    const violacoes: string[] = [];
    for (const pasta of PASTAS_NUVEM) {
      for (const arq of fontes(pasta)) {
        for (const imp of importsDe(arq)) if (BIOMETRIA.some((r) => r.test(imp))) violacoes.push(`${relative(RAIZ, arq)} importa ${imp}`);
      }
    }
    expect(violacoes).toEqual([]);
  });

  it("as pastas vigiadas existem (o teste não passa em silêncio por caminho errado)", () => {
    expect(fontes("packages/core/src/identity").length).toBeGreaterThan(0);
    expect(fontes("packages/llm/src").length).toBeGreaterThan(0);
  });

  it("o apps/api instala o guard ANTES de carregar qualquer módulo que faça rede", () => {
    const main = readFileSync(join(RAIZ, "apps/api/src/main.ts"), "utf8");
    const imports = importsDe(join(RAIZ, "apps/api/src/main.ts"));
    // env primeiro (carrega .env), guard logo em seguida, o resto depois
    expect(imports.slice(0, 2)).toEqual(["./env", "./egress-guard"]);
    expect(readFileSync(join(RAIZ, "apps/api/src/egress-guard.ts"), "utf8")).toMatch(/installBiometricEgressGuard\(/);
    expect(main).not.toMatch(/installBiometricEgressGuard\(/);
  });

  it("a regex de import pega as formas dinâmicas", () => {
    const tmp = join(RAIZ, "packages/core/src/privacy/__imports_exemplo__.ts");
    const conteudo = 'import a from "x1";\nimport "x2";\nconst b = await import("x3");\nconst c = require("x4");\nexport * from "x5";';
    writeFileSync(tmp, conteudo);
    try {
      expect(importsDe(tmp)).toEqual(["x1", "x2", "x3", "x4", "x5"]);
    } finally {
      unlinkSync(tmp);
    }
  });
});
