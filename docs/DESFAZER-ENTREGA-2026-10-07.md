# Desfazer entrega (só administrador) — 07/10/2026

## Problema
Pedido entregue não pode ser editado (a função `salvar_pedido` só aceita pedidos pendentes).
Então uma devolução, um item errado ou uma entrega marcada por engano não tinham como ser corrigidos pelo app.

## Solução
No detalhe de um pedido **entregue**, o administrador vê **"↩ Desfazer entrega"**. Depois de confirmar:
- o pedido volta para **pendente**: sai do relatório de entregas, volta para a lista de entregas e pode ser editado;
- **pagamento já recebido continua valendo** (na nova entrega o banco o preserva);
- "a receber" / "não pagou" são apagados e voltam a ser perguntados na próxima entrega;
- entrega parcial: os itens que faltaram não voltam sozinhos (o aviso diz para ajustar o pedido, se precisar);
- se a comissão do período já foi acertada, o relatório mostra o pedido como "saiu do período" (ver ACERTO-COMISSAO);
- o histórico do pedido mostra "Entrega desfeita".

Só com internet. A alteração usa `?id=eq.N&status=eq.entregue`: se outro aparelho já desfez, nada muda e a tela recarrega.

## Banco
Nenhuma mudança: o administrador já podia alterar pedidos (RLS). Entregador e vendedor não conseguem desfazer
(a RLS deles só permite mexer em pedidos pendentes). A data da entrega antiga fica guardada até a nova entrega.

## Testes
- `desfazer-entrega.test.cjs` (8): confirmação, alteração enviada, pagamento pago mantido, parcial, só admin/entregue/online,
  erro e pedido já desfeito, modo demonstração, botão e histórico.
- `entregador-db.test.cjs` (+2): com as regras reais do banco — entregador/vendedor não desfazem; admin desfaz;
  nova entrega pede o pagamento de novo e grava a data nova; pagamento pago preservado.
- Mutações conferidas (6).
