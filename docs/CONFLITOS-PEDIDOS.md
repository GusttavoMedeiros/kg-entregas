# Publicação: proteção contra conflitos

A migração `20261030165247_conflitos_pedidos.sql` e o aplicativo atualizado precisam ser publicados em conjunto, em uma janela coordenada. Antes da migração, sincronize as filas offline disponíveis e confirme a publicação em um banco de teste com o esquema real. A migração conserva os pedidos existentes e inicializa sua versão em 1.

Após a migração, versões antigas do aplicativo não conseguem editar pedidos ou concluir entregas, pois não enviam versão e identificador. Atualize os aparelhos. Uma entrega antiga ainda na fila é preservada e recusada para conferência pelo administrador; não a descarte sem comparar com o pedido e o recebimento. A versão anterior do aplicativo não é uma reversão compatível com a migração.

O repositório ainda não contém o esquema inicial completo das tabelas. Não gere uma migração inicial a partir dos esquemas simplificados dos testes; obtenha e confira o esquema real em um ambiente isolado.
