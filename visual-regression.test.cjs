const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('ios-like.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');
const appjs = fs.readFileSync('app.js', 'utf8');
const tokens = fs.readFileSync('styles/design-tokens.css', 'utf8');
const polish = fs.readFileSync('styles/visual-polish.css', 'utf8');

// ============================================================================
// REGRAS GERAIS DE UI (inalteradas — botões, layout, acessibilidade)
// ============================================================================

// Regressão observada no iPhone: a regra genérica de .atalho-card não pode
// apagar o fundo dourado do botão principal.
assert.match(css, /\.atalho-card\.atalho-novo\s*\{[^}]*background:var\(--go\)/s);
assert.match(css, /\.atalho-card\.atalho-novo \.atalho-label\s*\{[^}]*color:#102317/s);

// O documento e os grids compartilhados pelos três perfis não podem criar
// uma área arrastável na horizontal.
assert.match(css, /html\s*\{[^}]*overflow-x:hidden/s);
assert.match(css, /@supports \(overflow:clip\)/);
assert.match(css, /\.atalhos-row\s*\{\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/s);
assert.doesNotMatch(html, /\*:hover\s*\{[^}]*box-shadow/s);

// Acessibilidade: o refinamento de movimento respeita a preferência do SO.
assert.match(css, /prefers-reduced-motion:reduce[\s\S]*\.tela\.ativa[\s\S]*animation:none !important/);

// Aparelhos fracos recebem uma composição mais simples antes da pintura.
assert.match(html, /deviceMemory&&n\.deviceMemory<=4/);
assert.match(html, /hardwareConcurrency&&n\.hardwareConcurrency<=4/);
assert.doesNotMatch(html, /family=Nunito/);
assert.match(css, /html\.modo-economico \.header[\s\S]*backdrop-filter:none/);
assert.match(css, /#tela-login\s*\{[^}]*overflow-y:auto/s);
assert.match(css, /max-height:700px[\s\S]*#tela-login[\s\S]*justify-content:flex-start/);
assert.match(css, /@supports \(content-visibility:auto\)[\s\S]*contain-intrinsic-size:auto 172px/);
assert.match(html, /ios-like\.css\?v=7/);
assert.match(html, /styles\/design-tokens\.css\?v=1/);
assert.match(html, /styles\/visual-polish\.css\?v=1/);
assert.match(tokens, /--kg-motion-ease/);
assert.match(polish, /kgModalSheet/);
assert.match(polish, /prefers-reduced-motion: reduce/);
assert.match(css, /\.stagger-in:nth-child\(n\+7\) \{ animation:none; \}/);
assert.match(css, /@media \(update:slow\)/);

// ============================================================================
// ARQUITETURA: PDF (jsPDF + autoTable), não mais HTML + window.print()
//
// Por quê: o print preview do Safari (especialmente iOS PWA) ignora @page
// margin, aplica margens próprias, e corta conteúdo à direita — mesmo com
// inline styles, table-layout fixed e fonte Arial. Várias tentativas em
// commits 5fb113f..f331909 não resolveram.
//
// Solução adotada (commit atual): gerar PDF A4 vetorial em JavaScript
// (jsPDF + jspdf-autotable), exibido via iframe no overlay. O Safari
// apenas VISUALIZA o PDF — não decide mais nada sobre layout.
// ============================================================================

// Vendored: jsPDF + autoTable devem estar no projeto (não CDN) pro PWA
// funcionar offline, mas são carregados sob demanda para não bloquear o login.
assert.doesNotMatch(html, /<script[^>]+vendor\/(?:pdf|jspdf)/);
assert.match(appjs, /_carregarBibliotecasPdf/);
assert.ok(fs.existsSync('vendor/jspdf.umd.min.js'), 'jspdf vendor file missing');
assert.ok(fs.existsSync('vendor/jspdf-autotable.min.js'), 'jspdf-autotable vendor file missing');

// SW deve cachear os novos arquivos vendor (pra PWA offline)
assert.match(sw, /'\.\/vendor\/jspdf\.umd\.min\.js'/);
assert.match(sw, /'\.\/vendor\/jspdf-autotable\.min\.js'/);
assert.match(sw, /'\.\/styles\/design-tokens\.css\?v=1'/);
assert.match(sw, /'\.\/styles\/visual-polish\.css\?v=1'/);

// JS deve usar jsPDF pra gerar a via (não mais HTML inline)
assert.match(appjs, /function gerarPdfViaPedido/);
assert.match(appjs, /new jsPDF\(\s*\{\s*unit:\s*'mm',\s*format:\s*'a4'/);
assert.match(appjs, /doc\.autoTable\(/);

// JS não pode mais montar a via via HTML + innerHTML (a causa raiz do clipping)
assert.doesNotMatch(appjs, /document\.getElementById\('via-papel'\)\.innerHTML\s*=\s*`<div class="via-cab">/);
assert.doesNotMatch(appjs, /document\.getElementById\('via-papel'\)\.innerHTML\s*=\s*\`<div class="via-cab">/);

// O overlay agora é um iframe (PDF), não HTML
assert.match(html, /<div class="via-papel" id="via-papel"><\/div>/);
assert.match(appjs, /<iframe[^>]+src="\$\{url\}"[^>]*><\/iframe>/);

// Botões de ação: Imprimir / Salvar / Compartilhar / Fechar
assert.match(html, /id="via-btn-imprimir"/);
assert.match(html, /id="via-btn-salvar"/);
assert.match(html, /id="via-btn-whatsapp"/);
assert.match(html, /class="via-btn via-btn-fechar"/);

// ============================================================
// REGRESSÃO: garantir que o caminho antigo de HTML+print foi removido
// ============================================================

// Não pode mais haver @media print tentando diagramar a via (já que agora é PDF)
assert.doesNotMatch(html, /@media print\s*\{[^}]*@page\s*\{\s*size:\s*A4 portrait/);
assert.doesNotMatch(html, /table-layout:\s*fixed.*via-tabela-itens/s);

// CSS morto removido (todas essas classes eram do HTML antigo da via)
assert.doesNotMatch(html, /\.via-cab-nome\s*\{/);
assert.doesNotMatch(html, /\.via-tabela-itens\s*\{/);
assert.doesNotMatch(html, /\.via-tabela-ranking\s*\{/);
assert.doesNotMatch(html, /\.via-indicador b\s*\{/);
assert.doesNotMatch(html, /\.via-total-valor\s*\{/);

// Truque antigo do Cinzel (media="print" onload) — nunca mais
assert.doesNotMatch(html, /fonts\.googleapis\.com[^"]*Cinzel[^"]*media="print"/);
assert.doesNotMatch(html, /this\.media='all'/);

// JS não chama mais window.print() da via (agora é window.open no blob URL)
assert.doesNotMatch(appjs, /<button class="via-btn via-btn-imprimir" onclick="window\.print\(\)">/);

console.log('UI, acessibilidade, PDF-via-pedido e regressão de hacks antigos validados.');
