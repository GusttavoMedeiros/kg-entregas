# Paginação das Entregas e limite da observação (2026-10-08)

Dois achados da bateria de estresse de 2026-10-08.

## 1. Lista de Entregas em lotes (app, v67)
- Admin: a lista mostra 30 entregas por vez, com botão "Ver mais" (igual ao catálogo).
  Trocar de aba (Pendentes / Entregues / Todas) recomeça do primeiro lote.
- Ordem: pendentes primeiro (data mais próxima no topo); entregues da mais recente para a mais antiga.
  Antes todas saíam da data mais antiga para a mais nova, o que esconderia o que importa atrás do "Ver mais".
- Entregador: continua vendo todas as pendentes (e a rota por bairro inteira), sem paginar.
- Medição (1.500 pedidos, CPU 4x mais lenta): 1.250 ms -> cerca de 20 ms para montar a tela.

## 2. Limite de 1000 caracteres na observação (banco + app)
- Migration `20261008120000_limite_observacao.sql`: CHECK em `pedidos.observacao` e `clientes.observacao`.
  Antes o banco aceitava 1.000.000 de caracteres. A maior observação real tinha 45.
- Os 3 campos de observação do app (`pedido-obs`, `cliente-observacao`, `entrega-obs`) têm `maxlength="1000"`.
- Mudança aditiva: nenhum dado alterado; o app antigo continua funcionando.

Testes: `limites-paginacao.test.cjs`.
