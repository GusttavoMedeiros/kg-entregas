# Acerto de comissão registrado (07/10/2026)

## Problema
Depois de pagar a comissão de um período, uma devolução, uma correção de pedido ou uma entrega
lançada mais tarde com data daquele período mudava os números do relatório sem nenhum aviso.
O acerto já pago e o relatório deixavam de bater, e ninguém percebia.

## Decisão
Não travar a correção de pedidos (devolução precisa ser lançada). Em vez disso, **registrar o acerto**
e mostrar em destaque o que mudou depois dele, para acertar a diferença no próximo pagamento.

## Como funciona
- No relatório, o administrador escolhe o vendedor (ou, se só um vendedor entregou no período,
  ele já vem escolhido) e toca em **"Registrar acerto deste período"**. A confirmação mostra pedidos,
  unidades e valor; se o período ainda não terminou, avisa.
- O botão só funciona com o relatório conferido com o servidor e sem entregas pendentes na fila do aparelho.
- O **banco** monta a lista do acerto (função `registrar_acerto`): pedido a pedido, unidades e valor,
  com a mesma regra do relatório (entregue, do vendedor, data real da entrega ou prevista nos antigos).
- Ao abrir o mesmo período/vendedor depois:
  - nada mudou: faixa verde "Acerto registrado em ...: N un · R$ X. Nada mudou desde então.";
  - mudou: aviso laranja "Mudou depois do acerto de ...", com a diferença (unidades e valor a mais/a menos)
    e a lista: pedido que **entrou** depois, que **saiu** do período, ou que **mudou** (de X para Y un / de R$ A para R$ B).
- Pagou a diferença: registra o acerto de novo (o novo vira a referência; o antigo fica no histórico).
- O vendedor vê a situação do próprio acerto (sem o botão). O PDF traz o mesmo aviso logo após o resumo.
- Se todos os pedidos acertados saírem do período, o vendedor continua no filtro e o aviso aparece.

## Banco (migração `20261007210000_acertos_comissao.sql`)
Aditiva: tabela nova `acertos_comissao` (vazia) e função nova `registrar_acerto`. Nenhum pedido é alterado.
- Leitura: admin vê todos; vendedor só os dele; entregador nenhum.
- Ninguém grava, altera ou apaga direto pela API; só a função grava, e só para o admin.
- Se a consulta dos acertos falhar, o relatório funciona normalmente (só não mostra o acerto).

## App (kg-v63 / app.js?v=85)
`unidadesDoPedido`, `vendedorDoAcerto`, `acertoDoPeriodo`, `diferencasDoAcerto`, `textoMudancaAcerto`,
`textoDiferencaAcerto`, `dataHoraAcerto`, `htmlAcertoRelatorio`, `registrarAcertoRelatorio`; `montarRelatorio`
devolve `vendedorAcerto`, `acerto`, `difAcerto`. Textos sem símbolos fora da fonte embutida do PDF.

## Testes
- `acertos-db.test.cjs` (7): Postgres em memória — lista certa, período vazio, só admin, sem escrita direta,
  quem lê o quê, acerto refeito, pedidos intactos.
- `acerto-app.test.cjs` (12): diferenças (entrou/saiu/mudou, só preço, centavos), textos do PDF,
  último acerto, vendedor do acerto, tela (verde/laranja/vazio/botão/vendedor/falha), registrar, PDF.
- Mutações conferidas: 7 no app e 5 no banco.
