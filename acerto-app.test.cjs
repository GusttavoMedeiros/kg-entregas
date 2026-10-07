const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Acerto de comissão no relatório: registrar (admin), mostrar a situação e o que
// mudou depois do acerto (devolução, correção, entrega lançada tarde).
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function ambiente({ perfil = 'admin', login = perfil } = {}) {
  const els = new Map();
  const c = {
    usuario: { perfil, login, nome: login },
    MODO_DEMO: false, navigator: { onLine: true }, Intl, Date, Math, Number, String, Array, Map, Set, JSON, isNaN, console,
    todosOsPedidos: [], todosOsProdutos: [],
    toasts: [], confirmacoes: [], respostaConfirmar: true, chamadas: [], respostaRpc: null,
    toast: m => c.toasts.push(m),
    confirmar: async (m, o) => { c.confirmacoes.push({ m, o }); return c.respostaConfirmar; },
    lerFilaOffline: () => [], acaoOfflinePertenceAoUsuario: () => true,
    apiSupabase: async (tabela, metodo, corpo) => { c.chamadas.push({ tabela, metodo, corpo }); return c.respostaRpc; },
    document: {
      getElementById: id => { if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', disabled: false }); return els.get(id); },
      querySelectorAll: () => [],
    },
  };
  vm.createContext(c);
  vm.runInContext(
    trecho('const fmt = d =>', 'function badgeCategoria(') +
    trecho('function foiPago(', '// Detecta se o pedido') +
    trecho('const PDF_FONTE_TEM', 'function _registrarFontesPdf(') +
    trecho("let relTipo = 'semanal';", '// Gera o Blob do PDF do relatório.'), c);
  c.el = id => c.document.getElementById(id);
  c.run = codigo => vm.runInContext(codigo, c);
  return c;
}

// Período mensal atual e pedidos dentro dele.
function cenario(c, { acertos = [], pedidos } = {}) {
  const { ini } = c.run("calcularJanelaRelatorio('mensal', 0)");
  const dia = ini; // primeiro dia do mês: sempre dentro do período e nunca no futuro
  const base = pedidos || [
    { id: 1, status: 'entregue', vendedor: 'vendedor', data_entregue_em: dia, valor: 100, cliente_nome: 'Ana', itens: [{ nome: 'Milho', qtd: 10, preco_unit: 10 }] },
    { id: 2, status: 'entregue', vendedor: 'vendedor', data_entregue_em: dia, valor: 50, cliente_nome: 'Bruno', itens: [{ nome: 'Sal', qtd: 5, preco_unit: 10 }] },
  ];
  c.relFonteTeste = { pedidos: base, acertos };
  c.run(`relTipo = 'mensal'; relOffset = 0; relVendedor = '';
    relFonte = { pedidos: relFonteTeste.pedidos, filaPendente: [], acertos: relFonteTeste.acertos, atualizadoEm: new Date(), erro: null, carregando: false };`);
  return { ini, fim: c.run("calcularJanelaRelatorio('mensal', 0)").fim, dia };
}

const acertoDe = (ini, fim, pedidos, extra = {}) => ({ id: 1, vendedor: 'vendedor', tipo: 'mensal', ini, fim,
  pedidos, unidades: pedidos.reduce((s, p) => s + p.unidades, 0), total: pedidos.reduce((s, p) => s + p.valor, 0),
  registrado_por: 'admin', registrado_em: '2026-10-01T15:20:00+00:00', ...extra });

test('Diferenças: pedido que entrou, saiu ou mudou de unidades/valor', () => {
  const c = ambiente();
  const acerto = { pedidos: [
    { id: 1, cliente: 'Ana', unidades: 10, valor: 100 },
    { id: 2, cliente: 'Bruno', unidades: 5, valor: 50 },
    { id: 3, cliente: 'Carla', unidades: 2, valor: 20 },
  ] };
  const agora = [
    { id: 1, cliente_nome: 'Ana', valor: 100, itens: [{ qtd: 10 }] },            // igual
    { id: 2, cliente_nome: 'Bruno', valor: 40, itens: [{ qtd: 4 }] },            // devolução de 1
    { id: 4, cliente_nome: 'Davi', valor: 30.1, itens: [{ qtd: 1 }, { qtd: 2 }] }, // lançado depois
  ];
  const dif = c.diferencasDoAcerto(acerto, agora);
  assert.deepEqual(Array.from(dif.mudancas, m => [m.id, m.tipo]), [[2, 'mudou'], [3, 'saiu'], [4, 'entrou']]);
  assert.equal(dif.difUnidades, -1 - 2 + 3);
  assert.equal(dif.difValor, 0.1, 'em centavos: -10 - 20 + 30,10');
  assert.equal(c.textoMudancaAcerto(dif.mudancas[0]), 'mudou: de 5 para 4 un, de R$ 50,00 para R$ 40,00');
  assert.equal(c.textoMudancaAcerto(dif.mudancas[1]), 'saiu do período (2 un, R$ 20,00)');
  assert.equal(c.textoMudancaAcerto(dif.mudancas[2]), 'entrou depois do acerto (3 un, R$ 30,10)');
  assert.equal(c.textoDiferencaAcerto(dif), 'R$ 0,10 a mais');
  assert.equal(c.textoDiferencaAcerto({ difUnidades: -2, difValor: -20 }), '2 un a menos, R$ 20,00 a menos');
  assert.equal(c.textoDiferencaAcerto({ difUnidades: 0, difValor: 0 }), 'mesmo total, pedidos diferentes');

  // Só o preço foi corrigido (mesma quantidade): também é mudança.
  const preco = c.diferencasDoAcerto({ pedidos: [{ id: 5, cliente: 'Eva', unidades: 2, valor: 20 }] },
    [{ id: 5, cliente_nome: 'Eva', valor: 18, itens: [{ qtd: 2 }] }]);
  assert.equal(preco.mudancas.length, 1);
  assert.equal(c.textoMudancaAcerto(preco.mudancas[0]), 'mudou: de R$ 20,00 para R$ 18,00');
  assert.equal(c.textoDiferencaAcerto(preco), 'R$ 2,00 a menos');
});

test('Diferenças: nada mudou (inclusive com centavos de ponto flutuante) e valores vindos como texto', () => {
  const c = ambiente();
  const acerto = { pedidos: [{ id: 7, cliente: 'Ana', unidades: '3', valor: '0.3' }] };
  const dif = c.diferencasDoAcerto(acerto, [{ id: '7', valor: 0.1 + 0.2, itens: [{ qtd: 1 }, { qtd: 2 }] }]);
  assert.equal(dif.mudancas.length, 0);
  assert.equal(c.unidadesDoPedido({ itens: [{ qtd: 2 }, { qtd: '1.5' }, { qtd: -3 }, {}] }), 3.5);
  assert.equal(c.unidadesDoPedido({}), 0);
});

test('Textos do acerto saem inteiros na fonte embutida do PDF', () => {
  const c = ambiente();
  const usaReserva = c.run('pdfPrecisaFonteReserva');
  const textos = [
    c.textoMudancaAcerto({ tipo: 'mudou', antesUn: 5, agoraUn: 4, antesValor: 1234.5, agoraValor: 1000 }),
    c.textoMudancaAcerto({ tipo: 'entrou', agoraUn: 1.5, agoraValor: 9 }),
    c.textoMudancaAcerto({ tipo: 'saiu', antesUn: 2, antesValor: 3 }),
    c.textoDiferencaAcerto({ difUnidades: -2.5, difValor: 10 }),
    `Mudou depois do acerto de ${c.dataHoraAcerto('2026-10-01T15:20:00+00:00')}: x`,
    'Acerte a diferença no próximo pagamento.',
  ];
  for (const t of textos) assert.equal(usaReserva(t), false, t);
  assert.equal(c.dataHoraAcerto('2026-10-01T15:20:00+00:00'), '01/10/2026 às 12:20', 'horário de Brasília');
  assert.equal(c.dataHoraAcerto('lixo'), '');
});

test('Acerto do período: o mais recente, só do mesmo vendedor e das mesmas datas', () => {
  const c = ambiente();
  const a = (id, vendedor, ini, fim, em) => ({ id, vendedor, ini, fim, registrado_em: em });
  const lista = [
    a(1, 'vendedor', '2026-09-01', '2026-09-30', '2026-10-01T10:00:00Z'),
    a(2, 'vendedor', '2026-09-01', '2026-09-30', '2026-10-03T10:00:00Z'),
    a(3, 'admin', '2026-09-01', '2026-09-30', '2026-10-05T10:00:00Z'),
    a(4, 'vendedor', '2026-09-01', '2026-09-15', '2026-10-06T10:00:00Z'),
  ];
  assert.equal(c.acertoDoPeriodo(lista, 'vendedor', '2026-09-01', '2026-09-30').id, 2);
  assert.equal(c.acertoDoPeriodo(lista, 'vendedor', '2026-09-01', '2026-09-15').id, 4);
  assert.equal(c.acertoDoPeriodo(lista, 'vendedor', '2026-08-01', '2026-08-31'), null);
  assert.equal(c.acertoDoPeriodo(lista, '', '2026-09-01', '2026-09-30'), null);
  assert.equal(c.acertoDoPeriodo(null, 'vendedor', '2026-09-01', '2026-09-30'), null);
});

test('De quem é o acerto: vendedor logado, escolhido pelo admin ou o único do período', () => {
  const adm = ambiente();
  assert.equal(adm.vendedorDoAcerto(['vendedor']), 'vendedor');
  assert.equal(adm.vendedorDoAcerto(['admin', 'vendedor']), '', 'com dois vendedores, precisa escolher');
  adm.run("relVendedor = 'admin'");
  assert.equal(adm.vendedorDoAcerto(['admin', 'vendedor']), 'admin');
  assert.equal(ambiente({ perfil: 'vendedor', login: 'joao' }).vendedorDoAcerto([]), 'joao');
  assert.equal(ambiente({ perfil: 'entregador' }).vendedorDoAcerto(['vendedor']), '');
});

test('Tela: sem mudanças mostra o acerto em verde; com mudanças, o aviso e a lista', () => {
  const c = ambiente();
  const { ini, fim } = cenario(c);
  c.relFonteTeste.acertos.push(acertoDe(ini, fim, [{ id: 1, cliente: 'Ana', unidades: 10, valor: 100 }, { id: 2, cliente: 'Bruno', unidades: 5, valor: 50 }]));
  c.renderizarRelatorio();
  let html = c.el('relatorio-conteudo').innerHTML;
  assert.match(html, /✓ Acerto registrado em 01\/10\/2026 às 12:20: <b>15 un · R\$ 150,00<\/b>\. Nada mudou desde então\./);
  assert.match(html, /Registrar novo acerto · Vendedor/);
  assert.doesNotMatch(html, /Mudou depois do acerto/);

  // Devolução depois do acerto: Bruno ficou com 3 un e R$ 30.
  c.relFonteTeste.pedidos[1].itens[0].qtd = 3; c.relFonteTeste.pedidos[1].valor = 30;
  c.renderizarRelatorio();
  html = c.el('relatorio-conteudo').innerHTML;
  assert.match(html, /⚠ Mudou depois do acerto de 01\/10\/2026 às 12:20<\/b><span>2 un a menos, R\$ 20,00 a menos/);
  assert.match(html, /Bruno <small>nº 2<\/small>\s*<span class="rel-acerto-mudanca">mudou: de 5 para 3 un, de R\$ 50,00 para R\$ 30,00/);
  assert.match(html, /Acerte a diferença no próximo pagamento e registre o acerto de novo/);
  assert.doesNotMatch(html, /Ana <small>nº 1<\/small>\s*<span class="rel-acerto-mudanca">/);
});

test('Tela: todos os pedidos acertados saíram — o vendedor continua no filtro e o aviso aparece', () => {
  const c = ambiente();
  const { ini, fim } = cenario(c, { pedidos: [] });
  c.relFonteTeste.acertos.push(acertoDe(ini, fim, [{ id: 9, cliente: 'Ana', unidades: 4, valor: 40 }]));
  c.renderizarRelatorio();
  const html = c.el('relatorio-conteudo').innerHTML;
  assert.match(html, /Nenhum pedido entregue neste período/);
  assert.match(html, /Mudou depois do acerto/);
  assert.match(html, /Ana <small>nº 9<\/small>\s*<span class="rel-acerto-mudanca">saiu do período \(4 un, R\$ 40,00\)/);
});

test('Tela: botão só para o admin, só com vendedor definido e com o servidor conferido', () => {
  const c = ambiente();
  cenario(c);
  c.renderizarRelatorio();
  assert.match(c.el('relatorio-conteudo').innerHTML, /<button type="button" class="btn-azul rel-btn-acerto" onclick="registrarAcertoRelatorio\(\)">Registrar acerto deste período · Vendedor/);

  c.run("relFonte = { ...relFonte, atualizadoEm: null, erro: 'sem rede' }");
  c.renderizarRelatorio();
  assert.match(c.el('relatorio-conteudo').innerHTML, /rel-btn-acerto" disabled/);

  // Dois vendedores e filtro "Todos": pede para escolher.
  const d = ambiente();
  cenario(d);
  d.relFonteTeste.pedidos[1].vendedor = 'admin';
  d.renderizarRelatorio();
  assert.doesNotMatch(d.el('relatorio-conteudo').innerHTML, /rel-btn-acerto/);
  assert.match(d.el('relatorio-conteudo').innerHTML, /escolha o vendedor acima/);

  // Vendedor vê a situação do próprio acerto, sem botão.
  const v = ambiente({ perfil: 'vendedor', login: 'vendedor' });
  const { ini, fim } = cenario(v);
  v.relFonteTeste.acertos.push(acertoDe(ini, fim, [{ id: 1, cliente: 'Ana', unidades: 10, valor: 100 }]));
  v.renderizarRelatorio();
  const hv = v.el('relatorio-conteudo').innerHTML;
  assert.doesNotMatch(hv, /rel-btn-acerto/);
  assert.match(hv, /Mudou depois do acerto/);
  assert.match(hv, /Acerte a diferença no próximo pagamento\.<\/div>/, 'sem "registre de novo" para o vendedor');

  // Acertos não consultados: aviso discreto, sem botão.
  const f = ambiente();
  cenario(f, { acertos: null });
  f.run('relFonte = { ...relFonte, acertos: null }');
  f.renderizarRelatorio();
  assert.match(f.el('relatorio-conteudo').innerHTML, /Não foi possível consultar os acertos/);
  assert.doesNotMatch(f.el('relatorio-conteudo').innerHTML, /rel-btn-acerto/);
});

test('Registrar: confirma com o resumo, chama o banco e mostra o acerto na hora', async () => {
  const c = ambiente();
  const { ini, fim } = cenario(c);
  c.respostaConfirmar = false;
  await c.registrarAcertoRelatorio();
  assert.equal(c.chamadas.length, 0, 'cancelar não grava');
  assert.match(c.confirmacoes[0].m, /^Vendedor — /);
  assert.match(c.confirmacoes[0].m, /2 pedido\(s\) · 15 unidade\(s\) · R\$ 150,00/);
  assert.match(c.confirmacoes[0].m, /ainda não terminou/, 'o mês atual ainda está em andamento');
  assert.equal(c.confirmacoes[0].o.okLabel, 'Registrar acerto');

  c.respostaConfirmar = true;
  c.respostaRpc = { ok: true, dados: acertoDe(ini, fim, [{ id: 1, cliente: 'Ana', unidades: 10, valor: 100 }, { id: 2, cliente: 'Bruno', unidades: 5, valor: 50 }], { registrado_em: new Date().toISOString() }) };
  await c.registrarAcertoRelatorio();
  assert.deepEqual(JSON.parse(JSON.stringify(c.chamadas[0])), { tabela: 'rpc/registrar_acerto', metodo: 'POST',
    corpo: { p_vendedor: 'vendedor', p_tipo: 'mensal', p_ini: ini, p_fim: fim } });
  assert.equal(c.toasts.at(-1), '✓ Acerto registrado.');
  assert.match(c.el('relatorio-conteudo').innerHTML, /Nada mudou desde então/);

  // Servidor tinha outra coisa (outro aparelho mudou no meio tempo): avisa.
  c.respostaRpc = { ok: true, dados: acertoDe(ini, fim, [{ id: 1, cliente: 'Ana', unidades: 10, valor: 100 }], { registrado_em: new Date(Date.now() + 1000).toISOString() }) };
  await c.registrarAcertoRelatorio();
  assert.match(c.toasts.at(-1), /dados diferentes desta tela/);
  assert.match(c.el('relatorio-conteudo').innerHTML, /Mudou depois do acerto/);

  // Erro do banco: não mostra como registrado.
  const antes = c.run('relFonte.acertos.length');
  c.respostaRpc = { ok: false, erro: 'Só o administrador registra acertos' };
  await c.registrarAcertoRelatorio();
  assert.match(c.toasts.at(-1), /não foi registrado[\s\S]*Só o administrador/);
  assert.equal(c.run('relFonte.acertos.length'), antes);
});

test('Registrar: bloqueado sem conferência com o servidor, para não-admin e no modo demonstração', async () => {
  const c = ambiente();
  cenario(c);
  c.run("relFonte = { ...relFonte, erro: 'sem rede', atualizadoEm: null }");
  await c.registrarAcertoRelatorio();
  assert.equal(c.confirmacoes.length, 0);
  assert.match(c.toasts.at(-1), /Confira o relatório com o servidor/);

  const v = ambiente({ perfil: 'vendedor', login: 'vendedor' });
  cenario(v);
  await v.registrarAcertoRelatorio();
  assert.equal(v.confirmacoes.length + v.chamadas.length, 0);

  const d = ambiente();
  cenario(d);
  d.MODO_DEMO = true;
  await d.registrarAcertoRelatorio();
  assert.equal(d.chamadas.length, 0);
  assert.match(d.toasts.at(-1), /modo demonstração/);
});

test('PDF mostra a situação do acerto logo depois do resumo', () => {
  const pdf = trecho('async function gerarPdfRelatorio(', '// Gera PDF do relatório e mostra');
  assert.match(pdf, /const \{ pendentes, naFila, d, acerto, difAcerto \} = montarRelatorio\(\)/);
  const bloco = pdf.slice(pdf.indexOf('if (acerto) {'), pdf.indexOf('// Pedidos sem baixa de entrega'));
  assert.match(bloco, /Nada mudou desde então/);
  assert.match(bloco, /tituloSecao\(`Mudou depois do acerto de \$\{quando\}: \$\{textoDiferencaAcerto\(difAcerto\)\}`, LARANJA\)/);
  assert.match(bloco, /textoMudancaAcerto\(m\)/);
  assert.ok(pdf.indexOf('if (acerto) {') > pdf.indexOf("['A receber', moeda(d.aReceber)]"), 'depois do resumo');
});

test('Busca dos acertos não derruba o relatório se falhar', async () => {
  const c = ambiente();
  c.apiSupabase = async () => { throw new Error('rede'); };
  assert.equal(await c.buscarAcertosRelatorio(), null);
  c.apiSupabase = async () => ({ ok: true, deCache: true, dados: [] });
  assert.equal(await c.buscarAcertosRelatorio(), null, 'cópia antiga do aparelho não serve para o acerto');
  c.apiSupabase = async (t, m, x, f) => ({ ok: true, dados: [{ id: 1, filtros: f }] });
  assert.equal((await c.buscarAcertosRelatorio())[0].filtros, '?select=*&order=registrado_em.desc&limit=1000');
});
