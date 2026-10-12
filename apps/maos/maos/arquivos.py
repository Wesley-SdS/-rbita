"""Arquivos que precisam do Windows do dono: Lixeira, salvar anexo e abrir com o programa padrão.

Ler, listar e escrever moram no core (o extrator universal é de lá). Aqui
fica o que só o shell do Windows faz, com as travas repetidas do lado de cá:

  - LIXEIRA, nunca apagar de vez (`send2trash` usa a operação de arquivo do
    shell com "permitir desfazer");
  - caminho fora das raízes recebidas, `..` e link que sai da raiz: recusados;
  - SALVAR grava em `Downloads/Órbita/` sem nunca sobrescrever (nome novo), sem
    marca de executável e com a "marca da web" (`Zone.Identifier`), para o
    próprio Windows tratar o arquivo como vindo da internet;
  - ABRIR com o programa padrão recusa executável pelo NOME e pelos BYTES
    (um `.pdf` que começa com `MZ` é um `.exe`).
"""

from __future__ import annotations

import os
import re
from pathlib import Path

EXTENSOES_EXECUTAVEIS = {
    ".exe", ".msi", ".msix", ".appx", ".bat", ".cmd", ".com", ".scr", ".pif", ".cpl", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh",
    ".hta", ".lnk", ".url", ".iso", ".img", ".vhd", ".vhdx", ".apk", ".jar", ".reg", ".dll", ".sys", ".msc", ".gadget", ".application", ".appref-ms", ".py", ".pyw",
    ".sh", ".docm", ".xlsm", ".pptm", ".scf", ".inf", ".chm", ".library-ms", ".search-ms", ".settingcontent-ms",
    # os que faltavam (M11 da auditoria de 11/10/2026): Office com macro (binário, modelo,
    # suplemento, show), consulta web e SYLK do Excel (executam ao abrir), scriptlets do
    # Windows Script Host, pacote de diagnóstico e instalador de app
    ".xlsb", ".dotm", ".xltm", ".xlam", ".ppam", ".potm", ".ppsm", ".sldm", ".iqy", ".slk", ".sct", ".wsc",
    ".diagcab", ".appinstaller",
}
ASSINATURAS_EXECUTAVEIS = (b"MZ", b"\x7fELF", b"#!", b"PK\x03\x04META-INF")
OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
# os fluxos de macro dentro do contêiner OLE (DOC e XLS antigos), como o diretório os grava: UTF-16LE
NOMES_DE_MACRO = ("_VBA_PROJECT".encode("utf-16-le"), "Macros".encode("utf-16-le"))
# o bastante para qualquer anexo (o core recusa acima de `anexos.tamanhoMaxMb`), sem ler um disco inteiro
MAX_LIDO_PARA_MACRO = 64 * 1024 * 1024


def tem_macro_ole(dados: bytes) -> bool:
    """DOC e XLS ANTIGOS (OLE) com macro: a extensão é a mesma do sem macro, então é pelos bytes.

    O `.doc` com VBA roda a macro ao abrir no Office (com o aviso que o dono clica sem ler);
    a marca da web atenua, mas a Órbita não abre o que tem código dentro.
    """
    return dados.startswith(OLE) and any(n in dados for n in NOMES_DE_MACRO)


def dentro_das_raizes(caminho: str, raizes: list[str]) -> Path:
    """O caminho resolvido (links seguidos) tem de cair dentro de uma raiz. Levanta PermissionError."""
    alvo = Path(os.path.expanduser(caminho))
    try:
        real = alvo.resolve(strict=True)
    except OSError as e:
        raise FileNotFoundError(f"Não achei {caminho}.") from e
    for r in raizes:
        try:
            raiz = Path(os.path.expanduser(r)).resolve(strict=True)
        except OSError:
            continue
        if real == raiz:
            raise PermissionError("Não mexo na pasta liberada inteira, só no que está dentro dela.")
        if raiz in real.parents:
            return real
    raise PermissionError("Esse caminho está fora das pastas liberadas (ou é um atalho que aponta para fora delas).")


def para_lixeira(caminho: str, raizes: list[str]) -> dict:
    from send2trash import send2trash

    real = dentro_das_raizes(caminho, raizes)
    tipo = "pasta" if real.is_dir() else "arquivo"
    send2trash(str(real))
    if real.exists():
        raise OSError("O Windows não mandou para a Lixeira.")
    return {"ok": True, "caminho": str(real), "tipo": tipo}


def eh_executavel(nome: str, inicio: bytes) -> bool:
    if Path(nome).suffix.lower() in EXTENSOES_EXECUTAVEIS:
        return True
    if tem_macro_ole(inicio):
        return True
    return any(inicio.startswith(a) for a in ASSINATURAS_EXECUTAVEIS)


NOME_SEGURO = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def nome_seguro(nome: str) -> str:
    n = NOME_SEGURO.sub("_", nome).strip(" .")[:150] or "anexo"
    base = n.split(".")[0].upper()
    if base in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(10)), *(f"LPT{i}" for i in range(10))}:
        n = "_" + n
    return n


def salvar(pasta: str, nome: str, dados: bytes) -> dict:
    destino_dir = Path(os.path.expanduser(pasta))
    destino_dir.mkdir(parents=True, exist_ok=True)
    nome = nome_seguro(nome)
    alvo = destino_dir / nome
    stem, suf = alvo.stem, alvo.suffix
    k = 1
    # nunca sobrescreve: o arquivo que o dono já tem não some por um anexo com o mesmo nome
    while alvo.exists():
        k += 1
        alvo = destino_dir / f"{stem} ({k}){suf}"
    with open(alvo, "xb") as f:
        f.write(dados)
    try:
        # a "marca da web": o Windows (SmartScreen, Office em modo protegido) trata como vindo de fora
        with open(str(alvo) + ":Zone.Identifier", "w", encoding="ascii") as z:
            z.write("[ZoneTransfer]\r\nZoneId=3\r\n")
    except OSError:
        pass
    # o OLE inteiro (até o teto): o fluxo de macro mora no diretório, que não está nos primeiros bytes
    amostra = dados[:MAX_LIDO_PARA_MACRO] if dados.startswith(OLE) else dados[:64]
    return {"ok": True, "caminho": str(alvo), "bytes": len(dados), "executavel": eh_executavel(alvo.name, amostra)}


def abrir_arquivo(caminho: str, raizes: list[str]) -> dict:
    real = dentro_das_raizes(caminho, raizes)
    if real.is_dir():
        os.startfile(str(real))  # type: ignore[attr-defined]  # abre no Explorador
        return {"ok": True, "caminho": str(real), "tipo": "pasta"}
    with open(real, "rb") as f:
        inicio = f.read(64)
        if inicio.startswith(OLE):
            inicio += f.read(MAX_LIDO_PARA_MACRO)
    if eh_executavel(real.name, inicio):
        raise PermissionError("Esse arquivo é um programa ou script: a Órbita nunca abre executável.")
    os.startfile(str(real))  # type: ignore[attr-defined]
    return {"ok": True, "caminho": str(real), "tipo": "arquivo"}


def abrir_url(url: str) -> dict:
    if not re.match(r"^https?://[^\s]+$", url, re.I):
        raise PermissionError("Só abro endereço http ou https.")
    os.startfile(url)  # type: ignore[attr-defined]
    return {"ok": True, "url": url}


def abrir_app(nome: str) -> dict:
    """Pelo nome que o Windows conhece (App Paths, PATH): "code", "excel", "notepad"."""
    from .apps import APELIDOS, normalizar_app

    n = normalizar_app(nome)
    exe = next((k for k, v in APELIDOS.items() if n == k or n in v), n)
    # o executável do app nem sempre é o nome que abre ele (a Calculadora é UWP)
    exe = LANCADORES.get(exe, exe)
    if not re.match(r"^[a-z0-9 ._-]{1,60}:?$", exe):
        raise ValueError("Nome de app inválido.")
    from win32com.shell import shell, shellcon

    try:
        # sem a caixa de erro do Windows: app que não existe vira resposta, não um diálogo na tela do dono
        shell.ShellExecuteEx(fMask=shellcon.SEE_MASK_FLAG_NO_UI, lpVerb="open", lpFile=exe, nShow=1)
    except Exception as e:  # noqa: BLE001
        raise FileNotFoundError(f"Não achei o app {nome}.") from e
    return {"ok": True, "app": nome, "executavel": exe}


LANCADORES = {"calculatorapp": "calc", "systemsettings": "ms-settings:", "windowsterminal": "wt", "ms-teams": "ms-teams:"}
