"""Rosto: detecção + alinhamento + embedding, com dois backends para medir.

- `opencv`: YuNet (detecção) + SFace (128 d). Vem no próprio opencv-python,
  leve em CPU.
- `insightface`: SCRFD (detecção) + ArcFace (512 d) rodando direto no
  onnxruntime, sem o pacote `insightface` (que no Windows exige compilar C++).
  Padrão de precisão do PRD §7.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .mathutil import l2_normalize

FACE_MODELS: dict[str, dict[str, str]] = {
    "opencv": {"det": "face_detection_yunet_2023mar.onnx", "rec": "face_recognition_sface_2021dec.onnx"},
    "insightface_s": {"det": "buffalo_s/det_500m.onnx", "rec": "buffalo_s/w600k_mbf.onnx"},
    "insightface_l": {"det": "buffalo_l/det_10g.onnx", "rec": "buffalo_l/w600k_r50.onnx"},
}

# Molde de 5 pontos do ArcFace (112x112): olho esq., olho dir., nariz, boca esq., boca dir.
ARCFACE_DST = np.array(
    [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]],
    dtype=np.float32,
)


@dataclass
class Face:
    bbox: tuple[float, float, float, float]  # x1, y1, x2, y2
    score: float
    landmarks: np.ndarray  # (5, 2)
    embedding: np.ndarray

    @property
    def size(self) -> float:
        return float(min(self.bbox[2] - self.bbox[0], self.bbox[3] - self.bbox[1]))


def decode_image(data: bytes) -> np.ndarray:
    import cv2

    if not data:
        raise ValueError("imagem vazia")
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("imagem ilegível")
    return img


# ── SCRFD (puro sobre arrays, testável) ─────────────────────────────────────


def anchor_centers(height: int, width: int, stride: int, num_anchors: int) -> np.ndarray:
    centers = np.stack(np.mgrid[:height, :width][::-1], axis=-1).astype(np.float32)
    centers = (centers * stride).reshape(-1, 2)
    if num_anchors > 1:
        centers = np.stack([centers] * num_anchors, axis=1).reshape(-1, 2)
    return centers


def distance2bbox(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    return np.stack(
        [points[:, 0] - distance[:, 0], points[:, 1] - distance[:, 1], points[:, 0] + distance[:, 2], points[:, 1] + distance[:, 3]],
        axis=-1,
    )


def distance2kps(points: np.ndarray, distance: np.ndarray) -> np.ndarray:
    out = []
    for i in range(0, distance.shape[1], 2):
        out.append(points[:, i % 2] + distance[:, i])
        out.append(points[:, i % 2 + 1] + distance[:, i + 1])
    return np.stack(out, axis=-1)


def nms(dets: np.ndarray, thresh: float) -> list[int]:
    """NMS clássico sobre [x1, y1, x2, y2, score]."""
    x1, y1, x2, y2, scores = dets[:, 0], dets[:, 1], dets[:, 2], dets[:, 3], dets[:, 4]
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0.0, xx2 - xx1 + 1) * np.maximum(0.0, yy2 - yy1 + 1)
        ovr = inter / (areas[i] + areas[order[1:]] - inter)
        order = order[np.where(ovr <= thresh)[0] + 1]
    return keep


class _Onnx:
    def __init__(self, path: Path, threads: int):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        self.session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name


class FaceEncoder:
    def __init__(self, models_dir: Path, name: str, threads: int = 2, det_size: int = 640, score_threshold: float = 0.5, nms_threshold: float = 0.4):
        if name not in FACE_MODELS:
            raise ValueError(f"backend de rosto desconhecido: {name}")
        self.name = name
        self.det_size = det_size
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        files = {k: models_dir / "face" / v for k, v in FACE_MODELS[name].items()}
        for p in files.values():
            if not p.exists():
                raise FileNotFoundError(f"modelo não baixado: {p} (rode scripts/download_models.py)")
        self._lock = threading.Lock()
        if name == "opencv":
            import cv2

            self._det = cv2.FaceDetectorYN.create(str(files["det"]), "", (det_size, det_size), score_threshold, nms_threshold, 50)
            self._rec = cv2.FaceRecognizerSF.create(str(files["rec"]), "")
        else:
            self._det_onnx = _Onnx(files["det"], threads)
            self._rec_onnx = _Onnx(files["rec"], threads)

    def detect_and_embed(self, img: np.ndarray) -> list[Face]:
        with self._lock:
            return self._opencv(img) if self.name == "opencv" else self._insight(img)

    # ── OpenCV ──
    def _opencv(self, img: np.ndarray) -> list[Face]:
        import cv2

        # detecta numa cópia reduzida (o custo do YuNet cresce com a área: 720p
        # cheio levava 1,5 s aqui) e leva caixa e pontos de volta à escala real,
        # porque o alinhamento para o embedding usa a imagem original
        h, w = img.shape[:2]
        escala = min(1.0, self.det_size / max(h, w))
        pequena = cv2.resize(img, (int(w * escala), int(h * escala))) if escala < 1.0 else img
        self._det.setInputSize((pequena.shape[1], pequena.shape[0]))
        _, rows = self._det.detect(pequena)
        faces: list[Face] = []
        for r in rows if rows is not None else []:
            r = r.copy()
            r[:14] = r[:14] / escala
            aligned = self._rec.alignCrop(img, r)
            feat = l2_normalize(self._rec.feature(aligned))
            x, y, fw, fh = (float(v) for v in r[:4])
            faces.append(Face((x, y, x + fw, y + fh), float(r[14]), np.asarray(r[4:14], dtype=np.float32).reshape(5, 2), feat))
        return faces

    # ── SCRFD + ArcFace ──
    def _insight(self, img: np.ndarray) -> list[Face]:
        import cv2

        size = self.det_size
        im_ratio = img.shape[0] / img.shape[1]
        if im_ratio > 1:
            new_h, new_w = size, int(size / im_ratio)
        else:
            new_w, new_h = size, int(size * im_ratio)
        scale = new_h / img.shape[0]
        canvas = np.zeros((size, size, 3), dtype=np.uint8)
        canvas[:new_h, :new_w] = cv2.resize(img, (new_w, new_h))
        blob = cv2.dnn.blobFromImage(canvas, 1.0 / 128.0, (size, size), (127.5, 127.5, 127.5), swapRB=True)
        outs = self._det_onnx.session.run(None, {self._det_onnx.input_name: blob})

        fmc, strides = 3, (8, 16, 32)
        scores_l, boxes_l, kps_l = [], [], []
        for idx, stride in enumerate(strides):
            scores = outs[idx].reshape(-1)
            boxes = outs[idx + fmc].reshape(-1, 4) * stride
            kps = outs[idx + fmc * 2].reshape(-1, 10) * stride
            h, w = size // stride, size // stride
            centers = anchor_centers(h, w, stride, num_anchors=len(scores) // (h * w))
            pos = np.where(scores >= self.score_threshold)[0]
            scores_l.append(scores[pos])
            boxes_l.append(distance2bbox(centers, boxes)[pos])
            kps_l.append(distance2kps(centers, kps)[pos].reshape(-1, 5, 2))
        if not scores_l or sum(len(s) for s in scores_l) == 0:
            return []
        scores = np.concatenate(scores_l)
        boxes = np.concatenate(boxes_l) / scale
        kpss = np.concatenate(kps_l) / scale
        dets = np.hstack([boxes, scores[:, None]]).astype(np.float32)
        keep = nms(dets, self.nms_threshold)

        faces: list[Face] = []
        for i in keep:
            lmk = kpss[i].astype(np.float32)
            m, _ = cv2.estimateAffinePartial2D(lmk, ARCFACE_DST, method=cv2.LMEDS)
            if m is None:  # pontos degenerados: não dá para alinhar, descarta o rosto
                continue
            aligned = cv2.warpAffine(img, m, (112, 112), borderValue=0.0)
            rblob = cv2.dnn.blobFromImage(aligned, 1.0 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
            feat = self._rec_onnx.session.run(None, {self._rec_onnx.input_name: rblob})[0]
            x1, y1, x2, y2, sc = (float(v) for v in dets[i])
            faces.append(Face((x1, y1, x2, y2), sc, lmk, l2_normalize(feat)))
        return faces
