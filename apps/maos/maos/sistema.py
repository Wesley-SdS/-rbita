"""Sistema (PRD A5): CPU, memória, disco, processos, bateria e rede, e encerrar um processo.

Encerrar é `efeito_externo` no core (vai pela fila). Aqui ficam as recusas
que não dependem dele: processo do sistema, processo elevado, as próprias
mãos, e PID reaproveitado (o processo que o dono aprovou fechar tem de ser o
MESMO: nome e hora de início conferidos, não só o número).
"""

from __future__ import annotations

import ctypes
import getpass
import os
import time
from ctypes import wintypes as w

import psutil

from .apps import identidade_do_pid, normalizar_app
from .seguranca import pid_elevado
from .win32 import kernel32

# fechar qualquer um destes derruba a sessão do Windows ou a própria Órbita
INTOCAVEIS = {"system", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "lsaiso", "svchost", "fontdrvhost", "dwm", "memory compression", "secure system", "sihost", "ctfmon", "audiodg", "msmpeng", "securityhealthservice"}


def sessao_do_windows() -> int:
    s = w.DWORD(0)
    kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(s))
    return int(s.value)


def resumo_do_sistema(top: int = 8) -> dict:
    cpu = psutil.cpu_percent(interval=0.4)
    mem = psutil.virtual_memory()
    discos = []
    for p in psutil.disk_partitions(all=False):
        if "cdrom" in p.opts or not p.fstype:
            continue
        try:
            u = psutil.disk_usage(p.mountpoint)
        except OSError:
            continue
        discos.append({"unidade": p.mountpoint, "total_gb": round(u.total / 1e9, 1), "livre_gb": round(u.free / 1e9, 1), "uso_pct": u.percent})
    procs = []
    for p in psutil.process_iter(["pid", "name", "memory_info"]):
        try:
            procs.append((p, p.info["memory_info"].rss if p.info["memory_info"] else 0))
        except (psutil.Error, AttributeError):
            continue
    for p, _ in procs:
        try:
            p.cpu_percent(None)
        except psutil.Error:
            pass
    time.sleep(0.5)
    medidos = []
    nucleos = psutil.cpu_count() or 1
    for p, rss in procs:
        try:
            medidos.append({"pid": p.pid, "nome": p.info["name"], "cpu_pct": round(p.cpu_percent(None) / nucleos, 1), "memoria_mb": round(rss / (1024 * 1024))})
        except psutil.Error:
            continue
    por_cpu = sorted(medidos, key=lambda x: x["cpu_pct"], reverse=True)[:top]
    por_mem = sorted(medidos, key=lambda x: x["memoria_mb"], reverse=True)[:top]
    bat = None
    try:
        b = psutil.sensors_battery()
        if b:
            bat = {"carga_pct": round(b.percent), "na_tomada": bool(b.power_plugged), "minutos_restantes": None if b.secsleft in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) else round(b.secsleft / 60)}
    except Exception:  # noqa: BLE001 - desktop sem bateria
        bat = None
    rede = []
    estat = psutil.net_if_stats()
    for nome, addrs in psutil.net_if_addrs().items():
        st = estat.get(nome)
        if not st or not st.isup:
            continue
        ipv4 = [a.address for a in addrs if a.family == 2 and not a.address.startswith("169.254")]
        if ipv4:
            rede.append({"interface": nome, "ipv4": ipv4, "velocidade_mbps": st.speed})
    return {
        "cpu_pct": cpu,
        "nucleos": nucleos,
        "memoria": {"total_gb": round(mem.total / 1e9, 1), "usada_pct": mem.percent, "livre_gb": round(mem.available / 1e9, 1)},
        "discos": discos,
        "processos_cpu": por_cpu,
        "processos_memoria": por_mem,
        "bateria": bat,
        "rede": rede,
        "ligado_desde": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(psutil.boot_time())),
    }


def descrever_processo(pid: int) -> dict:
    p = psutil.Process(pid)
    ident = identidade_do_pid(pid)
    return {"pid": pid, "nome": p.name(), "app": ident["app"], "inicio": round(p.create_time(), 3), "usuario": _usuario(p)}


def _usuario(p: psutil.Process) -> str | None:
    try:
        return p.username()
    except (psutil.Error, OSError):
        return None


def procurar_processos(nome: str) -> list[dict]:
    alvo = normalizar_app(nome)
    out = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if normalizar_app(p.info["name"] or "") == alvo or alvo in [normalizar_app(n) for n in identidade_do_pid(p.pid)["nomes"]]:
                out.append(descrever_processo(p.pid))
        except (psutil.Error, OSError):
            continue
    return out


def motivo_para_nao_encerrar(pid: int, nome_esperado: str | None, inicio_esperado: float | None, pids_protegidos: set[int]) -> str | None:
    try:
        p = psutil.Process(pid)
        nome = p.name()
        inicio = p.create_time()
    except psutil.NoSuchProcess:
        return "Esse processo já não existe."
    except psutil.Error as e:
        return f"Não consegui ler esse processo ({e})."
    if pid in pids_protegidos or pid == os.getpid():
        return "Esse processo é da própria Órbita."
    if normalizar_app(nome) in INTOCAVEIS:
        return f"{nome} é um processo do Windows: fechar derruba a sessão."
    if nome_esperado and normalizar_app(nome) != normalizar_app(nome_esperado):
        return f"O processo {pid} agora é {nome}, não {nome_esperado}: o número foi reaproveitado."
    if inicio_esperado and abs(inicio - inicio_esperado) > 1.0:
        return f"O processo {pid} reiniciou depois da proposta: veja a lista de novo."
    if pid_elevado(pid) is True:
        return "Esse processo roda como administrador: a Órbita não mexe nele."
    u = _usuario(p)
    if u and getpass.getuser().lower() not in u.lower():
        return "Esse processo é de outro usuário."
    return None


def _fechar_janelas(pid: int) -> int:
    """WM_CLOSE nas janelas do processo: o app fecha como se o dono clicasse no X (e pode salvar)."""
    import win32con
    import win32gui
    import win32process

    n = 0

    def cb(h, _):
        nonlocal n
        try:
            if win32gui.IsWindowVisible(h) and win32process.GetWindowThreadProcessId(h)[1] == pid:
                win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
                n += 1
        except Exception:  # noqa: BLE001
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return n


def encerrar(pid: int, forcar: bool = False) -> dict:
    p = psutil.Process(pid)
    nome = p.name()
    filhos = p.children(recursive=True)
    ok = False
    if not forcar and _fechar_janelas(pid):
        try:
            p.wait(timeout=4)
            ok = True
        except psutil.TimeoutExpired:
            ok = False
    if not ok:
        try:
            p.kill() if forcar else p.terminate()
            p.wait(timeout=5)
            ok = True
        except psutil.NoSuchProcess:
            ok = True
        except psutil.TimeoutExpired:
            ok = False
    for f in filhos:
        try:
            if f.is_running():
                f.terminate()
        except psutil.Error:
            pass
    return {"pid": pid, "nome": nome, "encerrado": ok}
