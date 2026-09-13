# Auditoria funcional, desempenho e movimento — KG Entregas

## A. Resumo executivo

Revisão do frontend JavaScript/CSS/HTML, Service Worker, autenticação, consultas, regras SQL e testes existentes.
Corrigidos problemas reproduzíveis de concorrência, edição de valores, busca, relatórios e recuperação de carregamento.
53 testes automatizados aprovados e quatro cenários de navegador cobrindo os três perfis, mobile, desktop, economia e movimento reduzido.
Banco consultado somente para leitura: 13 pedidos, 13 clientes e 58 produtos antes/depois; zero totais divergentes da soma dos itens.
Não houve migração, alteração de senhas ou gravação de dados de negócio em produção nesta revisão; ausência absoluta de bugs não pode ser garantida.

Stack: JavaScript sem framework, HTML/CSS, PWA/Service Worker, Supabase Auth/PostgREST/PostgreSQL/Realtime; hospedagem Vercel.

## B. Achados corrigidos

Os nomes abaixo identificam as funções no patch de `app.js`; movimento fica em `ios-like.css` e versões em `index.html`/`sw.js`.

| Sev. | Sintoma e evidência anterior | Causa / risco | Correção / validação |
|---|---|---|---|
| P1 | Editar pedido com o mesmo produto em linhas de R$ 10 e R$ 20 alterava o total (`abrirModalNovoPedido`). | Agrupava somente por produto; a segunda linha assumia o primeiro preço. | Agrupa apenas preços/referências iguais; controles operam por linha. Teste preserva R$ 60 e altera apenas a quantidade escolhida. |
| P1 | Resposta recebida depois de sair/trocar de conta podia ser aplicada pelos chamadores (`apiSupabase`). | Requisições não tinham identificação da geração do acesso. | Invalida respostas da sessão anterior, inclusive durante renovação e falha de rede. Teste de PATCH em voo retorna cancelamento 499 sem sucesso local. |
| P2 | Busca por `+`, `(teste)` ou nomes contendo `mark` quebrava o destaque (`highlightBusca`). | Regex montada diretamente do texto e reaplicada sobre HTML gerado; podia também consumir CPU em padrões problemáticos. | Escapa metacaracteres, busca uma vez no texto original e escapa cada fragmento. Testes com acentos, HTML, pontuação e padrão de repetição. |
| P2 | Enter repetido fazia mais de uma autenticação (`fazerLogin`). | Botão desabilitado não bloqueava o listener de teclado. | Trava lógica com liberação em `finally`; resultado de tentativa invalidada não abre sessão. |
| P2 | Enter com foco em Cancelar podia confirmar a ação (`confirmar`). | Listener global aceitava qualquer Enter como confirmação. | Usa ativação nativa do botão focado; mantém Tab dentro da confirmação e cancela confirmação anterior/ao sair. Validado no navegador. |
| P2 | Primeiro carregamento malsucedido deixava telas sem recuperação direta (`carregarTudo`). | Saía após toast, sem ação de repetir. | Estado visível, botão Tentar novamente, trava contra leituras duplicadas e preservação das listas anteriores em falha parcial. |
| P2 | Trocar de aba antes de terminar o carregamento deixava a aba escolhida sem renderização. | Carregamento renderizava apenas a tela padrão do perfil. | Renderiza a tela ativa quando o usuário navegou durante a espera. |
| P2 | Detalhe do produto A podia substituir o produto B após troca rápida (`verDetalheProduto`). | A resposta lenta escrevia no mesmo contêiner. | Confere geração do acesso, estado do modal e elemento de carregamento. Teste de navegador com respostas fora de ordem. Falha de histórico não aparece como histórico vazio. |
| P2 | Consulta CNPJ atrasada podia preencher outro cadastro (`tentarConsultarCNPJ` / `aplicarDadosReceita`). | Não verificava documento/tipo/abertura atual após rede e confirmações. | Descarta resultado e preenchimento quando contexto muda. Teste com documento trocado durante consulta. |
| P2 | API podia continuar aguardando corpo da resposta indefinidamente (`apiSupabase`). | Timer encerrava ao receber cabeçalhos. | Mantém timeout durante leitura do corpo; teste trava o corpo e confirma saída recuperável. |
| P2 | Atualização manual podia travar ou recarregar um formulário depois de o usuário entrar (`atualizarAplicativo`). | Ausência de limite completo de espera e de verificação do acesso. | Timeout de 15s para rede/atualização do SW; descarta cache como confirmação de rede e impede recarga após mudança de sessão. Dois testes novos. |
| P2 | Relatório mensal/quinzenal e vencimento podiam variar com fuso do aparelho. | Misturava datas locais com formatação no Brasil. | Aritmética de data civil ancorada em UTC, com referência do Brasil. Testado em UTC, Los Angeles e Kiritimati, incluindo virada de ano. |
| P2 | Financeiro podia colocar pagamento legado no mês da previsão, mesmo tendo data real de entrega. | Fallback usava apenas `data_entrega`. | Usa `data_pagamento` e, na ausência, `dataRealEntrega`. |
| P2 | Atualizar opções de cliente apagava a seleção de um pedido em edição (`popularSelectClientes`). | Recriava o select sem restaurar o valor. | Preserva seleção; teste dedicado e formulários no navegador. |
| P2 | Quantidades inválidas e preços com precisão extra produziam prévias divergentes. | Aceitava infinito/truncava quantidade e mantinha mais de dois decimais no preço. | Valida inteiros e valores finitos; ajuste de preço em centavos; valida itens antes do envio. |
| P3 | Nomes como `__proto__` e `constructor` quebravam agregações/rotas. | Dicionários herdavam propriedades de Object. | Dicionários sem protótipo; teste de totais de produtos/clientes. |
| P3 | Cálculo de débitos repetia varredura de pedidos para cada cliente. | Custo proporcional a clientes × pedidos. | Soma em uma passagem com Map; teste conta uma leitura por pedido. Rotas também indexam clientes uma vez. |
| P3 | Cálculos de data criavam muitos formatadores; eventos próximos do Realtime provocavam leituras repetidas. | Trabalho repetido nas listas e sincronização. | Reutiliza Intl.DateTimeFormat; debounce existente de 250ms agrupa eventos próximos. |
| P3 | Cartões repetiam animação durante sincronizações e o mesmo keyframe `slideDown` tinha definições conflitantes. | Animação aplicada a todo novo HTML, independentemente da navegação. | Animação de entrada somente durante navegação/carregamento; até seis cartões, atraso máximo 120ms, transições curtas, sem movimento no modo econômico/reduzido. |

Nenhum novo P0 foi confirmado nos cenários examinados. Os registros atuais não contêm linhas do mesmo produto com preços distintos; esse caso de edição foi reproduzido em fixture para proteger pedidos futuros/legados.

## C. Reprodução dos três casos prioritários

1. Pedido com duas linhas do mesmo produto, preços distintos: abrir edição, conferir total, aumentar a segunda linha, salvar. Antes unificava preços; agora preserva os valores e altera somente a linha escolhida.
2. PATCH com resposta atrasada: iniciar, encerrar o acesso e iniciar outro antes da resposta. O retorno antigo deve ser rejeitado e não atualizar o estado da conta atual.
3. Confirmação: abrir, focar Cancelar e pressionar Enter. Deve cancelar. Abrir outra confirmação enquanto a anterior aguarda deve resolver a anterior como cancelada, sem executar duas ações.

## D. Mudanças mínimas

Reutilizados `debounce`, API, carrinho, modais e testes existentes. Sem biblioteca nova em produção, sem troca de framework, sem alteração de banco. Removido wrapper de cache que apenas devolvia o argumento. Mudanças de correção foram implementadas, não apenas recomendadas.

## E. Validação e regressão

- `node --check app.js`, `node --check sw.js` e `git diff --check`.
- `node --test *.test.cjs`: 53 aprovados; o teste PostgreSQL usa PGlite local via NODE_PATH, nunca produção.
- `node browser-audit.cjs`: Playwright/Edge via NODE_PATH. API e autenticação simuladas; nenhuma gravação vai ao Supabase. Cobre navegação, edição de pedido, criação de boleto, edição de cliente, cadastro de produto, confirmação por teclado, histórico fora de ordem, relatório, prévias de impressão e entrega offline preservada no logout.
- Quatro configurações: admin 360px; vendedor 320px com modo econômico; entregador 390px com movimento reduzido; admin desktop 1280px. Sem erros JavaScript nesses cenários.
- Service Worker real em origem local: reabertura com zero downloads de JS/CSS versionados, login offline funcional e chave da fila preservada.
- Comparação indicativa com a versão anterior `5fbe9d9`, CPU 4× mais lenta, 300ms/requisição: mantém três consultas para admin/vendedor e duas para entregador. Não houve ganho adicional conclusivo no tempo de login nesse conjunto pequeno; esta revisão reduz trabalho repetido e corrige falhas. Não atribuir uma nova porcentagem de aceleração geral.
- Consulta de invariantes no banco: zero pedidos sem itens ou com total divergente. Consulta sob papel vendedor: nenhum pedido de outro vendedor retornado. As verificações de autorização e pagamento existentes também continuam aprovadas no PostgreSQL local.

## F. Pontos de atenção

- Publicação: `app.js?v=57`, `ios-like.css?v=7`, cache de assets `kg-v33`. Cache de dados continua `kg-v23-data`; fila offline não foi limpa.
- Testes de navegador usam Edge e simulação de recursos. Safari/iPhone e Android físicos ainda precisam de validação de campo; não se afirma cobertura de todos os aparelhos/redes.
- Não foram enviados WhatsApps, impressos documentos físicos, apagados pedidos nem executados testes destrutivos em produção.
- Advisor do Supabase: **proteção contra senhas vazadas desativada**. É uma configuração de plataforma disponível no plano Pro ou superior; o plano não foi alterado nesta revisão. [Documentação e correção](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Advisor de desempenho: índice `pedidos_cliente_id_idx` ainda sem uso nas estatísticas. Mantido: com 13 pedidos, varredura sequencial é plausível, e o índice protege consultas conforme o volume cresce. [Explicação do aviso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- A revisão e os testes reduzem riscos; não constituem garantia de perfeição ou ausência de condições não reproduzidas.
