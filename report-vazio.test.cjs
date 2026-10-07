const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Relatório de período sem entregas: mantém o resumo (zerado) e o filtro de
// vendedor. Antes, o vendedor escolhido sumia dos botões se ele não tivesse
// entregado nada no período, e o filtro continuava ativo sem ninguém ver.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente() {
  const c = { Set, Array };
  vm.createContext(c);
  vm.runInContext(trecho('function nomeVendedorRelatorio(', 'function qtdTexto(') +
    trecho('function vendedoresDoFiltro(', 'function mudarVendedorRelatorio('), c);
  return c;
}

test('O vendedor escolhido continua na lista mesmo sem entregas no período', () => {
  const c = ambiente();
  assert.deepEqual(Array.from(c.vendedoresDoFiltro([], 'admin')), ['admin']);
  assert.deepEqual(Array.from(c.vendedoresDoFiltro(['vendedor'], 'admin')), ['admin', 'vendedor'], 'em ordem alfabética do nome mostrado');
  assert.deepEqual(Array.from(c.vendedoresDoFiltro(['admin', 'vendedor'], 'admin')), ['admin', 'vendedor'], 'sem duplicar');
});

test('Sem vendedor escolhido, só entram os do período', () => {
  const c = ambiente();
  assert.deepEqual(Array.from(c.vendedoresDoFiltro(['vendedor'], '')), ['vendedor']);
  assert.deepEqual(Array.from(c.vendedoresDoFiltro([], '')), []);
});

test('Tela: período vazio mantém resumo e filtro, e diz de quem é o relatório', () => {
  const tela = trecho('function renderizarRelatorio(', 'async function gerarPdfRelatorio(');
  assert.match(tela, /vendedoresDoFiltro\(vendedores, relVendedor\)/);
  assert.match(tela, /\['', \.\.\.listaVendedores\]/, 'os botões usam a lista com o vendedor escolhido');
  const vazio = tela.slice(tela.indexOf('if (!pedidos.length) {'), tela.indexOf('el.innerHTML = `', tela.indexOf('if (!pedidos.length) {')));
  assert.match(vazio, /htmlResumo/, 'resumo aparece mesmo sem pedidos');
  assert.match(vazio, /opcoesVendedor/);
  assert.match(vazio, /Nenhum pedido entregue neste período/);
  assert.match(vazio, /nomeVendedorRelatorio\(relVendedor\)/);
  assert.match(vazio, /\(seus pedidos\)/);
});

test('PDF de período vazio continua dizendo que não houve entregas e mostra o escopo', () => {
  const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra na overlay');
  assert.match(pdf, /if \(!d\.nPedidos\)/);
  assert.match(pdf, /Nenhum pedido entregue neste período\./);
  assert.match(pdf, /Vendedor: \$\{nomeVendedorRelatorio\(relVendedor\)\}/);
});
