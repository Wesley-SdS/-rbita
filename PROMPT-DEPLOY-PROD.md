# Prompt para o Claude do Chrome: colocar a Órbita em produção

Cole o bloco abaixo numa sessão do Claude in Chrome, com o navegador já logado nas contas
(GitHub, Render, Neon). Pré-requisito de código, que o Chrome não faz: o repositório precisa de um
`apps/api/Dockerfile` (hoje só existem os de web, voz e percepção). Faça isso numa sessão de código
antes, ou troque o serviço do api por "Node" com `tsx src/main.ts`.

---

```
Você vai configurar, pelos painéis web, a produção da Órbita, um assistente pessoal de UM dono só
(não é SaaS, não tem multi-tenant). Repositório: GitHub Wesley-SdS/Orbita (ou o remote "origin" do
dono). Leia o DEPLOY.md e o CLAUDE.md do repositório antes de começar, mas onde o DEPLOY.md falar
"tudo na Vercel" ignore: ele está velho.

ARQUITETURA ALVO
- Neon: Postgres 16 com pgvector (extensão "vector" habilitada).
- Render, serviço 1 "orbita-api" (Docker, persistente, plano que não durma): apps/api, NestJS,
  porta 3010. É o processo vivo (cron, regras, eventos, refresh de token, WhatsApp, TODAS as rotas
  /api). Não pode ser serverless nem dormir.
- Render, serviço 2 "orbita-web" (Docker, apps/web/Dockerfile, build a partir da raiz): Next.js na
  3000. Encaminha /api/* ao api pela variável API_URL (use o endereço interno do Render).
- Render, serviço 3 "orbita-gowa" (imagem aldinokemal2104/go-whatsapp-web-multidevice:v9.5.0, versão
  FIXA), serviço privado, com disco persistente para a sessão do WhatsApp, comando
  `rest --port=3000 --basic-auth=$GOWA_BASIC_AUTH`. Confirme o caminho de dados no README da imagem.
- NÃO sobem na nuvem: apps/perception (biometria nunca sai de casa), mãos do Windows e extensão do
  Chrome (controlam o PC do dono), Ollama. Deixe esses desligados.
- Voz (apps/voice): opcional. Se subir, serviço Docker à parte; se não, TTS pelo Edge/Gemini e
  transcrição pela AssemblyAI.

O QUE CONFIGURAR
1. Neon: criar projeto, habilitar `CREATE EXTENSION IF NOT EXISTS vector;`, pegar a connection string.
2. Render: criar os serviços acima, na mesma região do Neon, com deploy automático da branch main.
   Rede privada entre api, web e gowa.
3. Variáveis de ambiente (nomes exatos, valores gerados por você quando aleatórios, com
   `openssl rand -hex 32` ou o gerador do painel):
   - Api e web: DATABASE_URL (Neon), BETTER_AUTH_SECRET, BETTER_AUTH_URL (URL pública do web),
     CONNECTORS_ENC_KEY (DISTINTA do BETTER_AUTH_SECRET, obrigatória em produção),
     ORBITA_OWNER_EMAIL (e-mail do dono), ALLOWED_EMAILS.
   - Web: API_URL (endereço interno do orbita-api, porta 3010).
   - Api: GOWA_BASIC_AUTH (usuario:senha forte, a mesma no gowa) e o endereço interno do gowa onde o
     código esperar (procure em packages/core/src/whatsapp/gowa/ o nome da variável de URL).
   - Modelos e embedding: pelo menos uma chave de nuvem para chat (GROQ_API_KEY, GEMINI_API_KEY,
     OPENAI_API_KEY ou AI_GATEWAY_API_KEY) e uma para embedding (GEMINI_API_KEY ou OPENAI_API_KEY).
     NÃO configure CLAUDE_CODE_OAUTH_TOKEN nem OLLAMA_BASE_URL.
   - Se o dono tiver as chaves: ASSEMBLYAI_API_KEY, GOOGLE_CLIENT_ID/SECRET, MICROSOFT_*, VAPID_*,
     TOMTOM_API_KEY. As que ele não tiver, deixe de fora e liste no relatório.
4. Migrações: rodar as do packages/db contra o Neon (drizzle-kit migrate). Se você não tiver
   terminal, use o shell do Render (job único) ou peça ao dono para rodar localmente com a
   DATABASE_URL do Neon. Depois confira que a tabela __drizzle_migrations tem todas as migrações e
   que o `when` da última é o maior do journal.
5. OAuth: nos consoles do Google e da Microsoft, cadastrar os redirects
   https://SEU-DOMINIO/api/auth/callback/google e https://SEU-DOMINIO/api/connectors/<provedor>/callback.
6. Domínio e HTTPS: apontar o domínio do dono para o orbita-web (microfone do celular exige HTTPS).
7. Validar: GET https://SEU-DOMINIO/api/health deve voltar status ok com db up. Serviços que não
   sobem na nuvem devem aparecer como nao_usado ou down sem derrubar o status. Abrir o app, criar a
   conta do dono (a primeira conta vira dono; o cadastro fecha depois dela), testar um chat. Parear
   o WhatsApp só se o dono estiver com o celular na mão.

REGRAS INVIOLÁVEIS
- Nunca imprima, cole no chat ou grave em arquivo do repositório nenhum segredo. Segredo só entra
  no campo de variável do painel. No relatório final, escreva só os NOMES das variáveis.
- Se pedir login, senha, 2FA, cartão ou qualquer pagamento, pare e peça ao dono. Não crie plano
  pago sem ele confirmar o valor.
- Não apague nem recrie nada que já exista no Render ou no Neon sem perguntar. Antes de mexer num
  recurso existente, olhe o que ele é.
- Não faça push, nem commit, nem mexa no GitLab. Você configura painéis, não código.
- Se um painel não deixar fazer algo (ou o Dockerfile do api não existir), pare e diga exatamente o
  que falta, em vez de improvisar.
- Se uma ação falhar 2 ou 3 vezes, pare e explique o que tentou.

ENTREGA
Relatório curto em pt-BR, sem travessão: o que foi criado (nome e URL de cada serviço), quais
variáveis ficaram faltando e por quê, resultado literal do /api/health, e o que o dono ainda precisa
fazer à mão. Se algo falhou, diga que falhou.
```
