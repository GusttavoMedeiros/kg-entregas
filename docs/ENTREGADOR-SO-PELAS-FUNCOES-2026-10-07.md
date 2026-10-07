# Entregador só conclui entregas pelo aplicativo (07/10/2026)

## Problema
O gatilho `restringir_update_entregador` já impedia o entregador de mudar valor, cliente,
vendedor, datas previstas e forma combinada. Mas um PATCH direto na tabela `pedidos` (fora do
aplicativo, com o login do entregador) ainda conseguia:
- marcar um pedido à vista/cheque como entregue **sem dizer se o cliente pagou**
  (as funções `concluir_entrega*` exigem isso; o PATCH direto pulava a conferência);
- gravar data de entrega antiga (por exemplo num mês já acertado de comissão) — isso valia até pelas funções;
- gravar data de pagamento antiga ou no futuro.

## Regra nova (migração `20261007200000_entregador_so_pelas_funcoes.sql`)
Só para o perfil **entregador**:
- qualquer alteração em `pedidos` precisa vir de `concluir_entrega` ou `concluir_entrega_parcial`
  (as funções marcam o pedido com `kg.concluir_entrega` só durante o próprio UPDATE; a API não
  consegue definir essa marca);
- data da entrega: de hoje até **7 dias atrás** (folga para a fila sem internet); no futuro já era proibido;
- data do pagamento registrada na entrega: de hoje até 7 dias atrás, nunca no futuro.
  Pagamento adiantado (data antiga já gravada pelo admin) continua preservado.

Mais antigo que 7 dias: o administrador registra a entrega (o admin não tem essas travas).
Administrador e vendedor não mudam. Nenhum pedido existente é alterado; as funções são as mesmas
da migração do cheque, só com a marca antes e depois do UPDATE.

Compatível com o app no ar: o entregador já usa só as funções (`rpc/concluir_entrega*`), online e na fila offline.
Uma entrega da fila com mais de 7 dias é recusada e aparece como falha na fila (fluxo do PR #16).

## Testes
`entregador-db.test.cjs` (9), Postgres em memória com as migrações reais: a brecha existia antes e
fecha depois; entrega pelo app continua funcionando (completa, parcial, reenvio); limites de data;
pagamento adiantado preservado; marca vale só para o pedido; admin e vendedor iguais; dados e
permissões intactos. Mutações conferidas (tirar a exigência, mudar a janela, aceitar pagamento futuro, não limpar a marca).
