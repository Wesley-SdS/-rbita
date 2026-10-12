"""Sessão de terminal persistente (PRD A9): um shell vivo sobre ConPTY, para dev server, REPL e ssh.

Escrever numa sessão é `efeito_externo` no core por padrão: o classificador
não enxerga dentro de um programa interativo (o que o `python` do REPL faz com
a linha não é comando de shell). Aqui só se executa.

O shell nasce com o mesmo ambiente mínimo do terminal avulso e entra num Job
Object logo depois de nascer (antes de receber qualquer linha), então fechar
a sessão, o "parar" e a morte das mãos levam a árvore inteira junto.
"""

from __future__ import annotations

import re
import threading
import time
import uuid

import win32api
import win32con
import win32job

from .jobobj import Job
from .terminal import ambiente_minimo, dentro_de, detectar_shells

ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r(?!\n)")
GUARDA_MAX = 400_000


class Sessao:
    def __init__(self, sid: str, shell: str, pasta: str, proc, job: Job) -> None:
        self.id = sid
        self.shell = shell
        self.pasta = pasta
        self.proc = proc
        self.job = job
        self.inicio = time.time()
        self.texto = ""
        self.base = 0  # quantos caracteres já foram descartados do começo
        self.lock = threading.Lock()
        self.fechada = False
        self.motivo: str | None = None

    def acrescentar(self, s: str) -> None:
        s = ANSI.sub("", s)
        with self.lock:
            self.texto += s
            if len(self.texto) > GUARDA_MAX:
                corte = len(self.texto) - GUARDA_MAX
                self.texto = self.texto[corte:]
                self.base += corte

    def ler(self, desde: int | None, maximo: int) -> dict:
        with self.lock:
            fim = self.base + len(self.texto)
            inicio = fim - min(len(self.texto), maximo) if desde is None else max(desde, self.base)
            pedaco = self.texto[inicio - self.base :][:maximo]
            perdido = desde is not None and desde < self.base
            return {"id": self.id, "texto": pedaco, "desde": inicio, "ate": inicio + len(pedaco), "fim": fim, "perdeu_inicio": perdido, "viva": not self.fechada and self.proc.isalive(), "motivo": self.motivo}

    def resumo(self) -> dict:
        return {"id": self.id, "shell": self.shell, "pasta": self.pasta, "viva": not self.fechada and self.proc.isalive(), "desde": time.strftime("%H:%M:%S", time.localtime(self.inicio)), "caracteres": self.base + len(self.texto)}


ARGV = {
    "powershell": lambda exe: [exe, "-NoLogo", "-NoProfile"],
    "pwsh": lambda exe: [exe, "-NoLogo", "-NoProfile"],
    "gitbash": lambda exe: [exe, "--noprofile", "--norc", "-i"],
    "wsl": lambda exe: [exe],
}


class Sessoes:
    def __init__(self, maximo: int = 6) -> None:
        self._s: dict[str, Sessao] = {}
        self._lock = threading.Lock()
        self.maximo = maximo

    def abrir(self, shell: str, pasta: str, raizes: list[str], variaveis: list[str], memoria_mb: int) -> Sessao:
        from pathlib import Path

        from winpty import PtyProcess

        shells = detectar_shells()
        if shell not in shells:
            raise ValueError(f"O terminal {shell} não está instalado nesta máquina.")
        alvo = Path(pasta).expanduser()
        if not alvo.is_dir() or not dentro_de(alvo, raizes):
            raise PermissionError("A pasta não existe ou está fora das pastas liberadas para o terminal.")
        with self._lock:
            vivas = [s for s in self._s.values() if not s.fechada]
            if len(vivas) >= self.maximo:
                raise RuntimeError(f"Já há {len(vivas)} sessões de terminal abertas: feche uma antes.")
        env = ambiente_minimo(variaveis)
        proc = PtyProcess.spawn(ARGV[shell](shells[shell]), cwd=str(alvo.resolve()), env=env, dimensions=(40, 160))
        job = Job(memoria_mb)
        try:
            h = win32api.OpenProcess(win32con.PROCESS_SET_QUOTA | win32con.PROCESS_TERMINATE, False, proc.pid)
            win32job.AssignProcessToJobObject(job.handle, h)
            win32api.CloseHandle(h)
        except Exception as e:  # noqa: BLE001 - sem job, sem sessão: não há como garantir que o parar a mata
            proc.terminate(force=True)
            job.fechar()
            raise RuntimeError(f"Não consegui prender o terminal num Job Object: {e}") from e
        s = Sessao(uuid.uuid4().hex[:10], shell, str(alvo.resolve()), proc, job)
        with self._lock:
            self._s[s.id] = s
        threading.Thread(target=self._ler, args=(s,), daemon=True, name=f"pty-{s.id}").start()
        return s

    def _ler(self, s: Sessao) -> None:
        while True:
            try:
                dados = s.proc.read(8192)
            except EOFError:
                break
            except Exception:  # noqa: BLE001 - pty fechado por fora
                break
            if dados:
                s.acrescentar(dados)
            elif not s.proc.isalive():
                break
        if not s.fechada:
            s.fechada = True
            s.motivo = s.motivo or "o programa terminou"
        s.job.fechar()

    def obter(self, sid: str) -> Sessao | None:
        with self._lock:
            return self._s.get(sid)

    def escrever(self, sid: str, texto: str, enter: bool) -> dict:
        s = self.obter(sid)
        if not s or s.fechada or not s.proc.isalive():
            raise LookupError("Essa sessão de terminal não está aberta.")
        s.proc.write(texto + ("\r" if enter else ""))
        return {"ok": True, "id": sid, "fim": s.base + len(s.texto)}

    def fechar(self, sid: str, motivo: str = "fechada") -> bool:
        s = self.obter(sid)
        if not s:
            return False
        s.fechada, s.motivo = True, motivo
        s.job.matar(1)
        try:
            s.proc.terminate(force=True)
        except Exception:  # noqa: BLE001
            pass
        s.job.fechar()
        return True

    def fechar_todas(self, motivo: str) -> int:
        with self._lock:
            ids = [k for k, s in self._s.items() if not s.fechada]
        for k in ids:
            self.fechar(k, motivo)
        return len(ids)

    def listar(self) -> list[dict]:
        with self._lock:
            return [s.resumo() for s in self._s.values()]
