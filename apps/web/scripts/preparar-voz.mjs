/**
 * Põe o runtime do WebAssembly em `public/modelos/`, para o detector de fala
 * funcionar OFFLINE.
 *
 * Por que um script e não um arquivo no repositório: o `.wasm` do onnxruntime
 * tem 14 MB, e binário desse tamanho no git fica lá para sempre, em toda
 * clonagem, em todo histórico. O modelo do silero (1,8 MB) fica versionado
 * porque é o dado que define o comportamento; o runtime é só a máquina que o
 * executa, e ela vem do node_modules.
 *
 * Falhar aqui NÃO quebra nada: sem o arquivo, a voz cai para a energia
 * adaptativa, que é pior mas funciona. Por isso o script avisa e sai com 0.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const destino = join(process.cwd(), "public", "modelos");

// o caminho é montado à mão de propósito: o `exports` do pacote não expõe o
// `package.json`, então `require.resolve` não serve para achar a raiz dele
const raiz = join(process.cwd(), "node_modules", "onnxruntime-web");

try {
  mkdirSync(destino, { recursive: true });
  let copiados = 0;
  for (const arquivo of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
    const de = join(raiz, "dist", arquivo);
    if (!existsSync(de)) continue;
    copyFileSync(de, join(destino, arquivo));
    copiados++;
  }
  console.log(copiados ? `[voz] runtime do detector de fala pronto (${copiados} arquivos)` : "[voz] runtime não encontrado; a voz usará energia");
} catch {
  console.log("[voz] onnxruntime-web não instalado; a voz usará energia adaptativa");
}
