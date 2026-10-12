// O ID da extensão sai da `key` do manifesto (sha256 da chave pública, 32
// letras de a a p). É ele que o canal confere no Origin. Uso:
//   node scripts/id-da-extensao.mjs            imprime o ID
//   node ../api/node_modules/tsx/dist/cli.mjs scripts/gravar-id.ts   grava em navegador.extensaoId
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function idDaChave(chaveBase64) {
  const hex = createHash("sha256").update(Buffer.from(chaveBase64, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const { key } = JSON.parse(readFileSync(join(raiz, "manifest.json"), "utf8"));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(idDaChave(key));
