---
name: adalink-referencia
description: Consulta os projetos adalink-platform e Adalink-Agents-Pipeline como referência de padrão para a Órbita, filtrando o que é de SaaS multi-tenant. Use ao portar roteador de modelos, RAG, OCR, ferramentas de chat ou conectores, e sempre que alguém disser "copia do Adalink" ou "igual no Adalink".
---

# Usar o Adalink como referência (sem importar a plataforma)

## Onde estão

| Repo | Caminho | O que é |
|---|---|---|
| `adalink-platform` | `../adalink-platform` | SaaS multi-tenant, NestJS + Prisma, 25 microserviços |
| `Adalink-Agents-Pipeline` | `../Adalink-Agents-Pipeline` | Front/esteira de agentes, Turborepo |

Ambos têm `CLAUDE.md` na raiz e `.claude/{agents,commands,skills}` — valem como referência de
convenção, não como código a copiar.

## A regra de ouro

A Órbita é um **assistente pessoal de um dono só**. O Adalink resolve muitos tenants, muito
volume, custo por token e latência na casa dos segundos. **A solução dele é calibrada para outro
problema.** Portar inteiro deixa a Órbita mais complexa e mais lenta no caso que mais importa.

**Sempre separe: o DESENHO é valioso, o CÓDIGO é parcialmente portável.**

## Filtro obrigatório — nunca entra na Órbita

- `organizationId` e qualquer coisa de tenant
- Billing, credits, marketplace, ledger de custo
- `SecurityServiceClient` / policy por organização (é outro microserviço)
- Libs `@adalink/*` (`shared-domain`, `observability`, `shared-infrastructure`)
- Prisma (a Órbita é Drizzle, e continua sendo)
- Redis, filas e rate limiter distribuído "por escala"
- Clean Architecture em 4 camadas por feature — é peso morto neste tamanho

## Veredito por peça (medido no código, 2026-09)

### ✅ OCR — portar quase direto
`../adalink-platform/apps/processing-service/src/application/use-cases/ocr/` (838 linhas)
Pipeline `render-pdf-to-images → run-tesseract → vision-fallback por confiança`, com
`ocr-result.vo` e timeout. O `apps/web/src/lib/ocr.ts` atual tem ~50 linhas e nenhum fallback.
Melhor relação valor/linha das três peças.

### 🟡 Roteador de modelos — portar o desenho + 2 camadas
`../adalink-platform/apps/chat-service/src/infrastructure/ai/`

| Portar | Não portar |
|---|---|
| `rule-based-prefilter.service.ts` (~200 linhas, quase puro) | `model-router.service.ts` (1.544 linhas) |
| `heuristic-complexity-scorer.service.ts` (~250, quase puro) | `llm-models.catalog.ts` (1.586 linhas) |
| Specs de ambos (~1.700 linhas — é a rede de segurança) | `model-registry.ts` (399, 100% gateway) |
| `ModelTier`, `RoutingLayer`, `FallbackReason`, `PoolRole` | |

**Por que o núcleo não serve:** `grep -c -i "ollama\|local\|vllm"` em `model-registry.ts` = **0**.
O roteador do Adalink **não tem noção de modelo local**: tudo é chaveado por `gatewayId` do Vercel
AI Gateway e os tiers são de **custo** (`$`/`$$`/`$$$`).

O eixo nº 1 da Órbita é **local vs nuvem** (latência, offline, privacidade), e ele não existe lá.
O roteador da Órbita precisa de **dois eixos**: local/nuvem primeiro, custo dentro dele.

⚠️ A cascata tripla de classificador LLM (2s → 2,5s → 3s) faz sentido com milhares de turnos/dia.
Numa casa, o **prefilter de regras resolve ~90%**, e para "apaga a luz" a cascata é o oposto do
que se quer. Preveja um `taskType: home_command` que curto-circuita para o modelo local pequeno.

### 🔴 RAG — não portar o serviço
`../adalink-platform/apps/rag-service`: **45.143 linhas em 419 arquivos**, com fila, Redis, rate
limiter, scheduling, security e multi-tenant. O RAG inteiro da Órbita tem ~150 linhas.

Garimpe peças isoladas e reimplemente em Drizzle sobre o pgvector que já funciona:
`infrastructure/reranking/cohere-reranker.service.ts` (pequeno e focado) e as ideias dos
use-cases `memory-graph`, `continuity` e `insights`.

## Também vale olhar (padrão, não código)

- `apps/chat-service/.../chat-tools.service.ts` — como um catálogo grande de tools é organizado
- `apps/chat-service/.../circuit-breaker.service.ts` — comparar com `packages/llm/src/failover.ts`
- `CLAUDE.md` dos dois repos — convenção de commit, pré-fechamento, política de lint

## Como reportar um porte

Ao trazer algo, diga explicitamente no resumo: **o que veio**, **o que foi removido no filtro**, e
**o que foi reescrito**. Porte silencioso é como `organizationId` entra sem ninguém ver.
