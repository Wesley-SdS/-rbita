# Percepção local: medição e como rodar

Serviço **stateless** da Fase 2: entra áudio ou imagem, saem vetores. Quem é quem mora no `apps/api`.
Biometria nunca sai de casa: o serviço só escuta em `127.0.0.1`, e o `apps/api` só manda biometria
para URL local (guard de saída + teste NV.1).

## Subir

```bash
cd apps/perception
# uma vez: venv 3.12 (MediaPipe não tem wheel acima disso no Windows)
uv venv --python 3.12 .venv && uv pip install --python .venv/Scripts/python.exe -e . pytest httpx
.venv/Scripts/python.exe scripts/download_models.py tudo      # ~610 MB, fora do repo
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8002
.venv/Scripts/python.exe -m pytest -q                         # testes (sem modelo)
```

`PERCEPTION_BENCH=1` liga a página `/bench` para gravar amostras de medição em `bench_data/`
(gitignored). Fora da medição, o processo não escreve nada em disco.

## Medição de 17/09/2026 (esta máquina)

i7-10610U (4 núcleos / 8 threads), 32 GB, sem GPU. CPU já saturada por outros processos durante
toda a medição, então latências são ruidosas. Amostras: voz e rosto reais do dono (1 pessoa).
Impostores: 5 vozes sintéticas (Edge TTS) + Piper; 60 rostos públicos do LFW.
**Sintético/público prova separação, não precisão contra alguém da casa.**

### Voz

| Modelo | 3 s | 3 s + Ollama | Genuíno mín / média | Impostor máx | EER |
|---|---|---|---|---|---|
| **WeSpeaker ResNet34** (escolhido) | 0,57 s | 0,31 s | 0,66 / 0,88 | 0,62 | 0% |
| TitaNet small | 0,13 s | 1,07 s | 0,06 / 0,62 | 0,22 | 7,5% |
| CAM++ VoxCeleb | 0,26 s | 2,1 s | 0,19 / 0,56 | 0,75 | 42% |

Teste ponta a ponta pela API (cadastro de 45 s, limiar 0,75 / provável 0,62 / fala mínima 1 s):
9 de 12 frases **identificadas** (0,87 a 0,93), 3 **prováveis** (todas com menos de 1 s de fala),
0 erradas; 15 de 15 vozes sintéticas **desconhecidas** (máx 0,62). 2,6 a 4,9 s por chamada.

### Rosto

| Backend | 720p | 720p + Ollama (p50/p95) | Genuíno mín | Impostor máx | EER |
|---|---|---|---|---|---|
| **InsightFace S** (escolhido) | 0,13 s | 2,5 / 8,6 s | 0,77 | 0,21 | 0% |
| OpenCV YuNet+SFace | 0,17 s | 0,77 / 1,4 s | 0,81 | 0,36 | 0% |
| InsightFace L | 2,0 s | 8,6 / 14 s | 0,82 | 0,20 | 0% |

### O que isto vira de especificação (decisão 9.7)

- Nesta máquina, voz e rosto cabem **só sob evento** (comando, reunião, câmera detectou pessoa).
- Com o Ollama gerando junto, a latência sobe de 5 a 20x. O servidor da casa precisa de **GPU** ou de
  **8+ núcleos físicos** para rosto perto de tempo real junto com modelo local.
- Máquina nova: rode `bench/evaluate.py` de novo com as mesmas amostras e ajuste modelo e limiares em
  Ajustes → Identidade e biometria. Nada disso exige mudar código.
