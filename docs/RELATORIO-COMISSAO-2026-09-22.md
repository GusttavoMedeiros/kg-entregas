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
