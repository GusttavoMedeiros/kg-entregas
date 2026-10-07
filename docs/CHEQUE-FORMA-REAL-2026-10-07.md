# Cheque como forma real de recebimento (07/10/2026)

## O que mudou
Ao entregar (completa ou parcial) e em "Marcar como Pago", agora dá para registrar que o
cliente pagou com **cheque**, ao lado de dinheiro e PIX / Cartão. Cheque **conta como pago**
(entra em "Recebido" no relatório e no financeiro), e a forma fica gravada como `cheque`.

Antes, um cheque recebido tinha de ser anotado como "dinheiro", o que escondia a origem do dinheiro.

## Banco (migração `20261007180000_cheque_forma_real.sql`)
Aditiva — não altera nenhum pedido existente:
- `pedidos_forma_pagamento_real_check` passa a aceitar `dinheiro`, `pix` e `cheque`.
- `concluir_entrega` e `concluir_entrega_parcial` recriadas **idênticas** às de produção
  (conferido por hash do corpo), só com `cheque` na lista de formas aceitas. Permissões,
  `security definer/invoker` e `search_path` não mudam.

Ordem de publicação: **aplicar a migração no banco primeiro**, depois publicar o app.
O app antigo nunca envia `cheque`, então continua funcionando depois da migração.
Se o app novo fosse publicado antes, registrar cheque daria erro "Informe a forma e a data do recebimento".

## App (kg-v61 / app.js?v=84)
- Botão "Cheque" na janela de entrega (5 opções; o último botão ocupa a linha toda quando o número é ímpar).
- `FIN_FORMAS` (Marcar como Pago) ganhou `cheque`, com ícone 📝; a confirmação da entrega usa a mesma lista.
- Detalhe do pedido mostra "Pago (Cheque)".

## Testes
- `cheque-db.test.cjs` (6): Postgres em memória com as migrações reais — banco antigo recusa cheque,
  banco novo aceita nas duas funções, formas inválidas continuam recusadas, dados e permissões intactos.
- `cheque-app.test.cjs` (5): botões, gravação da forma, mensagens e detalhe.
- Mutações conferidas: desfazer cada parte do app faz algum teste falhar.
