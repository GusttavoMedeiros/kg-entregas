# Relatório de vendas / comissão — revisão de 22/09/2026

O relatório é usado para acertar a comissão do vendedor, então nenhum pedido
entregue pode ficar de fora.

## Problemas encontrados

1. **Só mostrava os 5 maiores clientes.** Não existia lista de pedidos: um
   cliente abaixo do 5º lugar (ex.: Sociedade dos Criadores) simplesmente não
   aparecia, nem na tela nem no PDF.
2. **Quinzena "móvel".** O período era "os últimos 15 dias a partir de hoje",
   então mudava conforme o dia em que o relatório era aberto. Dois acertos
   feitos em dias diferentes podiam pular dias ou contar o mesmo dia duas vezes.
3. **Pedido esquecido de marcar como entregue sumia sem aviso.** Só pedidos com
   status "entregue" entram no total, e os demais não apareciam em lugar nenhum.
4. **Dados podiam estar desatualizados.** O relatório usava a lista em memória;
   se a sincronização automática tivesse falhado, faltariam pedidos sem aviso.
5. **PDF:** "Página 1 de 1" errado em relatórios de várias páginas, tabelas
   das páginas seguintes por baixo do cabeçalho e símbolos (#, ·, ª) que sumiam
   por não existirem na fonte embutida.

## O que mudou

- Lista completa de **todos** os pedidos entregues (data, nº, cliente,
  vendedor, pagamento, valor), com total no fim. Top 5 virou complemento.
- Quadro **Por vendedor** (admin), com recebido / a receber / total.
- Quinzenas **fixas**: 1 a 15 e 16 ao último dia do mês. Semana (seg–dom) e mês
  já eram fixos. Teste garante que os períodos encaixam sem lacuna.
- **Alerta** em vermelho com os pedidos previstos até o fim do período que
  ainda não foram marcados como entregues (fora do total).
- Ao abrir o relatório e ao gerar o PDF, os pedidos são **buscados de novo no
  servidor**. Se não der, tela e PDF avisam para não usar no acerto.
- Somas feitas em centavos: o total sempre bate com a soma das linhas.

Testes: `report-completeness.test.cjs` e `report-period.test.cjs`.
Nenhuma alteração no banco de dados.

## Redesenho (23/09/2026)

A comissão é paga **por unidade de cada produto** (ex.: um valor por saco de
milho 60kg, outro pelo de 30kg). O relatório passou a ser organizado assim:

- **Produtos entregues:** total de unidades de cada produto no período.
- **Por cliente:** cada cliente com a quantidade de cada produto (somando todos
  os pedidos dele) e os números dos pedidos, para conferência.
- **Filtro de vendedor** (admin): Todos / Admin / Vendedor. O PDF sai só do
  vendedor escolhido, pronto para o acerto.
- Produtos saem dos próprios itens entregues: **produto novo aparece sozinho**,
  e produto renomeado soma junto usando o nome atual do catálogo.
- Resumo reduzido a três números (entregue, pedidos, a receber). Saíram os
  "top 5" e a lista pedido a pedido.
- PDF no computador não fica mais achatado (a folha era espremida na altura
  da tela). Vale também para a via do pedido.
- Nomes com `& ' + ! ? "` e outros símbolos saem inteiros no PDF.

## Simplificação (23/09/2026)

A pedido, a seção **Por cliente** saiu da tela e do PDF. O relatório tem agora
só o resumo, os **pedidos sem baixa de entrega** e os **produtos entregues**
(total de unidades de cada produto). Para voltar com a seção, ver o PR #13.

## Conferência com o servidor (27/09/2026)

Revisão feita em conjunto com o Codex. Dois caminhos faziam o relatório parecer
conferido sem estar:

- **Cópia antiga do celular.** Com internet fraca ou caída, o service worker
  responde com a última cópia salva dos pedidos (marcada com `x-from-cache`).
  O relatório tratava essa cópia como resposta do servidor e mostrava
  "Conferido com o servidor". Agora essa resposta conta como falha: tela e PDF
  mostram o aviso para não usar no acerto.
- **Entregas feitas offline neste aparelho.** Eram somadas ao total antes de
  chegarem ao banco. Agora o relatório tenta enviá-las antes de conferir; as
  que continuarem sem envio ficam **fora do total** e aparecem num bloco
  próprio ("ainda não enviadas ao servidor"), na tela e no PDF.

Teste: `report-server-check.test.cjs`. Nenhuma alteração no banco de dados.

## Entrega parcial (28/09/2026)

Às vezes chega só parte do pedido. Antes, a entrega marcava o pedido inteiro e o
relatório contava todas as unidades, então a comissão saía a mais. Regra
combinada: **o que não chegou é cancelado e o cliente paga só o que recebeu**.

- Na tela de confirmar entrega, cada item vem preenchido com a quantidade pedida.
  O entregador só ajusta quando chegou menos. O valor novo aparece na hora e o app
  pede confirmação antes de gravar.
- O banco reduz as quantidades, tira o item que não chegou, recalcula o valor e
  guarda em cada item a quantidade originalmente pedida (`qtd_pedida`).
- O relatório já soma a quantidade de cada item, então passa a contar só o que foi
  entregue, sem mudança nele.
- **Pedido já pago adiantado não aceita entrega parcial** (o cliente teria pago a
  mais). Os campos ficam travados e o administrador ajusta o pedido antes.
- Funciona sem internet: a entrega parcial fica na fila com as quantidades e é
  enviada depois pela mesma função.

**Banco de dados** (`supabase/migrations/20260928170000_partial_delivery.sql`), só
acréscimos: coluna `itens_pedido.qtd_pedida` (vazia nos pedidos existentes), função
`concluir_entrega_parcial` e um ajuste no gatilho do entregador, que continua sem
poder mudar valor ou itens por conta própria (só a função nova pode, dentro da sua
transação). `concluir_entrega` não muda.

**Ordem para publicar:** aplicar a migration no banco **primeiro**, publicar o app
depois. O app antigo continua funcionando com a migration aplicada. Para desfazer:
remover a função `concluir_entrega_parcial` e a coluna `qtd_pedida` (e restaurar o
gatilho `restringir_update_entregador` da migration `20260813153429`).

Testes: `partial-delivery-db.test.cjs` (Postgres em memória com as regras reais),
`partial-delivery-app.test.cjs`.

## Marcar como Pago (28/09/2026)

Antes, o botão "Marcar como Pago" da janela do cliente quitava **todos** os pedidos em aberto de uma vez, como dinheiro, sem perguntar. Isso incluía pedidos ainda não entregues e pagamentos que o cliente tinha se recusado a fazer.

Agora:
- Cada pedido em aberto tem sua caixa de seleção, todas **desmarcadas**. Há "Marcar todos" e "Limpar".
- É preciso escolher a forma: **Dinheiro** ou **PIX / Cartão** (grava em `forma_pagamento_real`).
- Antes de gravar, o app mostra uma confirmação com os números dos pedidos, o total, a forma e, se houver, o aviso de pedido ainda não entregue (a entrega continua pendente).
- A gravação só atinge os pedidos marcados e só os que ainda não estão pagos (`status_pagamento` nulo ou diferente de `pago`). Se outro aparelho já tiver quitado algum, o app avisa quantos foram atualizados de fato e recarrega os dados.
- A escolha em andamento não se perde quando a tela atualiza sozinha, e não passa para outro cliente.

Impacto no relatório de comissão: nenhum. O relatório usa `data_entregue_em`, não a data do pagamento. Sem mudança no banco de dados.
