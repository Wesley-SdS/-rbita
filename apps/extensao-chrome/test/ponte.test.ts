import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { RAIZ } from "./ambiente";
// @ts-expect-error módulo JS puro da ponte, sem tipos
import { criarLeitor, LIMITE_DO_HOST, quadro, quadrosParaOChrome } from "../ponte/quadros.mjs";
// @ts-expect-error módulo JS puro do instalador, sem tipos
import { idDaExtensao, instalada, instalar, manifestoDoHost, remover } from "../ponte/instalar.mjs";

const pastaDeTeste = mkdtempSync(join(tmpdir(), "orbita-ponte-"));
const arquivoDoSegredo = join(pastaDeTeste, "segredo");
afterAll(() => rmSync(pastaDeTeste, { recursive: true, force: true }));

/**
 * A PONTE de native messaging (B7): quadros com o tamanho em 32 bits na
 * frente, mensagem grande para o Chrome em pedaços (limite de 1 MB), e a ponte
 * de verdade, como processo, repassando entre o "Chrome" (stdin/stdout) e um
 * canal falso, anunciando-se com `x-orbita-ponte` e sem Origin.
 */

describe("quadros", () => {
  it("tamanho em 32 bits little-endian na frente, e o leitor junta pedaços de stdin", () => {
    const q = quadro({ t: "ping" });
    expect(q.readUInt32LE(0)).toBe(q.length - 4);
    const vistas: unknown[] = [];
    const ler = criarLeitor((m: unknown) => vistas.push(m));
    const dois = Buffer.concat([quadro({ a: 1 }), quadro({ b: 2 })]);
    ler(dois.subarray(0, 5));
    ler(dois.subarray(5));
    expect(vistas).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("acima de 1 MB vai em pedaços, nenhum passa do limite, e junta igual", () => {
    const grande = { t: "ordem", dados: "x".repeat(2_500_000) };
    const qs = quadrosParaOChrome(grande, "id1") as Buffer[];
    expect(qs.length).toBeGreaterThan(2);
    for (const q of qs) expect(q.length).toBeLessThanOrEqual(LIMITE_DO_HOST);
    const partes = qs.map((q) => JSON.parse(q.subarray(4).toString()));
    expect(partes.every((p: { t: string; n: number }) => p.t === "pedaco" && p.n === qs.length)).toBe(true);
    expect(JSON.parse(partes.map((p: { dados: string }) => p.dados).join(""))).toEqual(grande);
    expect(quadrosParaOChrome({ t: "pong" }, "x")).toHaveLength(1);
  });

  it("o manifesto do host não tem curinga: só esta extensão", () => {
    const m = manifestoDoHost("C:/x/ponte.bat", idDaExtensao());
    expect(m).toMatchObject({ name: "com.orbita.ponte", type: "stdio", allowed_origins: [`chrome-extension://${idDaExtensao()}/`] });
    expect(JSON.stringify(m)).not.toContain("*");
  });
});

describe("o instalador (B7, I-14): segredo com ACL só do dono, idempotente, numa chave que nenhum navegador lê", () => {
  // a chave "teste" (HKCU\Software\OrbitaTeste) e uma pasta temporária: nunca as do Chrome do dono
  const env = { ...process.env, ORBITA_PONTE_SEGREDO: join(pastaDeTeste, "instalado", "segredo") };
  const pasta = join(pastaDeTeste, "manifesto");
  afterAll(() => remover(["teste"], env, { pasta }));

  it.skipIf(process.platform !== "win32")("instala, mantém o MESMO segredo ao rodar de novo, e remove tudo (registro, arquivos e segredo)", () => {
    const r = instalar(["teste"], env, { pasta });
    expect(instalada("teste")).toBe(true);
    const segredo = readFileSync(env.ORBITA_PONTE_SEGREDO, "utf8");
    expect(segredo).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // o .bat leva o caminho do segredo: a ponte lê o mesmo arquivo que o api
    expect(readFileSync(r.bat, "utf8")).toContain(env.ORBITA_PONTE_SEGREDO);
    // ACL sem herança, só o usuário atual
    const acl = execFileSync("icacls", [env.ORBITA_PONTE_SEGREDO], { encoding: "utf8" });
    const linhas = acl.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes(":("));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain(process.env.USERNAME!);
    expect(acl).not.toMatch(/\(I\)/);
    instalar(["teste"], env, { pasta });
    expect(readFileSync(env.ORBITA_PONTE_SEGREDO, "utf8")).toBe(segredo);
    remover(["teste"], env, { pasta });
    expect(instalada("teste")).toBe(false);
    expect(existsSync(env.ORBITA_PONTE_SEGREDO)).toBe(false);
    expect(existsSync(r.json)).toBe(false);
  });
});

describe("a ponte como processo", () => {
  it("sem o arquivo do segredo, a ponte nem tenta: sai sem abrir o canal", async () => {
    let conectou = false;
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => wss.once("listening", r));
    wss.on("connection", () => (conectou = true));
    const porta = (wss.address() as { port: number }).port;
    const p = spawn(process.execPath, [join(RAIZ, "ponte", "ponte.mjs"), "chrome-extension://teste/"], { env: { ...process.env, ORBITA_CANAL_URL: `ws://127.0.0.1:${porta}/api/navegador/canal`, ORBITA_PONTE_SEGREDO: join(pastaDeTeste, "nao-existe") } });
    await new Promise((r) => p.on("exit", r));
    expect(conectou).toBe(false);
    wss.close();
  }, 20_000);

  it("repassa nos dois sentidos, sem Origin e com o SEGREDO e a origem do Chrome; resposta grande sai em pedaços", async () => {
    writeFileSync(arquivoDoSegredo, "q".repeat(43));
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => wss.once("listening", r));
    const porta = (wss.address() as { port: number }).port;
    const cabecalhos = new Promise<Record<string, unknown>>((resolve) => wss.on("connection", (ws, req) => {
      resolve(req.headers);
      ws.on("message", (m) => {
        const msg = JSON.parse(m.toString());
        if (msg.t === "ola") ws.send(JSON.stringify({ t: "bem_vindo", grande: "y".repeat(1_500_000) }));
      });
    }));
    const p = spawn(process.execPath, [join(RAIZ, "ponte", "ponte.mjs"), "chrome-extension://teste/"], { env: { ...process.env, ORBITA_CANAL_URL: `ws://127.0.0.1:${porta}/api/navegador/canal`, ORBITA_PONTE_SEGREDO: arquivoDoSegredo } });
    const recebidas: { t: string; dados?: string; n?: number }[] = [];
    const ler = criarLeitor((m: { t: string }) => recebidas.push(m));
    p.stdout.on("data", (b: Buffer) => ler(b));
    p.stdin.write(quadro({ t: "ola", token: "t".repeat(40), versao: "0.1.0" }));
    const h = await cabecalhos;
    // nunca mais o "1" público: o segredo do arquivo, que só o dono lê
    expect(h["x-orbita-ponte"]).toBe("q".repeat(43));
    expect(h["x-orbita-ponte-origem"]).toBe("chrome-extension://teste/");
    expect(h.origin).toBeUndefined();
    const fim = Date.now() + 10_000;
    while (Date.now() < fim && !(recebidas.length && recebidas.length === recebidas[0]!.n)) await new Promise((r) => setTimeout(r, 50));
    expect(recebidas[0]!.t).toBe("pedaco");
    expect(JSON.parse(recebidas.map((r) => r.dados).join(""))).toMatchObject({ t: "bem_vindo" });
    p.stdin.end();
    await new Promise((r) => p.on("exit", r));
    wss.close();
  }, 30_000);
});
