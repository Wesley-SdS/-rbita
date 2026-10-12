"""Mídia, volume e bloquear a tela (PRD A5): reversível e sem terceiro, sem sessão.

Tocar, pausar e pular são as teclas de mídia do Windows (o app que está
tocando recebe, como no teclado). O volume é o do dispositivo de saída
padrão, pelo `IAudioEndpointVolume` (pycaw), para "volume em 30" ser 30 de
verdade e não "aperte a tecla 15 vezes".
"""

from __future__ import annotations

from . import entrada
from .win32 import user32

TECLAS = {"tocar_pausar": "media_play_pause", "pausar": "media_play_pause", "tocar": "media_play_pause", "proxima": "media_next", "anterior": "media_prev", "parar": "media_stop"}


def _volume():
    import comtypes
    from pycaw.pycaw import AudioUtilities

    try:
        comtypes.CoInitialize()
    except OSError as e:
        # a thread já tem COM noutro modo (MTA): o pycaw funciona do mesmo jeito
        if getattr(e, "winerror", None) != -2147417850:
            raise
    dispositivo = AudioUtilities.GetSpeakers()
    return dispositivo.EndpointVolume


def estado_do_volume() -> dict:
    v = _volume()
    return {"volume": round(v.GetMasterVolumeLevelScalar() * 100), "mudo": bool(v.GetMute())}


def executar(acao: str, valor: int | None = None) -> dict:
    if acao in TECLAS:
        entrada.atalho(TECLAS[acao], conferir=False)
        return {"ok": True, "acao": acao}
    if acao == "bloquear":
        if not user32.LockWorkStation():
            raise OSError("O Windows não bloqueou a tela.")
        return {"ok": True, "acao": acao}
    v = _volume()
    atual = round(v.GetMasterVolumeLevelScalar() * 100)
    if acao == "volume":
        if valor is None:
            raise ValueError("Diga o volume de 0 a 100.")
        novo = max(0, min(100, int(valor)))
    elif acao in ("aumentar", "diminuir"):
        passo = max(1, min(100, int(valor or 10)))
        novo = max(0, min(100, atual + (passo if acao == "aumentar" else -passo)))
    elif acao in ("mudo", "som"):
        v.SetMute(1 if acao == "mudo" else 0, None)
        return {"ok": True, "acao": acao, **estado_do_volume()}
    else:
        raise ValueError(f"ação de mídia desconhecida: {acao}")
    v.SetMasterVolumeLevelScalar(novo / 100, None)
    if novo > 0 and v.GetMute():
        v.SetMute(0, None)
    return {"ok": True, "acao": acao, "antes": atual, **estado_do_volume()}
