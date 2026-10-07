const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Via do pedido: texto com símbolos que a fonte embutida não tem (& ñ + ...) sai
// inteiro, o pedido vem do servidor, "À vista" não perde o "À" e a numeração
// de páginas conta o total certo.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente(opcoes = {}) {
  const c = {
    MODO_DEMO: !!opcoes.demo, navigator: { onLine: opcoes.offline ? false : true },
    todosOsPedidos: [{ id: 5, cliente_id: 1, cliente_nome: 'Local', valor: 10, itens: [{ nome: 'Velho', qtd: 1 }] }],
    todosOsClientes: [{ id: 1, nome: 'Cliente local' }],
    fila: opcoes.fila || [], lerFilaOffline: () => c.fila,
    chamadas: [],
    apiSupabase: async (tabela, metodo, corpo, filtros) => {
      c.chamadas.push({ tabela, metodo, filtros });
      if (opcoes.erroApi) throw new Error('rede');
      return opcoes.resposta || { ok: true, deCache: false, dados: [{ id: 5, cliente_id: 1, valor: 99, clientes: { id: 1, nome: 'Cliente servidor', endereco: 'Rua A' },
        itens_pedido: [{ nome: 'Novo', qtd: 7 }] }] };
    },
    encodeURIComponent, String, Array, Error,
    normalizarPedidos: dados => dados.map(p => ({ ...p, cliente_nome: p.clientes?.nome || '–', itens: p.itens_pedido || [] })),
    formatarPagamento: p => ({ avista: '💵 À vista', cheque: '📝 Cheque', boleto: '📄 Boleto 2× (7 + 14 dias)' })[p.forma_pagamento] || 'Não informado',
  };
  vm.createContext(c);
  vm.runInContext(trecho('const PDF_FONTE_TEM', 'function _registrarFontesPdf(') +
    trecho('async function _pedidoParaVia(', '// Gera o Blob do PDF da via.') +
    trecho('function pagamentoSemEmoji(', '// Usa sempre o preço efetivamente cobrado'), c);
  return c;
}

test('Fonte embutida: só o que ela tem passa; qualquer outro caractere cai na fonte reserva', () => {
  const c = ambiente();
  const usaReserva = t => vm.runInContext('pdfPrecisaFonteReserva', c)(t);
  for (const ok of ['Agropecuária São José', 'João da Silva (Matriz)', 'R$ 1.234,56', 'Rua A, 100 - Centro', '12.345.678/0001-90', 'Ração Premium 15kg', 'Ôi Áurea À vista', 'Via — Nº 5', 'a\nb'])
    assert.equal(usaReserva(ok), false, ok);
  for (const ruim of ['Boa Safra & Cia', "D'Ávila", 'Nandú Ñ', 'ñ', 'Ração + Sal', '50% desc.', '#7', 'Pet Shop 🐶', 'Cuidado!', 'Que dia?', 'a;b', 'João @ Casa', 'preço €', '2²'])
    assert.equal(usaReserva(ruim), true, ruim);
});

test('Símbolos que nem a Helvetica desenha viram "?", sem cortar o resto do texto', () => {
  const c = ambiente();
  const seguro = vm.runInContext('pdfTextoSeguro', c);
  assert.equal(seguro('Pet Shop 🐶 ok ✓'), 'Pet Shop ?? ok ?', 'emoji ocupa 2 unidades UTF-16');
  assert.equal(seguro('ñ & é — “ok” … € ™'), 'ñ & é — “ok” … € ™');
});

test('"À vista" mantém o "À" e os emojis do começo saem', () => {
  const c = ambiente();
  assert.equal(c.pagamentoSemEmoji({ forma_pagamento: 'avista' }), 'À vista');
  assert.equal(c.pagamentoSemEmoji({ forma_pagamento: 'cheque' }), 'Cheque');
  assert.equal(c.pagamentoSemEmoji({ forma_pagamento: 'boleto' }), 'Boleto 2× (7 + 14 dias)');
  assert.equal(c.pagamentoSemEmoji({}), 'Não informado');
});

test('Com internet, a via usa o pedido do servidor (não a cópia velha do aparelho)', async () => {
  const c = ambiente();
  const r = await c._pedidoParaVia(5);
  assert.equal(r.conferido, true);
  assert.equal(r.p.valor, 99);
  assert.equal(r.p.itens[0].nome, 'Novo');
  assert.equal(r.p.cliente_nome, 'Cliente servidor');
  assert.equal(r.c.endereco, 'Rua A');
  assert.match(c.chamadas[0].filtros, /^\?id=eq\.5&select=\*,clientes\(\*\),itens_pedido\(\*\)$/);
});

test('Sem internet, com falha ou com dados do cache, usa o aparelho e marca como não conferido', async () => {
  for (const opcoes of [{ offline: true }, { erroApi: true }, { resposta: { ok: false } }, { resposta: { ok: true, deCache: true, dados: [{ id: 5 }] } }]) {
    const c = ambiente(opcoes);
    const r = await c._pedidoParaVia(5);
    assert.equal(r.conferido, false, JSON.stringify(opcoes));
    assert.equal(r.p.cliente_nome, 'Local');
  }
});

test('Ação deste aparelho ainda na fila offline: a tela vale mais que o servidor', async () => {
  const c = ambiente({ fila: [{ tipo: 'marcar-entregue', pedidoId: 5 }] });
  const r = await c._pedidoParaVia(5);
  assert.equal(r.conferido, false);
  assert.equal(c.chamadas.length, 0);
  // Ação já recusada (falha) ou de outro pedido não impede.
  const d = ambiente({ fila: [{ tipo: 'marcar-entregue', pedidoId: 5, falha: { status: 400 } }, { tipo: 'marcar-entregue', pedidoId: 9 }] });
  assert.equal((await d._pedidoParaVia(5)).conferido, true);
});

test('Pedido apagado no servidor avisa em vez de gerar a via velha; pedido que nunca existiu também', async () => {
  const c = ambiente({ resposta: { ok: true, deCache: false, dados: [] } });
  await assert.rejects(c._pedidoParaVia(5), /não existe mais no servidor/);
  const d = ambiente({ offline: true });
  await assert.rejects(d._pedidoParaVia(404), /Pedido não encontrado/);
});

test('Modo demonstração usa os dados locais sem consultar o servidor', async () => {
  const c = ambiente({ demo: true });
  assert.equal((await c._pedidoParaVia(5)).conferido, false);
  assert.equal(c.chamadas.length, 0);
});

test('Código da via: escrita com fonte reserva, rodapé com total de páginas e aviso de dados não conferidos', () => {
  const via = trecho('async function gerarPdfViaPedido(', '// Mostra a via (PDF) na overlay do app.');
  assert.doesNotMatch(via.replace(/const escrever = .*\n/, '').replace(/const quebrar = .*\n/, ''), /doc\.text\(/, 'todo texto passa por escrever()');
  assert.doesNotMatch(via.replace(/const quebrar = .*\n/, ''), /doc\.splitTextToSize\(/);
  assert.match(via, /const \{ p, c, conferido \} = await _pedidoParaVia\(id\)/);
  assert.match(via, /drawRodape\(i, totalPaginas\)/);
  assert.match(via, /if \(!conferido && !MODO_DEMO\)/);
  assert.match(via, /top: mT \+ 18/, 'tabela das páginas seguintes começa abaixo do cabeçalho');
  assert.match(via, /pediu \$\{i\.qtd_pedida\}/, 'entrega parcial aparece na via');
  assert.match(app, /pdfPrecisaFonteReserva\(data\.cell\.text\.join/, 'relatório usa a mesma regra de fonte');
  assert.doesNotMatch(app, /FORA_DA_FONTE/);
  assert.doesNotMatch(app, /formatarPagamento\(p\)\.replace\(\/\^\[\^\\w\]/);
});
