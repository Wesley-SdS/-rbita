// Instala (ou remove) a ponte de native messaging no Windows, para o usuário
// atual (HKCU, sem administrador). Idempotente: rodar de novo regrava igual e
// mantém o mesmo segredo.
//
//   node ponte/instalar.mjs                        instala para o Google Chrome
//   node ponte/instalar.mjs --remover              desfaz tudo (registro, arquivos gerados e o segredo)
//   node ponte/instalar.mjs --estado               imprime em JSON se está instalada e se o segredo existe
//   node ponte/instalar.mjs --navegador chromium   (ou "chrome-for-testing") para os testes
//
// O manifesto do host leva o caminho de um .bat (o Chrome no Windows só inicia
// .exe ou .bat), e o .bat chama o MESMO node que rodou este instalador.
//
// O SEGREDO (I-14 da auditoria): a ponte prova ao apps/api que é a ponte com
// um segredo de arquivo, e não mais com um cabeçalho público ("x-orbita-ponte:
// 1", que qualquer processo da máquina sabe mandar). O arquivo nasce aqui com
// 32 bytes aleatórios e ACL só para o usuário que instalou (icacls, sem herança).
// O api lê o mesmo arquivo (packages/core/src/navegador/ponte.ts, a mesma regra
// de caminho: ORBITA_PONTE_SEGREDO ou %LOCALAPPDATA%\Orbita\ponte\segredo).
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const NOME_DO_HOST = "com.orbita.ponte";
// montadas com "\\" à mão: script de shell que escreve isto perde a barra (já aconteceu, ver CLAUDE.md §9)
const B = String.fromCharCode(92);
const CHAVES = {
  chrome: ["HKCU", "Software", "Google", "Chrome", "NativeMessagingHosts"].join(B),
  chromium: ["HKCU", "Software", "Chromium", "NativeMessagingHosts"].join(B),
  "chrome-for-testing": ["HKCU", "Software", "Google", "Chrome for Testing", "NativeMessagingHosts"].join(B),
  // chave que NENHUM navegador lê: o teste do instalador grava e apaga aqui, sem tocar nas do Chrome
  teste: ["HKCU", "Software", "OrbitaTeste", "NativeMessagingHosts"].join(B),
};
const chaveDo = (n) => `${CHAVES[n]}${B}${NOME_DO_HOST}`;

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, "..");

export function idDaExtensao() {
  const { key } = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

export function manifestoDoHost(caminhoDoBat, id) {
  // sem curinga: só ESTA extensão consegue iniciar a ponte
  return { name: NOME_DO_HOST, description: "Ponte da Órbita (native messaging)", path: caminhoDoBat, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] };
}

/** Onde o segredo mora. A MESMA regra de `caminhoDoSegredoDaPonte` no core. */
export function caminhoDoSegredo(env = process.env) {
  if (env.ORBITA_PONTE_SEGREDO) return env.ORBITA_PONTE_SEGREDO;
  return join(env.LOCALAPPDATA ?? env.HOME ?? ".", "Orbita", "ponte", "segredo");
}

/** O segredo existente, ou um novo gravado com ACL só do usuário atual. Devolve o caminho. */
export function garantirSegredo(env = process.env) {
  const caminho = caminhoDoSegredo(env);
  const atual = existsSync(caminho) ? readFileSync(caminho, "utf8").trim() : "";
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(atual)) {
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  restringir(caminho);
  return caminho;
}

/** Só o dono do arquivo lê e escreve: no Windows, ACL sem herança com o usuário atual; fora dele, 600. */
function restringir(caminho) {
  if (process.platform !== "win32") {
    chmodSync(caminho, 0o600);
    return;
  }
  const usuario = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}${B}${process.env.USERNAME}` : process.env.USERNAME;
  if (!usuario) throw new Error("Não sei quem é o usuário do Windows para restringir o segredo da ponte.");
  // /inheritance:r tira as permissões herdadas da pasta; /grant:r deixa SÓ esta
  execFileSync("icacls", [caminho, "/inheritance:r", "/grant:r", `${usuario}:F`], { stdio: ["ignore", "pipe", "pipe"] });
}

function reg(args) {
  return execFileSync("reg", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

/** `pasta`: onde ficam o .bat e o manifesto (o teste usa uma temporária, para nunca sobrescrever a instalação do dono). */
export function instalar(navegadores = ["chrome"], env = process.env, { pasta = aqui } = {}) {
  const segredo = garantirSegredo(env);
  mkdirSync(pasta, { recursive: true });
  const bat = join(pasta, "ponte.bat");
  const json = join(pasta, `${NOME_DO_HOST}.json`);
  // o caminho do segredo vai no .bat: a ponte lê o MESMO arquivo que o instalador criou
  writeFileSync(bat, `@echo off\r\nset "ORBITA_PONTE_SEGREDO=${segredo}"\r\n"${process.execPath}" "${join(aqui, "ponte.mjs")}" %*\r\n`);
  writeFileSync(json, JSON.stringify(manifestoDoHost(bat, idDaExtensao()), null, 2));
  for (const n of navegadores) reg(["add", chaveDo(n), "/ve", "/t", "REG_SZ", "/d", json, "/f"]);
  return { bat, json, segredo, chaves: navegadores.map(chaveDo) };
}

export function remover(navegadores = Object.keys(CHAVES), env = process.env, { apagarSegredo = true, pasta = aqui } = {}) {
  for (const n of navegadores) {
    try {
      reg(["delete", chaveDo(n), "/f"]);
    } catch {
      /* não estava instalada: remover de novo não é erro */
    }
  }
  // a chave de teste é nossa inteira: não sobra nem a pasta vazia no registro
  if (navegadores.includes("teste")) {
    try {
      reg(["delete", ["HKCU", "Software", "OrbitaTeste"].join(B), "/f"]);
    } catch {
      /* já não existia */
    }
  }
  // sem nenhum navegador usando a ponte, os arquivos e o segredo saem: ninguém mais fala como ponte
  const sobrou = pasta === aqui && ["chrome", "chromium", "chrome-for-testing"].some((n) => instalada(n));
  if (sobrou) return;
  for (const f of ["ponte.bat", `${NOME_DO_HOST}.json`]) if (existsSync(join(pasta, f))) rmSync(join(pasta, f));
  if (apagarSegredo && existsSync(caminhoDoSegredo(env))) rmSync(caminhoDoSegredo(env));
}

export function instalada(navegador = "chrome") {
  try {
    return reg(["query", chaveDo(navegador), "/ve"]).includes(NOME_DO_HOST);
  } catch {
    return false;
  }
}

/** O que a tela "Controle do PC" mostra. */
export function estado(env = process.env) {
  return { instalada: instalada("chrome"), segredo: existsSync(caminhoDoSegredo(env)), manifesto: existsSync(join(aqui, `${NOME_DO_HOST}.json`)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--navegador");
  const navegadores = i > 0 ? [process.argv[i + 1]] : ["chrome"];
  if (navegadores.some((n) => !CHAVES[n])) {
    console.error(`navegador desconhecido; use: ${Object.keys(CHAVES).join(", ")}`);
    process.exit(2);
  }
  if (process.argv.includes("--estado")) {
    console.log(JSON.stringify(estado()));
  } else if (process.argv.includes("--remover")) {
    remover(i > 0 ? navegadores : undefined);
    console.log("ponte removida");
  } else {
    const r = instalar(navegadores);
    console.log(`ponte instalada para ${navegadores.join(", ")}:\n  ${r.chaves.join("\n  ")}\n  manifesto: ${r.json}`);
  }
}
