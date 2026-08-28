const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8');
const inicio = app.indexOf('function formatarPrecoItemPedido');
const fim = app.indexOf('\n}\n\n// ============================================================', inicio) + 2;
assert.ok(inicio >= 0 && fim > inicio, 'helper de preço não encontrado');

const contexto = {
  moeda: valor => `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`,
};
vm.runInNewContext(app.slice(inicio, fim), contexto);
const formatar = contexto.formatarPrecoItemPedido;

const saco20 = formatar({ nome: 'Ração X 20kg', qtd: 2, preco_unit: 65 });
assert.equal(saco20.textoUnidade, 'Unid./kg: R$ 3,25');
assert.equal(saco20.textoEmbalagem, 'Saco: R$ 65,00');
assert.equal(saco20.textoSubtotal, 'Subtotal: R$ 130,00');

assert.equal(formatar({ nome: 'Ração 40 KG', qtd: 1, preco_unit: 200 }).valorPorKg, 5);
assert.equal(formatar({ nome: 'Ração 10,1kg', qtd: 1, preco_unit: 50.5 }).valorPorKg, 5);
assert.equal(formatar({ nome: 'Ração 10.1 kg', qtd: 1, preco_unit: 20.2 }).valorPorKg, 2);

const semPeso = formatar({ produto_nome: 'Produto Y', qtd: '2', preco_unit: '28' });
assert.equal(semPeso.textoUnidade, 'Unid.: R$ 28,00');
assert.equal(semPeso.textoEmbalagem, '');
assert.equal(semPeso.subtotal, 56);

const ajustado = formatar({ nome: 'Ração 20kg', qtd: 2, preco_unit: 60, preco_catalogo: 75 });
assert.equal(ajustado.valorPorKg, 3);
assert.equal(ajustado.subtotal, 120);
assert.equal(formatar({ nome: 'Produto 0kg', qtd: 1, preco_unit: 25 }).valorPorKg, null);
assert.equal(formatar({ nome: 'Produto 20kg', qtd: 1, preco_unit: 'inválido' }).valorPorKg, null);
assert.equal(formatar({ nome: 'Produto 20kg', qtd: Number.MAX_VALUE, preco_unit: Number.MAX_VALUE }).subtotal, 0);

assert.equal((app.match(/formatarPrecoItemPedido\(/g) || []).length, 3, 'WhatsApp e PDF devem usar o helper');
assert.match(app, /colspan="4">\$\{esc\(p\.descricao \|\| ''\)\}/, 'fallback PDF legado removido');
assert.match(app, /: `• \$\{p\.descricao \|\| ''\}`/, 'fallback WhatsApp legado removido');

const inicioPagamento = app.indexOf('function formatarPagamento');
const fimPagamento = app.indexOf('\n}\n\n// ============================================================', inicioPagamento) + 2;
vm.runInNewContext(app.slice(inicioPagamento, fimPagamento), contexto);

const inicioWhatsapp = app.indexOf('function enviarPedidoWhatsApp');
const fimWhatsapp = app.lastIndexOf('}', app.indexOf('function verDetalhePedido', inicioWhatsapp)) + 1;
contexto.obterSaudacao = () => 'Bom dia';
contexto.dataBR = data => data.split('-').reverse().join('/');
contexto.toast = () => {};
contexto.todosOsClientes = [{ id: 1, responsavel: 'Maria', whatsapp: '81999990000' }];
contexto.todosOsPedidos = [{
  id: 42,
  cliente_id: 1,
  itens: [
    { nome: 'Ração 20kg', qtd: 2, preco_unit: 60, preco_catalogo: 75 },
    { nome: 'Produto Y', qtd: 2, preco_unit: 28 },
  ],
  valor: 176,
  forma_pagamento: 'boleto',
  prazo_dias: 30,
  data_entrega: '2026-08-28',
  data_vencimento: '2026-09-27',
  observacao: 'Entregar pela manhã',
}];
contexto.window = { open: url => { contexto.urlAberta = url; } };
vm.runInNewContext(app.slice(inicioWhatsapp, fimWhatsapp), contexto);
contexto.enviarPedidoWhatsApp(42);

const mensagem = decodeURIComponent(contexto.urlAberta.split('text=')[1]);
assert.match(mensagem, /2x Ração 20kg\nUnid\.\/kg: R\$ 3,00 \| Saco: R\$ 60,00 \| Subtotal: R\$ 120,00/);
assert.match(mensagem, /2x Produto Y\nUnid\.: R\$ 28,00 \| Subtotal: R\$ 56,00/);
assert.match(mensagem, /\*Pedido nº 42\*[\s\S]*\*Total do pedido: R\$ 176,00\*/);
assert.match(mensagem, /Pagamento: Boleto 30 dias[\s\S]*Entrega: 28\/08\/2026[\s\S]*Vencimento: 27\/09\/2026[\s\S]*Observação: Entregar pela manhã/);

contexto.todosOsPedidos = [{ id: 7, cliente_id: 1, descricao: 'Pedido antigo', valor: 50 }];
contexto.enviarPedidoWhatsApp(7);
const mensagemLegada = decodeURIComponent(contexto.urlAberta.split('text=')[1]);
assert.match(mensagemLegada, /• Pedido antigo/);
assert.doesNotMatch(mensagemLegada, /Pagamento:|Entrega:|Vencimento:|Observação:/);

console.log('Preço por kg, item comum, preço ajustado e pedidos antigos validados.');
