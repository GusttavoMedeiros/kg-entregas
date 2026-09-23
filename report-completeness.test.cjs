const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// O relatório é a base do acerto de comissão, que é paga por unidade de cada
// produto. Nenhum pedido, cliente ou produto entregue pode ficar de fora.
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, { innerHTML: '', textContent: '', disabled: false }); return els.get(id); };
const catalogo = [
  { id: 1, nome: 'Milho 60kg' }, { id: 2, nome: 'Milho 30kg' },
  { id: 3, nome: 'Ração Nova Cadastrada Hoje' }, { id: 4, nome: 'Farelo (nome novo)' },
];
const pedidos = [];
for (let i = 1; i <= 12; i++) {
  pedidos.push({ id: i, cliente_id: i, status: 'entregue', data_entregue_em: '2026-09-1' + (i % 5), data_entrega: '2026-09-10',
    valor: 100 + i * 10.1, cliente_nome: `Cliente ${i}`, vendedor: i % 2 ? 'vendedor' : 'admin',
    status_pagamento: i % 3 ? 'pago' : 'pendente',
    itens: [{ produto_id: 1, nome: 'Milho 60kg', qtd: i, preco_unit: 10 }, { produto_id: 2, nome: 'Milho 30kg', qtd: 1, preco_unit: 5 }] });
}
// Mesmo cliente com dois pedidos, produto novo e produto renomeado no catálogo.
pedidos.push({ id: 50, cliente_id: 99, status: 'entregue', data_entregue_em: '2026-09-12', valor: 0.1, cliente_nome: 'Sociedade dos Criadores',
  vendedor: 'vendedor', status_pagamento: 'pendente',
  itens: [{ produto_id: 1, nome: 'Milho 60kg', qtd: 10, preco_unit: 1 }, { produto_id: 3, nome: 'Ração Nova Cadastrada Hoje', qtd: 2, preco_unit: 1 }] });
pedidos.push({ id: 51, cliente_id: 99, status: 'entregue', data_entregue_em: '2026-09-20', valor: 7, cliente_nome: 'Sociedade dos Criadores',
  vendedor: 'vendedor', status_pagamento: 'pago',
  itens: [{ produto_id: 1, nome: 'Milho 60kg', qtd: 5, preco_unit: 1 }, { produto_id: 4, nome: 'Farelo antigo', qtd: 3, preco_unit: 1 }] });
pedidos.push({ id: 60, status: 'pendente', data_entrega: '2026-09-11', valor: 999, cliente_nome: 'Esquecido Ltda', vendedor: 'vendedor' });
pedidos.push({ id: 61, status: 'pendente', data_entrega: '2026-10-20', valor: 1, cliente_nome: 'Futuro', vendedor: 'vendedor' });
pedidos.push({ id: 70, status: 'entregue', data_entregue_em: '2026-08-31', valor: 5, cliente_nome: 'Mês passado', vendedor: 'vendedor' });

const contexto = {
  usuario: { perfil: 'admin', login: 'admin' },
  todosOsPedidos: pedidos, todosOsProdutos: catalogo,
  relTipo: 'mensal', relOffset: 0, relVendedor: '',
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
assert.equal(lista.length, 14, 'todos os entregues do período entram');

const d = contexto.calcularDadosRelatorio(lista, catalogo);
const esperado = lista.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100;
assert.equal(d.total, esperado, 'total bate com a soma das linhas, em centavos');
assert.equal(Math.round((d.recebido + d.aReceber) * 100), Math.round(d.total * 100));

// Quantidade total por produto (base da comissão por unidade)
const qtd = nome => d.produtos.find(p => p.nome === nome)?.qtd;
assert.equal(qtd('Milho 60kg'), 78 + 15);
assert.equal(qtd('Milho 30kg'), 12);
assert.equal(qtd('Ração Nova Cadastrada Hoje'), 2, 'produto novo aparece sozinho');
assert.equal(qtd('Farelo (nome novo)'), 3, 'usa o nome atual do catálogo');
assert.equal(d.produtos.length, 4, 'nenhum produto fica de fora (sem "top 5")');
assert.deepEqual(Array.from(d.produtos.slice(0, 2), p => p.nome), ['Farelo (nome novo)', 'Milho 30kg'], 'ordem alfabética, 30kg antes de 60kg');

// Cada cliente com a quantidade de cada produto, somando todos os pedidos dele
const soc = d.clientes.find(c => c.nome === 'Sociedade dos Criadores');
assert.equal(soc.pedidos.length, 2);
assert.equal(soc.itens.find(i => i.nome === 'Milho 60kg').qtd, 15);
assert.equal(d.clientes.length, 13);

const pend = contexto.pendentesDoRelatorio('2026-09-30');
assert.deepEqual(Array.from(pend, p => p.id), [60], 'pendente previsto no período aparece como alerta');

contexto.renderizarRelatorio();
const html = el('relatorio-conteudo').innerHTML;
for (let i = 1; i <= 12; i++) assert.match(html, new RegExp(`Cliente ${i}<`), `Cliente ${i} precisa aparecer`);
assert.match(html, /Sociedade dos Criadores/);
assert.match(html, /Ração Nova Cadastrada Hoje/);
assert.match(html, /Esquecido Ltda/, 'pedido sem baixa aparece no alerta');
assert.doesNotMatch(html, /Mês passado|Futuro/);
assert.match(html, /rel-chip/, 'admin escolhe o vendedor');

// Filtro por vendedor (admin): só os pedidos daquele vendedor
contexto.mudarVendedorRelatorio('vendedor');
const htmlVendFiltro = el('relatorio-conteudo').innerHTML;
assert.match(htmlVendFiltro, /Sociedade dos Criadores/);
assert.doesNotMatch(htmlVendFiltro, /Cliente 2</);
assert.equal(contexto.montarRelatorio().d.nPedidos, 8);
contexto.mudarVendedorRelatorio('');

// Vendedor só enxerga os próprios pedidos e não tem filtro
contexto.usuario = { perfil: 'vendedor', login: 'vendedor' };
contexto.renderizarRelatorio();
const htmlVend = el('relatorio-conteudo').innerHTML;
assert.match(htmlVend, /Sociedade dos Criadores/);
assert.doesNotMatch(htmlVend, /Cliente 2</);
assert.doesNotMatch(htmlVend, /rel-chip/);

// Sem conferir com o servidor, o aviso aparece.
contexto.relFonte = { pedidos: null, atualizadoEm: null, erro: 'offline', carregando: false };
contexto.renderizarRelatorio();
assert.match(el('relatorio-conteudo').innerHTML, /Não use para acertar comissão/);

// O PDF traz produtos, clientes com cada produto, alerta e aviso de servidor.
const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra');
assert.match(pdf, /montarRelatorio\(\)/);
assert.match(pdf, /d\.produtos\.map/);
assert.match(pdf, /d\.clientes\.forEach/);
assert.match(pdf, /sem baixa de entrega/);
assert.match(pdf, /ATENÇÃO: este relatório foi gerado SEM conferir com o servidor/);
assert.match(app, /async function imprimirRelatorio\(\)[\s\S]{0,900}await atualizarFonteRelatorio\(\)/);

console.log('Relatório: todos os produtos por cliente, produto novo automático, filtro por vendedor.');
