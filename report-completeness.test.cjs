const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// O relatório é a base do acerto de comissão: nenhum pedido entregue do
// período pode deixar de aparecer, mesmo que não esteja entre os "top 5".
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', disabled: false }); return els.get(id); };
const pedidos = [];
for (let i = 1; i <= 12; i++) {
  pedidos.push({ id: i, status: 'entregue', data_entregue_em: '2026-09-1' + (i % 5), data_entrega: '2026-09-10',
    valor: 100 + i * 10.1, cliente_nome: `Cliente ${i}`, vendedor: i % 2 ? 'vendedor' : 'admin',
    status_pagamento: i % 3 ? 'pago' : 'pendente', itens: [] });
}
pedidos.push({ id: 50, status: 'entregue', data_entregue_em: '2026-09-12', valor: 0.1, cliente_nome: 'Sociedade dos Criadores',
  vendedor: 'vendedor', status_pagamento: 'pendente', itens: [] });
pedidos.push({ id: 60, status: 'pendente', data_entrega: '2026-09-11', valor: 999, cliente_nome: 'Esquecido Ltda', vendedor: 'vendedor' });
pedidos.push({ id: 61, status: 'pendente', data_entrega: '2026-10-20', valor: 1, cliente_nome: 'Futuro', vendedor: 'vendedor' });
pedidos.push({ id: 70, status: 'entregue', data_entregue_em: '2026-08-31', valor: 5, cliente_nome: 'Mês passado', vendedor: 'vendedor' });

const contexto = {
  usuario: { perfil: 'admin', login: 'admin' },
  todosOsPedidos: pedidos,
  relTipo: 'mensal', relOffset: 0,
  relFonte: { pedidos: null, atualizadoEm: new Date(), erro: null, carregando: false },
  document: { getElementById: el },
  calcularJanelaRelatorio: () => ({ ini: '2026-09-01', fim: '2026-09-30', label: 'Setembro de 2026' }),
};
vm.runInNewContext(
  trecho('function dataRealEntrega', 'function dadosEntregaConcluida') +
  trecho('function dataBR(', 'function badgeCategoria(') +
  trecho('function foiPago(', '// Detecta se o pedido') +
  trecho('function pedidosBaseRelatorio(', 'function abrirModalRelatorio(') +
  trecho('// Filtra somente pedidos', '// Gera o Blob do PDF'), contexto);

const lista = contexto.pedidosDoRelatorio('2026-09-01', '2026-09-30');
assert.equal(lista.length, 13, 'todos os entregues do período entram');
assert.ok(lista.some(p => p.cliente_nome === 'Sociedade dos Criadores'));

const d = contexto.calcularDadosRelatorio(lista);
const esperado = lista.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100;
assert.equal(d.total, esperado, 'total bate com a soma das linhas, em centavos');
assert.equal(Math.round((d.recebido + d.aReceber) * 100), Math.round(d.total * 100));
assert.equal(d.porVendedor.reduce((s, v) => s + v.nPedidos, 0), 13);
assert.equal(Math.round(d.porVendedor.reduce((s, v) => s + v.total, 0) * 100), Math.round(d.total * 100));

const pend = contexto.pendentesDoRelatorio('2026-09-30');
assert.deepEqual(Array.from(pend, p => p.id), [60], 'pendente previsto no período aparece como alerta');

contexto.renderizarRelatorio();
const html = el('relatorio-conteudo').innerHTML;
for (let i = 1; i <= 12; i++) assert.match(html, new RegExp(`Cliente ${i}<`), `Cliente ${i} precisa aparecer`);
assert.match(html, /Sociedade dos Criadores/, 'cliente fora do top 5 aparece na lista completa');
assert.match(html, /Esquecido Ltda/, 'pedido não marcado como entregue aparece no alerta');
assert.match(html, /Não estão somados no total/);
assert.doesNotMatch(html, /Mês passado|Futuro/);
assert.match(html, /Por vendedor/);

// Vendedor só enxerga os próprios pedidos e não vê o quadro por vendedor.
contexto.usuario = { perfil: 'vendedor', login: 'vendedor' };
contexto.renderizarRelatorio();
const htmlVend = el('relatorio-conteudo').innerHTML;
assert.match(htmlVend, /Sociedade dos Criadores/);
assert.doesNotMatch(htmlVend, /Cliente 2</);
assert.doesNotMatch(htmlVend, /Por vendedor/);

// Sem conferir com o servidor, o aviso aparece.
contexto.relFonte = { pedidos: null, atualizadoEm: null, erro: 'offline', carregando: false };
contexto.renderizarRelatorio();
assert.match(el('relatorio-conteudo').innerHTML, /Não use para acertar comissão/);

// O PDF traz a lista completa, o alerta de pendentes e o total no rodapé da tabela.
const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra');
assert.match(pdf, /pedidos\.map\(p => \[dataBR\(dataRealEntrega\(p\)\)/);
assert.match(pdf, /pendentesDoRelatorio\(fim, base\)/);
assert.match(pdf, /Total: \$\{d\.nPedidos\} pedido\(s\) entregue\(s\)/);
assert.match(pdf, /ATENÇÃO: este relatório foi gerado SEM conferir com o servidor/);
assert.match(app, /async function imprimirRelatorio\(\)[\s\S]{0,900}await atualizarFonteRelatorio\(\)/);

console.log('Relatório lista todos os pedidos entregues, alerta pendentes e soma sem erro de centavos.');
