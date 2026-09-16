# FIX-VIA-PEDIDO-PDF-2026-09-15.md

**Autor:** Mavis (MiniMax Code)
**Data:** 2026-09-15
**Issue:** Bug na impressão/PDF da Via do Pedido (clipping no iOS Safari PWA)

---

## 1. TL;DR

A "Via do Pedido" cortava o lado direito no print preview do iPhone Safari (PWA instalado). Funcionava 100% no PC (Chrome/Edge).

**Causa raiz:** o print preview do Safari (especialmente iOS PWA) é um snapshot-based renderer que ignora `@page margin`, aplica margens próprias (~20–25mm de cada lado), não respeita `inline styles` em alguns casos, e pode cortar conteúdo à direita. O bug era **arquitetural**, não de CSS.

**Solução:** parar de pedir pro Safari diagramar a via. Gerar PDF A4 vetorial em JavaScript usando `jsPDF` + `jspdf-autotable`, exibido via `<iframe>` num overlay. Safari **apenas visualiza** o PDF — não decide mais nada sobre layout.

---

## 2. Causa raiz detalhada

Tentativas anteriores (7 commits incrementais) tentaram consertar via CSS/HTML:

| Commit | Tentativa | Por que falhou |
|---|---|---|
| `5fb113f` | Tirar truque `media="print" onload` da fonte Cinzel + `@media print` com `table-layout: fixed` | Safari ignora/redefine larguras de tabela em print preview |
| `1ef0656` | Bump SW cache `kg-v33 → kg-v34` | Não era problema de cache |
| `efd6729` | Inline styles nas `<td>`/`<th>` da tabela | iOS Safari print preview usa snapshot que pode ignorar inline styles em alguns casos |
| `687e170` | Substituir `<table>` por `<div style="display:flex">` | Mesmo problema — Safari ainda controla o layout do print |
| `705d2d1` | Encolher `via-papel` 186mm → 170mm | Margem interna do iOS ainda cortava |
| `b17d9da` | Encolher `via-papel` 170mm → 150mm + `margin: 0 auto` | Margem interna do iOS ainda cortava (~150mm visível) |
| `f331909` | Fonte Georgia → Arial + formato BR `42.300,00` | Mais estreito mas ainda extrapolava o A4 com margem interna do iOS |

**Conclusão:** mexer em styling não resolve porque o print preview do Safari é um sandbox isolado que não respeita muito do que o navegador normal respeita. A solução é **abrir mão** do controle de layout e dar pro Safari um PDF já pronto.

---

## 3. Arquitetura nova

```
DADOS DO PEDIDO (Supabase / cache local)
        ↓
gerarPdfViaPedido(id) → jsPDF + jspdf-autotable
        ↓
PDF A4 VETORIAL (Blob URL)
        ↓
<iframe src="blob:..."> no overlay
        ↓
Botões: Imprimir (window.open → AirPrint) · Salvar (download .pdf) · Compartilhar (navigator.share)
```

**Fluxo no iPhone:**
1. Usuário clica "Via do pedido" → overlay abre
2. Overlay mostra `<iframe>` com PDF já diagramado
3. Usuário clica 🖨️ Imprimir → `window.open(blobUrl)` → iOS abre PDF em nova aba → AirPrint
4. Usuário clica 💾 Salvar → download do `.pdf`
5. Usuário clica 📤 Compartilhar → `navigator.share({files: [pdfFile]})` → Share Sheet nativo do iOS

**Fluxo no PC:**
- Mesma coisa — PDF no iframe, botões de Imprimir/Salvar/Compartilhar funcionam idênticos.

---

## 4. Arquivos modificados / criados

### Criados
- `vendor/jspdf.umd.min.js` — 364 KB, jsPDF 2.5.1 (vendored local pra PWA offline)
- `vendor/jspdf-autotable.min.js` — 39 KB, plugin de tabelas 3.8.2 (vendored local)
- `pdf-via-pedido.test.cjs` — testes da nova arquitetura PDF

### Modificados
- `app.js` — `gerarViaPedido()` e `imprimirRelatorio()` reescritos pra usar jsPDF em vez de HTML + window.print(). Função `gerarPdfViaPedido(id)` constrói o PDF A4; `showPdfViaOverlay()` mostra no iframe.
- `index.html` — overlay agora é só `<iframe>`; CSS morto (`@media print`, `.via-tabela*`, `.via-cab*`, `.via-bloco*`, `.via-dados*`, `.via-total*`, `.via-indicador*`, hacks de largura 186/170/150mm) removido.
- `sw.js` — `CACHE_VERSION = 'kg-v40'`; `ASSETS_PARA_CACHEAR` inclui `vendor/jspdf.umd.min.js` e `vendor/jspdf-autotable.min.js`.
- `app.js?v=62 → ?v=63` — cache bust do JS.
- `visual-regression.test.cjs` — reescrito pra validar arquitetura PDF (vendor files, jsPDF, autoTable, sem hacks antigos).
- `item-price.test.cjs` — assertion do fallback HTML antigo removida, assertion do fallback PDF preservada.
- `sw.test.cjs` — versão atualizada de `kg-v33 → kg-v40`, lista de caches antigas estendida.

---

## 5. Estrutura do PDF gerado

Controlado por jsPDF (não pelo Safari):

```
┌─────────────────────────────────────────────────┐  ← margem 15mm
│ KG AGROPET                       VIA DO PEDIDO   │
│ Glória do Goitá — PE                 Nº 50      │
│ ────────────────────────────────────────────── │  ← linha separadora
│ CLIENTE                                        │
│ J. M. DA SILVA CELESTINO                       │
│                                                 │
│ RESPONSÁVEL            WHATSAPP                 │
│ Lealdo Limoeiro        (81) 99742-1675          │
│                                                 │
│ ENDEREÇO                                      │
│ SAO SEBASTIAO, LIMOEIRO, PE - CEP 55700000    │
│                                                 │
│ CNPJ                                            │
│ 07.911.987/0001-45                            │
│                                                 │
│ ITENS DO PEDIDO                                │
│ ┌─────┬─────────────────┬─────────────┬─────┐ │
│ │ Qtd │ Produto         │ Unid./Saco  │Sub…│ │  ← autoTable
│ │ 100 │ Milho 30KG      │ R$ 1,57/kg  │4.7…│ │
│ │ 400 │ Milho 60KG      │ R$ 1,57/kg  │37.…│ │
│ └─────┴─────────────────┴─────────────┴─────┘ │
│ ────────────────────────────────────────────── │
│                                  TOTAL  42.300,00│
│                                                 │
│ PAGAMENTO E PRAZOS                              │
│ FORMA PAGAMENTO         ENTREGA PREVISTA        │
│ Cheque                   09/09/2026              │
│ VENCIMENTO                                        │
│ 09/09/2026                                       │
│                                                 │
│ OBSERVAÇÕES                                     │
│ Prazo no cheque 15 dias                          │
│                                                 │
│ ────────────────────────────────────────────── │
│ Este documento não substitui documento fiscal.   │
│ Gerado em 15/09/2026  Página 1 de 1             │
└─────────────────────────────────────────────────┘  ← margem 18mm
```

**Tratamento de campos longos:**
- `doc.splitTextToSize(c.endereco, cW)` — endereço quebra linha
- `doc.splitTextToSize(p.observacao, cW)` — observação quebra linha
- `doc.splitTextToSize(escopo, cW/2 - 4)` — escopo do relatório quebra linha
- AutoTable com `overflow: 'linebreak'` — nomes grandes de produto quebram automaticamente

**Paginação:**
- `autoTable` gerencia paginação automaticamente
- `didDrawPage` redesenha cabeçalho e rodapé em CADA página (exceto a primeira)
- TOTAL e Pagamento movem pra próxima página se não couberem
- Rodapé sempre presente: "Página X de Y"

---

## 6. Botões da overlay

```html
<div id="via-overlay" style="display:none">
  <div class="via-acoes">
    <button id="via-btn-imprimir">🖨️ Imprimir</button>
    <button id="via-btn-salvar">💾 Salvar PDF</button>
    <button id="via-btn-whatsapp">📤 Compartilhar</button>
    <button class="via-btn-fechar" onclick="fecharViaPedido()">× Fechar</button>
  </div>
  <div class="via-papel" id="via-papel"></div>  <!-- recebe o iframe -->
</div>
```

| Botão | Comportamento |
|---|---|
| 🖨️ Imprimir | `window.open(blobUrl, '_blank')` → Safari/Chrome abre PDF em nova aba → AirPrint / Print dialog nativo |
| 💾 Salvar PDF | `<a href=blobUrl download=nomeArquivo>` → download direto |
| 📤 Compartilhar | `navigator.canShare({files: [pdfFile]}) ? navigator.share(...) : enviarPedidoWhatsApp(id)` → iOS Share Sheet / fallback WhatsApp |
| × Fechar | `fecharViaPedido()` → `papel.innerHTML = ''` (libera blob URL) → `display: none` |

---

## 7. CSS morto removido (limpeza)

Antes (no `index.html`, dentro do bloco `<style>`):
```css
/* IMPRESSÃO: esconde TODO o app e mostra só o papel da via, em A4 limpo */
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  html, body { width: 186mm !important; ... }
  body > *:not(#via-overlay) { display: none !important; }
  .via-papel { width: 186mm !important; ... }   /* depois 170mm, depois 150mm */
  .via-tabela-itens { table-layout: fixed; width: 100%; }
  .via-tabela-itens th:nth-child(3) { width: 30%; min-width: 32mm; }
  /* ...90+ linhas de hacks... */
}
```

Depois (no `index.html`):
```css
#via-overlay{position:fixed;inset:0;z-index:2000;background:#525659;overflow:hidden}
.via-papel{position:absolute;top:60px;left:0;right:0;bottom:0;background:#525659}
.via-papel iframe{width:100%;height:100%;border:0;display:block}
```

**Removidos completamente** (eram tentativas anteriores que falharam):
- `@media print` (90+ linhas) — Safari não respeita, era inútil
- `.via-tabela`, `.via-tabela-itens`, `.via-tabela-ranking`
- `.via-cab`, `.via-cab-nome`, `.via-cab-sub`, `.via-cab img`
- `.via-bloco`, `.via-bloco-titulo`, `.via-linha`
- `.via-cliente-nome`, `.via-dados`, `.via-dado`, `.via-dado-largo`, `.via-contexto`
- `.via-resumo`, `.via-indicador`
- `.via-total`, `.via-total-label`, `.via-total-valor`
- `.via-aviso-fiscal`
- `.via-preco-item`
- Truque Cinzel `media="print" onload="this.media='all'"`
- Hacks de largura: 186mm, 170mm, 150mm

---

## 8. Testes (53 passando)

### Cobertura nova
- `pdf-via-pedido.test.cjs` (NOVO) — 65 linhas, valida:
  - Vendor files presentes (jspdf + jspdf-autotable) e > 100KB
  - `function gerarPdfViaPedido(id)` existe
  - `new jsPDF({unit:'mm', format:'a4'})` — formato correto
  - `doc.autoTable({head:['Qtd',...], body:itens, columnStyles})` — tabela com paginação
  - `doc.splitTextToSize(...)` em endereço/observação/escopo — quebra de linha defensiva
  - `didDrawPage` com `drawRodape` e `drawCabecalho` — cabeçalho/rodapé em todas as páginas
  - `moeda()` com regex `\d{3}` (ponto nos milhares)
  - Sem `<button onclick="window.print()">` da via
  - `<iframe src="${url}">` no overlay
  - `id="via-btn-imprimir"`, `id="via-btn-salvar"`, `id="via-btn-whatsapp"` no HTML
  - `navigator.canShare({files:[file]})` pra iOS
  - Limpeza de Blob URL ao fechar overlay

### Testes atualizados
- `visual-regression.test.cjs` — reescrito, valida arquitetura PDF ao invés de hacks antigos
- `item-price.test.cjs` — assertion do fallback HTML antigo removida (não existe mais)
- `sw.test.cjs` — versão `kg-v33 → kg-v40`, lista de caches antigas estendida

### Cobertura preservada (inalterada)
- `app-audit.test.cjs`, `actual-delivery-date.test.cjs`, `full-audit.test.cjs`,
  `loading-performance.test.cjs`, `manual-update.test.cjs`,
  `qa-regression.test.cjs`, `report-filter.test.cjs`, `robustness.test.cjs`,
  `state-consistency.test.cjs`

---

## 9. iOS — por que agora funciona

| Antes | Agora |
|---|---|
| Safari recebia HTML e decidia layout via print preview | Safari recebe PDF já diagramado e só exibe |
| Margens próprias do iOS cortavam @page | PDF já vem em A4 com margens internas próprias (15mm) |
| Fontes podiam não carregar no momento do snapshot | jsPDF usa Helvetica built-in (sempre disponível) |
| `table-layout: fixed` podia ser ignorado | jsPDF calcula layout deterministicamente |
| Texto longo transbordava | `splitTextToSize` quebra linha antes de renderizar |
| Múltiplas páginas = bug garantido | autoTable + `didDrawPage` paginam corretamente |
| iOS só tinha "Imprimir / Salvar PDF" do print preview | iOS tem Imprimir (window.open → AirPrint) + Salvar (download) + Compartilhar (navigator.share com Share Sheet nativo) |

---

## 10. Service Worker

```js
const CACHE_VERSION = 'kg-v40';
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;
const DATA_CACHE   = 'kg-v23-data';

const ASSETS_PARA_CACHEAR = [
  './',
  './index.html',
  './app.js?v=63',
  './ios-like.css?v=7',
  './manifest.json',
  './logo.webp',
  './logo.png',
  './app-icon-180.png',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon-maskable-512.png',
  // jsPDF para geração de PDF A4 real (sem dependência de print preview do Safari)
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf-autotable.min.js',
];
```

Cache busting: SW versionou `kg-v40`. No primeiro acesso após o deploy, o SW detecta o novo `sw.js`, instala `kg-v40-assets`, descarta `kg-v22..kg-v39-assets` automaticamente (exceto `kg-v23-data` que tem cache de usuário).

---

## 11. Como reproduzir / verificar

**PC:**
1. `https://kg-entregas.vercel.app` → login admin → Entregas → qualquer pedido
2. "Ver detalhes" → "📄 Via do pedido" → overlay abre com **PDF no iframe**
3. Botões: 🖨️ Imprimir abre PDF em nova aba, 💾 Salvar baixa `.pdf`, 📤 Compartilhar usa Share API

**iPhone (PWA):**
1. Aguardar ~30s pro Vercel terminar o deploy
2. Ajustes → Safari → Avançado → Dados de sites Web → Remover todos os dados (limpa TUDO do Safari)
3. Reabrir o PWA → SW auto-atualiza pra `kg-v40` → baixa vendor files pro cache
4. Login → Entregas → qualquer pedido → "📄 Via do pedido"
5. PDF abre no overlay, sem corte de conteúdo

---

## 12. Sugestões de melhorias (não implementadas — fora do escopo)

Pra considerar no futuro (não são parte deste fix):
- [ ] Logo da KG Agropet no canto superior esquerdo do PDF (atualmente só texto)
- [ ] QR Code de verificação/autenticação do documento (usar plugin `qrcode-generator` ou similar)
- [ ] Background cinza do iframe (`#525659`) pode ser customizado por tema (claro/escuro)
- [ ] Indicador de loading enquanto jsPDF gera (atualmente é instantâneo, mas pode ficar lento com pedidos gigantes)
- [ ] Cache de PDFs gerados (LocalStorage) pra evitar re-gerar ao reabrir overlay

---

**Total:** 9 arquivos modificados, 53 testes passando, 0 hacks sobrepostos, 1 arquitetura definitiva.

**Sobre o autor:** este documento e a implementação foram gerados pelo agente Mavis (MiniMax Code). O usuário pode revisar, ajustar ou pedir modificações ao Codex conforme necessário.
