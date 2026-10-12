"""Os FATOS de um comando (PRD A3): o apps/maos analisa, o core decide.

PowerShell pelo parser oficial, num processo que fica aberto (`analisar.ps1`).
O `pwsh` (7) é usado quando existe; senão, o Windows PowerShell 5.1, que tem o
mesmo `Parser.ParseInput` (confere `parser_disponivel`). Bash pela gramática
`tree-sitter-bash`, sem processo nenhum.

Os fatos têm o MESMO formato para as duas linguagens, e o core
(`terminal/risco.ts`) não sabe qual parser rodou: comandos (nome, nome
resolvido do alias, argumentos), redirecionamentos, substituições, métodos e
tipos .NET, operadores, atribuições. Qualquer dúvida aqui vira `parse_ok:
false`, e o core trata parse falho como `perigoso`.
"""

from __future__ import annotations

import base64
import glob
import itertools
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

import tree_sitter_bash
from tree_sitter import Language, Parser

SCRIPT = Path(__file__).with_name("analisar.ps1")


def falha(shell: str, erro: str) -> dict:
    return {"shell": shell, "parse_ok": False, "erros": [erro], "comandos": [], "redirecionamentos": [], "substituicoes": [], "metodos": [], "tipos": [], "operadores": [], "atribuicoes": 0, "instrucoes": 0}


class AnalisadorPowerShell:
    """Um powershell -NoProfile aberto, um pedido por linha, com prazo por pedido."""

    def __init__(self, exe: str, prazo_seg: float = 8.0) -> None:
        self.exe = exe
        self.prazo = prazo_seg
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._seq = 0
        self.subida_ms: float | None = None

    def _subir(self) -> subprocess.Popen:
        comeco = time.perf_counter()
        script = SCRIPT.read_text(encoding="ascii")
        b64 = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        p = subprocess.Popen(
            [self.exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", b64],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=0x08000000,
        )
        self._proc = p
        self.subida_ms = (time.perf_counter() - comeco) * 1000
        return p

    def fechar(self) -> None:
        with self._lock:
            if self._proc and self._proc.poll() is None:
                self._proc.kill()
            self._proc = None

    def analisar(self, comando: str) -> dict:
        with self._lock:
            p = self._proc if self._proc and self._proc.poll() is None else self._subir()
            self._seq += 1
            pedido = json.dumps({"id": self._seq, "comando": comando}, ensure_ascii=False) + "\n"
            resultado: dict = {}

            def ler():
                try:
                    assert p.stdout
                    linha = p.stdout.readline()
                    resultado["linha"] = linha
                except Exception as e:  # noqa: BLE001
                    resultado["erro"] = str(e)

            try:
                assert p.stdin
                p.stdin.write(pedido.encode("utf-8"))
                p.stdin.flush()
            except OSError as e:
                self._proc = None
                return falha("powershell", f"analisador fora do ar: {e}")
            t = threading.Thread(target=ler, daemon=True)
            t.start()
            t.join(self.prazo)
            if t.is_alive() or not resultado.get("linha"):
                # travou ou morreu: mata e o próximo pedido sobe outro. Parse que não volta é perigoso.
                p.kill()
                self._proc = None
                return falha("powershell", resultado.get("erro") or "o analisador não respondeu a tempo")
            try:
                fatos = json.loads(resultado["linha"].decode("utf-8"))
            except (ValueError, UnicodeDecodeError) as e:
                return falha("powershell", f"resposta ilegível do analisador: {e}")
            if fatos.get("id") != self._seq:
                # resposta fora de ordem: alguém leu a linha errada, não confio em nada
                p.kill()
                self._proc = None
                return falha("powershell", "resposta fora de ordem do analisador")
            fatos.pop("id", None)
            return fatos


def parser_disponivel(exe: str) -> bool:
    """O `Parser.ParseInput` existe neste PowerShell? (Existe desde o 3.0; conferido, não presumido.)"""
    try:
        r = subprocess.run(
            [exe, "-NoProfile", "-NonInteractive", "-Command", "[bool]([System.Management.Automation.Language.Parser].GetMethod('ParseInput',[type[]]@([string],[System.Management.Automation.Language.Token[]].MakeByRefType(),[System.Management.Automation.Language.ParseError[]].MakeByRefType())))"],
            capture_output=True,
            timeout=20,
            creationflags=0x08000000,
        )
        return r.stdout.decode(errors="ignore").strip().lower() == "true"
    except (OSError, subprocess.SubprocessError):
        return False


# ── o caminho REAL de cada argumento ───────────────────────────────────────
# O core compara os argumentos com `arquivos.negados` pelo TEXTO, e o Windows
# lê o mesmo arquivo por vários nomes (G1 da auditoria de 11/10/2026): link
# simbólico e junção com nome inocente, nome curto 8.3 (`ENV~1`), curinga
# (`.en*`) e fluxo do NTFS (`.env::$DATA`). Aqui cada argumento que EXISTE no
# disco, na pasta do comando, vira o caminho final (`os.path.realpath`, que no
# Windows abre o arquivo e pede o nome final ao sistema), e o core confere
# esse caminho com as mesmas regras das tools de arquivo. Nada aqui lê o
# conteúdo de arquivo nenhum.

MAX_ARGS_RESOLVIDOS = 64
MAX_CASAMENTOS_POR_CURINGA = 50
_CURINGA = ("*", "?", "[")


def _valor_do_arg(a: str) -> str:
    """Tira o "-Path:" da frente (PowerShell) e as aspas, como o core faz."""
    v = a.strip()
    if v.startswith("-") and ":" in v:
        nome, _, resto = v.partition(":")
        if nome[1:].isalpha():
            v = resto
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v


def _eh_rede_ou_dispositivo(v: str) -> bool:
    # UNC e \\?\ ficam de fora: resolver um caminho de rede pode travar, e o core já os sobe para perigoso
    return len(v) >= 2 and v[0] in "\\/" and v[1] in "\\/"


def _expandir(v: str, home: str) -> str:
    baixo = v.lower()
    for prefixo in ("$env:userprofile", "$home", "%userprofile%"):
        if baixo == prefixo or baixo.startswith(prefixo + "\\") or baixo.startswith(prefixo + "/"):
            return home + v[len(prefixo):]
    if v == "~" or v.startswith("~/") or v.startswith("~\\"):
        return home + v[1:]
    m = re.match(r"^/([a-zA-Z])(/|$)", v)
    if m:  # /c/Users/... do Git Bash
        return f"{m.group(1).upper()}:\\" + v[3:].replace("/", "\\")
    return v


def _sem_fluxo(p: str) -> str:
    """`C:\\x\\.env::$DATA` e `.env:oculto` são o próprio `.env`: o fluxo é o que vem depois do primeiro dois-pontos."""
    unidade, resto = os.path.splitdrive(p)
    return unidade + resto.split(":", 1)[0] if ":" in resto else p


def caminhos_reais(fatos: dict, pasta: str, home: str | None = None) -> list[dict]:
    """[{arg, real}] de cada argumento (e alvo de `<`) que existe no disco, com link, 8.3, curinga e fluxo resolvidos."""
    home = home or os.path.expanduser("~")
    candidatos: list[str] = []
    for c in fatos.get("comandos") or []:
        candidatos.extend(a for a in c.get("args") or [] if isinstance(a, str))
    candidatos.extend(r["alvo"] for r in fatos.get("redirecionamentos") or [] if r.get("tipo") == "entrada" and r.get("alvo"))
    out: list[dict] = []
    vistos: set[tuple[str, str]] = set()
    for a in candidatos[:MAX_ARGS_RESOLVIDOS]:
        v = _valor_do_arg(a)
        if not v or v.startswith("-") or _eh_rede_ou_dispositivo(v) or "\x00" in v or len(v) > 1000:
            continue
        p = _sem_fluxo(_expandir(v, home))
        if not os.path.isabs(p):
            p = os.path.join(pasta, p)
        if any(ch in p for ch in _CURINGA):
            try:
                achados = list(itertools.islice(glob.iglob(p, include_hidden=True), MAX_CASAMENTOS_POR_CURINGA))
            except (OSError, ValueError, re.error):
                achados = []
        else:
            achados = [p] if os.path.lexists(p) else []
        for achado in achados:
            try:
                real = os.path.realpath(achado)
            except (OSError, ValueError):
                continue
            if (a, real) not in vistos:
                vistos.add((a, real))
                out.append({"arg": a, "real": real})
    return out


# ── bash ────────────────────────────────────────────────────────────────────
_BASH = Language(tree_sitter_bash.language())
_parser_bash = Parser(_BASH)

OPERADORES_BASH = {";": ";", "&": "&", "&&": "&&", "||": "||", "|": "|", "|&": "|", "\n": "nova_linha", ";;": ";"}
EXPANSOES = {"command_substitution", "process_substitution", "simple_expansion", "expansion", "arithmetic_expansion", "brace_expression"}


def _tem_expansao(no) -> bool:
    if no.type in EXPANSOES:
        return True
    return any(_tem_expansao(f) for f in no.children)


def _literal(no, fonte: bytes) -> str:
    t = fonte[no.start_byte : no.end_byte].decode("utf-8", errors="replace")
    if no.type == "raw_string" and len(t) >= 2:
        return t[1:-1]
    if no.type == "string" and len(t) >= 2:
        return t[1:-1]
    if no.type == "concatenation":
        return "".join(_literal(f, fonte) for f in no.children)
    if no.type == "word":
        # fora de aspas, a barra invertida escapa o caractere seguinte, como o bash faz
        return re.sub(r"\\(.)", r"\1", t)
    return t


def analisar_bash(comando: str) -> dict:
    fonte = comando.encode("utf-8")
    arvore = _parser_bash.parse(fonte)
    raiz = arvore.root_node
    fatos = falha("bash", "")
    fatos["erros"] = []
    fatos["parse_ok"] = not raiz.has_error
    if raiz.has_error:
        fatos["erros"].append("o comando não é bash válido")
    fatos["instrucoes"] = sum(1 for f in raiz.children if f.is_named)
    ops: list[str] = []

    def visitar(no) -> None:
        tipo = no.type
        if not no.is_named and tipo in OPERADORES_BASH and OPERADORES_BASH[tipo] not in ops:
            ops.append(OPERADORES_BASH[tipo])
        if tipo == "command":
            nome_no = no.child_by_field_name("name")
            args, din = [], False
            for f in no.children_by_field_name("argument"):
                if _tem_expansao(f):
                    din = True
                args.append(_literal(f, fonte))
            nome = _literal(nome_no, fonte) if nome_no else ""
            fatos["comandos"].append(
                {
                    "nome": nome,
                    "nome_resolvido": None,
                    "dinamico": nome_no is None or _tem_expansao(nome_no),
                    "args": args,
                    "args_dinamicos": din,
                    "invocacao": None,
                }
            )
        elif tipo == "file_redirect":
            dest = no.child_by_field_name("destination")
            alvo = _literal(dest, fonte) if dest else ""
            op = next((fonte[f.start_byte : f.end_byte].decode() for f in no.children if not f.is_named), ">")
            if (op in (">&", "<&") and (alvo.isdigit() or alvo == "-")) or alvo == "/dev/null":
                # 2>&1 só mistura saídas e >/dev/null descarta: nenhum dos dois grava arquivo
                fatos["redirecionamentos"].append({"tipo": "mescla", "alvo": alvo, "anexar": False})
            elif op.startswith("<"):
                fatos["redirecionamentos"].append({"tipo": "entrada", "alvo": alvo, "anexar": False})
            else:
                fatos["redirecionamentos"].append({"tipo": "arquivo", "alvo": alvo, "anexar": ">>" in op})
        elif tipo in ("heredoc_redirect", "herestring_redirect"):
            fatos["redirecionamentos"].append({"tipo": "entrada", "alvo": None, "anexar": False})
        elif tipo == "command_substitution":
            fatos["substituicoes"].append({"tipo": "crase" if fonte[no.start_byte : no.start_byte + 1] == b"`" else "subexpressao", "texto": fonte[no.start_byte : no.end_byte].decode("utf-8", errors="replace")[:200]})
        elif tipo == "process_substitution":
            fatos["substituicoes"].append({"tipo": "processo", "texto": fonte[no.start_byte : no.end_byte].decode("utf-8", errors="replace")[:200]})
        elif tipo in ("subshell", "compound_statement", "function_definition"):
            fatos["substituicoes"].append({"tipo": "bloco", "texto": fonte[no.start_byte : no.end_byte].decode("utf-8", errors="replace")[:200]})
        elif tipo in ("variable_assignment", "declaration_command"):
            fatos["atribuicoes"] += 1
        for f in no.children:
            visitar(f)

    visitar(raiz)
    fatos["operadores"] = ops
    return fatos
