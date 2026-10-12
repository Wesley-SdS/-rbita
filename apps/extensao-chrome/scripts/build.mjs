// Build da extensão: esbuild, sem framework. Gera `dist/`, que é a pasta a
// carregar em chrome://extensions ("Carregar sem compactação").
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(raiz, "dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const comum = { bundle: true, target: "chrome118", sourcemap: false, minify: false, legalComments: "none", logLevel: "warning" };
// sem `keepNames`: a função injetada na página não pode chamar `__name` (ela é serializada)
await build({ ...comum, entryPoints: [join(raiz, "src/sw.ts")], outfile: join(dist, "sw.js"), format: "esm" });
await build({ ...comum, entryPoints: [join(raiz, "src/conteudo.ts")], outfile: join(dist, "conteudo.js"), format: "iife" });
await build({ ...comum, entryPoints: [join(raiz, "src/popup.ts")], outfile: join(dist, "popup.js"), format: "iife" });
await build({ ...comum, entryPoints: [join(raiz, "src/painel.ts")], outfile: join(dist, "painel.js"), format: "iife" });

copyFileSync(join(raiz, "manifest.json"), join(dist, "manifest.json"));
for (const f of ["popup.html", "painel.html", "estilo.css"]) copyFileSync(join(raiz, "src", f), join(dist, f));

// ícone: um círculo na cor da Órbita, gerado aqui (PNG mínimo) para não versionar binário
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function icone(lado) {
  const linhas = [];
  const r = lado / 2;
  for (let y = 0; y < lado; y++) {
    const linha = Buffer.alloc(1 + lado * 4);
    for (let x = 0; x < lado; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      const dentro = d <= r - 0.5;
      const anel = d <= r * 0.42 && d >= r * 0.22;
      const o = 1 + x * 4;
      if (dentro) {
        linha[o] = anel ? 255 : 0xa1; linha[o + 1] = anel ? 255 : 0x42; linha[o + 2] = anel ? 255 : 0xf4; linha[o + 3] = 255;
      }
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ihdr), bloco("IDAT", deflateSync(Buffer.concat(linhas))), bloco("IEND", Buffer.alloc(0))]);
}
for (const l of [16, 48, 128]) writeFileSync(join(dist, `icone-${l}.png`), icone(l));

const manifesto = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
console.log(`extensão pronta em ${dist} (versão ${manifesto.version})`);
