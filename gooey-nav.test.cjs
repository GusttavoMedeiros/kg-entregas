const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Efeito "gooey" na barra de navegação e nos grupos de abas: filtro SVG só na
// camada de trás (ícones e textos nítidos), alternativa simples para aparelhos
// fracos e nenhum uso fora dos seletores de "onde estou".
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const polish = fs.readFileSync('styles/visual-polish.css', 'utf8').replace(/\r\n/g, '\n');
const regra = sel => {
  const i = polish.indexOf(sel + ' {');
  assert.ok(i >= 0, 'não achei ' + sel);
  return polish.slice(i, polish.indexOf('}', i));
};
const ms = (corpo) => Number(corpo.match(/transform\s+(\d+)ms/)[1]);

test('O filtro SVG #kg-goo existe, com desfoque e corte de opacidade', () => {
  assert.match(html, /<filter id="kg-goo"/);
  assert.match(html, /<feGaussianBlur[^>]*stdDeviation="\d+"/);
  assert.match(html, /<feColorMatrix[^>]*values="[^"]*22 -10"/);
});

test('Barra e abas usam o filtro só na camada de trás, com duas bolhas', () => {
  assert.match(regra('.nav-indicator,\n.aba-gota'), /filter:\s*url\(#kg-goo\)/);
  assert.ok(ms(regra('.nav-bottom.nav-indicator-ready .nav-indicator::after')) > ms(regra('.nav-bottom.nav-indicator-ready .nav-indicator::before')));
  assert.ok(ms(regra('.com-gota.gota-pronta > .aba-gota::after')) > ms(regra('.com-gota.gota-pronta > .aba-gota::before')));
});

test('Sem excesso: o filtro gooey só aparece no indicador da barra e na gota das abas', () => {
  const semComentarios = polish.replace(/\/\*[\s\S]*?\*\//g, '');
  const usos = [...semComentarios.matchAll(/([^{}]+)\{[^}]*filter:\s*url\(#kg-goo\)/g)].map(m => m[1].trim());
  assert.deepEqual(usos.map(u => u.replace(/\s+/g, ' ')), ['.nav-indicator, .aba-gota']);
  for (const arq of ['ios-like.css', 'styles/design-tokens.css']) assert.doesNotMatch(fs.readFileSync(arq, 'utf8'), /kg-goo/);
});

test('Movimento reduzido, aparelho fraco e modo econômico não usam o filtro', () => {
  const reduzido = polish.slice(polish.indexOf('@media (prefers-reduced-motion: reduce), (update: slow)'));
  const bloco = reduzido.slice(0, reduzido.indexOf('html.modo-economico'));
  assert.match(bloco, /\.nav-indicator, \.aba-gota \{[^}]*filter:\s*none/);
  assert.match(bloco, /\.nav-indicator::after, \.aba-gota::after \{ display: none; \}/);
  assert.match(polish, /html\.modo-economico \.nav-indicator,\nhtml\.modo-economico \.aba-gota \{ filter: none; \}/);
});

test('No computador a barra lateral também tem o indicador (não fica mais escondido)', () => {
  assert.doesNotMatch(polish, /\.nav-indicator\s*\{\s*display:\s*none/);
  assert.match(app, /--nav-indicator-y/);
});

test('A gota vai para a aba ativa e só viaja depois de posicionada', () => {
  const vars = {}, classes = new Set();
  const ativa = { offsetLeft: 120, offsetTop: 4, offsetWidth: 100, offsetHeight: 38 };
  const gota = { style: { setProperty: (k, v) => { vars[k] = v; } } };
  const grupo = {
    querySelector: sel => (sel.includes('aba-gota') ? gota : ativa),
    classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
  };
  const quadros = [];
  const c = { requestAnimationFrame: fn => quadros.push(fn) };
  vm.createContext(c);
  const i = app.indexOf('function posicionarGotaAba');
  vm.runInContext(app.slice(i, app.indexOf('\nfunction iniciarGotasAbas', i)), c);
  c.posicionarGotaAba(grupo, false);
  assert.deepEqual(vars, { '--gx': '120px', '--gy': '4px', '--gw': '100px', '--gh': '38px' });
  assert.equal(classes.has('gota-pronta'), false, 'primeira vez: aparece no lugar, sem viajar');
  while (quadros.length) quadros.shift()();
  assert.equal(classes.has('gota-pronta'), true);
  ativa.offsetWidth = 0; vars['--gx'] = 'x';
  c.posicionarGotaAba(grupo, true);
  assert.equal(vars['--gx'], 'x', 'grupo escondido não mexe na gota');
});

test('Versões trocadas para o cache atualizar', () => {
  assert.match(html, /visual-polish\.css\?v=3/);
  assert.match(fs.readFileSync('sw.js', 'utf8'), /visual-polish\.css\?v=3/);
});
