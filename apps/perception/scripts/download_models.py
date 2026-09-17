"""Baixa os modelos candidatos da medição para apps/perception/models.

Passo EXPLÍCITO, rodado à mão: o serviço em si nunca vai à internet (PRD §6,
"sem saída p/ internet"). Modelos não vão para o repo (.gitignore).

    .venv/Scripts/python.exe scripts/download_models.py [voz|rosto|tudo]
"""

from __future__ import annotations

import sys
import urllib.request
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "models"

SHERPA = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
VOZ = {
    "wespeaker_en_voxceleb_resnet34.onnx": SHERPA + "wespeaker_en_voxceleb_resnet34.onnx",
    "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx": SHERPA + "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
    "nemo_en_titanet_small.onnx": SHERPA + "nemo_en_titanet_small.onnx",
}

ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/"
ROSTO = {
    "face_detection_yunet_2023mar.onnx": ZOO + "face_detection_yunet/face_detection_yunet_2023mar.onnx",
    "face_recognition_sface_2021dec.onnx": ZOO + "face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
FACE_MODELS_USADOS = {
    "insightface_s": {"det": "buffalo_s/det_500m.onnx", "rec": "buffalo_s/w600k_mbf.onnx"},
    "insightface_l": {"det": "buffalo_l/det_10g.onnx", "rec": "buffalo_l/w600k_r50.onnx"},
}
INSIGHT = {
    "buffalo_s": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
    "buffalo_l": "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
}


def baixar(url: str, destino: Path) -> None:
    if destino.exists() and destino.stat().st_size > 0:
        print(f"já existe: {destino.name}")
        return
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".part")
    print(f"baixando {destino.name} ...", flush=True)
    urllib.request.urlretrieve(url, tmp)
    tmp.replace(destino)


def main(alvo: str) -> None:
    if alvo in ("voz", "tudo"):
        for nome, url in VOZ.items():
            baixar(url, RAIZ / "voice" / nome)
    if alvo in ("rosto", "tudo"):
        for nome, url in ROSTO.items():
            baixar(url, RAIZ / "face" / nome)
        for pacote, url in INSIGHT.items():
            pasta = RAIZ / "face" / pacote
            if pasta.exists() and any(pasta.glob("*.onnx")):
                print(f"já existe: {pacote}")
                continue
            z = RAIZ / "face" / f"{pacote}.zip"
            baixar(url, z)
            with zipfile.ZipFile(z) as zf:
                # só detecção e reconhecimento: o pacote traz também gênero/idade e
                # malha 3D, que ficam fora de escopo (PRD §12) e não entram na máquina
                usados = {Path(v).name for fs in ([f["det"], f["rec"]] for f in FACE_MODELS_USADOS.values()) for v in fs}
                for m in zf.namelist():
                    if Path(m).name in usados:
                        (pasta).mkdir(parents=True, exist_ok=True)
                        (pasta / Path(m).name).write_bytes(zf.read(m))
            z.unlink()
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "tudo")
