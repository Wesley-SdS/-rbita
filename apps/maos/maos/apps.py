"""Quem é o app de uma janela, e como o nome que o dono diz casa com ele.

O envelope tem os nomes que o dono (ou o modelo, ao propor) escreveu: "VS
Code", "Excel", "Explorador de Arquivos". A janela tem o executável
(`Code.exe`) e a descrição gravada no binário ("Visual Studio Code"). O
TÍTULO da janela nunca entra na identidade: ele é escolhido pelo conteúdo
(uma página no Chrome pode se chamar "Excel"), e identidade que o conteúdo
escolhe não é identidade.

`APELIDOS` é fato sobre o Windows (o Word é o `WINWORD.EXE`), não decisão do
dono: o que ele decide é QUAIS apps entram no envelope, e isso é dado.
"""

from __future__ import annotations

import os
import re
import unicodedata
from functools import lru_cache

import psutil


def normalizar_app(nome: str) -> str:
    """Igual ao `normalizarApp` do core: sem acento, sem caixa, sem `.exe`."""
    s = unicodedata.normalize("NFD", nome or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\.exe$", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()[:80]


# executável (sem .exe, minúsculo) -> outros nomes pelos quais o dono chama o app
APELIDOS: dict[str, tuple[str, ...]] = {
    "code": ("vs code", "vscode", "visual studio code"),
    "winword": ("word", "microsoft word"),
    "excel": ("microsoft excel",),
    "powerpnt": ("powerpoint", "microsoft powerpoint"),
    "outlook": ("microsoft outlook",),
    "olk": ("outlook", "novo outlook"),
    "explorer": ("explorador de arquivos", "explorador", "file explorer", "windows explorer"),
    "msedge": ("edge", "microsoft edge"),
    "chrome": ("google chrome",),
    "windowsterminal": ("terminal", "windows terminal"),
    "notepad": ("bloco de notas",),
    "ms-teams": ("teams", "microsoft teams"),
    "spotify": (),
    "whatsapp": ("whatsapp desktop",),
    "calculatorapp": ("calculadora", "calculator"),
    "mspaint": ("paint",),
    "systemsettings": ("configuracoes", "configurações", "settings"),
    "taskmgr": ("gerenciador de tarefas", "task manager"),
    "slack": (),
    "zoom": (),
}


@lru_cache(maxsize=512)
def _descricao_do_binario(caminho: str) -> tuple[str, str]:
    """FileDescription e ProductName do recurso de versão do executável."""
    try:
        import win32api

        info = win32api.GetFileVersionInfo(caminho, "\\VarFileInfo\\Translation")
        if not info:
            return ("", "")
        lang, cp = info[0]
        base = f"\\StringFileInfo\\{lang:04x}{cp:04x}\\"
        d = win32api.GetFileVersionInfo(caminho, base + "FileDescription") or ""
        p = win32api.GetFileVersionInfo(caminho, base + "ProductName") or ""
        return (str(d).strip(), str(p).strip())
    except Exception:  # noqa: BLE001 - binário sem recurso de versão, ou sem acesso
        return ("", "")


@lru_cache(maxsize=1024)
def _identidade_do_executavel(caminho: str) -> tuple[str, tuple[str, ...]]:
    exe = os.path.basename(caminho)
    stem = normalizar_app(exe)
    desc, prod = _descricao_do_binario(caminho)
    nomes = [stem, normalizar_app(desc), normalizar_app(prod), *APELIDOS.get(stem, ())]
    vistos: list[str] = []
    for n in nomes:
        n = normalizar_app(n)
        if n and n not in vistos:
            vistos.append(n)
    exibicao = desc or prod or os.path.splitext(exe)[0]
    return (exibicao, tuple(vistos))


def identidade_do_pid(pid: int) -> dict:
    """{app, exe, nomes}: `app` é para mostrar, `nomes` é o que casa com o envelope."""
    try:
        p = psutil.Process(pid)
        caminho = p.exe()
    except (psutil.Error, OSError):
        try:
            nome = psutil.Process(pid).name()
        except (psutil.Error, OSError):
            return {"app": "", "exe": "", "nomes": []}
        stem = normalizar_app(nome)
        return {"app": os.path.splitext(nome)[0], "exe": nome, "nomes": [stem, *APELIDOS.get(stem, ())]}
    exibicao, nomes = _identidade_do_executavel(caminho)
    return {"app": exibicao, "exe": os.path.basename(caminho), "nomes": list(nomes)}


def nomes_com_apelidos(nomes: list[str] | tuple[str, ...]) -> set[str]:
    """Os nomes mais o executável e os apelidos dele: "VS Code" vira {vs code, code, vscode, visual studio code}."""
    out: set[str] = set()
    for n in nomes:
        n = normalizar_app(n)
        if not n:
            continue
        out.add(n)
        for exe, apelidos in APELIDOS.items():
            if n == exe or n in apelidos:
                out.add(exe)
                out.update(apelidos)
    return out


def app_no_envelope(nomes: list[str] | tuple[str, ...], apps_do_envelope: list[str]) -> bool:
    """Algum nome do app é um app do envelope (sem acento e sem caixa), contando os apelidos
    dos DOIS lados: o envelope diz "VS Code" e a janela pode trazer só "code"."""
    alvo = nomes_com_apelidos(apps_do_envelope)
    return bool(alvo) and bool(nomes_com_apelidos(nomes) & alvo)


def app_oculto(nomes: list[str] | tuple[str, ...], titulo: str, ocultos: list[str]) -> bool:
    """Apps ocultos casam pelo nome do app OU pelo título.

    Aqui o título entra de propósito, ao contrário do envelope: esconder demais
    (uma página chamada "KeePass") só apaga um pedaço da imagem, enquanto
    mostrar de menos vaza um cofre de senha. Falha para o lado de esconder.
    """
    lista = [normalizar_app(o) for o in ocultos if normalizar_app(o)]
    if not lista:
        return False
    nomes_n = {normalizar_app(n) for n in nomes if n}
    titulo_n = normalizar_app(titulo)
    for o in lista:
        if o in nomes_n:
            return True
        # palavra inteira no título: "KeePass" pega "Banco.kdbx - KeePass", mas "Code" não pega "Encode"
        if titulo_n and re.search(rf"(^|[^\w]){re.escape(o)}($|[^\w])", titulo_n):
            return True
    return False
