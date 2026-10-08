const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Paleta única: cada significado (sucesso, atenção, perigo, informação) tem um
// tom só, com contraste bom no fundo verde-escuro.
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const tokens = fs.readFileSync('styles/design-tokens.css', 'utf8');
const cores = fs.readFileSync('styles/cores.css', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

// Contraste WCAG entre duas cores RGB
const lum = rgb => rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
  .reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05); };
const FUNDO_CARTAO = [13, 37, 25]; // --v2 do ios-like

test('Cada cor de estado tem contraste de texto de pelo menos 7:1 no cartão', () => {
  for (const nome of ['sucesso', 'atencao', 'perigo', 'info']) {
    const m = tokens.match(new RegExp(`--kg-${nome}-rgb:\\s*(\\d+),(\\d+),(\\d+)`));
    assert.ok(m, 'faltou --kg-' + nome + '-rgb');
    const c = contraste(m.slice(1).map(Number), FUNDO_CARTAO);
    assert.ok(c >= 7, `${nome}: contraste ${c.toFixed(1)} abaixo de 7`);
  }
});

test('Os tons soltos antigos saíram do texto (só sobram em fundos com texto branco)', () => {
  for (const hex of ['#ee7d6f', '#ffb4a8', '#f4a04a', '#5dade2', '#7eb8ff', '#58d68d'])
    assert.doesNotMatch(html + app, new RegExp(hex, 'i'), hex + ' ainda usado');
  assert.doesNotMatch(html, /color:\s*#e05a4e/i);
  assert.doesNotMatch(app, /#e05a4e|#7ec850/i);
  assert.doesNotMatch(html, /rgba\((192,57,43|39,174,96|212,121,26|41,128,185|100,180,255),/);
});

test('Os nomes antigos (--gn, --rm...) apontam para a paleta nova', () => {
  for (const [antigo, novo] of [['gn', 'sucesso'], ['am', 'atencao'], ['rm', 'perigo'], ['az', 'info']])
    assert.match(cores, new RegExp(`--${antigo}:\\s*var\\(--kg-${novo}\\)`));
});

test('"Novo pedido" usa um + em texto (o emoji saía roxo sobre o dourado)', () => {
  assert.doesNotMatch(html, /➕/);
  assert.match(html, /<span class="atalho-icone" aria-hidden="true">\+<\/span>/);
});

test('A camada de cores carrega por último e entra no cache offline', () => {
  const i = html.indexOf('styles/cores.css?v=2');
  assert.ok(i > html.indexOf('styles/visual-polish.css') && i > html.indexOf('ios-like.css'));
  assert.match(sw, /'\.\/styles\/cores\.css\?v=2'/);
});
