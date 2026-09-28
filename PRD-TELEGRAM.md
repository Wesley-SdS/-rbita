# PRD: Telegram, o canal da própria Órbita

Decidido em 27/09/2026 com o dono. É o "número dela" do modelo híbrido (CHECKLIST.md): o WhatsApp é o
número do Wesley, onde a Órbita lê e responde COMO ele, sempre com aprovação; o Telegram é onde ela fala
como ELA MESMA, com o dono e com as pessoas da casa.

## Por que Telegram e não um segundo WhatsApp

- **Bot oficial.** Sem ponte não oficial e sem risco de banimento (número novo que só manda aviso é o
  perfil que o WhatsApp mais bloqueia).
- **Sem endereço público.** A Órbita pergunta ao Telegram se há mensagem nova (`getUpdates` com espera
  longa), então roda em casa como hoje. Webhook ficaria para quando houver URL pública.
- **Botão de aprovar.** A proposta chega com "Aprovar / Recusar". O clique é do dono e nenhum texto de
  terceiro imita um botão.
- **Custo zero.**

## O que existe (T1 a T8)

| Item | Onde |
|---|---|
| T1. Conectar o bot (token do @BotFather conferido com `getMe`, gravado cifrado) | `telegram/bot.ts` · rota `POST /api/telegram/conectar` · tela `telegram-panel.tsx` |
| T2. Convite de uso único (`t.me/<bot>?start=<código>`, só o hash no banco, com validade) | `telegram/store.ts` (`criarConvite`, `usarConvite`) · `POST /api/telegram/convite` |
| T3. Escuta: grava e só então avança o cursor; update que falha volta; 409 = outro processo ouvindo | `telegram/receber.ts` (`ouvirTelegram`) · laço `telegram` no `SchedulerService` |
| T4. Turno do DONO: tudo (como a conversa "Eu"), "manda" aprova, memória aprende | `telegram/turno.ts` |
| T5. Turno da PESSOA DA CASA: só `telegram.dominiosDaFamilia`, sem RAG/persona/memória do dono, permissão por pessoa e cômodo, proposta vai ao dono | `telegram/turno.ts` |
| T6. Botões: só do dono; risco perigoso e proposta vencida só pela tela | `telegram/receber.ts` (`tratarBotao`) |
| T7. Avisos e briefing também no Telegram, com silêncio e teto próprios | `telegram/enviar.ts` (`avisarNoTelegram`) · `whatsapp/briefing.ts` |
| T8. Tools `enviar_telegram` (com gate) e `ler_telegram` | `tools/domains/telegram.ts` |

## Regras que não podem ser afrouxadas

1. **Desconhecido nunca chega ao modelo.** Qualquer pessoa acha um bot. Sem convite, um recado (uma vez)
   e mais nada.
2. **Só conversa privada.** Em grupo, qualquer um do grupo falaria em nome da casa.
3. **A pessoa da casa não é o dono.** Ela não vê e-mail, finanças, agenda, documentos nem memória dele.
   O que ela diz não vira memória dele.
4. **Aprovação é do dono.** Botão de outra pessoa não aprova; "manda" dela é só uma frase.
5. **Voz e nota de voz** saem com a mesma voz do tempo real (`whatsapp.vozDaNota`).

## Limites conhecidos

- Documento mandado pelo Telegram ainda não entra nos fluxos (cupom, extrato, conhecimento). A Órbita
  pede para mandar pelo app ou pelo WhatsApp.
- O bot não escreve para quem nunca falou com ele (regra do Telegram): quem recebe mensagem da Órbita
  precisa ter entrado pelo convite.
