# Rolagem com trancos — 07/10/2026

## Sintoma
A tela "dava uns trancos" (stuttering) ao rolar as listas.

## Causa (medida)
Medição com celular simulado (390px, processador 4x mais lento), 60 pedidos e
40 clientes, rolando até o fim, atualizando a lista e voltando ao topo:

| Tela | Pulos de conteúdo (CLS) antes | depois |
|---|---|---|
| Entregas (admin) | 0,27 | 0 |
| Clientes | 1,07 | 0 |
| Catálogo | 0,71 | 0 |
| Entregas (entregador) | **4,30** | 0 |

(Acima de 0,25 já é considerado ruim.)

1. **Cartões com altura estimada.** O CSS usava `content-visibility:auto` com
   altura estimada de 172px para todos os cartões. Os reais têm de ~70px
   (cliente) a ~400px (entrega com conferência de carga). Ao entrar na tela, o
   cartão mudava de tamanho e a página pulava; a cada atualização da lista a
   estimativa voltava. No iPhone, que não compensa o pulo, era pior. A página
   também ficava com a altura errada (Clientes: 5.599px em vez de 3.589px).
   **Correção:** removido. As listas são pequenas; desenhar tudo é mais leve
   que o tranco.
2. **Botão "voltar ao topo".** A cada evento de rolagem (e em dobro: um
   ouvinte na janela e outro no documento) ele media a página
   (`getComputedStyle`, `scrollHeight`). **Correção:** um ouvinte só e no
   máximo uma medição por quadro. Tempo gasto nos eventos de rolagem: de 40ms
   para 4ms na lista de entregas.

## Testes
`rolagem.test.cjs` (2), conferido por mutação; suíte: 182 passando; auditoria
no navegador sem erros. Versões: `kg-v66`, `app.js?v=88`, `ios-like.css?v=8`.
Sem mudança no banco.
