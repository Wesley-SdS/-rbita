# Medição: RAG e OCR (setembro de 2026)

No espírito de `apps/perception/MEDICAO.md`: número medido nesta máquina, com os
documentos do dono, não reputação de biblioteca.

## Máquina

i7-10610U (4 núcleos, 8 threads), 32 GB de RAM, **sem GPU**, Windows 11.
As medições de acerto valem para qualquer máquina; as de tempo são o pior caso
de uma casa. Onde a máquina estava ocupada, está dito.

## Acervo e gabarito

15 documentos reais do dono (`bench/data`, fora do git: o repositório é público):
conta de luz, extrato bancário de 12 páginas, imposto de renda, recibo de
pagamento, DECORE, contrato de locação de veículo, minuta de compra de
apartamento, manual do proprietário de 99 páginas, carta da Caixa, relatório de
auditoria, plano de ações de uma loja e dois livros longos (que entram
truncados em 40 páginas, como ruído realista).

`bench/perguntas.json` (fora do git, formato em `bench/perguntas.exemplo.json`): **32 perguntas**, sendo 30 com resposta conhecida
(documento + página) e 2 propositalmente sem resposta no acervo. Os tipos são
misturados de propósito: valor e número exato (onde a busca por palavra ganha),
paráfrase (onde o vetor ganha), pergunta sem acento e pergunta multi-página.
O gabarito aponta documento e PÁGINA, não id de trecho, para sobreviver a
mudanças de corte.

Como reproduzir:

```bash
node bench/extrair.mjs                                     # PDF → texto por página
node bench/medir.mjs indexar --tag=X --chunk=atual|novo --embed=<modelo>
node bench/medir.mjs avaliar --tag=X --modo=vetor|texto|rrf [--rerank=1]
node bench/rerank.mjs --modelo=<hf> --arquivo=model_quint8_avx2
```

## 1. O acerto, por estratégia

Todos os números abaixo vêm do MESMO acervo indexado do jeito antigo (corte por
caractere, 1000/150), trocando só a estratégia de busca e o modelo de embedding.
`k = 5` (quantos trechos entram no contexto do turno).

### Com o embedding local de hoje (`nomic-embed-text`, só inglês)

| Estratégia | Acerto no top 5 | Top 10 | MRR@10 | Latência média |
|---|---|---|---|---|
| Só vetor (o que a Órbita fazia) | 50,0% | 53,3% | 0,345 | 2415 ms |
| Só palavra, exigindo TODOS os termos | 6,7% | 6,7% | 0,067 | 204 ms |
| Só palavra, qualquer termo + `ts_rank_cd` | 56,7% | 73,3% | 0,454 | 389 ms |
| Híbrida: RRF das duas listas (k=60) | 56,7% | 63,3% | 0,410 | 2696 ms |

### Com embedding local multilíngue (`nomic-embed-text-v2-moe`)

| Estratégia | Acerto no top 5 | Top 10 | MRR@10 | Latência média |
|---|---|---|---|---|
| Só palavra, qualquer termo | 73,3% | 83,3% | 0,580 | 152 ms |
| Só vetor | 76,7% | 76,7% | 0,604 | 8284 ms (máquina ocupada) |
| **Híbrida: RRF das duas** | **86,7%** | **90,0%** | **0,708** | 15236 ms (máquina ocupada) |

**O que isso quer dizer**

1. A forma "oficial" da busca textual (`websearch_to_tsquery`, usada no exemplo
   do pgvector e no guia da Supabase) **não serve** para pergunta em linguagem
   natural: ela exige todos os termos no mesmo trecho, e "qual o valor da conta
   de luz da Enel que vence em agosto?" não tem nenhum trecho assim. 6,7%.
   Os MESMOS termos unidos por `|`, deixando o `ts_rank_cd` ordenar, dão 56,7%.
   Virou a chave `rag.textMode`, com "qualquer palavra" como padrão.
2. O embedding local era um modelo **só de inglês** num acervo em português
   (https://huggingface.co/nomic-ai/nomic-embed-text-v1.5). Trocar por um
   multilíngue levou a busca vetorial de 50,0% para 76,7% sozinha.
3. A fusão RRF só compensa quando os DOIS lados são bons: com o embedding de
   inglês ela empatava e piorava o top 10; com o multilíngue ela sobe de 76,7%
   para 86,7%. Das 30 perguntas, a Órbita achava 15 e passa a achar 26.
4. As latências de vetor foram medidas com a máquina ocupada (indexação em
   paralelo). O lado textual, medido no mesmo momento, respondeu em 152 ms.

## 2. Reordenação (rerank)

Modelo: `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (118M, Apache 2.0, treinado
no mMARCO, que inclui português), arquivo ONNX int8 `model_quint8_avx2`, rodando
em Node com `@huggingface/transformers`.

| Situação | Tempo |
|---|---|
| Carregar o modelo (uma vez por processo) | 17 a 23 s |
| Reordenar 5 candidatos | 3,4 s (mediana, máquina parada) |
| Reordenar 10 candidatos | 1,9 s |
| Reordenar 20 candidatos | 2,5 s |
| Reordenar 30 candidatos | 1,8 s |
| Mesma medida com a máquina ocupada | 9 a 23 s |

O tempo quase não varia com a quantidade de candidatos (o lote vai junto), então
reordenar 20 custa o mesmo que reordenar 5.

Qualidade: no caso de controle, com 6 trechos e a pergunta "quantos anos de
garantia tem a impermeabilização?", o reordenador colocou o trecho certo em
primeiro com nota 2,87 contra −7,49 do segundo colocado, uma separação enorme.

**O ganho de acerto no conjunto completo NÃO foi medido**: a máquina estava
sobrecarregada e a passada de 30 perguntas (embedding + reordenação por
pergunta) não terminou em tempo aceitável. É a primeira medição a refazer com a
máquina livre, antes de qualquer recomendação de ligar a reordenação.

**Leitura**: a qualidade é claramente boa, e o custo é de 2 a 3 segundos por
turno nesta CPU. Numa máquina com GPU isso cai para dezenas de milissegundos.
Por isso o padrão de fábrica é "não reordenar", e a chave `rag.rerank` deixa o
dono ligar quando o servidor da casa tiver GPU, ou quando ele preferir esperar.

## 3. OCR

**Ainda não medido.** O pipeline está escrito e testado (confiança por palavra,
três gatilhos para o modelo de visão, tabela de PDF nativo, dedup por SHA-256),
mas a comparação entre motores com os documentos do dono depende de rodar com a
máquina livre. O que já se sabe pelo acervo, sem medir motor nenhum:

- O `WhatsApp Scan` de 1 página devolve **zero caractere** pela extração de
  texto: é um PDF escaneado puro. No código antigo ele virava o erro "nenhum
  texto extraído do arquivo"; agora ele entra no OCR.
- O `Manual Olimpic` tem 99 páginas com média de **339 caracteres por página**,
  ou seja, é quase todo imagem. Era indexado como se fosse texto completo.

O que medir, com CER e acerto de valor, data e CPF/CNPJ, e segundos por página:
`tesseract.js` (o de hoje) contra **RapidOCR PP-OCRv5 latin** por ONNX (Apache
2.0, roda na venv que o `apps/perception` já tem), e, se o gargalo for tabela,
Docling com TableFormer.

## Decisões que saíram daqui

- Busca textual em modo "qualquer palavra" como padrão (`rag.textMode`).
- Busca híbrida com RRF ligada por padrão, com pesos e `k` configuráveis.
- Embedding local multilíngue no lugar do modelo de inglês.
- Reordenação implementada e **desligada por padrão** nesta máquina.

## Pendências de medição

- Embedding de nuvem (`gemini-embedding-2`): a chave disponível é de plano
  gratuito e devolveu **429 (cota excedida)** depois de cerca de 60 requisições.
  Para centenas de trechos, o caminho gratuito não se sustenta, e o plano
  gratuito ainda usa o conteúdo para treinar.
- Comparação de motores de OCR (tesseract.js contra RapidOCR) com os documentos
  escaneados do dono.
- Ganho de acerto da reordenação no conjunto completo (ver a seção 2).
- Refazer o índice do "antes" (`atual-nomic`): ele ficou com 469 trechos contra
  485 do índice novo, porque um documento falhou na gravação antes da correção
  do byte inválido. A comparação de 50,0% para 86,7% é, portanto, levemente
  pessimista do lado "antes"; o sentido não muda, o número exato pode mudar.
