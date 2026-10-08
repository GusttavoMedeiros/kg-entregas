const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Indicador "gooey" da barra de navegação: filtro SVG só na camada de trás
// (ícones e textos continuam nítidos) e alternativa simples para aparelhos fracos.
const html = fs.readFileSync('index.html', 'utf8');
const polish = fs.readFileSync('styles/visual-polish.css', 'utf8').replace(/\r\n/g, '\n');
const bloco = (css, abre) => { const i = css.indexOf(abre); assert.ok(i >= 0, 'não achei ' + abre); return css.slice(i, css.indexOf('}', i) + 1); };

test('O filtro SVG #kg-goo existe, com desfoque e corte de opacidade', () => {
  assert.match(html, /<filter id="kg-goo"/);
  assert.match(html, /<feGaussianBlur[^>]*stdDeviation="\d+"/);
  assert.match(html, /<feColorMatrix[^>]*values="[^"]*22 -10"/);
});

test('O indicador tem duas bolhas (a da frente e a que chega atrasada) e usa o filtro', () => {
  assert.match(bloco(polish, '.nav-indicator {'), /filter:\s*url\(#kg-goo\)/);
  assert.match(polish, /\.nav-indicator::before,\s*\.nav-indicator::after\s*\{/);
  const frente = polish.match(/nav-indicator-ready \.nav-indicator::before\s*\{[^}]*\}/)[0];
  const atras = polish.match(/nav-indicator-ready \.nav-indicator::after\s*\{[^}]*\}/)[0];
  const dur = t => Number(t.match(/transform\s+(\d+)ms/)[1]);
  assert.ok(dur(atras) > dur(frente), 'a bolha de trás precisa demorar mais para formar a gota');
});

test('Os ícones e textos da barra ficam fora do filtro (nítidos)', () => {
  assert.doesNotMatch(bloco(polish, '.nav-item {'), /filter/);
  assert.doesNotMatch(polish, /\.nav-bottom\s*\{[^}]*filter\s*:\s*url/);
});

test('Movimento reduzido, aparelho fraco e modo econômico não usam o filtro', () => {
  const reduzido = polish.slice(polish.indexOf('@media (prefers-reduced-motion: reduce), (update: slow)'));
  assert.match(reduzido.slice(0, reduzido.indexOf('html.modo-economico')), /\.nav-indicator \{[^}]*filter:\s*none/);
  assert.match(polish, /html\.modo-economico \.nav-indicator \{ filter: none; \}/);
  assert.match(polish, /html\.modo-economico \.nav-indicator::after \{ display: none; \}/);
});

test('A versão do CSS foi trocada para o cache atualizar', () => {
  assert.match(html, /visual-polish\.css\?v=2/);
  assert.match(fs.readFileSync('sw.js', 'utf8'), /visual-polish\.css\?v=2/);
});
