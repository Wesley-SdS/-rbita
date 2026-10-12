"""Modo ISOLADO para script desconhecido (PRD A10): rede desligada, pasta só para leitura.

Dois motores, detectados de verdade (nunca presumidos):

  - **Windows Sandbox** (`WindowsSandbox.exe`, recurso opcional do Windows Pro):
    um `.wsb` com rede desligada, a pasta do comando mapeada só para leitura e
    uma pasta de saída. O `wsb exec` não devolve stdout (PRD §12.10), então a
    saída e o código voltam por arquivo na pasta compartilhada;
  - **Docker** (Docker Desktop com Linux): `--network none`, sistema de
    arquivos só de leitura, sem capacidades, limite de memória e de processos,
    a pasta montada só para leitura e `/saida` gravável.

Sem nenhum dos dois, o erro diz exatamente o que falta. Nunca cai para o
terminal normal: o dono pediu isolamento, e rodar sem ele seria mentir.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

PASTA_SAIDA = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "Orbita" / "maos" / "isolado"


def sandbox_disponivel() -> str | None:
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsSandbox.exe"
    if exe.is_file():
        return str(exe)
    return shutil.which("WindowsSandbox.exe")


def docker_disponivel() -> str | None:
    exe = shutil.which("docker.exe") or shutil.which("docker")
    if not exe:
        return None
    try:
        r = subprocess.run([exe, "info", "--format", "{{.OSType}}"], capture_output=True, timeout=240, creationflags=0x08000000)
        return exe if r.returncode == 0 and r.stdout.decode(errors="ignore").strip() == "linux" else None
    except (OSError, subprocess.SubprocessError):
        return None


def motores() -> dict:
    return {"sandbox": sandbox_disponivel() is not None, "docker": docker_disponivel() is not None}


def escolher(preferencia: str) -> str:
    """auto: Sandbox se existir, senão Docker. Pedido explícito sem o motor é erro, não troca silenciosa."""
    m = motores()
    if preferencia == "sandbox":
        if not m["sandbox"]:
            raise RuntimeError("O Windows Sandbox não está instalado nesta máquina (é o recurso opcional \"Área Restrita do Windows\", que pede Windows Pro e virtualização ligada). Ligue-o ou escolha Docker em Ajustes.")
        return "sandbox"
    if preferencia == "docker":
        if not m["docker"]:
            raise RuntimeError("O Docker (com contêiner Linux) não está rodando nesta máquina. Abra o Docker Desktop ou escolha outro modo em Ajustes.")
        return "docker"
    if m["sandbox"]:
        return "sandbox"
    if m["docker"]:
        return "docker"
    raise RuntimeError("Não há como isolar nesta máquina: o Windows Sandbox não está instalado e o Docker Desktop não está rodando.")


def args_docker(exe: str, nome: str, pasta: str, saida: str, imagem: str, comando: str, memoria_mb: int) -> list[str]:
    return [
        exe, "run", "--rm", "--name", nome, "--network", "none", "--read-only", "--tmpfs", "/tmp:rw,size=256m",
        "--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--pids-limit", "256", "--memory", f"{memoria_mb}m", "--cpus", "2",
        "--mount", f"type=bind,source={pasta},target=/trabalho,readonly", "--mount", f"type=bind,source={saida},target=/saida",
        "-w", "/trabalho", imagem, "sh", "-c", comando,
    ]


def config_wsb(pasta: str, saida: str, comando: str) -> str:
    """O `.wsb`: rede e área de transferência desligadas, a pasta do comando só para leitura."""
    linha = f'cmd /c "cd /d C:\\trabalho &amp;&amp; ({comando.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace(chr(34), "&quot;")}) &gt; C:\\saida\\saida.txt 2&gt;&amp;1 &amp; echo %errorlevel% &gt; C:\\saida\\codigo.txt"'
    return f"""<Configuration>
  <Networking>Disable</Networking>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <PrinterRedirection>Disable</PrinterRedirection>
  <AudioInput>Disable</AudioInput>
  <VideoInput>Disable</VideoInput>
  <ProtectedClient>Enable</ProtectedClient>
  <MappedFolders>
    <MappedFolder><HostFolder>{pasta}</HostFolder><SandboxFolder>C:\\trabalho</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>{saida}</HostFolder><SandboxFolder>C:\\saida</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>{linha}</Command></LogonCommand>
</Configuration>
"""


# Os processos de uma Área Restrita do Windows. O servidor da sessão não nasce
# como filho do WindowsSandbox.exe (e, no Windows 11 24H2, o WindowsSandbox.exe
# pode só repassar o pedido e sair), por isso a instância é reconhecida por
# "árvore do que lançamos" MAIS "processo do Sandbox que nasceu depois".
NOMES_DO_SANDBOX = ("WindowsSandbox.exe", "WindowsSandboxClient.exe", "WindowsSandboxRemoteSession.exe", "WindowsSandboxServer.exe")


def processos_do_sandbox() -> set[int]:
    """Os PIDs de processos do Windows Sandbox rodando agora."""
    import psutil

    nomes = {n.lower() for n in NOMES_DO_SANDBOX}
    out: set[int] = set()
    for p in psutil.process_iter(["pid", "name"]):
        if (p.info.get("name") or "").lower() in nomes:
            out.add(p.info["pid"])
    return out


def arvore_do_processo(pid: int) -> set[int]:
    """O processo e todos os descendentes vivos."""
    import psutil

    try:
        return {pid, *(c.pid for c in psutil.Process(pid).children(recursive=True))}
    except psutil.Error:
        return {pid}


def matar_pids(pids: set[int]) -> None:
    import psutil

    for pid in pids:
        try:
            psutil.Process(pid).kill()
        except psutil.Error:
            pass  # já saiu sozinho


def _lancar(args: list[str]):
    return subprocess.Popen(args, creationflags=0x08000000)


def rodar_no_sandbox(
    pasta: str,
    comando: str,
    timeout_seg: int,
    *,
    exe: str | None = None,
    lancar=_lancar,
    listar=processos_do_sandbox,
    arvore_de=arvore_do_processo,
    matar=matar_pids,
    dormir=time.sleep,
) -> dict:
    """Roda `comando` numa Área Restrita descartável e devolve a saída (por arquivo).

    Só a instância que ESTA chamada abriu é fechada. A versão anterior fazia
    `taskkill /IM WindowsSandbox.exe /F` no fim e derrubava junto uma Área
    Restrita que o dono tivesse aberto à mão, com o que ele estivesse fazendo
    nela (G5 da auditoria de 11/10/2026). Como o Windows roda uma Área Restrita
    por vez, havendo uma aberta antes a chamada RECUSA, em vez de disputar
    com ela; e o que se mata no fim é a árvore do processo lançado mais os
    processos do Sandbox que nasceram depois do lançamento.

    `lancar`, `listar`, `arvore_de`, `matar` e `dormir` existem para o teste
    simular o Sandbox: ele não está instalado nesta máquina.
    """
    exe = exe or sandbox_disponivel()
    if not exe:
        raise RuntimeError("O Windows Sandbox não está instalado nesta máquina.")
    antes = listar()
    if antes:
        raise RuntimeError(
            "Já existe uma Área Restrita do Windows aberta nesta máquina, e o Windows roda uma por vez. Feche-a para rodar o comando isolado (a Órbita não fecha a que você abriu)."
        )
    sid = uuid.uuid4().hex[:10]
    saida = PASTA_SAIDA / sid
    saida.mkdir(parents=True, exist_ok=True)
    cfg = saida.parent / f"{sid}.wsb"
    cfg.write_text(config_wsb(pasta, str(saida), comando), encoding="utf-8")
    comeco = time.time()
    proc = lancar([exe, str(cfg)])
    codigo_arq = saida / "codigo.txt"
    try:
        while time.time() - comeco < timeout_seg:
            if codigo_arq.exists() and codigo_arq.stat().st_size > 0:
                break
            dormir(1)
        terminou = codigo_arq.exists()
    finally:
        # o Sandbox é descartável: fechar apaga tudo que foi feito dentro dele. Só o NOSSO (ver acima).
        matar(arvore_de(proc.pid) | (listar() - antes))
        cfg.unlink(missing_ok=True)
    texto = (saida / "saida.txt").read_text(encoding="utf-8", errors="replace") if (saida / "saida.txt").exists() else ""
    codigo = int(codigo_arq.read_text().strip() or "-1") if terminou else None
    return {"motor": "sandbox", "terminou": terminou, "codigo": codigo, "saida": texto, "pasta_saida": str(saida), "duracaoMs": int((time.time() - comeco) * 1000)}
