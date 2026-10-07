# Pente fino geral — 07/10/2026

Revisão completa do app depois das prioridades (cheque, entregador só pelas
funções, acerto de comissão, desfazer entrega).

## O que foi verificado

- **Auditoria automática no navegador** (`browser-audit.cjs`) nos perfis admin
  (celular e computador), vendedor e entregador: sem erros. O script foi
  atualizado para o relatório novo (acertos de comissão e "Entregas do período").
- **Supabase:** avisos de segurança e de desempenho. Só sobraram avisos
  conhecidos e intencionais (funções `security definer` que conferem o perfil
  por dentro; índices ainda sem uso). A "proteção contra senhas vazadas" é uma
  escolha do dono e fica no painel do Supabase.
- **Leitura do código inteiro:** `app.js` (7.000 linhas), `sw.js` e a estrutura
  do `index.html`. Todos os 75 botões da tela apontam para funções que existem.

## Problemas encontrados e corrigidos

1. **Aviso de falha aparecia como sucesso.** Mensagens como "Pedido não salvo",
   "Cliente não atualizado" e "Produto não excluído" saíam com ✅ verde, porque
   o app via a palavra "salvo"/"atualizado"/"excluído". "A entrega não foi
   desfeita" e "O acerto não foi registrado" saíam como informação. Agora toda
   negação ("não salvo", "não foi", "não consegui"...) aparece como erro.
2. **"Cobrar atrasados" herdava o último pedido aberto.** A janela de cobrança
   usa a mesma janela do detalhe do pedido e mostrava os botões "Via do pedido"
   e "Desfazer entrega" do pedido visto antes; uma atualização automática podia
   trocar a lista de cobrança por esse pedido. Agora a janela começa limpa, com
   o título no lugar certo e um botão "Fechar" só (antes eram dois).
3. **Margem negativa no catálogo** saía "+-15%". Agora sai "-15%".
4. **Erro ao gerar o PDF do relatório** usava uma caixa do navegador que trava a
   tela. Agora usa o aviso do app, como no resto.

## Testes

- `pente-fino.test.cjs` (4 testes), conferidos por mutação: desfazendo cada
  correção, o teste correspondente falha.
- Suíte completa: 180 testes passando.

Versões: `kg-v65` / `app.js?v=87`. Nenhuma mudança no banco de dados.
