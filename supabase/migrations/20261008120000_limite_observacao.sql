-- Limite de tamanho do campo "observação" (pedidos e clientes).
--
-- Um teste pesado mostrou que o banco aceitava uma observação de 1.000.000 de
-- caracteres, o que deixaria o aplicativo, o PDF e o relatório lentos. O limite
-- passa a ser de 1000 caracteres (a maior observação já salva tem 45).
--
-- Mudança aditiva: só adiciona uma regra de validação. Nenhum dado é alterado e
-- o aplicativo antigo continua funcionando (ele nunca enviou textos desse tamanho).

alter table public.pedidos
  add constraint pedidos_observacao_tamanho check (char_length(observacao) <= 1000);

alter table public.clientes
  add constraint clientes_observacao_tamanho check (char_length(observacao) <= 1000);
