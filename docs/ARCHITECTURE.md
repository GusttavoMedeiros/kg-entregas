# Arquitetura do KG Entregas

## Runtime

O aplicativo é uma PWA estática hospedada no Vercel. `index.html` contém a estrutura das telas e o estilo base; `ios-like.css` contém a camada visual existente; `styles/` contém tokens e refinamentos visuais; `app.js` concentra os fluxos de autenticação, dados, pedidos, sincronização, relatórios e PDF; `sw.js` trata cache, atualização e fallback offline.

O Supabase é a fonte de verdade dos pedidos, itens, clientes e produtos. A fila offline mantém ações de entrega no dispositivo até a confirmação do servidor. Nenhuma mudança de layout deve alterar nomes de tabelas, payloads, RPCs ou chaves de armazenamento.

## Organização por responsabilidade

| Área | Arquivos | Regra |
| --- | --- | --- |
| Apresentação | `index.html`, `ios-like.css`, `styles/` | Sem consultas ou persistência |
| Aplicação | `app.js` | Fluxos existentes preservam as APIs atuais |
| Offline e atualização | `sw.js` | Versionar assets e manter `kg-v23-data` |
| Persistência | `supabase/migrations/` | Migrações aditivas e revisáveis |
| Verificação | `*.test.cjs`, `browser-audit.cjs` | Rodar `npm test` e `npm run test:browser` |
| Documentação | `docs/` | Registrar decisões e evidências |

## Evolução segura

Novos componentes visuais devem entrar em `styles/` antes de qualquer extração de lógica. A divisão futura de `app.js` pode ser feita por adaptadores compatíveis (`auth`, `data`, `sync`, `orders`, `reports`, `pdf`), mantendo as funções globais usadas pelo HTML até que exista uma etapa de build.

## Restauração

O estado aprovado antes do redesign está protegido no tag remoto `backup/pre-visual-2026-09-16`. Para voltar, crie uma branch a partir desse tag e publique uma nova versão; isso gera um commit reversível e não exige alterar o banco.
