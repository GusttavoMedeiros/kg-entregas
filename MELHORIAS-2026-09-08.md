# Correções verificadas em 08/09/2026

Implementadas na branch `codex/robustez-kg-entregas`, a partir de
`f7cc43dbd68d9f5f1add2829825dbf6dbcbea119`. Publicação em produção pendente.

## Comportamento resultante

- Pedido e itens são gravados juntos por `salvar_pedido`. Uma falha reverte
  cabeçalho, itens e auditoria. Repetir uma criação após perder a resposta usa
  a mesma chave e recupera o pedido criado, sem duplicá-lo.
- Excluir um pedido remove seus itens por chave estrangeira com cascade.
  O banco valida o total contra os itens ao terminar cada transação, inclusive
  em alterações feitas fora da interface. A migração interrompe se encontrar
  registros antigos inconsistentes, para não modificar valores automaticamente.
- Custos foram separados em `produto_custos`, com acesso apenas de administrador.
  O vendedor continua consultando o catálogo e fica impedido, no banco,
  de alterar recebimentos. As novas funções respeitam RLS e não usam
  `SECURITY DEFINER`.
- Produto, custo e histórico de preços são salvos juntos. Falha no histórico
  reverte a alteração inteira. Repetir o mesmo preço não duplica o histórico.
- Entregas offline reaparecem concluídas quando o aplicativo é reaberto.
  Falta de espaço impede a confirmação e apresenta um aviso. Quedas de conexão,
  timeout e falhas temporárias do servidor preservam a entrega na fila.
- A fila identifica o usuário, preserva ações acrescentadas durante um envio e
  usa Web Locks quando disponíveis para coordenar abas. Reenviar uma entrega
  concluída não altera sua data nem seu pagamento. Datas de entrega futuras
  são recusadas. Um aviso mostra entregas ainda aguardando envio.
- Listas usam paginação por ID, sem truncamento silencioso no limite da API.
  Atualizações não se sobrepõem nem consultam dados enquanto a aba está oculta
  ou sem conexão. O entregador não consulta o catálogo de produtos.
- Corrigidos preço zero na edição, último dia do mês anterior, inclusão indevida
  de mês futuro, virada UTC no financeiro, extração de bairro dos endereços
  preenchidos pela consulta de CNPJ e fechamento do modal superior com Escape.
- Cache do PWA atualizado para `kg-v22`; script da página atualizado para `v=49`.

## Validação realizada

Ambiente isolado, dados fictícios, Chrome e PostgreSQL 17 via PGlite, reconstruído
a partir do esquema observado em produção. Nenhum pedido real foi criado,
alterado ou excluído para testar.

| Verificação | Resultado |
|---|---:|
| Navegador: login, três perfis, vendas, entregas, catálogo, clientes, financeiro, relatórios e falhas | 75/75 |
| PWA com service worker real: cache, reabertura offline, fila, reconexão e logout | 8/8 |
| Testes Node: cinco arquivos anteriores e dez cenários novos | 15/15 |
| Scripts SQL: autorização, auditoria e robustez | 3/3 |
| Reexecução de fluxos afetados pelos ajustes finais | 16/16 |

Os scripts SQL provocam falhas durante a inserção de itens e de histórico,
verificam reversão, preços inválidos, preço zero, permissões, totais, entrega
futura, idempotência e exclusão em cascade. Os novos testes Node verificam
concorrência da fila, armazenamento cheio/corrompido, separação entre usuários,
paginação e limites mensais.

Os testes de navegador e PWA, resultados e capturas estão na pasta local irmã
`kg-entregas-verificacao-20260908`. Os testes permanentes do código e banco
estão neste repositório. Android/iOS físicos e concorrência entre servidores
reais não foram ensaiados; os resultados não equivalem a garantia de ausência
de todos os defeitos possíveis.

## Como repetir os testes permanentes

Na raiz, com Node instalado:

```sh
node --test actual-delivery-date.test.cjs app-audit.test.cjs item-price.test.cjs report-filter.test.cjs robustness.test.cjs sw.test.cjs
node --check app.js
git diff --check
```

Em banco de teste com o esquema migrado:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/authorization.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/order_audit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/robustez.sql
```

Esses scripts SQL usam transações com `rollback`; não devem ser executados
contra o banco operacional.

## Publicação coordenada

A nova interface exige a migração
`supabase/migrations/20260908154035_atomic_orders_and_restricted_costs.sql`.
Ela copia os custos para a tabela protegida antes de remover a coluna antiga.

1. Confirmar backup do banco e uma janela curta de atualização.
2. Aplicar a migração pelo Supabase em uma transação. Se usar `psql`, acrescentar
   `--single-transaction -v ON_ERROR_STOP=1`.
3. Publicar esta versão do site imediatamente depois e recarregar os aplicativos
   conectados, verificando o cache `kg-v22` e o script `v=49`.
4. Conferir leitura dos três perfis e a sincronização das filas pendentes.

Versões antigas gravam pedidos em várias chamadas e não são compatíveis com
a nova validação do total. Por isso banco e site precisam ser publicados juntos;
reverter somente o site não é um rollback válido. Entregas já guardadas na fila
antiga são reconhecidas pela versão nova.
