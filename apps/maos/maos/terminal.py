"""Terminal avulso (PRD A2): um comando, num Job Object, com ambiente mínimo.

O core já decidiu o risco e já passou pela fila quando precisava; aqui só se
executa, com as travas que não dependem do core:

  - a pasta tem de existir e ficar dentro de uma das raízes recebidas;
  - o ambiente do filho é SÓ a lista recebida, menos qualquer nome com cara de
    segredo (a lista é configurável; esta recusa não é);
  - saída por pipes (sem PTY: sai limpa e o código de saída é confiável),
    guardada como cabeça e cauda, para um `npm install` falante não encher a
    memória deste processo;
  - teto de tempo e de memória pelo job, e "parar" mata a árvore inteira.
"""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from .jobobj import Job

# segredo nunca vai para o filho, mesmo se o dono puser o nome na lista
SEGREDO = re.compile(r"(SECRET|TOKEN|PASSW|API_?KEY|PRIVATE|CREDENTIAL|ENC_KEY|_KEY$|^DATABASE_URL$|COOKIE|SESSION)", re.I)
# sem SystemRoot, até o Winsock do filho deixa de iniciar: não é escolha, é requisito do Windows
SEMPRE = ("SystemRoot",)


def ambiente_minimo(permitidas: list[str], origem: dict[str, str] | None = None) -> dict[str, str]:
    origem = dict(os.environ) if origem is None else origem
    por_nome = {k.upper(): (k, v) for k, v in origem.items()}
    out: dict[str, str] = {}
    for nome in [*SEMPRE, *permitidas]:
        nome = (nome or "").strip()
        if not nome or SEGREDO.search(nome):
            continue
        achado = por_nome.get(nome.upper())
        if achado:
            out[achado[0]] = achado[1]
    return out


def _wsl_tem_distro() -> bool:
    """O WSL só serve com uma distro de verdade: a `docker-desktop` não é um terminal para o dono."""
    exe = shutil.which("wsl.exe")
    if not exe:
        return False
    try:
        r = subprocess.run([exe, "-l", "-q"], capture_output=True, timeout=8, creationflags=0x08000000)
        nomes = r.stdout.decode("utf-16-le", errors="ignore").replace("\x00", "").split()
        return any(n and not n.lower().startswith("docker-desktop") for n in nomes)
    except (OSError, subprocess.SubprocessError):
        return False


def _git_bash() -> str | None:
    candidatos = []
    git = shutil.which("git.exe")
    if git:
        raiz = Path(git).resolve().parents[1]
        candidatos.append(raiz / "bin" / "bash.exe")
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")):
        candidatos.append(Path(base) / "Git" / "bin" / "bash.exe")
    for c in candidatos:
        if c.is_file():
            return str(c)
    return None


_shells_cache: dict[str, str] | None = None


def detectar_shells(recalcular: bool = False) -> dict[str, str]:
    """{nome: executável} dos terminais que existem nesta máquina."""
    global _shells_cache
    if _shells_cache is not None and not recalcular:
        return dict(_shells_cache)
    achados: dict[str, str] = {}
    pwsh = shutil.which("pwsh.exe") or next((str(p) for p in [Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "PowerShell" / "7" / "pwsh.exe"] if p.is_file()), None)
    if pwsh:
        achados["pwsh"] = pwsh
    ps = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    if ps.is_file():
        achados["powershell"] = str(ps)
    gb = _git_bash()
    if gb:
        achados["gitbash"] = gb
    if _wsl_tem_distro():
        achados["wsl"] = shutil.which("wsl.exe") or "wsl.exe"
    _shells_cache = achados
    return dict(achados)


PREFIXO_PS = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;\n"
SUFIXO_PS = "\n$__orbita_ok=$?;if($global:LASTEXITCODE){exit $global:LASTEXITCODE};if(-not $__orbita_ok){exit 1}"


def linha_de_comando(shell: str, exe: str, comando: str) -> list[str]:
    if shell in ("pwsh", "powershell"):
        # -EncodedCommand AQUI é só transporte: evita que aspas do comando
        # quebrem a linha de comando. O texto já foi analisado pelo AST antes.
        b64 = base64.b64encode((PREFIXO_PS + comando + SUFIXO_PS).encode("utf-16-le")).decode("ascii")
        return [exe, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", b64]
    if shell == "gitbash":
        return [exe, "--noprofile", "--norc", "-c", comando]
    if shell == "wsl":
        return [exe, "-e", "bash", "--noprofile", "--norc", "-c", comando]
    raise ValueError(f"terminal desconhecido: {shell}")


def dentro_de(pasta: Path, raizes: list[str]) -> bool:
    """A pasta (já resolvida, sem link) está dentro de alguma raiz? `..` e link não escapam."""
    try:
        alvo = pasta.resolve(strict=True)
    except OSError:
        return False
    for r in raizes:
        try:
            raiz = Path(os.path.expanduser(r)).resolve(strict=True)
        except OSError:
            continue
        if alvo == raiz or raiz in alvo.parents:
            return True
    return False


class Saida:
    """Cabeça e cauda da saída, com o total visto. Thread-safe."""

    def __init__(self, maximo: int) -> None:
        self.maximo = max(200, maximo)
        self.cabeca = ""
        self.cauda = ""
        self.total = 0
        self._lock = threading.Lock()

    def acrescentar(self, texto: str) -> None:
        with self._lock:
            self.total += len(texto)
            meia = self.maximo // 2
            if len(self.cabeca) < meia:
                falta = meia - len(self.cabeca)
                self.cabeca += texto[:falta]
                texto = texto[falta:]
            if texto:
                self.cauda = (self.cauda + texto)[-meia:]

    def texto(self) -> str:
        with self._lock:
            omitidos = self.total - len(self.cabeca) - len(self.cauda)
            if omitidos > 0:
                return f"{self.cabeca}\n[... {omitidos} caracteres omitidos ...]\n{self.cauda}"
            return self.cabeca + self.cauda


@dataclass
class Execucao:
    id: str
    comando: str
    shell: str
    pasta: str
    inicio: float
    saida: Saida
    job: Job
    proc: subprocess.Popen | None = None
    fim: float | None = None
    codigo: int | None = None
    status: str = "rodando"  # rodando | terminou | parado | tempo_esgotado | falhou
    motivo: str | None = None
    isolado: str | None = None
    # o que mais precisa morrer junto (o contêiner do Docker não é filho do processo)
    ao_parar: Callable[[], None] | None = None
    _pronto: threading.Event = field(default_factory=threading.Event)

    def matar(self) -> None:
        self.job.matar(1)
        if self.ao_parar:
            try:
                self.ao_parar()
            except Exception:  # noqa: BLE001
                pass

    def resumo(self) -> dict:
        dur = ((self.fim or time.time()) - self.inicio) * 1000
        return {
            "id": self.id,
            "comando": self.comando,
            "shell": self.shell,
            "pasta": self.pasta,
            "status": self.status,
            "terminou": self.status != "rodando",
            "codigo": self.codigo,
            "duracaoMs": int(dur),
            "saida": self.saida.texto(),
            "caracteres": self.saida.total,
            "motivo": self.motivo,
            "memoriaPicoMb": self.job.pico_de_memoria_mb(),
            "isolado": self.isolado,
        }


class Terminal:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._execucoes: dict[str, Execucao] = {}

    def executar(
        self,
        comando: str,
        shell: str,
        pasta: str,
        raizes: list[str],
        variaveis: list[str],
        timeout_seg: int,
        memoria_mb: int,
        saida_max: int,
    ) -> Execucao:
        shells = detectar_shells()
        if shell not in shells:
            raise ValueError(f"O terminal {shell} não está instalado nesta máquina (tem: {', '.join(shells) or 'nenhum'}).")
        alvo = Path(os.path.expanduser(pasta))
        if not alvo.is_dir():
            raise ValueError(f"A pasta {pasta} não existe.")
        if not dentro_de(alvo, raizes):
            raise PermissionError("A pasta está fora das pastas liberadas para o terminal.")
        ex = Execucao(id=uuid.uuid4().hex[:12], comando=comando, shell=shell, pasta=str(alvo.resolve()), inicio=time.time(), saida=Saida(saida_max), job=Job(memoria_mb))
        return self._iniciar(ex, linha_de_comando(shell, shells[shell], comando), ambiente_minimo(variaveis), timeout_seg)

    def executar_isolado(self, comando: str, pasta: str, raizes: list[str], variaveis: list[str], timeout_seg: int, memoria_mb: int, saida_max: int, imagem: str) -> Execucao:
        """Docker com rede desligada e a pasta só para leitura (A10). O Sandbox do Windows vai por `isolado.py`."""
        from .isolado import PASTA_SAIDA, args_docker

        # só o executável: conferir o daemon (`docker info`) leva minutos com o Docker Desktop lento,
        # e um daemon fora do ar já aparece na saída do próprio `docker run`
        exe = shutil.which("docker.exe") or shutil.which("docker")
        if not exe:
            raise RuntimeError("O Docker não está instalado nesta máquina.")
        alvo = Path(os.path.expanduser(pasta))
        if not alvo.is_dir() or not dentro_de(alvo, raizes):
            raise PermissionError("A pasta não existe ou está fora das pastas liberadas para o terminal.")
        eid = uuid.uuid4().hex[:12]
        saida = PASTA_SAIDA / eid
        saida.mkdir(parents=True, exist_ok=True)
        nome = f"orbita-{eid}"
        ex = Execucao(id=eid, comando=comando, shell="isolado", pasta=str(alvo.resolve()), inicio=time.time(), saida=Saida(saida_max), job=Job(None), isolado="docker")
        ex.ao_parar = lambda: subprocess.run([exe, "kill", nome], capture_output=True, timeout=20, creationflags=0x08000000)
        # o cliente do Docker precisa achar a configuração dele (USERPROFILE, APPDATA); segredo continua fora
        env = ambiente_minimo([*variaveis, "USERPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "PATH", "TEMP", "TMP"])
        return self._iniciar(ex, args_docker(exe, nome, ex.pasta, str(saida), imagem, comando, memoria_mb), env, timeout_seg)

    def _iniciar(self, ex: Execucao, args: list[str], env: dict[str, str], timeout_seg: int) -> Execucao:
        try:
            ex.proc = ex.job.iniciar(args, cwd=ex.pasta, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        except Exception as e:
            ex.job.fechar()
            ex.status, ex.motivo, ex.fim, ex.codigo = "falhou", f"não consegui iniciar: {e}", time.time(), -1
            ex._pronto.set()
            self._guardar(ex)
            return ex
        self._guardar(ex)
        threading.Thread(target=self._ler, args=(ex,), daemon=True, name=f"terminal-{ex.id}").start()
        threading.Thread(target=self._vigiar, args=(ex, timeout_seg), daemon=True, name=f"teto-{ex.id}").start()
        return ex

    def _guardar(self, ex: Execucao) -> None:
        with self._lock:
            self._execucoes[ex.id] = ex
            # guarda as 50 mais novas: saída velha não serve, e a lista não cresce para sempre
            if len(self._execucoes) > 50:
                for k in sorted(self._execucoes, key=lambda k: self._execucoes[k].inicio)[: len(self._execucoes) - 50]:
                    if self._execucoes[k].status != "rodando":
                        del self._execucoes[k]

    def _ler(self, ex: Execucao) -> None:
        assert ex.proc and ex.proc.stdout
        leitor = ex.proc.stdout
        while True:
            pedaco = leitor.read1(65536) if hasattr(leitor, "read1") else leitor.read(4096)
            if not pedaco:
                break
            ex.saida.acrescentar(pedaco.decode("utf-8", errors="replace").replace("\r\n", "\n"))
        codigo = ex.proc.wait()
        ex.fim = time.time()
        if ex.status == "rodando":
            ex.status = "terminou"
            ex.codigo = codigo
            if ex.job.memoria_mb and ex.job.pico_de_memoria_mb() >= ex.job.memoria_mb * 0.98:
                ex.motivo = f"passou do limite de {ex.job.memoria_mb} MB de memória"
        elif ex.codigo is None:
            ex.codigo = codigo
        # fecha o job: se o comando deixou filho para trás (um servidor iniciado em segundo plano), ele morre aqui
        ex.job.fechar()
        ex._pronto.set()

    def _vigiar(self, ex: Execucao, timeout_seg: int) -> None:
        if not ex._pronto.wait(timeout=max(1, timeout_seg)):
            ex.status, ex.motivo = "tempo_esgotado", f"passou de {timeout_seg} s e foi encerrado"
            ex.matar()

    def esperar(self, ex: Execucao, segundos: float) -> bool:
        return ex._pronto.wait(timeout=max(0.0, segundos))

    def obter(self, id_: str) -> Execucao | None:
        with self._lock:
            return self._execucoes.get(id_)

    def parar(self, id_: str, motivo: str = "parado pelo dono") -> Execucao | None:
        ex = self.obter(id_)
        if not ex:
            return None
        if ex.status == "rodando":
            ex.status, ex.motivo = "parado", motivo
            ex.matar()
        return ex

    def parar_todos(self, motivo: str) -> int:
        with self._lock:
            vivos = [e for e in self._execucoes.values() if e.status == "rodando"]
        for e in vivos:
            e.status, e.motivo = "parado", motivo
            e.matar()
        return len(vivos)

    def rodando(self) -> int:
        with self._lock:
            return sum(1 for e in self._execucoes.values() if e.status == "rodando")
