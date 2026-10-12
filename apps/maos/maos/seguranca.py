"""Travas do processo: nunca elevado, e quem pode falar com ele.

Elevado é recusado na SUBIDA, pelo token do próprio processo, e não por
convenção: o `SendInput` respeita a UIPI, então um processo de integridade
média não consegue clicar em janela elevada nem no prompt do UAC (PRD §2.7).
Rodar como administrador desligaria essa trava de graça.
"""

from __future__ import annotations

import ctypes
import hmac
from ctypes import wintypes as w

from .win32 import TOKEN_QUERY, TokenElevation, TokenIntegrityLevel, PROCESS_QUERY_LIMITED_INFORMATION, advapi32, kernel32

# RIDs do nível de integridade (SECURITY_MANDATORY_*_RID)
INTEGRIDADE = {0x0000: "nao_confiavel", 0x1000: "baixa", 0x2000: "media", 0x2100: "media_mais", 0x3000: "alta", 0x4000: "sistema"}


def _token(processo: int | None = None):
    h = kernel32.GetCurrentProcess() if processo is None else processo
    tok = w.HANDLE()
    if not advapi32.OpenProcessToken(h, TOKEN_QUERY, ctypes.byref(tok)):
        raise OSError(ctypes.get_last_error(), "OpenProcessToken")
    return tok


def _elevacao(tok) -> bool:
    v = w.DWORD(0)
    n = w.DWORD(0)
    if not advapi32.GetTokenInformation(tok, TokenElevation, ctypes.byref(v), ctypes.sizeof(v), ctypes.byref(n)):
        raise OSError(ctypes.get_last_error(), "GetTokenInformation")
    return v.value != 0


def _integridade(tok) -> int:
    n = w.DWORD(0)
    advapi32.GetTokenInformation(tok, TokenIntegrityLevel, None, 0, ctypes.byref(n))
    buf = ctypes.create_string_buffer(n.value)
    if not advapi32.GetTokenInformation(tok, TokenIntegrityLevel, buf, n, ctypes.byref(n)):
        raise OSError(ctypes.get_last_error(), "GetTokenInformation")
    sid = ctypes.cast(buf, ctypes.POINTER(ctypes.c_void_p))[0]
    count = advapi32.GetSidSubAuthorityCount(sid)[0]
    return int(advapi32.GetSidSubAuthority(sid, count - 1)[0])


def processo_elevado() -> bool:
    """O token deste processo está elevado (administrador com UAC aceito)?"""
    tok = _token()
    try:
        return _elevacao(tok) or _integridade(tok) >= 0x3000
    finally:
        kernel32.CloseHandle(tok)


def integridade_do_processo() -> str:
    tok = _token()
    try:
        rid = _integridade(tok)
    finally:
        kernel32.CloseHandle(tok)
    return INTEGRIDADE.get(rid, hex(rid))


def pid_elevado(pid: int) -> bool | None:
    """O processo de outra janela está elevado? None quando nem dá para abrir (o que já diz muito)."""
    h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return None
    try:
        tok = _token(h)
    except OSError:
        kernel32.CloseHandle(h)
        return None
    try:
        return _elevacao(tok) or _integridade(tok) >= 0x3000
    except OSError:
        return None
    finally:
        kernel32.CloseHandle(tok)
        kernel32.CloseHandle(h)


def token_confere(recebido: str | None, esperado: str) -> bool:
    """Comparação em tempo constante: o token não vaza byte a byte pelo tempo de resposta."""
    if not recebido or not esperado:
        return False
    return hmac.compare_digest(recebido.encode("utf-8"), esperado.encode("utf-8"))
