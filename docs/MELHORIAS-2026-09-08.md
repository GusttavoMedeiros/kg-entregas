# Correções verificadas em 08/09/2026

Implementadas na branch `codex/robustez-kg-entregas`, a partir de
`f7cc43dbd68d9f5f1add2829825dbf6dbcbea119`. Publicadas em produção em
08/09/2026, às 13h01 (Brasil), pelo PR #11, merge
`22ebaacbb3e1c73109b1282eee99126bacabbb85`.

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

Ambiente isolado, dados fictícios, Chrome e PostgreSQL 18.3 via PGlite 0.5.8,
com o esquema reconstruído a partir da produção, que usa PostgreSQL 17.
Nenhum pedido real foi criado,
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
reais não foram ensaiados. A migração foi aplicada ao PostgreSQL 17 em produção,
com verificação de leitura sob os três perfis e comparação integral dos dados.
As escritas de teste permaneceram no ambiente isolado; os resultados não
equivalem a garantia de ausência de todos os defeitos possíveis.

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

## Publicação realizada e conferida

A nova interface exige a migração
`supabase/migrations/20260908154035_atomic_orders_and_restricted_costs.sql`.
Ela copia os custos para a tabela protegida antes de remover a coluna antiga.

1. Backup dos seis conjuntos de dados e metadados do esquema salvo localmente,
   fora do GitHub. O ensaio da migração sobre essa cópia preservou todos os dados.
2. Migração aplicada pelo Supabase e registrada como
   `20260908160059_atomic_orders_and_restricted_costs`.
3. PR #11 integrado à `main`; Vercel confirmou publicação em produção. Os
   arquivos públicos `index.html`, `app.js` e `sw.js` correspondem aos arquivos
   aprovados, com script `v=49` e cache `kg-v22`.
4. Comparação antes/depois: 12 pedidos, 46 itens, 12 clientes, 58 produtos e
   35 registros em cada histórico, sem alterações, inclusões ou exclusões.
   Os 58 custos foram preservados na nova tabela.
5. Leitura em produção: administrador acessa os custos; vendedor e entregador
   não acessam custos. A tela de acesso pública foi conferida no navegador.

Backup, comparação e evidências da publicação ficaram guardados neste PC.
Quem já estiver com o aplicativo aberto deve reabri-lo conectado à internet
para receber a versão nova. Nenhuma venda de teste foi criada em produção.

Versões antigas gravam pedidos em várias chamadas e não são compatíveis com
a nova validação do total. Por isso banco e site precisam ser publicados juntos;
reverter somente o site não é um rollback válido. Entregas já guardadas na fila
antiga são reconhecidas pela versão nova.
