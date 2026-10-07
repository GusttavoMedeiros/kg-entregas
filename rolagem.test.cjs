const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Rolagem sem trancos: o conteúdo não pode pular e o evento de scroll não pode
// medir a página a cada disparo.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync('ios-like.css', 'utf8');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

test('Cartões sem altura estimada (content-visibility fazia a lista pular)', () => {
  assert.doesNotMatch(css, /content-visibility:\s*auto/);
  assert.doesNotMatch(css, /contain-intrinsic-size/);
});

test('Botão "voltar ao topo" mede a página no máximo uma vez por quadro', () => {
  const ouvintes = [], quadros = [];
  let medicoes = 0;
  const btn = { classList: { toggle() {}, remove() {} } };
  const c = {
    document: {
      getElementById: id => (id === 'btn-topo' ? btn : { style: { display: 'none' } }),
      querySelector: sel => (sel === '.conteudo' ? { get scrollHeight() { medicoes++; return 100; }, clientHeight: 100 } : null),
      addEventListener: (tipo, fn, op) => ouvintes.push({ alvo: 'document', tipo, fn, op }),
    },
    window: { addEventListener: (tipo, fn, op) => ouvintes.push({ alvo: 'window', tipo, fn, op }), scrollY: 600 },
    getComputedStyle: () => ({ overflowY: 'visible' }),
    requestAnimationFrame: fn => { quadros.push(fn); return quadros.length; },
  };
  vm.runInNewContext(trecho('// BOTÃO FLUTUANTE "VOLTAR AO TOPO"', '// RELATÓRIOS'), c);
  const scroll = ouvintes.filter(o => o.tipo === 'scroll');
  assert.equal(scroll.length, 1, 'um ouvinte só (antes eram dois para o mesmo evento)');
  assert.equal(scroll[0].alvo, 'document');
  assert.equal(scroll[0].op.capture, true, 'captura também a rolagem da .conteudo');
  assert.equal(scroll[0].op.passive, true);

  for (let i = 0; i < 10; i++) scroll[0].fn();
  assert.equal(medicoes, 0, 'nada é medido durante o evento');
  assert.equal(quadros.length, 1, '10 eventos no mesmo quadro agendam uma checagem só');
  quadros.shift()();
  assert.equal(medicoes, 1);
  scroll[0].fn();
  assert.equal(quadros.length, 1, 'quadro seguinte agenda de novo');
});
