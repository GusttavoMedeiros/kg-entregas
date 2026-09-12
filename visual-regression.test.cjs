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
assert.match(html, /ios-like\.css\?v=6/);
assert.match(css, /\.stagger-in:nth-child\(n\+7\) \{ animation:none; \}/);
assert.match(css, /@media \(update:slow\)/);

console.log('Contraste, largura móvel, movimento e modo econômico validados.');
