# Estrutura inicial do KG Entregas

`20261030175615_schema.sql` é uma cópia apenas da estrutura dos schemas `public` e `private` do projeto após a migração `20261030175615`. Não contém pedidos, clientes, contas nem senhas. O arquivo está fora de `migrations/` para não ser aplicado automaticamente em produção.

Para reconstruir em um projeto Supabase novo e vazio, primeiro confira o projeto de destino e crie um backup se ele contiver dados. Aplique esta estrutura somente em um banco vazio com os schemas e funções gerenciados do Supabase já provisionados. Ela representa todas as migrações até `20261030175615`: não execute as migrações antigas novamente sobre essa estrutura. Depois de confirmar que o banco de destino contém a estrutura esperada, registre como aplicadas as versões desses arquivos de migração no histórico do banco de destino; somente então use as migrações posteriores. Nunca ajuste o histórico do banco de produção como parte desse processo.

A estrutura foi testada em PostgreSQL isolado com os schemas gerenciados `auth` e `storage` correspondentes ao projeto. Para recuperar dados e autenticação, use um backup completo separado: este arquivo não os contém. Armazenamento de arquivos e configurações externas do projeto exigem recuperação própria.
