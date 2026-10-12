"""Job Object do Windows: a árvore do comando morre junto, sempre.

O processo nasce SUSPENSO, entra no job e só então é retomado. Sem isso, um
comando rápido o bastante (`start` de outro programa, um `cmd /c` que abre um
filho) cria netos antes de o pai entrar no job, e os netos escapam do
`TerminateJobObject` e do limite de memória.

`KILL_ON_JOB_CLOSE`: o único handle do job é deste processo. Se o apps/maos
morrer (inclusive de forma bruta, pelo Gerenciador de Tarefas), o Windows
fecha o handle e mata a árvore inteira: comando nenhum sobrevive às mãos.

Limite conhecido (PRD §12.7): processo criado por WMI (`Win32_Process.Create`)
nasce fora do job. Por isso o classificador trata WMI e CIM como `perigoso`.
"""

from __future__ import annotations

import subprocess

import win32api
import win32job

from .win32 import ntdll

CREATE_SUSPENDED = 0x00000004
CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_UNICODE_ENVIRONMENT = 0x00000400


class Job:
    def __init__(self, memoria_mb: int | None = None) -> None:
        self.handle = win32job.CreateJobObject(None, "")
        info = win32job.QueryInformationJobObject(self.handle, win32job.JobObjectExtendedLimitInformation)
        flags = win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | win32job.JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION
        if memoria_mb:
            flags |= win32job.JOB_OBJECT_LIMIT_JOB_MEMORY
            info["JobMemoryLimit"] = int(memoria_mb) * 1024 * 1024
        info["BasicLimitInformation"]["LimitFlags"] = flags
        win32job.SetInformationJobObject(self.handle, win32job.JobObjectExtendedLimitInformation, info)
        self.memoria_mb = memoria_mb
        self.fechado = False

    def iniciar(self, args: list[str], cwd: str, env: dict[str, str], **kw) -> subprocess.Popen:
        """Popen suspenso, dentro do job, e só então retomado."""
        flags = CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT
        proc = subprocess.Popen(args, cwd=cwd, env=env, creationflags=flags, **kw)
        try:
            win32job.AssignProcessToJobObject(self.handle, int(proc._handle))  # type: ignore[attr-defined]
        except Exception:
            proc.kill()
            raise
        st = ntdll.NtResumeProcess(int(proc._handle))  # type: ignore[attr-defined]
        if st != 0:
            proc.kill()
            raise OSError(f"NtResumeProcess falhou ({st:#x})")
        return proc

    def pico_de_memoria_mb(self) -> float:
        try:
            info = win32job.QueryInformationJobObject(self.handle, win32job.JobObjectExtendedLimitInformation)
            return round(info["PeakJobMemoryUsed"] / (1024 * 1024), 1)
        except Exception:  # noqa: BLE001
            return 0.0

    def processos_vivos(self) -> int:
        try:
            info = win32job.QueryInformationJobObject(self.handle, win32job.JobObjectBasicAccountingInformation)
            return int(info["ActiveProcesses"])
        except Exception:  # noqa: BLE001
            return 0

    def matar(self, codigo: int = 1) -> None:
        if self.fechado:
            return
        try:
            win32job.TerminateJobObject(self.handle, codigo)
        except Exception:  # noqa: BLE001 - job já vazio
            pass

    def fechar(self) -> None:
        """Fechar o handle MATA o que restar (KILL_ON_JOB_CLOSE)."""
        if self.fechado:
            return
        self.fechado = True
        try:
            win32api.CloseHandle(self.handle)
        except Exception:  # noqa: BLE001
            pass


__all__ = ["Job"]
