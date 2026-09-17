"""Medição nesta máquina (PRD §7): latência e precisão por modelo, com e sem o
Ollama gerando ao mesmo tempo. Lê as amostras gravadas em bench_data/ (via
/bench) e escreve bench_data/resultado.json.

    .venv/Scripts/python.exe bench/evaluate.py [--sem-ollama] [--runs 15]

Impostores: amostras de OUTRA pessoa gravada (a melhor medida) e, na falta,
as pastas `_sintetico*` (voz de TTS, rostos públicos). Sintético só dá limite
inferior de confusão: não prova precisão, e o relatório diz isso.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
import urllib.request
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

from perception.audio import decode_to_mono16k, speech_seconds  # noqa: E402
from perception.face import FACE_MODELS, FaceEncoder, decode_image  # noqa: E402
from perception.mathutil import cosine, equal_error_rate, mean_embedding  # noqa: E402
from perception.voice import VOICE_MODELS, VoiceEncoder  # noqa: E402

DADOS = BASE / "bench_data"
MODELOS = BASE / "models"


class CargaOllama:
    """Mantém o Ollama gerando em loop, como numa conversa local em andamento."""

    def __init__(self, modelo: str, url: str = "http://127.0.0.1:11434/api/generate"):
        self.modelo, self.url = modelo, url
        self.parar = threading.Event()
        self.geracoes = 0
        self.t = threading.Thread(target=self._loop, daemon=True)

    def _loop(self):
        corpo = json.dumps({"model": self.modelo, "prompt": "Escreva um parágrafo longo sobre a história do café no Brasil.", "stream": False, "options": {"num_predict": 256}}).encode()
        while not self.parar.is_set():
            try:
                req = urllib.request.Request(self.url, data=corpo, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=600).read()
                self.geracoes += 1
            except Exception:  # noqa: BLE001
                time.sleep(2)

    def __enter__(self):
        self.t.start()
        time.sleep(8)  # deixa o modelo carregar e começar a gerar
        return self

    def __exit__(self, *_):
        self.parar.set()


def percentis(ms: list[float]) -> dict:
    ms = sorted(ms)
    return {"p50": round(statistics.median(ms), 1), "p95": round(ms[max(0, int(len(ms) * 0.95) - 1)], 1), "n": len(ms)}


def medir(fn, runs: int) -> list[float]:
    fn()  # aquecimento
    out = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return out


def pessoas(kind: str) -> dict[str, list[Path]]:
    raiz = DADOS / kind
    if not raiz.exists():
        return {}
    return {p.name: sorted(f for f in p.iterdir() if f.is_file()) for p in sorted(raiz.iterdir()) if p.is_dir()}


def resumo_scores(genuinos: list[float], impostores: list[float], fonte_impostor: str) -> dict:
    r: dict = {"genuinos": {"n": len(genuinos)}, "impostores": {"n": len(impostores), "fonte": fonte_impostor}}
    if genuinos:
        r["genuinos"].update(media=round(float(np.mean(genuinos)), 3), minimo=round(float(np.min(genuinos)), 3))
    if impostores:
        r["impostores"].update(media=round(float(np.mean(impostores)), 3), maximo=round(float(np.max(impostores)), 3))
    if genuinos and impostores:
        eer, limiar = equal_error_rate(genuinos, impostores)
        r["eer"] = round(eer, 4)
        r["limiarEer"] = round(limiar, 3)
    return r


def avaliar_voz(runs: int, carga: str | None) -> dict:
    grupos = pessoas("voz")
    reais = {k: v for k, v in grupos.items() if not k.startswith("_")}
    sinteticos = {k: v for k, v in grupos.items() if k.startswith("_")}
    audio = {f: decode_to_mono16k(f.read_bytes()) for fs in grupos.values() for f in fs}
    out: dict = {}
    for nome in VOICE_MODELS:
        try:
            t0 = time.perf_counter()
            enc = VoiceEncoder(MODELOS, nome)
            carga_ms = round((time.perf_counter() - t0) * 1000)
        except FileNotFoundError as e:
            out[nome] = {"erro": str(e)}
            continue
        r: dict = {"dim": enc.dim, "carregarMs": carga_ms}

        # latência com um trecho real de 3 s e de 10 s (ou sintético, sem gravação)
        base = next((a for f, a in audio.items() if "cadastro" in f.name), None)
        if base is None or len(base) < 16000 * 10:
            base = (np.random.default_rng(0).standard_normal(16000 * 10) * 0.1).astype(np.float32)
        lat = {"3s": percentis(medir(lambda: enc.embed(base[: 16000 * 3]), runs)), "10s": percentis(medir(lambda: enc.embed(base[: 16000 * 10]), runs))}
        if carga:
            with CargaOllama(carga) as c:
                lat["3s_com_ollama"] = percentis(medir(lambda: enc.embed(base[: 16000 * 3]), runs))
                lat["10s_com_ollama"] = percentis(medir(lambda: enc.embed(base[: 16000 * 10]), runs))
                lat["ollamaGeracoesDurante"] = c.geracoes
        r["latenciaMs"] = lat

        # precisão: centroide do cadastro (janelas de 15 s) contra frases curtas
        centroides = {}
        for p, fs in reais.items():
            cad = [audio[f] for f in fs if "cadastro" in f.name]
            if not cad:
                continue
            janelas = [cad[0][i : i + 16000 * 15] for i in range(0, len(cad[0]), 16000 * 15) if len(cad[0][i : i + 16000 * 15]) > 16000 * 5]
            centroides[p] = mean_embedding([enc.embed(j).embedding for j in janelas])
        genuinos, impostores, curtas = [], [], []
        for p, c in centroides.items():
            for q, fs in {**reais, **sinteticos}.items():
                for f in fs:
                    if "cadastro" in f.name and not q.startswith("_"):
                        continue
                    a = audio[f]
                    s = cosine(c, enc.embed(a).embedding)
                    if q == p:
                        genuinos.append(s)
                        curtas.append({"arquivo": f.name, "fala_s": round(speech_seconds(a), 2), "score": round(s, 3)})
                    else:
                        impostores.append(s)
        fonte = "outra pessoa gravada" if len(reais) > 1 else ("sintético (TTS): só limite inferior" if sinteticos else "nenhum")
        r["precisao"] = resumo_scores(genuinos, impostores, fonte)
        r["frasesDoDono"] = curtas
        out[nome] = r
    return out


def avaliar_rosto(runs: int, carga: str | None) -> dict:
    grupos = pessoas("rosto")
    imgs = {f: decode_image(f.read_bytes()) for fs in grupos.values() for f in fs}
    out: dict = {}
    for nome in FACE_MODELS:
        try:
            t0 = time.perf_counter()
            enc = FaceEncoder(MODELOS, nome)
            carga_ms = round((time.perf_counter() - t0) * 1000)
        except FileNotFoundError as e:
            out[nome] = {"erro": str(e)}
            continue
        r: dict = {"carregarMs": carga_ms}
        amostra = next(iter(imgs.values()), None)
        if amostra is None:
            amostra = np.zeros((720, 1280, 3), dtype=np.uint8)
        lat = {"imagem720p": percentis(medir(lambda: enc.detect_and_embed(amostra), runs))}
        if carga:
            with CargaOllama(carga) as c:
                lat["imagem720p_com_ollama"] = percentis(medir(lambda: enc.detect_and_embed(amostra), runs))
                lat["ollamaGeracoesDurante"] = c.geracoes
        r["latenciaMs"] = lat

        vetores: dict[str, list[tuple[str, np.ndarray]]] = {}
        sem_rosto = 0
        for p, fs in grupos.items():
            for f in fs:
                faces = enc.detect_and_embed(imgs[f])
                if not faces:
                    sem_rosto += 1
                    continue
                maior = max(faces, key=lambda x: x.size)
                vetores.setdefault(p, []).append((f.name, maior.embedding))
        r["fotosSemRostoDetectado"] = sem_rosto
        genuinos, impostores = [], []
        for p, vs in vetores.items():
            if p.startswith("_") or len(vs) < 3:
                continue
            cad = [v for _, v in vs[:5]]
            c = mean_embedding(cad)
            for q, ws in vetores.items():
                for i, (_, w) in enumerate(ws):
                    if q == p and i < 5:
                        continue
                    (genuinos if q == p else impostores).append(cosine(c, w))
        reais = [p for p in grupos if not p.startswith("_")]
        fonte = "outra pessoa gravada" if len(reais) > 1 else ("rostos públicos (_sintetico)" if any(p.startswith("_") for p in grupos) else "nenhum")
        r["precisao"] = resumo_scores(genuinos, impostores, fonte)
        out[nome] = r
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=15)
    ap.add_argument("--ollama-modelo", default="qwen2.5:3b")
    ap.add_argument("--sem-ollama", action="store_true")
    ap.add_argument("--so", choices=["voz", "rosto"])
    a = ap.parse_args()
    carga = None if a.sem_ollama else a.ollama_modelo
    resultado = {"quando": time.strftime("%Y-%m-%d %H:%M"), "runs": a.runs, "cargaOllama": carga}
    if a.so in (None, "voz"):
        resultado["voz"] = avaliar_voz(a.runs, carga)
    if a.so in (None, "rosto"):
        resultado["rosto"] = avaliar_rosto(a.runs, carga)
    DADOS.mkdir(exist_ok=True)
    (DADOS / "resultado.json").write_text(json.dumps(resultado, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(resultado, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
