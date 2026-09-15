const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('ios-like.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

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
assert.match(css, /\.stagger-in:nth-child\(n\+7\) \{ animation:none; \}/);
assert.match(css, /@media \(update:slow\)/);

// Regressão do print da via (iOS Safari): o TOTAL e a coluna SUBTOTAL somem
// se a fonte Cinzel for carregada com truque media="print" onload e as colunas
// da tabela não tiverem largura explícita. Não voltar atrás.
//
// Cobertura (geral, vale pra TODOS os pedidos):
//   - Cinzel não pode usar truque media="print" onload (causa snapshot sem fonte)
//   - Todas as 4 colunas da tabela de itens com largura explícita em print
//   - TODO texto Cinzel dentro do papel cai pra Georgia/serif em print
//   - Cor do texto em print forçada a #111 (evita herdar tema escuro)
assert.doesNotMatch(html, /fonts\.googleapis\.com[^"]*Cinzel[^"]*media="print"/);
assert.doesNotMatch(html, /this\.media='all'/);
// Tabela de itens com largura fixa em print
assert.match(html, /\.via-tabela-itens\s*\{[^}]*table-layout:\s*fixed/s);
assert.match(html, /\.via-tabela-itens td:first-child[\s\S]{0,200}width:\s*10%/);
assert.match(html, /\.via-tabela-itens th:nth-child\(2\)[\s\S]{0,200}width:\s*38%/);
assert.match(html, /\.via-tabela-itens th:nth-child\(3\)[\s\S]{0,200}min-width:\s*32mm/);
assert.match(html, /\.via-tabela-itens th:nth-child\(4\)[\s\S]{0,200}min-width:\s*30mm/);
// Fallback de fonte pra TODOS os Cinzel dentro do papel (Arial/sans-serif agora,
// fonte estreita pra caber mais conteúdo na largura do papel A4)
assert.match(html, /\.via-papel \.via-cab-nome[\s\S]{0,400}font-family:\s*Arial/s);
assert.match(html, /\.via-papel \.via-indicador b[\s\S]{0,400}font-family:\s*Arial/s);
assert.match(html, /\.via-papel \.via-total-valor[\s\S]{0,400}font-family:\s*Arial/s);
// Cor visível forçada em print
assert.match(html, /\.via-papel \.via-total-valor[\s\S]{0,400}color:\s*#111\s*!important/s);

console.log('Contraste, largura móvel, movimento e modo econômico validados.');
