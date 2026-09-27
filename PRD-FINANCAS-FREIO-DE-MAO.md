# PRD — Freio de Mão

Controle financeiro pessoal com foco em "quanto eu posso gastar hoje"

Versão de referência: artefato "Freio de Mão" (revisão 22 dos dados, setembro de 2026).
Objetivo deste documento: descrever, em linguagem natural, 100% das telas, funcionalidades, regras de cálculo, interações, textos e comportamentos do aplicativo atual, para que ele seja reimplementado em outra aplicação sem perda de nada. Onde o comportamento atual tem uma inconsistência conhecida, isso está marcado como **[Ponto de atenção]**, com a correção sugerida; a decisão de corrigir ou manter fica com quem implementar.

Todo o texto de interface é em português do Brasil. Os textos entre aspas neste documento são os textos exatos que aparecem na tela e devem ser mantidos.

---

## 1. Visão do produto

### 1.1 O problema

A pessoa sabe quanto ganha, mas não sabe quanto pode gastar hoje. Contas fixas, parcelas de cartão, dívidas e projetos grandes (compra de imóvel, reforma) já estão comprometidos antes de qualquer decisão, e ninguém faz essa conta no dia a dia.

### 1.2 A proposta

Um painel único que:

1. Pega a renda do mês, tira tudo que já está comprometido (contas fixas e parcelas) e o que já foi gasto livremente, e divide o que sobra pelos dias restantes do mês. O resultado é o número principal: **"Posso gastar hoje"**.
2. Mostra contas a pagar e a receber com vencimento, avisa o que está vencido ou perto de vencer.
3. Controla cartões de crédito por fatura (fechamento e vencimento), inclusive compras parceladas e pagamento parcial que vira rotativo.
4. Controla dívidas com juros e calcula em quantos meses cada uma acaba.
5. Controla metas/projetos com teto de orçamento e lista de itens (ex.: compra do apartamento, reforma), cujas parcelas entram automaticamente no extrato e no comprometido dos meses seguintes.
6. Projeta os próximos 12 meses e mostra o histórico dos últimos 12.
7. Permite lançar muito rápido: botão +, atalhos de um toque, ditado por voz em linguagem natural, leitura de boleto e importação de extrato bancário.

### 1.3 Princípios que devem ser preservados

- **Mobile first.** A maior parte do uso é no celular, com uma mão. Botão flutuante de lançar sempre visível.
- **Lançar leva cinco segundos.** O campo de valor recebe foco automático, a máscara de dinheiro dispensa vírgula, e todo lançamento novo pode ser desfeito pela notificação.
- **Linguagem de gente, não de banco.** "Tenho na conta", "Já gastei no mês", "Para onde foi", "Sobra em 30 dias". Nada de "débito", "crédito", "saldo consolidado".
- **Honestidade do número.** O painel se recusa a mostrar "posso gastar hoje" quando ainda não sabe o que sai todo mês (ver 6.1.2, modo A).
- **Transferência não é gasto.** Mover dinheiro entre contas, sacar ou pagar fatura de cartão nunca conta como gasto do mês.
- **Uma pessoa, vários aparelhos.** Os mesmos dados no celular e no computador.

---

## 2. Glossário

- **Lançamento**: um movimento que já aconteceu. Pode ser saída (despesa) ou entrada (receita). Fica em uma conta ou em um cartão de crédito.
- **Conta a pagar / a receber (compromisso)**: algo com data de vencimento que ainda vai acontecer (aluguel, salário, boleto). Quando é pago ou recebido, é "quitado" e gera um lançamento. Na interface é chamado de "conta" (cuidado para não confundir com conta bancária).
- **Conta fixa (recorrente)**: compromisso que se repete todo mês. Internamente pertence a uma "série".
- **Conta / carteira**: onde o dinheiro fica (conta corrente, dinheiro em espécie, etc.). Tem saldo inicial.
- **Cartão**: cartão de crédito com limite, dia de fechamento, dia de vencimento e conta que paga a fatura.
- **Fatura**: conjunto de compras de um cartão agrupadas por data de fechamento.
- **Parcela**: lançamento que faz parte de uma compra dividida em várias vezes no cartão.
- **Meta (projeto)**: projeto com teto de orçamento e lista de itens. Os itens contratados geram lançamentos.
- **Dívida**: dívida que cobra juros (empréstimo, rotativo, cheque especial, crediário). Diferente de conta a pagar comum.
- **Rotativo**: o que sobrou de uma fatura paga parcialmente e virou dívida com juros.
- **Transferência**: dinheiro que muda de lugar entre contas próprias. Gera duas pernas (uma saída e uma entrada) e não conta como gasto nem como entrada.
- **Estorno / reembolso**: entrada que devolve um gasto. Em vez de contar como renda, abate o gasto da categoria.
- **Gasto livre (variável)**: tudo que foi gasto no mês que não é conta fixa, nem parcela, nem parcela de meta.
- **Comprometido**: o que já está decidido que vai sair no mês (contas a pagar do mês + parcelas + parcelas de metas).
- **Base do mês**: a renda declarada; se não houver renda, o teto de gastos.
- **Atalho**: um gasto pré-configurado que é lançado com um único toque.
- **Regra de categorização**: "se a descrição contiver X, use a categoria Y". Usada na importação de extrato e no ditado.

---

## 3. Modelo de dados

Todos os dados de uma pessoa formam um único documento de estado. Na nova aplicação isso pode virar tabelas, mas as entidades, campos e relações abaixo precisam existir. Valores monetários são em reais com duas casas. Datas são no formato ano-mês-dia. "Mês" é ano-mês.

### 3.1 Estado raiz

- **rev**: número de revisão, incrementado a cada alteração (usado para resolver qual cópia é mais nova).
- **tema**: "claro", "escuro" ou "auto" (do sistema). Padrão "claro".
- **renda**: renda mensal declarada (0 = não informada).
- **limiteMensal**: teto de gastos mensal (0 = não informado).
- **criadoEm**: data de criação.
- Listas: contas, cartoes, categorias, lancamentos, compromissos, atalhos, regras, dividas, metas, pagamentosFatura.

### 3.2 Conta (carteira)

- id, nome, tipo ("corrente" ou "dinheiro"; hoje só informativo), saldoInicial, cor.
- Saldo atual = saldo inicial + entradas − saídas de todos os lançamentos daquela conta que **não** são de cartão (transferências incluídas, porque movem dinheiro de verdade).

### 3.3 Cartão

- id, nome, limite, fechamento (dia 1–31), vencimento (dia 1–31), contaPagamentoId (conta que paga a fatura), cor.

### 3.4 Categoria

- id, nome, tipo ("despesa" ou "receita"), cor, orcamento (orçamento mensal opcional, 0 = sem orçamento).

### 3.5 Lançamento

- id, tipo ("despesa" ou "receita"), data, valor (sempre positivo), descricao (opcional), categoriaId.
- contaId (se saiu/entrou de uma conta) ou cartaoId (se foi no cartão). Um lançamento de cartão tem contaId vazio.
- transferencia (sim/não): se faz parte de uma transferência ou é pagamento de fatura.
- grupoTransferencia: liga as duas pernas de uma transferência.
- fixo (sim/não): marca que o lançamento veio de uma conta fixa quitada ou de pagamento de dívida.
- estorno (sim/não): entrada que abate gasto.
- grupoParcela, parcelaN, parcelaDe: ligam as parcelas de uma mesma compra (ex.: 3 de 10).
- metaId, metaItemId: lançamento gerado automaticamente por um item de meta.
- importado (sim/não): veio de importação de extrato.
- faturaPaga: campo legado (ver migração em 4.3).
- criadoEm: carimbo de tempo, usado como desempate na ordenação.

### 3.6 Compromisso (conta a pagar / a receber)

- id, direcao ("pagar" ou "receber"), descricao, valor, vencimento, categoriaId, contaId.
- recorrencia ("mensal" ou "nenhuma").
- serieId: identifica todas as ocorrências da mesma conta fixa.
- diaMes: dia do mês em que a série vence.
- status ("aberto" ou "quitado"), quitadoEm (data), lancamentoId (lançamento gerado ao quitar).

### 3.7 Pagamento de fatura

- id, cartaoId, fechamento (qual fatura, identificada pela data de fechamento), valor, data, lancamentoId, rolado (sim quando a parte foi "paga" jogando para o rotativo).

### 3.8 Dívida

- id, nome, tipo ("emprestimo", "cartao-rotativo", "cheque-especial", "crediario", "outro"), saldoInicial, jurosMes (% ao mês), parcelaMensal, contaId, cartaoId (só rotativo).
- pagamentos: lista de {id, data, valor, juros, abatimento, lancamentoId}.
- rolagens (só rotativo): lista de {id, data, valor, fechamento} registrando cada vez que uma fatura jogou saldo para o rotativo.
- Saldo devedor = saldoInicial − soma dos abatimentos (nunca negativo).

### 3.9 Meta

- id, nome, descricao (observação), orcamento (teto), prazo (reservado, sem uso na interface), cor, criadoEm.
- itens: lista de itens de meta.

### 3.10 Item de meta

- id, grupo (etapa, ex.: "Revestimentos"), nome, valor, status ("planejado", "orcado", "contratado", "pago"), obs.
- pagamento: forma ("avista", "cartao", "boleto", "carne"), parcelas (1–48), primeiroVenc (data), contaId, cartaoId.
- imagens: lista de {id, dado} onde dado é a imagem comprimida.

### 3.11 Atalho

- id, rotulo, valor, categoriaId, ondeId (identifica conta ou cartão; formato "conta:ID" ou "cartao:ID").

### 3.12 Regra de categorização

- contem (texto), categoriaId. Identificada pela posição na lista.

### 3.13 Dados iniciais de uma conta nova

- Contas: "Conta corrente" (corrente, saldo 0, cor #0E5A5E) e "Dinheiro" (dinheiro, saldo 0, cor #8E5D0C).
- Categorias de saída, nesta ordem: Mercado, Delivery e restaurante, Transporte, Moradia, Contas da casa, Saúde, Assinaturas, Lazer, Compras, Educação, Cuidados pessoais, Pets, Dívidas e juros, Outros gastos.
- Categorias de entrada: Salário, Freelance, Reembolso, Outras entradas.
- Cores das categorias atribuídas em sequência pela paleta de 12 cores (seção 11.3), recomeçando quando acaba.
- Todas as outras listas vazias, renda 0, teto 0, tema claro.

### 3.14 Categorias criadas automaticamente pelo sistema

O sistema cria estas categorias sozinho na primeira vez que precisa delas (busca por nome e tipo; se não existir, cria com a próxima cor da paleta e orçamento 0):

- "Dívidas e juros" (saída): pagamento de dívida.
- "Transferência" (saída) e "Transferência" (entrada): as duas pernas de uma transferência.
- "Pagamento de fatura" (saída): pagamento de fatura de cartão.
- "Projeto · {nome da meta}" (saída): lançamentos gerados por itens de meta.
- "Outros gastos" (saída) e "Outras entradas" (entrada): quando o ditado não reconhece a categoria.

---

## 4. Persistência, sincronização e manutenção automática dos dados

### 4.1 Como funciona hoje

O app atual é uma página única que guarda os dados dentro dela mesma e se republica a cada alteração, para que o mesmo link mostre os mesmos dados no celular e no computador. Também guarda uma cópia no armazenamento local do navegador. Na nova aplicação, isso deve virar um backend com banco de dados e autenticação, mas o comportamento percebido pela pessoa precisa ser o mesmo:

- Toda alteração salva sozinha, sem botão "salvar geral".
- Cada alteração incrementa a revisão (rev), grava localmente na hora e agenda o envio para a nuvem cerca de 1,6 segundo depois (várias alterações seguidas viram um envio só).
- Ao abrir, o app compara a cópia da nuvem com a local e usa a de revisão maior.
- Se a nuvem estiver fora do ar ou limitando requisições, tenta de novo depois (9 s quando limitado, 6 s em erro genérico). Se não tiver permissão de escrita, passa a funcionar só localmente. Se os dados ficarem grandes demais, avisa: "Base grande demais para sincronizar. Exporte um backup em Ajustes."
- Conflito de versão hoje é simplesmente ignorado. **[Ponto de atenção]** Na nova aplicação, tratar conflito de verdade (recarregar a versão do servidor e reaplicar, ou última escrita vence com aviso).

### 4.2 Indicador de sincronização

No topo, à direita, um ponto colorido com texto em fonte monoespaçada:

- Ponto âmbar pulsando + "salvando…": há alteração ainda não enviada.
- Ponto verde + "sincronizado": tudo salvo na nuvem.
- Ponto cinza + "só neste aparelho": sem nuvem disponível.
- Ponto âmbar pulsando + "conectando…": ainda descobrindo se há nuvem.
- A pulsação é desligada para quem prefere movimento reduzido.

### 4.3 Manutenção automática ao abrir o app

Toda vez que os dados são carregados, antes de desenhar a tela:

1. **Garantir listas**: qualquer lista ausente vira lista vazia; renda, teto e rev ausentes viram 0/0/1; tema inválido vira "claro". Aplicar o tema.
2. **Reatar séries de contas fixas antigas**: contas fixas sem serieId recebem a serieId de outra conta fixa com a mesma direção e a mesma descrição (sem diferenciar maiúsculas); se não houver, a própria conta vira a série. Contas fixas sem diaMes recebem o dia do vencimento.
3. **Migrar faturas antigas**: no modelo antigo, cada compra de cartão tinha um "faturaPaga". Para cada fatura em que todas as compras estavam marcadas como pagas, criar um pagamento de fatura com o total, datado no vencimento da fatura (se ainda não existir pagamento para essa fatura).
4. **Remover duplicatas**: entre contas fixas em aberto, se houver duas com a mesma direção, a mesma descrição e o mesmo mês de vencimento, manter só a primeira.
5. **Alinhar o dia das séries**: em cada série, a ocorrência mais antiga define o dia do mês. Todas as ocorrências em aberto que estejam com dia diferente são movidas para esse dia (limitado ao último dia do mês).
6. **Semear recorrentes** (ver 4.4).

### 4.4 Geração automática de contas fixas (semear recorrentes)

Regra: toda conta fixa mensal deve sempre existir, em aberto, até dois meses à frente do mês atual, independentemente de a pessoa ter quitado ou não as anteriores.

- Para cada série, pegar a ocorrência de vencimento mais distante.
- Enquanto o mês dela for anterior ao "mês atual + 2", criar a ocorrência do mês seguinte: mesma direção, descrição, valor, categoria, conta, recorrência mensal, status aberto, vencimento no diaMes da série (limitado ao último dia do mês).
- Não criar se já existir, naquele mês, uma ocorrência da mesma série ou uma com a mesma direção e a mesma descrição. Nesse caso, pula para o mês seguinte.
- Limite de segurança de 48 iterações por série.
- Essa rotina roda ao abrir o app, ao salvar uma conta fixa e ao quitar uma conta fixa.

Exemplo: hoje é setembro; o aluguel é fixo dia 8; devem existir as ocorrências de setembro, outubro e novembro.

### 4.5 Propagação ao editar uma conta fixa

Ao salvar a edição de uma ocorrência de conta fixa, todas as ocorrências **posteriores e ainda em aberto** da mesma série recebem a nova descrição, valor, categoria, conta e dia do mês (vencimento recalculado mantendo o mês de cada uma). Ocorrências quitadas e anteriores não mudam.

### 4.6 Estado da interface lembrado

Guardado por sessão (não sincronizado): aba atual, mês selecionado, filtros do extrato, sub-aba de Contas, meta aberta e posição da rolagem. Ao recarregar a página, a pessoa volta exatamente onde estava.

---

## 5. Regras de cálculo

Esta seção é a mais importante: todos os números da interface saem daqui.

### 5.1 Gasto do mês

Soma de todas as saídas do mês, **excluindo transferências**, menos todos os estornos do mês. Entradas comuns não entram.

### 5.2 Entrada do mês

Soma das entradas do mês que não são transferência nem estorno.

### 5.3 Saldo

- Saldo de uma conta: saldo inicial + entradas − saídas de todos os lançamentos (de qualquer data) daquela conta que não são de cartão.
- "Tenho na conta" = soma dos saldos de todas as contas.

### 5.4 Gasto por categoria (no mês)

Por categoria: saídas (não transferência) menos estornos. Mostrar só categorias com total maior que zero, ordenadas do maior para o menor.

### 5.5 Gasto diário e acumulado

Para cada dia do mês: saídas menos estornos daquele dia (sem transferências). O acumulado é a soma corrida.

### 5.6 Classificação do gasto

- **Parcela**: lançamento com parcelaDe maior que 1 e que não veio de meta.
- **Projeto**: lançamento que veio de meta.
- **Fixo lançado no mês**: saídas do mês, não transferência, marcadas como fixo e que não são parcela.
- **Parcelas no mês**: saídas do mês, não transferência, que são parcela.
- **Projetos no mês**: saídas do mês, não transferência, que vieram de meta.
- **Gasto livre (variável) no mês** = gasto do mês − fixos lançados − parcelas − projetos.

### 5.7 Previsto no mês

- **Contas fixas previstas**: soma de **todas** as contas a pagar com vencimento no mês (quitadas ou não, recorrentes ou não).
- **Parcelas previstas**: soma das parcelas (não de meta) com data no mês.
- **Metas previstas**: soma dos lançamentos de meta com data no mês.
- **Comprometido do mês** (para o cálculo diário) = contas fixas previstas + parcelas previstas. As parcelas de metas **não** entram aqui, mas entram no gráfico "Como o mês se divide" e na previsão de 12 meses.

**[Ponto de atenção]** Quitar uma conta a pagar **não recorrente** gera um lançamento sem a marca "fixo". Assim, o valor aparece duas vezes: como conta prevista e como gasto livre. Correção sugerida: marcar como fixo (ou ligar ao compromisso) todo lançamento gerado ao quitar uma conta a pagar, recorrente ou não, e excluí-lo do gasto livre.

### 5.8 Base do mês

Se houver renda declarada, a base é a renda. Senão, se houver teto de gastos, a base é o teto. Senão, não há base.

### 5.9 "Posso gastar hoje"

Só existe se houver base.

- Disponível para gasto livre = base − comprometido do mês.
- Sobra = disponível − gasto livre do mês.
- Dias restantes: no mês atual, (dias do mês − dia de hoje + 1), ou seja, contando hoje, com mínimo 1. Em outro mês, 1.
- Por dia = sobra ÷ dias restantes.

Exemplo: renda 10.000; fixos 4.000; parcelas 1.000; gasto livre até dia 20 de um mês de 30 dias: 3.000. Disponível = 5.000; sobra = 2.000; dias restantes = 11; por dia ≈ 181,82.

### 5.10 Janela de 30 dias

- "A pagar em 30 dias": soma das contas a pagar em aberto com vencimento até hoje + 30 dias, **incluindo as já vencidas**.
- "A receber em 30 dias": o mesmo para contas a receber.
- "Sobra em 30 dias" (previsão) = saldo total + a receber em 30 dias − a pagar em 30 dias.
- "Em atraso": soma das contas a pagar em aberto com vencimento antes de hoje.

### 5.11 Situação de uma conta a pagar / receber

- Quitado: status quitado.
- Vencido: em aberto e vencimento antes de hoje.
- Perto: em aberto e vence em até 7 dias (incluindo hoje).
- Aberto: o resto.

### 5.12 Cartão: em qual fatura cai uma compra

- Fechamento da fatura de uma compra: o dia de fechamento do cartão no mês da compra (limitado ao último dia do mês). Se a compra for **depois** desse dia, a fatura é a que fecha no mês seguinte.
- Exemplo: cartão fecha dia 5. Compra em 3/set cai na fatura que fecha em 5/set. Compra em 6/set cai na que fecha em 5/out.
- Vencimento da fatura: dia de vencimento do cartão. Se o dia de vencimento for **menor ou igual** ao dia de fechamento, o vencimento é no mês seguinte ao fechamento; senão, no mesmo mês. Sempre limitado ao último dia do mês.
- Exemplo: fecha 25, vence 5 → fatura que fecha 25/set vence 5/out. Fecha 1, vence 10 → fecha 1/set, vence 10/set.

### 5.13 Faturas de um cartão

- Cada fatura é identificada pela data de fechamento. Total = compras − estornos/entradas no cartão daquela fatura.
- Pago = soma dos pagamentos de fatura registrados para aquele fechamento (incluindo a parte "rolada" para o rotativo).
- Restante = total − pago, nunca negativo.
- Paga = total praticamente zero ou pago cobre o total (tolerância de meio centavo).
- **Fatura aberta** (a mostrada no cartão): a primeira fatura não paga, em ordem cronológica. Se todas estiverem pagas, mostra a fatura do ciclo atual (a que contém hoje), mesmo vazia.

### 5.14 Limite usado do cartão

Usado = (todas as compras do cartão − estornos − todos os pagamentos de fatura, nunca negativo) + saldo devedor das dívidas ligadas a esse cartão (rotativo). Livre = limite − usado, nunca negativo.

### 5.15 Projeção de quitação de dívida

Com saldo devedor S, juros mensais j e parcela P:

- Se S é zero: quitada.
- Se P é zero: sem previsão ("impossível").
- Senão, mês a mês: devido = S + S × j; pagamento = menor entre P e devido; se o pagamento não cobre nem os juros do mês, é impossível; S = devido − pagamento. Repetir até S zerar, com limite de 600 meses.
- Resultado: número de meses, total pago e juros totais (total pago − saldo inicial).

### 5.16 Metas

- Total da meta = soma dos valores de todos os itens.
- Já pago = soma dos lançamentos gerados pela meta com data até hoje.
- Parcelas a vencer = soma dos lançamentos gerados pela meta com data depois de hoje.
- Ainda sem contratar = total − já pago − parcelas a vencer.

### 5.17 Média de gasto livre

Média do gasto livre dos últimos 3 meses **completos** anteriores ao atual, considerando só os meses que têm pelo menos um lançamento. Zero se nenhum tiver.

### 5.18 Divisão de valor em parcelas

Sempre que um valor é dividido em N parcelas (compra parcelada, item de meta, ditado, edição de grupo):

- Trabalhar em centavos. Cada parcela recebe a divisão inteira; o resto dos centavos vai para a **primeira** parcela.
- Exemplo: 100,00 em 3x → 33,34 + 33,33 + 33,33.
- A primeira parcela fica na data escolhida; cada seguinte no mesmo dia dos meses seguintes, limitado ao último dia do mês (dia 31 vira 30 ou 28/29 quando preciso).
- A descrição de cada uma recebe o sufixo " (k/N)", ex.: "Geladeira (2/10)".
- Todas compartilham um identificador de grupo.

### 5.19 Máscara de valor monetário

Todo campo de dinheiro funciona como caixa registradora: a pessoa digita só números e eles entram como centavos. Digitar 4, 5, 9, 0 mostra 0,04 → 0,45 → 4,59 → 45,90. Zeros à esquerda são ignorados, máximo de 11 dígitos, teclado numérico no celular. Campo vazio vale 0. Ao editar, o campo é preenchido já formatado (ex.: 1.234,56).

Exceção: o campo de juros da dívida (%) é texto livre com vírgula decimal.

### 5.20 Formatos de exibição

- Dinheiro: padrão brasileiro "R$ 1.234,56". Em listas, o prefixo "R$" é omitido e o valor ganha sinal: "− 45,90" (saída, vermelho) ou "+ 1.200,00" (entrada, verde). Transferência sem cor.
- Data curta: "08/09". Data longa: "08/09/2026".
- Mês curto: "set 26". Mês longo: "setembro de 2026".
- Dia da semana abreviado: dom, seg, ter, qua, qui, sex, sáb.
- Iniciais: primeira letra das duas primeiras palavras em maiúsculas (ex.: "Delivery e restaurante" → "DE").

---

## 6. Estrutura, navegação e telas

### 6.0 Estrutura geral e navegação

#### 6.0.1 Telas existentes

Painel, Extrato, Contas (com sub-aba Dívidas), Cartões, Metas (lista e detalhe de uma meta), Previsão (12 meses à frente), Histórico (12 meses para trás) e Ajustes.

#### 6.0.2 Celular (largura menor que 900 px)

- **Topo fixo** ao rolar: selo da marca (quadrado arredondado na cor da marca com "R$" dentro) + título "Freio de Mão"; navegador de mês; indicador de sincronização. Linha divisória embaixo.
- **Barra inferior fixa** com 6 itens, ícone + rótulo: Painel, Extrato, Contas, Cartões, Metas, Ajustes. O item atual fica na cor da marca. Respeita a área segura inferior do iPhone.
- **Botão flutuante principal** (+), grande, canto inferior direito, acima da barra: abre "Novo lançamento".
- **Botão flutuante de microfone**, menor, acima do +: abre "Ditar lançamentos".
- Previsão e Histórico não estão na barra inferior. São acessados pelos links do Painel ("ver histórico", faixa de meses comprometidos) e um pelo outro.
- Espaço inferior no conteúdo para não ficar escondido atrás da barra e dos botões.

#### 6.0.3 Computador (900 px ou mais)

- **Barra lateral fixa** de 214 px com o selo e o título, e a navegação completa com 8 itens: Painel, Extrato, Contas, Cartões, Metas, Previsão, Histórico, Ajustes. Item atual com fundo suave da marca.
- Abaixo da navegação, dois botões: "+ Novo lançamento" (cheio) e "Ditar por voz".
- Barra inferior e botões flutuantes somem. O título some do topo (fica só na barra lateral).
- Conteúdo com largura máxima de 1180 px, centralizado.
- Blocos lado a lado onde indicado (ver cada tela).
- As folhas (formulários) viram janelas centralizadas em vez de subir de baixo.

#### 6.0.4 Navegador de mês

- Pílula com "‹", rótulo do mês (ex.: "set 26") e "›".
- "‹" e "›" mudam o mês selecionado. Tocar no rótulo volta para o mês atual (dica: "Voltar para o mês atual").
- O mês selecionado afeta: Painel, Extrato, Contas nas sub-abas "Do mês" e "Quitadas", e o gasto por categoria em Ajustes. Previsão e Histórico são sempre relativos a hoje.
- Ao criar ou editar um lançamento, o mês selecionado passa a ser o mês daquele lançamento. Atalho de um toque volta para o mês atual.

#### 6.0.5 Regras de navegação

- Trocar de aba rola para o topo.
- Tocar em "Metas" estando já em Metas (dentro de uma meta) volta para a lista de metas.
- Qualquer elemento com destino de aba (links "ver todas", avisos, linhas do painel) leva para aquela aba.
- Tocar em um mês na Previsão abre o Extrato daquele mês.

#### 6.0.6 Folhas (formulários)

Todo formulário abre como folha:

- No celular: sobe de baixo, cantos superiores arredondados, altura máxima de 92% da tela, rolagem interna, com animação curta de subida (desligada com movimento reduzido).
- No computador: janela centralizada, largura máxima 520 px.
- Cabeçalho fixo com o título e botão "✕" para fechar.
- Fecha ao tocar fora (no véu escuro), no "✕" ou apertando Esc.
- Só uma folha aberta por vez: abrir outra fecha a atual.
- Botão principal de ação largo, cor da marca, no fim do formulário. Botão de apagar, quando existe, largo, contornado em vermelho, abaixo do principal.
- Tem papel de diálogo modal para leitores de tela, com o título como rótulo.

#### 6.0.7 Notificação rápida (toast)

- Pílula escura centralizada acima da barra inferior (no computador, perto da base da tela).
- Some sozinha em 2,6 s. Quando tem ação ("desfazer"), fica 5,2 s e mostra a ação sublinhada; tocar executa a ação e fecha.
- Só uma por vez: uma nova substitui a anterior.

#### 6.0.8 Confirmações

Ações destrutivas pedem confirmação do sistema (diálogo "OK / Cancelar") com os textos indicados em cada seção. "Apagar tudo" pede duas confirmações.

---

### 6.1 Painel

A tela inicial. A ordem dos blocos, de cima para baixo, é a seguinte.

#### 6.1.1 Avisos de contas

Aparecem no topo, só para contas **a pagar** em aberto:

- Se houver vencidas: faixa vermelha com "!" — "**N conta(s) vencida(s)**, R$ X em atraso. Toque para resolver." (singular: "1 conta vencida").
- Se houver contas que vencem nos próximos 7 dias: faixa âmbar com ícone de relógio — "**N conta(s) para pagar** nos próximos 7 dias, R$ X." (singular: "1 conta para pagar").
- Tocar em qualquer aviso leva para Contas.

#### 6.1.2 Farol (número principal)

Cartão de destaque com um número grande. Tem quatro modos, avaliados nesta ordem:

**Modo A — "Antes de confiar em qualquer número"**
Quando: há base, o mês selecionado é o atual, e o app ainda não sabe o que sai todo mês (não existe nenhuma conta a pagar cadastrada e nenhum lançamento).
Mostra:
- Rótulo: "Antes de confiar em qualquer número".
- Número: a base (renda).
- Subtítulo: "é o que entra por mês. O painel ainda não sabe o que sai."
- Faixa âmbar: "Sem contas fixas cadastradas e sem gasto lançado, ele dividiria a renda inteira pelos dias que faltam e mostraria um valor que não existe. Cadastre o que sai todo mês primeiro."
- Três botões pequenos: "+ Conta fixa" (abre Nova conta a pagar), "+ Cartão" (abre Novo cartão), "Lançar por voz" (abre Ditado).

**Modo B — "Posso gastar hoje"**
Quando: há base e o mês selecionado é o atual (e o modo A não se aplica).
- Se faltam 5 dias ou menos no mês, o rótulo vira "Ainda cabe até o fim do mês" e o número é a sobra total. Senão, o rótulo é "Posso gastar hoje" e o número é o valor por dia.
- O número nunca aparece negativo (mínimo zero). Fica vermelho se o valor for zero ou negativo, verde se positivo.
- No modo "fim do mês" com sobra positiva, abaixo: "dá R$ X por dia nos N dias que faltam".
- Barra de progresso: gasto livre ÷ disponível (máximo 100%). Verde até 75%, âmbar de 75% a 100%, vermelha a partir de 100%.
- Se sobra positiva: "Sobram **R$ X** livres para os N dias que faltam, depois de tirar contas fixas e parcelas."
- Se sobra zero ou negativa: "Você já passou **R$ X** do que sobrava para o mês. Daqui pra frente, todo gasto está saindo do mês que vem."
- Rodapé em cinza: "Gasto livre até agora: **R$ X** de R$ Y. Total do mês, com fixos e parcelas: **R$ Z**."

**Modo C — "Previsão dos próximos 30 dias"**
Quando: não há base (sem renda e sem teto), mas existem contas cadastradas.
- Rótulo: "Previsão dos próximos 30 dias". Número: sobra em 30 dias (vermelho se negativo, verde se positivo).
- Subtítulo: se negativo, "É o que **falta** para fechar o mês com o que você tem e o que está previsto entrar."; senão, "É o que deve sobrar na conta depois de tudo que está previsto entrar e sair."
- Três colunas: "tenho hoje" (saldo total), "entra" (+ a receber em 30 dias, verde), "sai" (− a pagar em 30 dias, vermelho).
- Rodapé: "Cadastre sua renda em Ajustes para o painel também dizer quanto você pode gastar por dia." + link "Configurar".

**Modo D — "Gasto em {mês}"**
Quando: nenhum dos anteriores (inclui meses que não são o atual).
- Rótulo: "Gasto em setembro de 2026". Número: gasto do mês (vermelho se passou do teto).
- Se há teto: barra gasto ÷ teto (mesmas cores do modo B) e o texto "**R$ X** ainda cabem no limite de R$ Y." ou "Você passou **R$ X** do limite de R$ Y."
- Se não há teto: "Sem renda nem teto definidos." + link "Configurar agora".
- Se é o mês atual e já há gasto: "Ritmo de **R$ X** por dia. Nesse passo, o mês fecha em **R$ Y**." (média = gasto ÷ dia de hoje; projeção = média × dias do mês).

Os links "Configurar" e "Configurar agora" levam para Ajustes, rolam até o campo de teto e dão foco nele.

#### 6.1.3 Lançar em um toque

- Se existem atalhos: bloco "Lançar em um toque" com link "editar" (leva para Ajustes) e até 8 chips. Cada chip mostra o rótulo e o valor, com a borda na cor da categoria. Tocar lança na hora (ver 7.4).
- Se não existem atalhos, mas há sugestões: mesmo título, texto "Estes são os seus gastos mais repetidos. Guarde como atalho e lance com um clique." e até 4 chips "+ {rótulo} {valor}". Tocar cria o atalho e mostra "Atalho criado.".
- Se não há atalhos nem sugestões: o bloco não aparece.
- **Como as sugestões são calculadas**: considerar saídas que não são transferência nem parcela; agrupar pela descrição (ou pelo nome da categoria, se não houver descrição), sem diferenciar maiúsculas; manter só os grupos que aparecem 3 vezes ou mais; ordenar pelos mais frequentes; pegar os 4 primeiros. O valor sugerido é a mediana dos valores do grupo; categoria e forma de pagamento vêm do primeiro lançamento do grupo.

#### 6.1.4 Indicadores

Quatro cartõezinhos (2 colunas no celular, 4 no computador):

- "Tenho na conta": saldo total (vermelho se negativo).
- "A pagar em 30 dias" (vermelho se maior que zero).
- "Sobra em 30 dias" (vermelho se negativo, verde se não).
- "Já gastei no mês": gasto do mês selecionado (vermelho se maior que zero).

#### 6.1.5 Como o mês se divide

Não aparece se não houver nem valor comprometido/gasto nem base.

- Título "Como setembro de 2026 se divide" e, à direita, o total (comprometido + gasto livre).
- Barra horizontal empilhada, mais grossa, com as partes: Contas fixas (cor da marca), Parcelas (âmbar), Metas (cinza), Gasto livre (vermelho) e, se houver base, Sobra (verde; base − total, nunca negativa). A escala é o maior valor entre total e base. Partes com valor zero não aparecem.
- Lista com a mesma legenda: marcador de cor, nome, valor e percentual. O percentual é sobre a base, se houver; senão, sobre o total.
- Texto: com base, "De **R$ base** que entram, **R$ comprometido** saem sozinhos antes de você decidir qualquer coisa. Isso é **N%** do mês."; sem base, "**R$ X** já estão comprometidos neste mês. Cadastre sua renda em Ajustes para ver quanto isso representa do que entra."
- Se algum dos próximos 5 meses tiver valor comprometido: separador e rótulo "Já comprometido nos próximos meses", faixa rolável na horizontal com um cartão por mês (mês curto + valor), e a dica "Toque para ver os 12 meses à frente." Tocar na faixa abre Previsão.

#### 6.1.6 Ritmo do mês

Bloco com título "Ritmo do mês" e link "ver histórico".

Gráfico de linha (sem eixos, altura ~104 px, ocupa toda a largura):

- Linha principal na cor da marca: gasto acumulado dia a dia do mês selecionado, até hoje (se for o mês atual) ou até o fim do mês. Área abaixo com degradê da cor da marca para transparente. Ponto no último dia desenhado.
- Linha tracejada cinza: acumulado do mês anterior, para comparar.
- Linha tracejada vermelha horizontal: o teto de gastos (só se houver teto definido; a renda não entra aqui).
- Três linhas de grade horizontais claras em 25%, 50% e 75%.
- Escala vertical: 110% do maior valor entre o acumulado final, o total do mês anterior e o teto.
- Legenda: "este mês", "mês passado" e "limite" (só se houver teto).
- Se o mês anterior teve gasto até o mesmo dia: "No mesmo ponto do mês passado você tinha gasto **R$ X**. agora está **R$ Y acima**." (vermelho) ou "... **R$ Y abaixo**." (verde).

#### 6.1.7 Para onde foi

Em computador, fica à esquerda em uma grade de duas colunas (a da esquerda um pouco mais larga); no celular, empilhado.

- Título "Para onde foi" e total gasto à direita.
- Até 8 categorias, das maiores para as menores. Para cada uma: nome, valor, percentual sobre o gasto total, e uma barra fina.
- Sem orçamento: barra = percentual sobre o total, na cor da categoria.
- Com orçamento: barra = gasto ÷ orçamento (máximo 100%); cor vermelha se passou, âmbar a partir de 80%, cor da categoria abaixo disso. Linha extra: "passou R$ X do orçamento de R$ Y" ou "restam R$ X de R$ Y".
- Vazio: "Nenhum gasto lançado neste mês." / "Toque no + para registrar o primeiro."

#### 6.1.8 Coluna da direita

- **Faturas abertas** (só se houver cartões): título + link "ver todas". Uma linha por cartão: pastilha com iniciais na cor do cartão, nome, "fecha DD/MM · vence DD/MM" e o total da fatura aberta. Tocar leva para Cartões.
- **Dívidas** (só se houver dívidas): título + "ver todas". Até 4 dívidas: pastilha vermelha com iniciais, nome, "quita em N meses" / "quitada" / "sem previsão de quitação", e o saldo devedor em vermelho. Tocar leva para Contas.
- **Últimos lançamentos**: título + "ver extrato". Os 7 lançamentos mais recentes (por data, depois por criação). Vazio: "Nada lançado ainda." / "Cada gasto anotado é um gasto que você enxerga."

#### 6.1.9 Linha de lançamento (usada em várias telas)

- Pastilha quadrada arredondada com as iniciais da categoria, fundo na cor da categoria a 16% de opacidade e texto na cor cheia.
- Título: descrição (ou nome da categoria, se não houver descrição), cortado com reticências.
- Subtítulo em fonte monoespaçada: "DD/MM · Categoria · Conta ou Cartão".
- Valor à direita com sinal: "+" verde para entrada, "−" vermelho para saída, sem cor para transferência.
- Tocar abre a edição (ou a edição de transferência, se for uma perna de transferência).

---

### 6.2 Extrato

#### 6.2.1 Filtros (bloco no topo)

- Busca: "Buscar por descrição ou categoria". Filtra enquanto digita, com espera de ~260 ms, sem perder o foco nem a posição do cursor.
- Seletor de tipo: "Tudo", "Só saídas", "Só entradas".
- Seletor de categoria: "Todas as categorias" + todas as categorias.
- Seletor de onde: "Todas as contas e cartões" + contas + cartões (estes como "Cartão {nome}").
- Resumo: "N lançado(s)", "saídas R$ X" (vermelho), "entradas R$ Y" (verde), considerando os lançamentos filtrados (as somas incluem transferências).
- Se houver contas previstas: segunda linha com "N previsto(s)", "a pagar R$ X", "a receber R$ Y".
- Os filtros ficam guardados ao trocar de aba e de mês.

#### 6.2.2 Previsto para o mês

Aparece se houver contas **em aberto** com vencimento no mês selecionado que passem nos filtros (tipo: "Só saídas" = a pagar, "Só entradas" = a receber; categoria e busca também se aplicam; o filtro de conta/cartão não se aplica aqui).

- Título "Previsto para setembro de 2026" e, à direita, "ainda não aconteceu".
- Linhas de conta a pagar/receber (ver 6.3.3), ordenadas por vencimento.

#### 6.2.3 Já lançado

- Título "Já lançado".
- Lançamentos do mês que passam em todos os filtros, do mais recente para o mais antigo (desempate: criado por último primeiro).
- Agrupados por dia, com cabeçalho "qua, 16/09/2026" e, à direita, o total de saídas do dia (se houver).
- Vazio: "Nada lançado ainda neste mês." + "As contas acima são previsões. Quando você pagar ou receber, toque no botão e elas viram lançamento aqui." (se houver previstos) ou "Nenhum lançamento em setembro de 2026 com esses filtros."

---

### 6.3 Contas (a pagar e a receber)

#### 6.3.1 Topo (comum às quatro sub-abas)

- Três cartõezinhos: "A pagar em 30 dias" (vermelho se maior que zero), "A receber em 30 dias" (verde), "Em atraso" (vermelho se maior que zero).
- Alternador de sub-abas: "Em aberto", "Do mês", "Quitadas", "Dívidas". A escolha é lembrada.

#### 6.3.2 Sub-abas Em aberto, Do mês e Quitadas

- Botões: "+ Nova conta a pagar ou receber" (cheio, largo) e "Ler boleto" ao lado.
- Lista:
  - **Em aberto**: todas as contas não quitadas, de qualquer mês, ordenadas por vencimento (as vencidas aparecem primeiro).
  - **Do mês**: todas as contas com vencimento no mês selecionado, quitadas ou não, ordenadas por vencimento.
  - **Quitadas**: as quitadas com vencimento no mês selecionado, da mais recente para a mais antiga.
- Vazio: "Nenhuma conta nesta lista." / "Cadastre aluguel, internet, assinatura, boleto: tudo que tem data para vencer."

#### 6.3.3 Linha de conta a pagar / receber

- Pastilha com as iniciais da categoria (tocar abre a edição).
- Corpo (tocar abre a edição): descrição e, abaixo, uma etiqueta de situação e, se for fixa, uma etiqueta "fixa".
- Etiquetas de situação:
  - Quitada: verde, "paga" (a pagar) ou "recebido" (a receber).
  - Vencida: vermelha, "vencida" ou "atrasado".
  - Perto (até 7 dias): âmbar, "vence DD/MM" ou "recebe DD/MM".
  - Aberta: neutra, "vence DD/MM" ou "recebe DD/MM".
- À direita: valor com sinal ("−" vermelho a pagar, "+" verde a receber) e, embaixo, botão "Pagar" / "Recebi" se estiver em aberto, ou a data em que foi quitada.

#### 6.3.4 Sub-aba Dívidas

- Botão "+ Cadastrar dívida".
- Vazio: "Nenhuma dívida cadastrada." / "Aqui é só para dívida que cobra juros: rotativo do cartão, empréstimo, cheque especial, crediário. Conta a pagar comum fica na aba Em aberto e não aparece neste total."
- Um cartão por dívida:
  - Faixa vermelha no nome, nome, botão "editar".
  - "Saldo devedor" em número grande vermelho.
  - Linha: "X% de juros ao mês." (se houver juros) + "Pagando R$ Y por mês." ou "Sem parcela definida."
  - Barra de progresso verde (abatido ÷ saldo inicial) e "R$ X já abatidos de R$ Y".
  - Previsão:
    - Impossível e com parcela: faixa vermelha "A parcela não cobre nem os juros. Do jeito que está, essa dívida nunca acaba."
    - Impossível e sem parcela: faixa vermelha "Defina quanto você paga por mês para ver a previsão de quitação."
    - Com previsão: faixa suave "Quita em **N meses**, pagando R$ X no total. **R$ Y** só de juros."
    - Quitada: faixa suave com "✓" "Quitada."
  - Botão "Registrar pagamento" (só se ainda houver saldo).
  - Histórico com os 8 pagamentos mais recentes: ícone "✓" verde, data longa, "R$ X de juros, R$ Y de abatimento" e o valor pago. Vazio: "Nenhum pagamento registrado."

---

### 6.4 Cartões

- Botão "+ Cadastrar cartão".
- Vazio: "Nenhum cartão cadastrado." / "Cadastre seus cartões com dia de fechamento e vencimento: as compras entram na fatura certa automaticamente."
- Um cartão visual por cartão de crédito (no computador, em grade):
  - Etiqueta retangular na cor do cartão, nome, botão "editar".
  - Rótulo "Fatura que fecha em DD/MM" e, em número grande, o restante (ou o total, se não houver pagamento).
  - Se houve pagamento parcial e ainda falta: "total R$ X, já pago R$ Y".
  - "Vence DD/MM/AAAA, em N dia(s)" ou "Vence DD/MM/AAAA. **Vencida há N dia(s)**" (em vermelho).
  - Se tem limite: barra de uso (âmbar a partir de 70%, vermelha a partir de 90%) e "R$ X usados de R$ Y · R$ Z livres".
  - Botões "Pagar fatura" e "Lançar compra" (abre Novo lançamento já com saída e esse cartão escolhidos).
  - Lista das compras da fatura aberta, da mais recente para a mais antiga, até 12. Se houver mais: "+ N compras a mais, veja no extrato". Vazio: "Fatura vazia." / "Nenhuma compra neste ciclo."

---

### 6.5 Metas

#### 6.5.1 Lista de metas

- Botão "+ Nova meta".
- Vazio: "Nenhuma meta ainda." / "Uma meta é um projeto com teto próprio: a compra do apartamento, a reforma, a viagem. Você lista tudo que faz parte e o painel avisa quando a soma encosta no limite."
- Um cartão por meta (tocar abre a meta):
  - Etiqueta na cor da meta, nome, "N itens".
  - Total dos itens em número grande e "de um teto de R$ X".
  - Barra total ÷ teto: verde, âmbar a partir de 85%, vermelha se passou.
  - Texto: "Passou R$ X do teto." (vermelho) / "Cabem mais R$ X." / "Sem teto definido.", seguido de " Já pago: R$ Y."

#### 6.5.2 Meta aberta

- Botões no topo: "‹ Todas as metas" e "Editar meta".
- Farol: rótulo com o nome da meta, número grande com o total (vermelho se passou do teto), "somados os N itens da lista".
- Se tem teto: barra e "Você passou **R$ X** do teto de R$ Y. Corte ou aumente o teto." ou "Ainda cabem **R$ X** dentro do teto de R$ Y."
- Observação da meta em cinza, se houver.
- Três cartõezinhos: "Já pago", "Parcelas a vencer" (vermelho se maior que zero), "Ainda sem contratar".
- Botão "+ Adicionar item".
- Vazio: "Lista vazia." / "Adicione os itens um a um, ou apague esta meta e crie outra a partir de um modelo pronto."
- Itens agrupados por etapa, na ordem em que cada etapa aparece pela primeira vez. Cada grupo é um bloco com o nome da etapa e a soma à direita. Itens sem etapa ficam em "Sem grupo".
- Linha de item:
  - Miniatura da primeira foto, se houver; senão, pastilha com iniciais na cor da meta.
  - Nome do item.
  - Abaixo: etiqueta de situação (Planejado neutra, Orçado âmbar, Contratado âmbar, Pago verde) e, se contratado ou pago, a forma: "10x de R$ X no cartão Nubank" ou "à vista no Conta corrente" (a forma aparece como: "cartão {nome}", "boleto", "carnê", ou o nome da conta; "dinheiro" se não achar a conta). Se tiver mais de uma foto, etiqueta "N fotos".
  - Valor à direita ou "definir" em cinza, se o valor for zero.
  - Tocar abre a edição do item.

#### 6.5.3 Modelos prontos de meta

Ao criar uma meta, dá para começar de um modelo. Os itens entram com valor zero, situação "Planejado", pagamento à vista na primeira conta, primeira data hoje. O nome da meta não é preenchido pelo modelo (a pessoa digita); o nome interno de cada modelo hoje não é usado.

**Compra de imóvel** (nome interno: "Compra do apartamento"), 13 itens:
- Aquisição: Entrada / sinal; ITBI; Escritura em cartório de notas; Registro do imóvel; Certidões e documentação; Avaliação e laudo do banco; Taxas do financiamento; Corretagem; Seguro do imóvel.
- Mudança: Frete da mudança; Caixas e embalagem; Limpeza pós-obra; Taxa de mudança no condomínio.

**Reforma completa** (nome interno: "Reforma do apartamento"), 67 itens:
- Projeto: Arquiteto e projeto executivo; ART / RRT; Projeto elétrico e hidráulico.
- Demolição e alvenaria: Demolição; Remoção de entulho; Alvenaria e paredes; Contrapiso; Reboco e emboço.
- Hidráulica: Tubulação e ramais; Registros e acabamentos; Vaso sanitário; Caixa acoplada e assento; Cuba e pia; Torneiras; Chuveiro e ducha; Aquecedor.
- Elétrica: Fiação; Quadro de distribuição; Tomadas e interruptores; Pontos de luz; Infra de ar-condicionado; Aparelhos de ar-condicionado.
- Revestimentos: Piso (material); Piso (mão de obra); Argamassa e rejunte; Rodapé; Porcelanato de parede; Bancadas em granito ou quartzo; Soleiras e peitoris.
- Forro e gesso: Forro de gesso; Sanca e molduras.
- Pintura: Massa corrida; Tinta; Mão de obra de pintura.
- Esquadrias: Portas internas; Porta de entrada; Janelas; Box do banheiro; Fechaduras e ferragens; Espelhos.
- Marcenaria: Cozinha planejada; Dormitório planejado; Home e rack; Gabinete do banheiro; Closet.
- Iluminação: Spots e trilhos; Luminárias e pendentes; Fita de LED; Lâmpadas.
- Eletrodomésticos: Cooktop; Forno; Coifa; Geladeira; Máquina de lavar; Micro-ondas.
- Mobiliário: Sofá; Mesa de jantar e cadeiras; Cama e colchão; Cortinas e persianas; Tapetes.
- Mão de obra: Pedreiro; Ajudante; Eletricista; Encanador; Gesseiro; Marido de aluguel e ajustes.
- Reserva: Reserva para imprevistos.

**Imóvel + reforma**: os dois modelos juntos (80 itens).

#### 6.5.4 Lançamentos gerados por item de meta

Sempre que um item é salvo:

1. Apagar todos os lançamentos gerados anteriormente por esse item.
2. Se a situação for "Contratado" ou "Pago" e o valor for maior que zero, gerar os lançamentos:
   - Categoria "Projeto · {nome da meta}" (criada se não existir).
   - N parcelas (N = número de parcelas do pagamento, mínimo 1), divididas conforme 5.18, a partir da data da primeira parcela.
   - Descrição: nome do item, com " (k/N)" quando N maior que 1.
   - Se a forma for cartão e houver cartão escolhido: lançamentos no cartão (entram nas faturas certas). Senão: lançamentos na conta escolhida (ou na primeira conta).
   - Ficam ligados à meta e ao item.
3. Se for "Planejado" ou "Orçado", nenhum lançamento existe.

Consequências: as parcelas aparecem no Extrato, no cartão, em "Metas" dentro de "Como o mês se divide" e na Previsão. Não entram no "Posso gastar hoje".

**[Ponto de atenção]** Um lançamento gerado por meta pode ser editado ou apagado pelo Extrato, mas será recriado do zero na próxima vez que o item for salvo. Sugestão: na nova aplicação, bloquear a edição desses lançamentos pelo extrato ou mostrar o aviso "Este lançamento vem da meta X. Edite pelo item."

---

### 6.6 Previsão (12 meses à frente)

- Botão "‹ Painel" e rótulo "12 meses à frente".
- Farol: "Já comprometido nos próximos 12 meses", número grande com a soma do comprometido dos 12 meses (mês atual incluído) e o texto "contas fixas, parcelas em aberto e parcelas de metas, somando tudo que já está decidido."
- Mês mais apertado (menor valor livre):
  - Se o livre for negativo: faixa vermelha "Em **set 26** o comprometido passa o que entra em **R$ X**."
  - Senão: "Mês mais apertado: **set 26**, sobrando R$ X para o dia a dia."
- Se não houver renda: faixa âmbar "Sem renda cadastrada, a projeção só mostra o que sai. Preencha em Ajustes para ver o que sobra."

**Cálculo por mês** (mês atual e os 11 seguintes):

- Entra:
  - Mês atual: o maior entre renda declarada e entrada real do mês, somado às contas a receber projetadas.
  - Meses futuros: renda declarada + contas a receber projetadas.
- Contas fixas:
  - Mês atual: contas a pagar previstas do mês (5.7).
  - Meses futuros: contas a pagar projetadas.
- **Conta projetada** para um mês e uma direção: soma das contas que já existem com vencimento naquele mês + para cada série mensal que **não** tem ocorrência naquele mês e cuja última ocorrência é anterior a ele, o valor da última ocorrência (ou seja, assume que a conta fixa continua).
- Parcelas: parcelas previstas do mês. Metas: parcelas de meta do mês.
- Comprometido = contas fixas + parcelas + metas. Livre = entra − comprometido.
- Gasto livre: no mês atual, o real; nos futuros, a média de gasto livre (5.17).
- Saldo projetado: começa no saldo atual das contas; para cada mês futuro, saldo = saldo anterior + entra − comprometido − gasto livre médio. O mês atual não altera o saldo.

**Linha de cada mês** (tocar abre o Extrato daquele mês):

- Mês curto, etiqueta "agora" no mês atual, e à direita "R$ X livres" (verde) ou "-R$ X livres" (vermelho).
- Duas barras finas: entra (verde) e comprometido (vermelho), ambas na mesma escala (o maior valor de entra/comprometido entre os 12 meses).
- "entra R$ X · comprometido R$ Y (fixos Z) (parcelas W) (metas V)", mostrando só as partes maiores que zero.
- Nos meses futuros, se houver média de gasto livre: "no seu ritmo de R$ X por mês de gasto livre, o saldo em contas fecha em **R$ Y**" (verde ou vermelho).

Rodapé: "A projeção de saldo usa a média do seu gasto livre dos últimos 3 meses. Ela muda conforme você lança." ou, sem média, "Depois de um mês inteiro lançando, aparece aqui a projeção de saldo usando o seu ritmo real de gasto." Seguido de " Toque em um mês para ver os lançamentos dele."

---

### 6.7 Histórico (12 meses para trás)

- Bloco "Últimos 12 meses" com link "ver os 12 meses à frente" (vai para Previsão).
- Se nenhum mês teve movimento: "Ainda não há histórico." / "Depois de dois ou três meses lançando, esta tela mostra sua tendência."
- Gráfico de colunas agrupadas, do mês de 11 meses atrás até o atual: para cada mês, uma coluna vermelha (gasto) e uma verde (entrada), na mesma escala; rótulo com o mês abreviado embaixo; o mês atual com contorno tracejado. Rolagem horizontal no celular (largura mínima de 540 px). Legenda "saídas" e "entradas".
- Cartõezinhos: "Média por mês" (média do gasto só entre os meses com movimento). Se houver 2 meses ou mais com movimento: "Mês mais caro" ("set 26 · 12.345,00", vermelho) e "Mês mais leve" (verde).
- Bloco "{mês atual por extenso} contra a média dos 3 meses anteriores":
  - Para cada categoria que teve gasto no mês atual ou nos 3 anteriores: média = soma dos 3 anteriores ÷ 3; diferença = atual − média; percentual = diferença ÷ média (se a média for zero e houve gasto agora, 100%).
  - Ordenar pela maior diferença absoluta e mostrar até 10.
  - Linha: pastilha, nome, "média R$ X, agora R$ Y" e, à direita, "+N%" em vermelho (subiu) ou "−N%" em verde (caiu ou igual).
  - Vazio: "Sem base de comparação ainda."

---

### 6.8 Ajustes

Blocos, em ordem:

**1. Quanto entra e quanto pode sair**
- Texto: "Com a renda preenchida, o painel calcula sozinho quanto sobra por dia depois das contas fixas e das parcelas."
- Campo "Renda do mês" + botão "Salvar" (cheio) → toast "Renda salva."
- Campo "Teto de gastos (se preferir um limite fixo)" + botão "Salvar" → toast "Teto do mês definido."
- Ambos com máscara de dinheiro e preenchidos com o valor atual.

**2. Atalhos de um toque**
- Link "+ novo". Lista de atalhos: pastilha com iniciais do rótulo na cor da categoria, rótulo, nome da categoria, valor. Tocar edita.
- Vazio: "Nenhum atalho ainda." / "Um atalho lança o gasto com um clique, sem abrir formulário. Bom para almoço, transporte, café."

**3. Aparência**
- Alternador "Claro", "Escuro", "Do sistema". Aplica na hora e fica salvo nos dados (vale em todos os aparelhos).

**4. Regras de categorização**
- Link "+ nova". Cada regra: pastilha "→" na cor da categoria, 'contém "IFOOD"', "vira Delivery e restaurante", "editar".
- Vazio: "Nenhuma regra ainda." / "Elas são criadas sozinhas quando você importa um extrato e escolhe a categoria de cada linha."

**5. Categorias e orçamentos**
- Link "+ nova". Duas seções com cabeçalho: "Saídas" e "Entradas".
- Cada categoria: pastilha, nome, "orçamento R$ X" ou "sem orçamento", seguido de " · set 26: R$ Y" (total lançado na categoria no mês selecionado, sem transferências), e "editar".

**6. Contas e carteiras**
- Link "+ nova". Cada conta: pastilha, nome, "saldo inicial R$ X" e, à direita, o saldo atual (vermelho se negativo).

**7. Cartões**
- Link "+ novo". Cada cartão: pastilha, nome, "fecha dia X · vence dia Y · limite R$ Z", "editar".
- Vazio: "Nenhum cartão." / "Cadastre para acompanhar faturas, limite e compras parceladas."

**8. Seus dados**
- Texto: "N lançamentos, N contas, N metas. Tudo fica salvo neste painel: abra o mesmo link no celular e no computador." e, se houver fotos, " As fotos das metas ocupam cerca de N KB."
- Se as fotos passarem de ~3,5 MB: faixa âmbar "As fotos estão pesadas. Se a sincronização começar a falhar, remova algumas das metas antigas."
- Botões: "Transferência entre contas", "Importar extrato do banco", "Baixar CSV", "Backup (JSON)", "Restaurar backup".
- Botão vermelho: "Apagar tudo".

---

## 7. Formulários e fluxos (folhas)

Convenções que valem para todos:

- Campos com rótulo pequeno em maiúsculas, espaçado, em fonte monoespaçada.
- Campos de dinheiro com a máscara de 5.19.
- Validação só ao tocar no botão principal; o erro aparece como toast e a folha continua aberta.
- Ao salvar com sucesso: fecha a folha, salva os dados, redesenha a tela e mostra o toast de sucesso.
- Seletores de "onde" (conta ou cartão) são agrupados em "Contas" e "Cartões de crédito".

### 7.1 Novo lançamento / Editar lançamento

Abre pelo botão +, "+ Novo lançamento", "Lançar compra" de um cartão (já com saída e o cartão) ou tocando em um lançamento (edição).

Campos, em ordem:

1. Se for edição de uma parcela: texto "Parcela 3 de 10. Alterar aqui muda só esta parcela."
2. Alternador de tipo: "Saída", "Entrada" e, **só em novo**, "Transfer.". Tocar em "Transfer." fecha esta folha e abre a de Transferência.
3. "Valor" em campo grande (fonte monoespaçada, ~30 px, alinhado à direita). Recebe foco automaticamente ao abrir.
4. Só quando o tipo é Entrada: caixa "É estorno ou reembolso de um gasto". Marcada, o seletor de categoria passa a listar categorias de **saída** e o rótulo muda para "Categoria do gasto que voltou".
5. "Categoria": categorias do tipo atual. Trocar o tipo ou marcar/desmarcar estorno recarrega a lista e seleciona a primeira.
6. "Pago com": contas e, **só para saída**, cartões. Padrão: primeira conta (ou o cartão, se veio de "Lançar compra").
7. Só em novo, só para saída e só quando "Pago com" é um cartão: "Parcelas" de 1x a 24x. Com 2x ou mais e valor informado, dica: "10x de R$ X, lançadas uma por mês a partir da data escolhida." Trocar para conta volta para 1x e esconde o campo.
8. "Data" (padrão hoje) e "Descrição" (opcional, "opcional") lado a lado.
9. Só em novo: caixa "Guardar como atalho de um toque".
10. Botão "Lançar" (novo) ou "Salvar alterações" (edição).
11. Só em edição: "Apagar lançamento" (vermelho).
12. Só em edição de parcela: "Editar as N parcelas de uma vez" e "Apagar as N parcelas" (vermelho).

Validação: valor maior que zero, senão foca o valor e mostra "Informe um valor maior que zero."

Ao salvar um **novo**:

- Se é cartão e mais de uma parcela: cria as N parcelas no cartão (5.18). A descrição base é a digitada ou o nome da categoria.
- Senão: cria um lançamento. Se "Pago com" é conta, fica na conta; se é cartão, fica no cartão.
- Se "Guardar como atalho" estiver marcado, for saída e parcela única: cria um atalho com rótulo = descrição (ou nome da categoria), o valor, a categoria e o mesmo "pago com".
- O mês selecionado vira o mês do (primeiro) lançamento.
- Toast com ação "desfazer": "Saída de R$ X registrada." / "Entrada de R$ X registrada." / "10x de R$ X lançadas." (valor da última parcela). "desfazer" apaga tudo que foi criado e mostra "Desfeito." (o atalho criado junto não é desfeito).

Ao salvar uma **edição**: substitui os campos (tipo, data, descrição, categoria, conta/cartão, valor, estorno), mantém as marcas originais (fixo, transferência, grupo de parcela, meta). Muda só aquele lançamento. O mês selecionado vira o mês do lançamento. Toast "Lançamento atualizado."

Apagar: confirmação "Apagar este lançamento?" → toast "Lançamento apagado."
Apagar parcelas: confirmação "Apagar todas as N parcelas desta compra?" → apaga todas do grupo → "Parcelas apagadas."

### 7.2 Editar compra parcelada (grupo)

Abre por "Editar as N parcelas de uma vez".

- Texto: "Mudar aqui refaz as parcelas inteiras, apagando as antigas e criando as novas nas datas certas."
- "Valor total da compra" (preenchido com a soma das parcelas).
- "Parcelas" (1x a 48x, preenchido com a quantidade atual) e "Primeira em" (data da parcela 1).
- "Categoria" (saídas), "Pago com" (contas e cartões), "Descrição" (a original sem o sufixo "(k/N)").
- Dica ao vivo: "10x de R$ X."
- Botão "Refazer as parcelas": valida valor ("Informe o valor total."), apaga todas as parcelas do grupo e cria as novas com o mesmo identificador de grupo. Toast "Parcelas refeitas: 10x de R$ X."
- Se o grupo não for encontrado: "Não encontrei as parcelas dessa compra."

### 7.3 Transferência entre contas

Abre por "Transfer." no novo lançamento, "Transferência entre contas" em Ajustes, ou tocando em uma perna de transferência.

- Texto: "Dinheiro que muda de lugar, não some. Serve para saque, transferência entre suas contas e Pix para você mesmo. Não conta como gasto."
- "Valor" grande (foco automático).
- "Sai de" e "Entra em" (só contas; padrão: primeira e segunda conta).
- "Data" e "Descrição" ("Saque, reserva…"; padrão "Transferência").
- "Registrar" (novo) ou "Salvar" (edição); "Apagar transferência" na edição.

Validações: "Informe o valor."; "Escolha duas contas diferentes."
Ao salvar: cria (ou recria, na edição) duas pernas ligadas: uma saída na conta de origem (categoria "Transferência" de saída) e uma entrada na conta de destino (categoria "Transferência" de entrada), ambas marcadas como transferência. Toast "Transferência registrada."
Apagar: "Apagar esta transferência dos dois lados?" → apaga as duas pernas → "Transferência apagada."

### 7.4 Atalho de um toque (lançar)

Tocar em um chip de atalho no Painel:

- Cria uma saída com data de hoje, o valor, a descrição = rótulo, a categoria e a conta/cartão do atalho.
- Volta o mês selecionado para o atual.
- Toast com "desfazer": "Almoço: R$ 35,00 lançado." → desfazer apaga e mostra "Desfeito."

### 7.5 Novo / Editar atalho

- "Nome do atalho" ("Almoço"), "Valor" grande, "Categoria" (só saídas), "Pago com" (contas e cartões).
- "Salvar"; na edição, "Apagar atalho" (sem confirmação → "Atalho apagado.").
- Validações: "Dê um nome ao atalho."; "Informe o valor."
- Toast "Atalho salvo."

### 7.6 Nova conta / Editar conta (a pagar ou a receber)

Abre por "+ Nova conta a pagar ou receber", "+ Conta fixa" no Painel, tocando em uma conta, ou após ler um boleto (já preenchida).

- Alternador "A pagar" / "A receber". Trocar recarrega as categorias (saídas ou entradas).
- "Descrição" ("Aluguel, internet, fatura…").
- "Valor" e "Vencimento" lado a lado.
- "Categoria".
- Caixa "Repete todo mês (ao quitar, já cria a do mês seguinte)". Na prática, as próximas ocorrências são criadas até dois meses à frente (4.4).
- "Cadastrar" (novo) ou "Salvar" (edição); "Apagar" na edição.

Validações: "Dê um nome para a conta."; "Informe o valor."
Ao salvar: o dia do mês da série vira o dia do vencimento; se for mensal e não tiver série, a própria conta inicia a série; a conta associada é a original ou a primeira conta. Na edição de uma conta mensal, propaga para as próximas em aberto (4.5). Se for mensal, roda a geração de recorrentes. Toast "Conta salva."
Apagar: "Apagar esta conta?" → apaga só esta ocorrência → "Conta apagada."

### 7.7 Registrar pagamento / recebimento (quitar)

Abre pelo botão "Pagar" ou "Recebi" de uma conta.

- Título "Registrar pagamento" ou "Registrar recebimento".
- Texto: "{descrição}, vencimento DD/MM/AAAA".
- "Valor pago" / "Valor recebido" grande, preenchido com o valor da conta (pode ser alterado).
- "Data" (hoje) e "Saiu de" / "Entrou em" (contas; cartões só quando é a pagar). Padrão: a conta associada.
- Botão "Confirmar".

Ao confirmar (valida "Informe o valor."):
- Cria um lançamento de saída (a pagar) ou entrada (a receber) com o valor informado, a data, a descrição e a categoria da conta, na conta ou cartão escolhido. Marca como fixo se a conta for mensal.
- Marca a conta como quitada, com a data e o lançamento gerado.
- Se for mensal, roda a geração de recorrentes.
- Toast "Pagamento registrado." ou "Recebimento registrado."

Observação: não existe "desquitar". **[Ponto de atenção]** Sugestão para a nova aplicação: permitir desfazer a quitação (volta para aberto e apaga o lançamento gerado).

### 7.8 Pagar fatura

Abre por "Pagar fatura" em um cartão. Se não houver fatura em aberto: toast "Nenhuma fatura em aberto neste cartão." e não abre.

- Título "Pagar fatura · {cartão}".
- "Fatura": lista das faturas não pagas, "fecha DD/MM · vence DD/MM · falta R$ X"; a mais antiga vem selecionada. Abaixo, o resumo: "Total R$ X, já pago R$ Y, falta R$ Z."
- "Valor pago", preenchido com o restante da fatura escolhida (trocar de fatura preenche de novo).
- "Data do pagamento" (hoje) e "Saiu de" (só contas; padrão a conta que paga a fatura).
- Bloco de pagamento parcial, que aparece quando o valor digitado é menor que o restante:
  - Faixa âmbar "Faltam **R$ X** desta fatura."
  - Alternador "Resto vira rotativo" (padrão) / "Pago o resto depois".
  - Dica: rotativo → "O que faltou entra como dívida de rotativo do cartão, rendendo juros até você quitar. A fatura fica fechada."; depois → "A fatura continua em aberto com R$ X. Nada vira dívida agora."
- Texto fixo: "O pagamento sai do saldo da conta, mas não conta como gasto novo: as compras já foram contadas quando aconteceram."
- Botão "Confirmar pagamento".

Ao confirmar (valida "Escolha a fatura." e "Informe o valor pago."):
1. Cria um lançamento de saída na conta escolhida, descrição "Fatura {cartão} (DD/MM)", categoria "Pagamento de fatura", **marcado como transferência** (reduz o saldo da conta, mas não é gasto).
2. Registra um pagamento de fatura com o valor efetivamente usado (o menor entre o pago e o restante).
3. Se faltou dinheiro:
   - "Resto vira rotativo": encontra (ou cria) a dívida de rotativo desse cartão ("Rotativo {cartão}", tipo rotativo, juros padrão 14,9% ao mês, parcela 0, conta que paga a fatura); soma o que faltou ao saldo da dívida; registra a rolagem; registra um pagamento de fatura "rolado" com o valor que faltou (a fatura fica quitada). Toast "R$ X foram para o rotativo. Confira os juros em Contas, aba Dívidas."
   - "Pago o resto depois": a fatura continua em aberto. Toast "Pagamento parcial registrado. Faltam R$ X nesta fatura."
4. Se pagou tudo: toast "Fatura quitada."

### 7.9 Nova dívida / Editar dívida

- "Nome" ("Empréstimo Caixa, rotativo Nubank…").
- "Tipo": Empréstimo, Rotativo do cartão, Cheque especial, Crediário ou carnê, Outra.
- "Saldo devedor hoje".
- "Juros ao mês (%)" (texto com vírgula) e "Parcela mensal" lado a lado.
- Texto: "Com juros e parcela preenchidos, o painel calcula em quantos meses isso acaba e quanto você vai pagar de juros no caminho."
- "Salvar"; na edição, "Apagar dívida".
- Validação: "Dê um nome à dívida." Toast "Dívida salva."
- Apagar: "Apagar esta dívida e seu histórico de pagamentos?" → "Dívida apagada."
- Observação: editar o saldo devedor muda o saldo inicial; os abatimentos já registrados continuam descontando dele.

### 7.10 Registrar pagamento de dívida

- Título "Pagamento · {dívida}".
- Texto: "Saldo devedor: **R$ X**. Juros deste mês: **R$ Y**." (juros = saldo × taxa; a segunda frase só aparece se houver juros).
- "Valor pago" grande, preenchido com a parcela mensal.
- "Data" e "Saiu de" (só contas).
- "Quanto disso foi juros", preenchido com os juros do mês.
- Texto: "O que não for juros abate o saldo devedor. O pagamento entra no extrato como saída da conta."
- Botão "Registrar pagamento".

Ao confirmar (valida "Informe o valor pago."; se os juros forem maiores que o valor, ficam iguais ao valor):
- Cria uma saída na conta, descrição "Pagamento {dívida}", categoria "Dívidas e juros", marcada como fixo.
- Registra o pagamento na dívida com juros e abatimento (valor − juros).
- Toast "Pagamento registrado."

### 7.11 Nova meta / Editar meta

- "Nome da meta" ("Reforma do apartamento").
- "Teto de orçamento".
- "Observação" (texto longo, "opcional").
- Só em nova: "Começar de um modelo" com chips "Em branco" (padrão), "Compra de imóvel", "Reforma completa", "Imóvel + reforma". Ao escolher um modelo: "Entra com N itens zerados, agrupados por etapa. Você edita, apaga e acrescenta o que quiser."
- "Cor": 12 quadradinhos coloridos (paleta 11.3); o escolhido fica marcado. Padrão: próxima cor da paleta.
- "Criar meta" (nova) ou "Salvar" (edição); "Apagar meta" na edição.

Validação: "Dê um nome à meta."
Nova: cria com os itens do modelo e **abre a meta criada** na hora. Toast "Meta salva."
Apagar: "Apagar a meta {nome}, seus itens e os lançamentos gerados por ela?" → apaga meta, itens e lançamentos, volta para a lista → "Meta apagada."

### 7.12 Novo item / Editar item de meta

- Título: "Novo item" ou o nome do item.
- "Item" ("Porcelanato da sala").
- "Valor" e "Etapa" lado a lado. A etapa é texto livre com sugestões das etapas já existentes na meta ("Revestimentos"); em novo, vem com a primeira etapa da meta.
- "Situação": Planejado, Orçado, Contratado, Pago.
- Bloco de pagamento, **só visível em Contratado ou Pago**:
  - "Como vai pagar": À vista (conta ou Pix), Cartão de crédito, Boleto, Carnê.
  - "Parcelas" (1x a 48x) e "Primeira em" (data).
  - "Cartão" (só para cartão) ou "Sai de" (contas, para as outras formas).
  - Dica ao vivo: sem valor, "Informe o valor para gerar as parcelas."; 1x, "Uma saída de R$ X no extrato."; várias, "10x de R$ X, uma por mês, entrando no extrato e no comprometido dos próximos meses."; cartão sem cartões cadastrados, "Nenhum cartão cadastrado ainda. Cadastre em Cartões ou escolha outra forma."
- "Observação" ("loja, contato, medida, prazo de entrega").
- "Fotos de referência": galeria de miniaturas quadradas (78 px) com botão "✕" no canto para remover; botão "Adicionar foto" (várias de uma vez, só imagens). Texto: "As fotos ficam guardadas dentro do painel e são reduzidas automaticamente." Durante o processamento: "Reduzindo…"; depois: "N foto(s) neste item."; erro: "Não consegui ler alguma dessas imagens."
- "Adicionar" (novo) ou "Salvar"; "Remover item" na edição.

Regras de foto: no máximo 6 por seleção; ignora arquivos acima de 25 MB; reduz para no máximo 900 px no lado maior e salva como JPEG com qualidade ~62%.

Ao salvar (valida "Dê um nome ao item."):
- Se a meta tem teto e a soma dos outros itens + este valor passa do teto: confirmação "Com este item a meta passa R$ X do teto de R$ Y. Quer registrar mesmo assim?"
- Etapa vazia vira "Sem grupo".
- Salva o item e gera/regera os lançamentos (6.5.4).
- Toast "Item adicionado." ou "Item salvo."
Remover: "Remover {item} da meta?" → apaga item e seus lançamentos → "Item removido."

### 7.13 Nova categoria / Editar categoria

- "Nome".
- Só em nova: alternador "Saída" / "Entrada" (o tipo não muda depois).
- "Orçamento do mês (opcional)".
- "Cor" (paleta; padrão aleatória).
- "Salvar"; na edição, "Apagar categoria".
- Validação: "Dê um nome à categoria." Toast "Categoria salva."
- Apagar: se houver lançamentos na categoria, bloqueia com "Esta categoria tem N lançamentos. Renomeie em vez de apagar."; senão, "Apagar a categoria {nome}?" → "Categoria apagada."

### 7.14 Nova conta / Editar conta (carteira)

- "Nome" ("Nubank, Caixa, Dinheiro…").
- "Saldo de hoje" + texto "Este é o ponto de partida. Os lançamentos somam e subtraem daqui."
- "Salvar"; na edição, "Apagar conta" (sem confirmação).
- Validação: "Dê um nome à conta." Toast "Conta salva." Nova conta: tipo corrente, cor aleatória.
- Apagar: bloqueia se for a única ("Você precisa de pelo menos uma conta.") ou se tiver lançamentos ("Esta conta tem N lançamentos e não pode ser apagada."). Senão, "Conta apagada."
- **[Ponto de atenção]** Hoje não verifica se há contas a pagar, atalhos ou cartões apontando para essa conta. Sugestão: bloquear ou reatribuir.

### 7.15 Novo cartão / Editar cartão

- "Nome do cartão" ("Nubank, Itaú, Inter…"), "Limite".
- "Fecha" e "Vence": seletores "dia 1" a "dia 31" (padrão fecha 1, vence 10).
- "Fatura paga por": contas.
- "Cor".
- "Salvar"; na edição, "Apagar cartão" (sem confirmação).
- Validação: "Dê um nome ao cartão." Toast "Cartão salvo."
- Apagar: bloqueia se houver compras ("Este cartão tem N compras e não pode ser apagado."). Senão, "Cartão apagado."

### 7.16 Nova regra / Editar regra de categorização

- Texto: "Quando a descrição de um lançamento importado contiver este texto, a categoria abaixo é sugerida."
- "Se a descrição contiver" ("IFOOD").
- "Usar a categoria": todas, com " (entrada)" nas de entrada.
- "Salvar"; na edição, "Apagar regra" (sem confirmação).
- Validação: "Escreva o texto que deve ser procurado." Toasts "Regra salva." / "Regra apagada."

---

## 8. Entradas inteligentes

### 8.1 Ditado de lançamentos (voz e texto livre)

Abre pelo botão flutuante de microfone, "Ditar por voz" (computador) ou "Lançar por voz" (Painel).

#### 8.1.1 Tela

- Título "Ditar lançamentos".
- Texto: "Fale ou escreva do seu jeito. Vale mais de um lançamento de uma vez, separando por ponto ou por "e depois"."
- Se o navegador suporta reconhecimento de voz: botão grande "Tocar para falar" com uma bolinha. Ao tocar: fica vermelho, bolinha pulsando, texto "Ouvindo, toque para parar". Tocar de novo para.
- Se não suporta: faixa âmbar "Este navegador não deixa ditar por voz aqui. Use o microfone do teclado e dite direto no campo abaixo."
- Campo "O que aconteceu" (texto longo), exemplo: "gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel". Dica: "No celular, o microfone do teclado dita aqui dentro e funciona sempre."
- Botões "Entender" (cheio) e "Ler boleto" (abre a folha de boleto).
- Área de propostas, abaixo.

#### 8.1.2 Reconhecimento de voz

- Idioma português do Brasil, contínuo, com resultados parciais: o texto vai aparecendo no campo enquanto a pessoa fala, somado ao que já estava escrito.
- Erros:
  - Permissão negada ou sem microfone: troca o botão pela faixa "O navegador não entrega o microfone para páginas embutidas como esta, mesmo com o site já autorizado. Não é permissão sua, é regra do navegador e não dá para contornar por aqui. **Use o microfone do teclado** e dite no campo abaixo: o resultado é o mesmo." (Na nova aplicação, que não será embutida, a mensagem pode ser simplificada para um pedido de permissão.)
  - Sem fala: "Não ouvi nada, toque e fale de novo".
  - Outros: "Não consegui ouvir, escreva abaixo".
  - Falha ao abrir: toast "Não consegui abrir o microfone."
- "Entender" para a escuta antes de interpretar.

#### 8.1.3 Como o texto é interpretado

1. **Quebrar em frases**: separar por "e também", "e depois", ponto e vírgula, ponto final, e por " e " quando vem seguido de um verbo de lançamento (gastei, paguei, comprei, torrei, recebi, entrou, ganhei, saquei, transferi, estornaram, devolveram). Descartar pedaços com 2 caracteres ou menos.
2. Para cada frase (comparando sem acentos e em minúsculas):
   - **Parcelas**: "em 10x", "em 10 vezes", "em 10 parcelas", "10x", "10 vezes", "parcelado em 10". Válido de 2 a 48; fora disso vale 1.
   - **Data**: "hoje"; "ontem" (−1 dia); "anteontem" (−2); "semana passada" (−7); "15/09" ou "15/09/26" ou "15/09/2026" (ano de 2 dígitos vira 20xx; sem ano, ano atual); "dia 15" (no mês atual, limitado ao último dia). Sem data: hoje.
   - Retirar o trecho de parcelas e de data antes de procurar o valor.
   - **Valor**, nesta prioridade: "2 mil", "2 mil e 500", "1,5 mil" (multiplica por mil e soma o resto); "R$ 45,90"; qualquer número com vírgula decimal; número seguido de "reais", "real", "conto", "contos" ou "pila"; por último, o primeiro número da frase. Ponto como separador de milhar é entendido ("1.200"). **Frase sem valor é ignorada.**
   - **Tipo**:
     - Transferência se tiver: transferi, saquei, saque, "tirei da/do", "passei da/do".
     - Senão, estorno (entrada que abate gasto) se tiver algo como estorn…, devolv…, reembols…, cancelaram.
     - Senão, entrada se tiver recebi, entrou, ganhei, caiu, creditou, pagaram, e não tiver verbo de saída.
     - Senão, saída (gastei, paguei, comprei, torrei, saiu, debitou, debitado, ou nenhum verbo).
   - **Onde**: se o nome de um cartão (com mais de 2 letras) aparecer na frase, é esse cartão; senão, o nome de uma conta; senão, se falar "dinheiro", "espécie", "cash" ou "na mão", a conta cujo nome contém "dinheiro"; senão, se falar "crédito" ou "cartão" e só houver um cartão, esse cartão; senão, a primeira conta.
   - **Categoria**: se o nome de uma categoria (com mais de 3 letras) aparecer na frase, é ela; senão, o palpite por regras e palavras-chave (8.3); senão, "Outros gastos" ou "Outras entradas" (estorno usa categoria de saída).
   - **Descrição**: a frase original sem o trecho de parcelas, de data, o nome da conta/cartão, os verbos de lançamento, preposições e artigos comuns (de, do, da, no, na, em, com, para, pra, um, uma, uns, umas, foi, que, então), valores e letras soltas. Se sobrar menos de 3 caracteres, usa o nome da categoria. Primeira letra maiúscula, no máximo 42 caracteres.
3. Se nenhuma frase tiver valor: toast "Não achei valor nenhum nessa frase. Diga quanto foi."

Exemplo: "gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel" vira duas propostas: saída de 45,90 em Mercado, descrição "Mercado", hoje; saída de 1.200 em Moradia (palpite por "aluguel"), descrição "Aluguel", hoje.

#### 8.1.4 Revisão das propostas

- Título: "Entendi N lançamento(s), confira antes".
- Cada proposta em um cartão:
  - Lançamento comum: descrição em negrito e valor com sinal à direita; seletores de categoria e de onde (contas e cartões); data e descrição editáveis; se tiver parcelas, "10x de R$ X, só vale escolhendo um cartão"; se for estorno, "entra como estorno e abate o gasto da categoria"; botão "remover".
  - Transferência: "Transferência" e o valor; seletores de conta de origem e destino (padrão primeira e segunda conta); botão "remover".
- Botão "Lançar N de uma vez".

Ao lançar:
- Transferência com origem igual a destino é pulada. As outras viram as duas pernas de transferência.
- Lançamento comum usa os valores editados. Parcelas só são aplicadas se o destino for um cartão; senão, vira lançamento único.
- Toast "N lançamento(s) registrado(s) pelo ditado."

### 8.2 Ler boleto

Abre por "Ler boleto" (Contas ou Ditado).

- Texto: "Escolha o PDF do boleto, ou cole a linha digitável, aqueles 47 números. O valor e o vencimento saem exatos dos próprios números do código."
- Botão "Escolher PDF do boleto".
- Campo "Linha digitável", teclado numérico, exemplo com o formato de pontos e espaços.
- Área de mensagens e botão "Ler".

**Leitura da linha digitável** (boleto bancário de 47 dígitos):
- Remove tudo que não é dígito; precisa de pelo menos 47; usa os 47 primeiros.
- Fator de vencimento: dígitos das posições 34 a 37 (contando a partir de 1). Valor: dígitos das posições 38 a 47, divididos por 100.
- Valor precisa ser maior que 0 e no máximo 5 milhões.
- Vencimento = 07/10/1997 + fator dias. Como o fator reinicia (a partir de 2025), se a data calculada ficar mais de 1.100 dias no passado, somar 9.000 dias (até 5 vezes). Só aceitar se o ano ficar entre 1997 e 2099; senão, sem vencimento.
- Inválido: "Não achei um valor válido. Confira se copiou os 47 números inteiros."

**Leitura do PDF** (tudo no aparelho, nada é enviado):
- Mensagem "Lendo o PDF...".
- Extrair o texto do PDF (inclusive de trechos compactados).
- Procurar sequências de dígitos (com pontos, espaços e traços) de 46 a 82 caracteres; dentro de cada uma, testar janelas de 47 dígitos começando nas posições 0 a 11; preferir a primeira leitura válida que tenha vencimento, senão a primeira válida.
- Tentar achar o nome do beneficiário depois de "cedente", "beneficiário" ou "beneficiario" (5 a 41 letras).
- Não achou: "Não consegui achar a linha digitável nesse PDF. Copie os 47 números do boleto e cole no campo acima." Erro ao ler: "Não consegui ler esse PDF. Cole a linha digitável no campo acima." Erro ao abrir: "Não consegui abrir o arquivo."
- Na nova aplicação, pode usar uma biblioteca de PDF de verdade; o resultado esperado é o mesmo.

**Resultado**: fecha esta folha e abre "Nova conta" já preenchida: a pagar, descrição = beneficiário (ou "Boleto"), valor, vencimento (ou hoje), categoria = palpite pela descrição (ou a primeira categoria). Toast "Boleto lido: R$ X, vence DD/MM."

**[Ponto de atenção]** Boletos de concessionária/arrecadação (48 dígitos, começam com 8) não são suportados hoje. Sugestão: suportar.

### 8.3 Palpite de categoria

Usado na importação de extrato, no ditado e no boleto. Ordem:

1. **Regras da pessoa**: a primeira regra cujo texto aparece na descrição (sem diferenciar maiúsculas), se a categoria ainda existir.
2. **Palavras-chave embutidas** (a categoria precisa existir com esse nome exato):
   - Delivery e restaurante: ifood, rappi, ubereats, delivery, restaurante, lanchonete, pizzaria, burger, mcdonald, subway, padaria.
   - Transporte: uber, 99 app/pop/taxi, cabify, posto, combustível, shell, ipiranga, petrobras, estacionamento, pedágio, metrô, ônibus, bilhete único.
   - Mercado: mercado, supermercado, atacado/atacadão, assaí, carrefour, pão de açúcar, extra, big, hortifruti, sacolão.
   - Saúde: farmácia, drogaria, drogasil, pague menos, raia, panvel, hospital, clínica, laboratório, unimed, amil, dentista.
   - Assinaturas: netflix, spotify, amazon prime, disney, hbo, max, globoplay, youtube, apple.com, icloud, google one, deezer, assinatura.
   - Moradia: aluguel, condomínio, iptu, financiamento, prestação da casa.
   - Contas da casa: energia, enel, cemig, copel, light, sabesp, copasa, água, gás, internet, vivo, claro, tim, oi fibra, net.
   - Lazer: cinema, bar, cerveja, balada, show, ingresso, teatro, viagem, hotel, airbnb, passagem, latam, gol, azul.
   - Educação: escola, faculdade, curso, udemy, alura, livro, papelaria, material escolar.
   - Cuidados pessoais: salão, barbearia, cabelo, manicure, academia, smartfit, gympass, perfume, boticário, natura.
   - Pets: petz, cobasi, veterinário, ração.
   - Salário: salário, pagamento de salário, proventos, rendimento, pix recebido, transferência recebida.
   (Aceitar com e sem acento.)
3. Nada encontrado: sem categoria (quem chamou decide o padrão).

### 8.4 Importar extrato do banco

Abre por "Importar extrato do banco" em Ajustes.

**Tela 1 — Importar extrato**
- Texto: "Exporte o extrato do banco ou a fatura do cartão em CSV ou OFX e escolha o arquivo. O arquivo é lido aqui dentro, nada é enviado para lugar nenhum."
- Botão "Escolher arquivo" (.csv, .ofx, .txt). Ao escolher, lê e vai direto para a revisão.
- Campo "Ou cole o conteúdo aqui" (exemplo "data;descrição;valor") e botão "Ler lançamentos".
- Erro de leitura: "Não consegui ler esse arquivo."

**Leitura**
- Se o conteúdo tiver blocos de transação OFX: para cada transação, data (DTPOSTED), valor (TRNAMT) e descrição (MEMO, ou NAME). Valor negativo = saída; positivo = entrada; zero é ignorado.
- Senão, CSV: separador ";" se houver mais ";" que "," na primeira linha, senão ",". Aspas em volta das colunas são removidas. Para cada linha:
  - Data: a primeira coluna que parece data (aaaa-mm-dd, dd/mm/aaaa, dd/mm/aa, aaaammdd).
  - Valor: da última coluna para a primeira, a primeira que tem dígito, não é data e vira número diferente de zero (entende "1.234,56", "-45,90", "1234.56").
  - Descrição: a coluna mais longa que tem letras (fora a de data e a de valor); padrão "Lançamento importado".
  - Linhas sem data ou sem valor são ignoradas (isso descarta o cabeçalho sozinho).
- Nada encontrado: "Não encontrei lançamentos nesse conteúdo."

**Duplicatas**: é duplicata se já existir lançamento com a mesma data, o mesmo valor (diferença menor que meio centavo) e a mesma descrição (sem diferenciar maiúsculas). Se tudo for duplicata: fecha e mostra "Tudo desse arquivo já estava lançado."

**Tela 2 — Revisar importação**
- Texto: "N lançamentos novos, M já existiam e ficaram de fora. Confira a categoria de cada um antes de importar."
- "Tudo isso saiu ou entrou em": contas e cartões (padrão a primeira conta).
- Lista rolável (até ~46% da altura da tela), uma linha por lançamento: caixa de seleção (marcada), descrição, "DD/MM · saída" ou "entrada", seletor de categoria (do tipo certo, já com o palpite de 8.3) e valor com cor.
- Caixa "Lembrar destas categorias para as próximas importações" (marcada).
- Botão "Importar selecionados".

Ao importar:
- Cria um lançamento para cada linha marcada, com tipo, data, valor, descrição, a categoria escolhida e a conta/cartão escolhido, marcado como importado.
- Se "Lembrar" estiver marcado e a linha tiver categoria: pega a primeira palavra da descrição com mais de 3 letras e, se ainda não existir regra com esse texto, cria a regra "contém {palavra} → categoria".
- Toast "N lançamento(s) importado(s)."

---

## 9. Exportar, backup e reset

### 9.1 Baixar CSV

- Arquivo "lancamentos.csv", todos os lançamentos em ordem de data.
- Colunas: data, tipo, valor, descricao, categoria, conta, cartao, transferencia ("sim" / "nao").
- Separador ";", valores entre aspas (aspas internas duplicadas), valor com vírgula decimal, quebra de linha Windows, marca de codificação no início (para o Excel abrir acentos certo).

### 9.2 Backup (JSON)

- Arquivo "backup-financas.json" com todo o estado, formatado e legível.
- Serve também para migrar os dados atuais do artefato para a nova aplicação: a nova aplicação deve aceitar exatamente este formato na restauração.

### 9.3 Download

- Salva o arquivo pelo navegador. Toast "Arquivo salvo."
- Se o download não estiver disponível, abre a folha "Copiar {arquivo}": "O download não está disponível nesta tela. Copie o conteúdo abaixo e cole em um arquivo.", um campo com o conteúdo e o botão "Copiar tudo" → "Copiado." ou "Selecione e copie manualmente."

### 9.4 Restaurar backup

- Folha "Restaurar backup": "Cole aqui o conteúdo de um backup JSON. **Isso substitui todos os dados atuais.**", campo de texto e botão "Restaurar".
- Validações: texto que não é JSON → "Esse texto não é um backup válido."; sem lista de lançamentos → "Backup sem lançamentos. Verifique o arquivo."
- Confirmação "Substituir todos os dados atuais pelo backup?" → substitui tudo, garante as listas, define a revisão como a atual + 1 → "Backup restaurado."
- Sugestão para a nova aplicação: aceitar também o upload do arquivo, além de colar, e rodar a manutenção de 4.3 depois de restaurar.

### 9.5 Apagar tudo

- Duas confirmações: "Apagar TODOS os lançamentos, contas e cartões? Isso não tem volta." e "Tem certeza mesmo? Faça um backup antes se quiser guardar."
- Volta ao estado inicial (3.13), mantendo a revisão como a atual + 1, vai para o Painel → "Tudo apagado."

---

## 10. Primeira vez (boas-vindas)

Aparece uma única vez, cerca de 0,4 s depois de abrir, quando não há dados salvos e nenhum lançamento.

- Título "Bem-vindo ao Freio de Mão".
- "Três passos e o painel começa a trabalhar por você:"
  1. "**Diga quanto entra por mês.** É daí que sai o número de quanto você pode gastar hoje."
  2. "**Cadastre contas fixas e cartões** em Ajustes, para o painel saber o que já está comprometido."
  3. "**Lance cada gasto na hora** pelo botão +. Leva cinco segundos e é o que muda o jogo."
- "Abra este mesmo link no celular e no computador: os dados são os mesmos nos dois." (na nova aplicação: "Entre com a mesma conta no celular e no computador…")
- Campo grande "Renda do mês" com foco automático.
- Botão "Começar": se a renda for maior que zero, salva; fecha a folha.

---

## 11. Design system

### 11.1 Tipografia

- Interface: **Archivo** (400, 500, 600, 700), com alternativas do sistema.
- Números, rótulos e datas: **IBM Plex Mono** (400, 500, 600), com algarismos de largura fixa e espaçamento levemente apertado.
- Texto base 15 px, altura de linha 1,45.
- Rótulos: 10,5 px, monoespaçado, maiúsculas, espaçamento 0,1 em, cor terciária.
- Número do farol: 30–42 px (fluido), peso 600, espaçamento −0,04 em.
- Títulos de bloco: 13 px, peso 600.

### 11.2 Cores (tokens)

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| fundo | #EFF2F0 | #0B1110 | fundo da página |
| superfície | #FFFFFF | #131B19 | cartões, folhas |
| superfície 2 | #E5EAE7 | #1C2624 | trilhas de barra, alternador |
| superfície 3 | #F6F8F7 | #182220 | hover, cabeçalho de dia |
| linha | #D3DBD7 | #26332F | bordas e divisórias |
| linha forte | #B9C4BF | #35443F | bordas de campos e botões |
| tinta | #111A18 | #E7EDEA | texto principal |
| tinta 2 | #4B5854 | #A2B0AB | texto secundário |
| tinta 3 | #79857F | #74827C | rótulos, dicas |
| marca | #0E5A5E | #4FB8B4 | cor principal (petróleo) |
| marca suave | #D5E5E4 | #0F302F | fundo de item ativo |
| texto da marca | #0E5A5E | #7FD3CF | links |
| sobre a marca | #FFFFFF | #06100F | texto em botão cheio |
| saída | #A6382B | #E88374 | gasto, erro, vencido |
| saída suave | #F4DFDB | #33201C | fundo de aviso urgente |
| entrada | #1B6B45 | #5FC38D | entrada, ok, pago |
| entrada suave | #D8EADF | #132A20 | |
| alerta | #8E5D0C | #DCA845 | atenção, perto de vencer |
| alerta suave | #F5E6C9 | #2E2413 | |

- Sombras discretas nos cartões; sombra mais forte e na cor da marca no botão flutuante.
- Tema: "Claro" e "Escuro" forçam; "Do sistema" segue a preferência do aparelho. Padrão: claro.

### 11.3 Paleta para categorias, contas, cartões e metas (12 cores)

#0E5A5E, #A6382B, #1B6B45, #8E5D0C, #4A5EA8, #7A3B7E, #2F7D8C, #9B4A1F, #5B6E2A, #8A3556, #3D6B8E, #6B4E9B.
Pastilhas usam a cor a 16% de opacidade no fundo e a cor cheia no texto.

### 11.4 Formas e componentes

- Raio: 12 px em cartões, 8–10 px em campos e botões, pílula em chips e navegador de mês.
- Botão padrão 40 px de altura; grande 46 px (largura total); pequeno 32 px.
- Campos 42 px de altura; o campo de valor em destaque tem 60 px com número de 30 px alinhado à direita.
- Barra de progresso: 9 px, arredondada, trilha em superfície 2; cores verde/âmbar/vermelho por faixa.
- Etiquetas (fitas): texto monoespaçado 10,5 px em maiúsculas, fundo suave da cor (aberto = alerta, vencido = saída, quitado = entrada, neutra = superfície 2).
- Faixas de aviso: urgente (vermelho), perto (âmbar), calmo (marca), com ícone à esquerda.
- Alternador: segmentos dentro de uma trilha; o ativo fica em superfície com sombra; no tipo de lançamento, "Saída" ativa fica vermelha e "Entrada" ativa fica verde.
- Chips: pílula contornada; o ativo fica cheio na cor da marca.
- Estados vazios: título em negrito 14 px e texto cinza centralizado, largura máxima ~34 caracteres.
- Textos longos em linhas de lista cortados com reticências.
- Ícones de linha fina (traço 1,7) para: painel (casa), extrato (folha com linhas), contas (calendário com check), cartões (cartão), metas (alvo), previsão (linha subindo com seta), histórico (colunas), ajustes (engrenagem), microfone e mais.

---

## 12. Acessibilidade e detalhes de uso

- Foco visível com contorno de 2 px na cor da marca.
- Item de navegação atual marcado como página atual; botões de alternância marcados como pressionados.
- Folhas como diálogo modal com rótulo; botão de fechar com rótulo "Fechar".
- Botões só com ícone têm rótulo ("Novo lançamento", "Ditar lançamento", "Mês anterior", "Próximo mês", "Remover foto").
- Gráfico de ritmo com descrição "Gasto acumulado do mês".
- Respeitar "reduzir movimento": sem pulsação, sem animação de folha, sem transição de barra.
- Teclado numérico nos campos de dinheiro e na linha digitável.
- Respeitar a área segura (notch e barra inferior do iPhone).
- Esc fecha a folha aberta.
- Toda a interface cabe em telas de celular sem rolagem horizontal (só o gráfico do histórico e a faixa de meses rolam de lado).

---

## 13. Pontos de atenção (resumo)

Comportamentos do app atual que merecem decisão na reimplementação:

1. Quitar conta a pagar não recorrente conta o valor duas vezes (prevista e gasto livre). Ver 5.7.
2. Conflito de sincronização é ignorado. Ver 4.1.
3. Lançamentos gerados por meta podem ser editados pelo extrato e são sobrescritos ao salvar o item. Ver 6.5.4.
4. Não há como desfazer uma quitação. Ver 7.7.
5. Apagar conta bancária não verifica contas a pagar, atalhos e cartões ligados. Ver 7.14.
6. Boleto de concessionária (48 dígitos) não é lido. Ver 8.2.
7. O texto "ao quitar, já cria a do mês seguinte" não descreve o comportamento real (cria até 2 meses à frente sempre). Sugestão: "Repete todo mês".
8. Parcelas de meta não entram no "Posso gastar hoje", mas entram no "Como o mês se divide" e na Previsão. Decidir se é intencional.
9. Fotos das metas ficam dentro dos dados. Na nova aplicação, guardar em armazenamento de arquivos e salvar só a referência.
10. Apagar atalho, regra, conta bancária e cartão não pede confirmação (os demais pedem).

---

## 14. Critérios de aceite

A reimplementação está completa quando:

1. As 8 telas existem, com os blocos, textos e estados vazios descritos, em celular e computador.
2. Todos os 20+ formulários da seção 7 existem, com os mesmos campos, padrões, validações, confirmações e toasts.
3. Os números batem com as regras da seção 5 para um mesmo conjunto de dados. Teste mínimo: importar o backup JSON do app atual e conferir, no mesmo dia, "Posso gastar hoje", "Tenho na conta", "A pagar em 30 dias", "Sobra em 30 dias", "Como o mês se divide", as faturas abertas e a Previsão.
4. Contas fixas se autogeram até dois meses à frente e a edição propaga para as ocorrências futuras em aberto.
5. Compras parceladas caem nas faturas certas conforme fechamento e vencimento, com o resto dos centavos na primeira parcela.
6. Pagamento parcial de fatura gera rotativo ou deixa a fatura aberta, conforme a escolha.
7. O ditado entende o exemplo "gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel" como dois lançamentos corretos, e também "comprei geladeira de 3 mil em 10x no {cartão}", "recebi 2 mil de freelance ontem", "saquei 200" e "estornaram 50 do ifood".
8. Boleto de 47 dígitos gera conta a pagar com valor e vencimento exatos.
9. Extrato CSV e OFX importam com remoção de duplicatas, palpite de categoria e criação de regras.
10. Todo lançamento novo (formulário ou atalho) pode ser desfeito pelo toast.
11. Os dados aparecem iguais em dois aparelhos da mesma pessoa, com indicador de sincronização.
12. Tema claro, escuro e do sistema funcionam; movimento reduzido é respeitado.
13. O backup JSON do app atual restaura sem perda na nova aplicação, e o backup da nova é aceito de volta.
