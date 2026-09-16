# Carregamento e login — 2026-09-13

Base de comparação: `e621007` (produção antes desta alteração).

## Gargalos corrigidos

- Sessão era renovada em toda reabertura, mesmo com access token válido. Agora reutiliza o token até a margem de 60 segundos e deriva o perfil do JWT. Tokens expirados online continuam exigindo renovação. A API mantém autenticação e RLS.
- Cada lista buscava uma página vazia adicional. `Prefer: count=exact` fornece o total da consulta corrente; a paginação encerra quando essa página cobre os registros restantes. Cache antigo sem total mantém a busca conservadora. O código não presume que uma página curta significa lista completa.
- JavaScript e CSS versionados aguardavam rede em toda reabertura. Agora usam cache por URL exata; uma versão diferente exige seus próprios bytes. HTML continua network-first. Cache de dados `kg-v23-data` preservado.
- Fonte externa bloqueava a renderização inicial. Agora carrega sem bloquear e o JavaScript inicia seu download pelo preload.

## Verificação

Consulta somente de leitura no banco: 13 pedidos, 13 clientes, 58 produtos. Nenhum registro de negócio foi alterado pelo trabalho. A tentativa de leitura REST anônima foi rejeitada pelas permissões existentes.

38 testes automatizados aprovados: autenticação, contagem, limite de paginação menor que o solicitado, cache antigo, falha em página posterior, pagamentos, concorrência e fila offline.

Comparação no Edge headless, 360 × 740, CPU 4× mais lenta e 300 ms de atraso por requisição de autenticação/dados. Dados e autenticação simulados (um registro por lista), sem usar credenciais nem gravar no aplicativo oficial. Uma execução por cenário; os tempos são indicativos e não representam medição no celular do usuário.

| Perfil | Fluxo | Antes | Depois | Consultas de dados |
|---|---|---:|---:|---:|
| Admin | Login | 1882 ms | 1544 ms | 6 → 3 |
| Admin | Reabrir | 1538 ms | 961 ms | 6 → 3 |
| Vendedor | Login | 1772 ms | 1465 ms | 6 → 3 |
| Vendedor | Reabrir | 1510 ms | 697 ms | 6 → 3 |
| Entregador | Login | 1544 ms | 1257 ms | 4 → 2 |
| Entregador | Reabrir | 1419 ms | 799 ms | 4 → 2 |

Média: aproximadamente 18% de redução no login e 45% na reabertura. Na reabertura com token válido, chamadas de autenticação: 1 → 0. Sem erros JavaScript ou transbordamento horizontal nesses cenários.

Teste adicional com Service Worker real em origem local: reabertura fez zero downloads de app.js e ios-like.css; login abriu offline; botão de atualização informou falta de conexão; conteúdo da chave de fila local foi preservado. Os testes automatizados de fila também cobrem entregas pendentes reais em fixtures.

## Limites e manutenção

- Incrementar a versão da URL ao alterar JS/CSS. Publicação atual: app.js?v=56 e cache kg-v32.
- A contagem exata tem custo no banco; reavaliar quando o volume crescer significativamente. O volume atual é pequeno.
- Primeira autenticação e dados atuais ainda dependem da rede e do servidor. Não há promessa de tempo fixo em aparelhos físicos.
- Não houve mudança de esquema, exclusão de histórico ou limpeza de dados offline.
