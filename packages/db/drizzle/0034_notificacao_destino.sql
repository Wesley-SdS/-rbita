-- Para onde o aviso leva.
--
-- Sem esta coluna o sino é um mural: avisa que há contas a vencer e deixa a
-- pessoa procurar onde vê-las. Quem cria o aviso sabe o destino; adivinhar pelo
-- texto do título seria frágil e quebraria assim que alguém reescrevesse a regra.
--
-- Nulo é o normal: nem todo aviso tem para onde ir.
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "destino" text;
