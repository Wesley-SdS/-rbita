// Grava o ID da extensão (calculado da `key` do manifesto) em `navegador.extensaoId`.
// O primeiro pareamento já grava sozinho; isto é para quem quer deixar pronto antes.
import "../../api/src/env";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { settings } from "@orbita/core/settings/index";

const { key } = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as { key: string };
const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
const id = [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
await settings.set("navegador.extensaoId", id);
console.log(`navegador.extensaoId = ${id}`);
process.exit(0);
