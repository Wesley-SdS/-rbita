"""Screenshot de UM monitor (ou de uma janela), com os apps ocultos pintados de preto AQUI.

Captura pela duplicação de tela do DXGI (`dxcam`), que é a mais barata depois
da primeira imagem, com o `mss` (BitBlt do GDI) de reserva quando o DXGI não
serve (área de trabalho remota, tela segura, driver sem suporte).

Ordem que não muda (PRD A6):
  1. a imagem inteira do monitor, em pixel físico (o processo é Per-Monitor V2);
  2. cada janela visível de app oculto é PINTADA DE PRETO, antes de qualquer
     outra coisa: nem o recorte, nem a redução, nem a miniatura veem o cofre;
  3. recorte (janela) e redução para o tamanho da config, com a escala
     guardada na CAPTURA, para o clique do modelo voltar ao pixel certo;
  4. nada é gravado em disco.

A borda da Órbita é excluída da captura pelo próprio Windows
(`WDA_EXCLUDEFROMCAPTURE`), então não aparece para o modelo.
"""

from __future__ import annotations

import base64
import io
import threading
import time
import uuid
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .dpi import Monitor, monitores
from .uia import listar_janelas, retangulos_ocultos


@dataclass
class Captura:
    id: str
    monitor: int
    origem_x: int
    origem_y: int
    escala: float
    largura: int
    altura: int
    quando: float
    marcas: dict[int, tuple[int, int]] = field(default_factory=dict)


class Capturador:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cameras: dict[str, object] = {}
        self._ultimo: dict[str, np.ndarray] = {}
        self._capturas: dict[str, Captura] = {}
        self.motor = "dxcam"
        self.erro_dxgi: str | None = None

    # ── a imagem crua ──────────────────────────────────────────────────────
    def _dxcam(self, m: Monitor) -> np.ndarray | None:
        if self.motor != "dxcam":
            return None
        try:
            import dxcam

            cam = self._cameras.get(m.nome)
            if cam is None:
                for idx in range(8):
                    try:
                        c = dxcam.create(output_idx=idx, output_color="BGRA", processor_backend="numpy")
                    except Exception:  # noqa: BLE001 - acabaram as saídas
                        break
                    if getattr(c._output, "devicename", None) == m.nome:  # type: ignore[attr-defined]
                        cam = c
                        break
                if cam is None:
                    return None
                self._cameras[m.nome] = cam
            quadro = cam.grab()  # type: ignore[attr-defined]
            if quadro is None:
                # o DXGI só entrega quadro quando a tela MUDOU; sem mudança, vale o último
                quadro = self._ultimo.get(m.nome)
            else:
                self._ultimo[m.nome] = quadro
            return quadro
        except Exception as e:  # noqa: BLE001 - DXGI indisponível: cai para o GDI de vez
            self.erro_dxgi = str(e)[:200]
            self.motor = "mss"
            return None

    def _mss(self, m: Monitor) -> np.ndarray:
        import mss

        with mss.MSS() if hasattr(mss, "MSS") else mss.mss() as s:  # type: ignore[attr-defined]
            im = s.grab({"left": m.x, "top": m.y, "width": m.largura, "height": m.altura})
            return np.frombuffer(im.bgra, dtype=np.uint8).reshape(im.height, im.width, 4)

    def quadro(self, m: Monitor) -> tuple[np.ndarray, str]:
        with self._lock:
            q = self._dxcam(m)
            if q is not None and q.shape[0] == m.altura and q.shape[1] == m.largura:
                return q.copy(), "dxcam"
            return self._mss(m).copy(), "mss"

    # ── a captura que sai ──────────────────────────────────────────────────
    def capturar(
        self,
        ocultos: list[str],
        resolucao: tuple[int, int] = (1280, 720),
        monitor: int | None = None,
        janela: int | None = None,
        formato: str = "jpeg",
        marcas: str | None = None,
        elementos: list[dict] | None = None,
        retangulo: tuple[int, int, int, int] | None = None,
    ) -> dict:
        """`retangulo` (pixel físico) é o zoom: um trecho da tela, ampliado até a resolução pedida."""
        comeco = time.perf_counter()
        mons = monitores()
        if not mons:
            raise RuntimeError("Nenhum monitor encontrado.")
        janelas = listar_janelas(ocultos)
        alvo_janela = next((j for j in janelas if j["janela"] == janela), None) if janela else None
        if janela and not alvo_janela:
            raise LookupError("Essa janela não está aberta (ou não é visível).")
        if alvo_janela and alvo_janela["oculta"]:
            raise PermissionError("Esta janela é de um app oculto pela configuração: a Órbita não a vê.")
        if retangulo:
            cx, cy = (retangulo[0] + retangulo[2]) // 2, (retangulo[1] + retangulo[3]) // 2
            m = next((x for x in mons if x.contem(cx, cy)), next((x for x in mons if x.primario), mons[0]))
        elif alvo_janela and alvo_janela["monitor"] is not None:
            m = mons[alvo_janela["monitor"]]
        elif monitor is not None and 0 <= monitor < len(mons):
            m = mons[monitor]
        else:
            m = next((x for x in mons if x.primario), mons[0])
        bruto, motor = self.quadro(m)
        t_captura = time.perf_counter()

        # 2. apps ocultos pintados ANTES de tudo
        pintadas = 0
        for ret in retangulos_ocultos(ocultos):
            l, t, r, b = ret
            l, t, r, b = max(l, m.x) - m.x, max(t, m.y) - m.y, min(r, m.x + m.largura) - m.x, min(b, m.y + m.altura) - m.y
            if r > l and b > t:
                bruto[t:b, l:r, :3] = 0
                pintadas += 1

        # 3. recorte e redução
        ox, oy = m.x, m.y
        recorte = retangulo or (tuple(alvo_janela["retangulo"]) if alvo_janela else None)
        if recorte:
            l, t, r, b = recorte
            l, t, r, b = max(l, m.x), max(t, m.y), min(r, m.x + m.largura), min(b, m.y + m.altura)
            if r - l < 8 or b - t < 8:
                raise LookupError("A janela está fora da tela ou minimizada.")
            bruto = bruto[t - m.y : b - m.y, l - m.x : r - m.x]
            ox, oy = l, t
        img = Image.fromarray(bruto[:, :, [2, 1, 0]], "RGB")
        lw, lh = resolucao
        # o zoom AMPLIA o trecho (até 4x); a tela inteira e a janela só reduzem
        escala = min(4.0 if retangulo else 1.0, lw / img.width, lh / img.height)
        if escala != 1.0:
            img = img.resize((max(1, round(img.width * escala)), max(1, round(img.height * escala))), Image.LANCZOS)

        cap = Captura(id=uuid.uuid4().hex[:8], monitor=m.indice, origem_x=ox, origem_y=oy, escala=escala, largura=img.width, altura=img.height, quando=time.time())
        if marcas == "grade":
            self._grade(img, cap)
        elif marcas == "elementos" and elementos:
            self._marcar_elementos(img, cap, elementos)
        with self._lock:
            self._capturas[cap.id] = cap
            if len(self._capturas) > 30:
                for k in sorted(self._capturas, key=lambda k: self._capturas[k].quando)[:-30]:
                    del self._capturas[k]

        buf = io.BytesIO()
        if formato == "png":
            img.save(buf, "PNG", optimize=False)
            media = "image/png"
        else:
            img.save(buf, "JPEG", quality=82)
            media = "image/jpeg"
        mini = img.copy()
        mini.thumbnail((320, 180))
        mb = io.BytesIO()
        mini.save(mb, "JPEG", quality=60)
        return {
            "captura": cap.id,
            "monitor": m.indice,
            "largura": img.width,
            "altura": img.height,
            "escala": round(escala, 5),
            "origem": [ox, oy],
            "motor": motor,
            "ocultas_pintadas": pintadas,
            "mediaType": media,
            "base64": base64.b64encode(buf.getvalue()).decode("ascii"),
            "miniatura": "data:image/jpeg;base64," + base64.b64encode(mb.getvalue()).decode("ascii"),
            "marcas": {str(k): list(v) for k, v in cap.marcas.items()} if cap.marcas else None,
            "ms_captura": round((t_captura - comeco) * 1000),
            "ms": round((time.perf_counter() - comeco) * 1000),
            "bytes": len(buf.getvalue()),
        }

    # ── marcas (set-of-marks) para app sem árvore útil ─────────────────────
    def _fonte(self, tam: int):
        try:
            return ImageFont.truetype("arial.ttf", tam)
        except OSError:
            return ImageFont.load_default()

    def _grade(self, img: Image.Image, cap: Captura, colunas: int = 16) -> None:
        """Grade numerada: "clique na marca 37" vira o centro da célula 37, em pixel físico."""
        d = ImageDraw.Draw(img)
        cel = max(24, img.width // colunas)
        linhas = max(1, (img.height + cel - 1) // cel)
        f = self._fonte(max(10, cel // 4))
        n = 0
        for li in range(linhas):
            for co in range(colunas):
                n += 1
                x0, y0 = co * cel, li * cel
                d.rectangle([x0, y0, x0 + cel, y0 + cel], outline=(255, 0, 255))
                d.text((x0 + 2, y0 + 1), str(n), fill=(255, 0, 255), font=f)
                cx, cy = x0 + cel / 2, y0 + cel / 2
                cap.marcas[n] = (int(cap.origem_x + cx / cap.escala), int(cap.origem_y + cy / cap.escala))

    def _marcar_elementos(self, img: Image.Image, cap: Captura, elementos: list[dict]) -> None:
        d = ImageDraw.Draw(img)
        f = self._fonte(12)
        for el in elementos:
            l, t, r, b = el["retangulo"]
            x0, y0 = (l - cap.origem_x) * cap.escala, (t - cap.origem_y) * cap.escala
            x1, y1 = (r - cap.origem_x) * cap.escala, (b - cap.origem_y) * cap.escala
            if x1 < 0 or y1 < 0 or x0 > img.width or y0 > img.height:
                continue
            d.rectangle([x0, y0, x1, y1], outline=(255, 0, 0))
            d.text((x0 + 1, y0 + 1), str(el["id"]), fill=(255, 0, 0), font=f)
            cap.marcas[int(el["id"])] = ((l + r) // 2, (t + b) // 2)

    # ── coordenadas ────────────────────────────────────────────────────────
    def captura(self, cid: str) -> Captura | None:
        with self._lock:
            return self._capturas.get(cid)

    def para_fisico(self, cid: str, x: float, y: float) -> tuple[int, int]:
        """Ponto da IMAGEM que o modelo viu -> pixel físico da tela. Captura velha ou desconhecida é recusada."""
        cap = self.captura(cid)
        if not cap:
            raise LookupError("Essa captura não existe mais: veja a tela de novo antes de agir.")
        if time.time() - cap.quando > 600:
            raise LookupError("Essa captura é de mais de 10 minutos atrás: veja a tela de novo.")
        if not (0 <= x <= cap.largura and 0 <= y <= cap.altura):
            raise ValueError(f"O ponto ({x}, {y}) está fora da imagem ({cap.largura}x{cap.altura}).")
        return (int(round(cap.origem_x + x / cap.escala)), int(round(cap.origem_y + y / cap.escala)))

    def para_imagem(self, cid: str, x: int, y: int) -> tuple[int, int]:
        """O inverso de `para_fisico`: pixel físico da tela -> ponto da IMAGEM que o modelo viu.
        Pode cair fora da imagem (o cursor está em outro monitor): quem chama diz isso."""
        cap = self.captura(cid)
        if not cap:
            raise LookupError("Essa captura não existe mais: veja a tela de novo.")
        return (int(round((x - cap.origem_x) * cap.escala)), int(round((y - cap.origem_y) * cap.escala)))

    def marca(self, cid: str, n: int) -> tuple[int, int]:
        cap = self.captura(cid)
        if not cap or n not in cap.marcas:
            raise LookupError("Essa marca não existe na captura: veja a tela de novo.")
        return cap.marcas[n]


CAPTURADOR = Capturador()
