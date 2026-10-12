import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirZip, ehAlvoDeLeitura, EntradaGrandeDemaisError, SenhaDoZipError } from "../zip";
import { avisoDoTetoDeTexto, CompactadoRecusadoError, motivoDaSenha, type ArquivoInterno, type Extraido, type Limites, type Orcamento } from "../tipos";
import { tamanhoLegivel } from "../texto";

/**
 * Compactado: lista o conteúdo e lê cada arquivo pelo MESMO extrator, com os
 * tetos contra bomba (`anexos.zipMaxArquivos`, `anexos.zipMaxMb`,
 * `anexos.zipProfundidade`). ZIP é lido aqui mesmo, em memória; 7Z, RAR e ZIP
 * com AES vão para o 7-Zip, se estiver instalado.
 *
 * Nenhum arquivo de dentro é executado nem gravado com permissão de execução:
 * o ZIP nem toca o disco, e o caminho do 7-Zip extrai para a SAÍDA PADRÃO
 * (`-so`), então o único arquivo em disco é o compactado original, numa pasta
 * temporária só do dono do processo, apagada no fim.
 */

export type ExtrairFilho = (bytes: Buffer, nome: string, profundidade: number) => Promise<Extraido>;

export interface CompactadoLido {
  texto: string;
  partes: string[];
  arquivos: ArquivoInterno[];
  avisos: string[];
  resumo: string;
  protegido?: { motivo: string };
  /** qual das senhas abriu (a posição na lista), para marcar só ela */
  senhaUsada?: number;
}

/**
 * Junta o que foi lido de dentro. O texto para de crescer no teto
 * (`limites.textoMax`): os arquivos de dentro já pararam cada um no orçamento
 * de texto, e aqui a soma também não passa, nem com a lista dos nomes (I5).
 */
function montar(lidos: { caminho: string; ex: Extraido }[], listados: ArquivoInterno[], avisos: string[], oQue: string, textoMax = Number.POSITIVE_INFINITY): CompactadoLido {
  const arquivos = [...lidos.map(({ caminho, ex }) => ({ caminho, ext: ex.tipo.ext, familia: ex.tipo.familia, tamanho: ex.tamanho, lido: ex.lido, resumo: ex.resumo })), ...listados];
  const lista = arquivos.map((a) => `- ${a.caminho} (${a.ext}, ${tamanhoLegivel(a.tamanho)})${a.lido ? "" : `: ${a.resumo}`}`).join("\n");
  const cabeca = [`Conteúdo do ${oQue}:`, lista, ""].join("\n");
  const partes: string[] = [];
  let soma = cabeca.length;
  for (const { caminho, ex } of lidos) {
    if (soma >= textoMax) break;
    const p = `### ${caminho}\n${ex.lido ? ex.texto : ex.resumo}`;
    const cabe = p.length <= textoMax - soma ? p : p.slice(0, Math.max(0, textoMax - soma));
    partes.push(cabe);
    soma += cabe.length + 1;
  }
  const texto = [cabeca, ...partes].join("\n").trim();
  return {
    texto: texto.length > textoMax ? texto.slice(0, textoMax) : texto,
    partes,
    arquivos,
    avisos,
    resumo: `${oQue[0]!.toUpperCase()}${oQue.slice(1)} com ${arquivos.length} arquivo(s); li ${lidos.filter((l) => l.ex.lido).length}.`,
  };
}

/** O texto dos de antes já encheu o teto: os próximos nem são descompactados (descompactar para jogar fora também custa). */
const semTextoNoOrcamento = (o: Orcamento) => o.texto !== undefined && o.texto <= 0;
const naoLidoPeloTeto = (l: Limites) => `não li: o texto dos arquivos anteriores já chegou ao teto de ${l.textoMax.toLocaleString("pt-BR")} caracteres`;

/** Algum de dentro parou no teto de texto, ou nem foi aberto por ele: o de fora avisa uma vez. */
function bateuNoTeto(lidos: { ex: Extraido }[], listados: ArquivoInterno[], l: Limites): boolean {
  const aviso = avisoDoTetoDeTexto(l.textoMax);
  return lidos.some(({ ex }) => ex.avisos.includes(aviso) || /chegou ao teto/.test(ex.resumo)) || listados.some((a) => /chegou ao teto/.test(a.resumo));
}

/** A senha de dentro (de um PDF ou planilha no ZIP) vale como a que abriu, se o ZIP em si não tinha senha. */
function senhaDosDeDentro(lidos: { ex: Extraido }[]): number | undefined {
  return lidos.find((l) => l.ex.senhaUsada !== undefined)?.ex.senhaUsada;
}

export async function lerZip(bytes: Buffer, limites: Limites, orcamento: Orcamento, profundidade: number, senhas: readonly string[], extrairFilho: ExtrairFilho, seteZip: SeteZip | null, semRemetente?: boolean): Promise<CompactadoLido> {
  const zip = await abrirZip(bytes, limites.zipMaxArquivos);
  try {
    const uteis = zip.entradas.filter((e) => !e.pasta && ehAlvoDeLeitura(e.nome));
    const declarado = uteis.reduce((s, e) => s + e.tamanho, 0);
    if (declarado > orcamento.bytes) throw new CompactadoRecusadoError(`O conteúdo descompactado declarado (${tamanhoLegivel(declarado)}) passa do teto. Não abri.`);
    if (zip.entradas.some((e) => e.aes)) {
      // AES do WinZip: o 7-Zip abre com a senha; sem ele, só dá para listar
      if (seteZip) return lerCom7Zip(bytes, "zip", limites, orcamento, profundidade, senhas, extrairFilho, seteZip, semRemetente);
      return { ...montar([], uteis.map((e) => ({ caminho: e.nome, ext: "?", familia: "protegido" as const, tamanho: e.tamanho, lido: false, resumo: "protegido (AES)" })), [], "ZIP"), protegido: { motivo: "O ZIP tem criptografia AES. Para abrir, a Órbita precisa do 7-Zip instalado e da senha cadastrada para o remetente." } };
    }
    const lidos: { caminho: string; ex: Extraido }[] = [];
    const listados: ArquivoInterno[] = [];
    const avisos: string[] = [];
    let semSenha = 0;
    let senhaUsada: number | undefined;
    for (const e of uteis) {
      orcamento.arquivos--;
      if (orcamento.arquivos < 0) throw new CompactadoRecusadoError(`Os compactados, somados, passam de ${limites.zipMaxArquivos} arquivos. Não abri.`);
      if (e.tamanho > limites.arquivoMaxBytes) {
        listados.push({ caminho: e.nome, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: `grande demais para ler (${tamanhoLegivel(e.tamanho)})` });
        continue;
      }
      if (semTextoNoOrcamento(orcamento)) {
        listados.push({ caminho: e.nome, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: naoLidoPeloTeto(limites) });
        continue;
      }
      let conteudo: Buffer;
      try {
        conteudo = await zip.ler(e.nome, { maxBytes: limites.arquivoMaxBytes, orcamento, senhas, aoAbrirCom: (i) => (senhaUsada ??= i) });
      } catch (err) {
        if (err instanceof SenhaDoZipError) {
          semSenha++;
          listados.push({ caminho: e.nome, ext: "?", familia: "protegido", tamanho: e.tamanho, lido: false, resumo: "protegido por senha" });
          continue;
        }
        if (err instanceof EntradaGrandeDemaisError) {
          // o cabeçalho mentiu sobre ESTE arquivo, mas a soma ainda cabe: só ele fica de fora (M5)
          listados.push({ caminho: e.nome, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: `grande demais para ler (passou de ${tamanhoLegivel(limites.arquivoMaxBytes)}; o ZIP dizia ${tamanhoLegivel(e.tamanho)})` });
          continue;
        }
        throw err;
      }
      lidos.push({ caminho: e.nome, ex: await extrairFilho(conteudo, e.nome.split("/").pop() || e.nome, profundidade + 1) });
    }
    const r = montar(lidos, listados, avisos, "ZIP", limites.textoMax);
    if (bateuNoTeto(lidos, listados, limites)) r.avisos.push(avisoDoTetoDeTexto(limites.textoMax));
    if (semSenha && !lidos.length) r.protegido = { motivo: motivoDaSenha("O ZIP", senhas, semRemetente) };
    else if (semSenha) r.avisos.push(`${semSenha} arquivo(s) do ZIP têm senha e ficaram fechados.`);
    const usada = senhaUsada ?? senhaDosDeDentro(lidos);
    if (usada !== undefined) r.senhaUsada = usada;
    return r;
  } finally {
    zip.fechar();
  }
}

/* --- 7-Zip ------------------------------------------------------------------ */

export interface SeteZip {
  /** roda o 7z com estes argumentos; `maxSaida` corta a saída padrão (e mata o processo) */
  rodar(args: string[], maxSaida: number): Promise<{ codigo: number; saida: Buffer; erro: string }>;
}

/** Onde está o 7-Zip: a config, depois os lugares de sempre. Null quando não há. */
export function localizar7Zip(configurado: string): string | null {
  const candidatos = [
    configurado.trim(),
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
    "/usr/bin/7z",
    "/usr/bin/7zz",
    "/usr/local/bin/7z",
    "/opt/homebrew/bin/7z",
  ].filter(Boolean);
  return candidatos.find((c) => existsSync(c)) ?? null;
}

export function seteZipNoDisco(caminho: string, timeoutMs = 120_000): SeteZip {
  return {
    rodar: (args, maxSaida) =>
      new Promise((ok, falha) => {
        // stdin fechado: um pedido de senha do 7-Zip falha na hora, em vez de esperar para sempre
        const p = spawn(caminho, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        const partes: Buffer[] = [];
        let total = 0;
        let erro = "";
        let estourou = false;
        const relogio = setTimeout(() => p.kill(), timeoutMs);
        p.stdout.on("data", (c: Buffer) => {
          total += c.length;
          if (total > maxSaida) {
            estourou = true;
            p.kill();
            return;
          }
          partes.push(c);
        });
        p.stderr.on("data", (c: Buffer) => {
          if (erro.length < 4000) erro += c.toString("utf8");
        });
        p.on("error", (e) => {
          clearTimeout(relogio);
          falha(e);
        });
        p.on("close", (codigo) => {
          clearTimeout(relogio);
          if (estourou) return falha(new CompactadoRecusadoError("O conteúdo descompactado passa do teto. Pode ser uma bomba de compressão: não abri."));
          ok({ codigo: codigo ?? -1, saida: Buffer.concat(partes), erro });
        });
      }),
  };
}

interface EntradaDo7z {
  caminho: string;
  tamanho: number;
  pasta: boolean;
  criptografado: boolean;
}

/** Saída de `7z l -slt`: blocos "Chave = valor" separados por linha em branco. PURO. */
export function listagemDo7z(saida: string): EntradaDo7z[] {
  const blocos = saida.split(/\r?\n\r?\n/);
  const out: EntradaDo7z[] = [];
  // o primeiro bloco com "Path" é o próprio arquivo compactado; as entradas vêm depois do "----------"
  const depois = saida.includes("----------") ? saida.slice(saida.indexOf("----------") + 10).split(/\r?\n\r?\n/) : blocos;
  for (const b of depois) {
    const campo = (k: string) => new RegExp(`^${k} = (.*)$`, "m").exec(b)?.[1]?.trim();
    const caminho = campo("Path");
    if (!caminho) continue;
    out.push({
      caminho: caminho.replace(/\\/g, "/"),
      tamanho: Number(campo("Size") ?? 0) || 0,
      pasta: campo("Folder") === "+" || /D/.test(campo("Attributes") ?? ""),
      criptografado: campo("Encrypted") === "+",
    });
  }
  return out;
}

const senhaInvalida = (erro: string) => /wrong password|senha incorreta|can ?not open encrypted|data error in encrypted/i.test(erro);

/**
 * 7Z, RAR e ZIP com AES, pelo 7-Zip instalado.
 *
 * A senha vai no `argv` (`-p…`). O 7-Zip não tem outro canal NÃO interativo
 * documentado: arquivo de lista (`@lista`) só vale para nomes de arquivo, e o
 * pedido de senha pelo console exige terminal (com a entrada fechada, ele falha
 * na hora, que é o que se quer). Consequência, registrada de propósito (M13): a
 * linha de comando do processo, enquanto ele roda, é visível a outros processos
 * do MESMO usuário do Windows (os de outro usuário precisam de administrador).
 * A senha nunca vai para log, trilha nem mensagem, e o processo dura o tempo de
 * tirar um arquivo.
 *
 * Quando só o CONTEÚDO é cifrado (ZIP AES, 7Z e RAR sem `-mhe`), `7z l` lista
 * com qualquer senha: a senha que listou não diz nada. Por isso cada senha é
 * tentada na extração do primeiro arquivo cifrado, a que abriu é guardada para
 * os outros, e se nenhuma abrir nada o compactado sai `protegido` (e não "lido",
 * o que o deixaria no cache dizendo "tem senha" mesmo depois de cadastrada, I4).
 */
export async function lerCom7Zip(bytes: Buffer, ext: string, limites: Limites, orcamento: Orcamento, profundidade: number, senhas: readonly string[], extrairFilho: ExtrairFilho, sete: SeteZip, semRemetente?: boolean): Promise<CompactadoLido> {
  const pasta = await mkdtemp(join(tmpdir(), "orbita-anexo-"));
  const arquivo = join(pasta, `arquivo.${ext.replace(/[^a-z0-9]/gi, "") || "bin"}`);
  const oQue = ext.toUpperCase();
  try {
    // 0o600: só o dono do processo lê o compactado temporário (no Windows, a pasta temporária já é do usuário)
    await writeFile(arquivo, bytes, { mode: 0o600 });
    const tentativas = senhas.length ? [...senhas] : [""];
    let listagem: EntradaDo7z[] | null = null;
    // a senha que listou: só vale de verdade quando o cabeçalho é cifrado (`-mhe`), e aí é a única que abre
    let indiceDaLista = 0;
    for (const [i, s] of tentativas.entries()) {
      const r = await sete.rodar(["l", "-slt", "-ba", "-sccUTF-8", `-p${s}`, "--", arquivo], 8 * 1024 * 1024);
      if (r.codigo === 0) {
        listagem = listagemDo7z(r.saida.toString("utf8"));
        indiceDaLista = i;
        break;
      }
      if (!senhaInvalida(r.erro)) throw new Error("O 7-Zip não conseguiu abrir o compactado.");
    }
    if (!listagem) return { ...montar([], [], [], oQue), protegido: { motivo: motivoDaSenha(`O compactado ${oQue}`, senhas, semRemetente) } };

    const arquivos = listagem.filter((e) => !e.pasta && ehAlvoDeLeitura(e.caminho));
    if (arquivos.length > limites.zipMaxArquivos) throw new CompactadoRecusadoError(`O compactado tem mais de ${limites.zipMaxArquivos} arquivos (o teto configurado). Não abri.`);
    const declarado = arquivos.reduce((s, e) => s + e.tamanho, 0);
    if (declarado > orcamento.bytes) throw new CompactadoRecusadoError(`O conteúdo descompactado declarado (${tamanhoLegivel(declarado)}) passa do teto. Não abri.`);

    const lidos: { caminho: string; ex: Extraido }[] = [];
    const listados: ArquivoInterno[] = [];
    let fechados = 0;
    // null: ainda não se sabe qual senha abre o conteúdo (nenhum arquivo cifrado foi tirado)
    let senhaDoConteudo: number | null = null;
    let nenhumaAbre = false;
    for (const e of arquivos) {
      orcamento.arquivos--;
      if (orcamento.arquivos < 0) throw new CompactadoRecusadoError(`Os compactados, somados, passam de ${limites.zipMaxArquivos} arquivos. Não abri.`);
      if (e.tamanho > limites.arquivoMaxBytes) {
        listados.push({ caminho: e.caminho, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: `grande demais para ler (${tamanhoLegivel(e.tamanho)})` });
        continue;
      }
      if (semTextoNoOrcamento(orcamento)) {
        listados.push({ caminho: e.caminho, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: naoLidoPeloTeto(limites) });
        continue;
      }
      // o teto da saída é o MENOR entre o arquivo e o que sobra do orçamento: o tamanho listado é declarado, o real é contado
      const teto = Math.min(limites.arquivoMaxBytes, orcamento.bytes);
      const tirar = (senha: string) => sete.rodar(["e", "-so", "-sccUTF-8", `-p${senha}`, "--", arquivo, e.caminho], teto);
      let r: Awaited<ReturnType<SeteZip["rodar"]>>;
      if (senhaDoConteudo !== null) r = await tirar(tentativas[senhaDoConteudo]!);
      else if (nenhumaAbre && e.criptografado) r = { codigo: 2, saida: Buffer.alloc(0), erro: "Wrong password" };
      else {
        // a primeira tentativa é a que listou; se ela não abre e o arquivo pede senha, as outras uma a uma
        r = await tirar(tentativas[indiceDaLista]!);
        if (r.codigo === 0 && e.criptografado) senhaDoConteudo = indiceDaLista;
        else if (r.codigo !== 0 && senhaInvalida(r.erro)) {
          for (const [i, s] of tentativas.entries()) {
            if (i === indiceDaLista) continue;
            const outra = await tirar(s);
            if (outra.codigo === 0) {
              r = outra;
              senhaDoConteudo = i;
              break;
            }
            if (!senhaInvalida(outra.erro)) break;
          }
          if (senhaDoConteudo === null) nenhumaAbre = true;
        }
      }
      if (r.codigo !== 0) {
        if (senhaInvalida(r.erro)) {
          fechados++;
          listados.push({ caminho: e.caminho, ext: "?", familia: "protegido", tamanho: e.tamanho, lido: false, resumo: "protegido por senha" });
          continue;
        }
        listados.push({ caminho: e.caminho, ext: "?", familia: "desconhecido", tamanho: e.tamanho, lido: false, resumo: "o 7-Zip não conseguiu tirar este arquivo" });
        continue;
      }
      orcamento.bytes -= r.saida.length;
      if (orcamento.bytes < 0) throw new CompactadoRecusadoError("O conteúdo descompactado passa do teto. Pode ser uma bomba de compressão: não abri.");
      lidos.push({ caminho: e.caminho, ex: await extrairFilho(r.saida, e.caminho.split("/").pop() || e.caminho, profundidade + 1) });
    }
    const out = montar(lidos, listados, [], oQue, limites.textoMax);
    if (bateuNoTeto(lidos, listados, limites)) out.avisos.push(avisoDoTetoDeTexto(limites.textoMax));
    // tudo que pedia senha ficou fechado, e nada mais foi lido: é um compactado protegido, não um compactado lido
    if (fechados && !lidos.length) out.protegido = { motivo: motivoDaSenha(`O compactado ${oQue}`, senhas, semRemetente) };
    else if (fechados) out.avisos.push(`${fechados} arquivo(s) ficaram fechados por senha.`);
    // a senha só conta como usada se ela abriu um arquivo cifrado de verdade (o "" de quem não tem senha não é senha)
    const usada = senhaDoConteudo !== null && senhas.length ? senhaDoConteudo : senhaDosDeDentro(lidos);
    if (usada !== undefined) out.senhaUsada = usada;
    return out;
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}
