// ============================================================
// KG ENTREGAS — app.js
// ============================================================
// CONFIGURAÇÃO SUPABASE
// Substitua pelos seus dados em: supabase.com → Settings → API
// ============================================================
const SUPABASE_URL = 'https://eatmzxyckqrsjrlyosfg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhdG16eHlja3Fyc2pybHlvc2ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MzA0NzQsImV4cCI6MjA5NDMwNjQ3NH0.9Q23iGFuBdBWmag5Gl0KwCdmkCkjfxhq_IYddKClA7k';
const MODO_DEMO   = (SUPABASE_URL === 'SUA_URL_AQUI'); // demo sem banco

// ============================================================
// USUÁRIOS (enquanto não usa Supabase Auth)
// ============================================================
const USUARIOS = {
  admin:       { senha: 'kg2024admin',  perfil: 'admin',      nome: 'Kleber' },
  entregador:  { senha: 'kg2024',       perfil: 'funcionario', nome: 'Entregador' },
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let usuario     = null;
let pedidoSelecionado = null;
let clienteSelecionado = null;
let filtroEntregas = 'pendente';
let filtroFinanceiro = 'atrasado';
let todosOsPedidos  = [];
let todosOsClientes = [];
let todosOsFinanceiros = [];

// ============================================================
// DADOS DEMO (quando Supabase não está configurado)
// ============================================================
const DEMO_CLIENTES = [
  { id: 1, nome: 'Agropet São João',   responsavel: 'João Silva',  whatsapp: '(81) 99111-2222', endereco: 'Rua das Flores, 123 - Caruaru' },
  { id: 2, nome: 'Pet Center Flores',  responsavel: 'Maria Lima',  whatsapp: '(81) 98222-3333', endereco: 'Av. Brasil, 456 - Bezerros' },
  { id: 3, nome: 'Ração & Cia',        responsavel: 'Pedro Costa', whatsapp: '(81) 97333-4444', endereco: 'Rua do Campo, 789 - Gravatá' },
];

const hoje = new Date();
const fmt  = d => d.toISOString().split('T')[0];
const ontem = new Date(hoje); ontem.setDate(ontem.getDate()-1);
const amanha = new Date(hoje); amanha.setDate(amanha.getDate()+1);
const semana = new Date(hoje); semana.setDate(semana.getDate()+5);

const DEMO_PEDIDOS = [
  { id: 1, cliente_id: 1, cliente_nome: 'Agropet São João',  descricao: '2 sacos ração Golden 15kg', valor: 280.00, status: 'pendente', data_entrega: fmt(hoje),   data_vencimento: fmt(amanha), observacao: '' },
  { id: 2, cliente_id: 2, cliente_nome: 'Pet Center Flores', descricao: '1 cx ração Premium + 3 coleiras', valor: 195.50, status: 'pendente', data_entrega: fmt(hoje),   data_vencimento: fmt(ontem),  observacao: '' },
  { id: 3, cliente_id: 3, cliente_nome: 'Ração & Cia',       descricao: '5 sacos farelo de soja', valor: 420.00, status: 'entregue', data_entrega: fmt(ontem),  data_vencimento: fmt(semana), observacao: 'Recebeu o auxiliar, tudo certo' },
  { id: 4, cliente_id: 1, cliente_nome: 'Agropet São João',  descricao: 'Vacinas e medicamentos', valor: 150.00, status: 'pendente', data_entrega: fmt(amanha),  data_vencimento: fmt(semana), observacao: '' },
];

// ============================================================
// SUPABASE HELPER
// ============================================================
async function supabase(tabela, metodo = 'GET', dados = null, filtros = '') {
  if (MODO_DEMO) return null;
  try {
    const opts = {
      method: metodo,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': metodo === 'POST' ? 'return=representation' : '',
      },
    };
    if (dados) opts.body = JSON.stringify(dados);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtros}`, opts);
    if (!res.ok) throw new Error(await res.text());
    return metodo === 'DELETE' ? true : await res.json();
  } catch (e) {
    console.error('Supabase erro:', e);
    return null;
  }
}

// ============================================================
// LOGIN
// ============================================================
function fazerLogin() {
  const u = document.getElementById('input-usuario').value.trim().toLowerCase();
  const s = document.getElementById('input-senha').value;
  const user = USUARIOS[u];
  if (!user || user.senha !== s) {
    document.getElementById('erro-login').style.display = 'block';
    return;
  }
  usuario = { login: u, ...user };
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('tag-perfil').textContent = user.perfil === 'admin' ? '👑 Admin' : '📦 Entregador';
  configurarNav();
  if (MODO_DEMO) {
    document.getElementById('alerta-config').style.display = 'block';
    todosOsPedidos  = [...DEMO_PEDIDOS];
    todosOsClientes = [...DEMO_CLIENTES];
  }
  carregarTudo();
}

document.getElementById('input-senha').addEventListener('keyup', e => { if (e.key === 'Enter') fazerLogin(); });
document.getElementById('input-usuario').addEventListener('keyup', e => { if (e.key === 'Enter') document.getElementById('input-senha').focus(); });

function sair() {
  usuario = null;
  document.getElementById('tela-login').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('input-usuario').value = '';
  document.getElementById('input-senha').value = '';
  document.getElementById('erro-login').style.display = 'none';
}

// ============================================================
// NAV BOTTOM
// ============================================================
const NAV_ADMIN = [
  { id: 'dashboard', icone: '🏠', label: 'Início',    tela: 'tela-dashboard' },
  { id: 'entregas',  icone: '📦', label: 'Entregas',  tela: 'tela-entregas'  },
  { id: 'clientes',  icone: '🏪', label: 'Clientes',  tela: 'tela-clientes'  },
  { id: 'financeiro',icone: '💰', label: 'Financeiro',tela: 'tela-financeiro'},
];

const NAV_FUNC = [
  { id: 'entregas',  icone: '📦', label: 'Entregas do dia', tela: 'tela-entregas' },
];

function configurarNav() {
  const itens = usuario.perfil === 'admin' ? NAV_ADMIN : NAV_FUNC;
  const nav = document.getElementById('nav-bottom');
  nav.innerHTML = itens.map(i => `
    <button class="nav-item ${i.id === (usuario.perfil==='admin'?'dashboard':'entregas') ? 'ativo' : ''}" 
            onclick="navegarPara('${i.id}')" id="nav-${i.id}">
      <span class="nav-icon">${i.icone}</span>
      <span class="nav-label">${i.label}</span>
    </button>
  `).join('');

  if (usuario.perfil === 'funcionario') {
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-clientes').style.display = 'none';
    document.getElementById('tela-financeiro').style.display = 'none';
    navegarPara('entregas');
  }
}

function navegarPara(id) {
  const nav = usuario.perfil === 'admin' ? NAV_ADMIN : NAV_FUNC;
  const item = nav.find(i => i.id === id);
  if (!item) return;

  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  document.getElementById(item.tela).classList.add('ativa');
  document.getElementById('header-titulo').textContent = {
    dashboard: 'Início', entregas: 'Entregas', clientes: 'Clientes', financeiro: 'Financeiro'
  }[id];

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  const btn = document.getElementById(`nav-${id}`);
  if (btn) btn.classList.add('ativo');

  if (id === 'clientes')   renderizarClientes(todosOsClientes);
  if (id === 'financeiro') renderizarFinanceiro(filtroFinanceiro);
  if (id === 'entregas')   renderizarEntregas(filtroEntregas);
}

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarTudo() {
  if (!MODO_DEMO) {
    const [pedidos, clientes] = await Promise.all([
      supabase('pedidos', 'GET', null, '?order=data_entrega.asc&select=*,clientes(nome)'),
      supabase('clientes', 'GET', null, '?order=nome.asc'),
    ]);
    if (pedidos) {
      todosOsPedidos = pedidos.map(p => ({
        ...p,
        cliente_nome: p.clientes?.nome || '–',
      }));
    }
    if (clientes) todosOsClientes = clientes;
  }
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  popularSelectClientes();
}

// ============================================================
// DASHBOARD
// ============================================================
function renderizarDashboard() {
  const fmtHoje = fmt(new Date());
  const hojeEntregas = todosOsPedidos.filter(p => p.data_entrega === fmtHoje);
  const pendentes    = todosOsPedidos.filter(p => p.status === 'pendente');
  const atrasados    = pedidosAtrasados();

  document.getElementById('num-hoje').textContent      = hojeEntregas.length;
  document.getElementById('num-pendentes').textContent = pendentes.length;
  document.getElementById('num-atrasados').textContent = atrasados.length;
  document.getElementById('num-clientes').textContent  = todosOsClientes.length;

  const proximas = pendentes.slice(0, 5);
  const el = document.getElementById('lista-proximas');
  if (!proximas.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">✅</div><p>Sem entregas pendentes</p></div>`;
    return;
  }
  el.innerHTML = proximas.map(p => cardEntrega(p, false)).join('');
}

// ============================================================
// ENTREGAS
// ============================================================
function renderizarEntregas(filtro) {
  filtroEntregas = filtro;
  let lista = filtro === 'todos'
    ? todosOsPedidos
    : todosOsPedidos.filter(p => p.status === filtro);

  // funcionário só vê de hoje e pendentes
  if (usuario.perfil === 'funcionario') {
    const fmtHoje = fmt(new Date());
    lista = todosOsPedidos.filter(p => p.status === 'pendente' && p.data_entrega === fmtHoje);
  }

  const el = document.getElementById('lista-entregas');
  if (!lista.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">📭</div><p>Nenhuma entrega aqui</p></div>`;
    return;
  }
  el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
}

function cardEntrega(p, mostrarBotoes) {
  const atrasado = isAtrasado(p);
  const classe   = p.status === 'entregue' ? 'entregue' : (atrasado ? 'atrasado' : 'pendente');
  const badgeHtml = p.status === 'entregue'
    ? `<span class="badge badge-entregue">✓ Entregue</span>`
    : atrasado
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : `<span class="badge badge-pendente">Pendente</span>`;

  const botoesHtml = (mostrarBotoes && p.status === 'pendente') ? `
    <div class="item-acoes">
      <button class="btn-entregar" onclick="abrirModalEntrega(${p.id})">✓ Marcar entregue</button>
      <button class="btn-obs" onclick="abrirModalEntrega(${p.id})">📝</button>
    </div>` : '';

  const dataFmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '–';

  return `
    <div class="item-entrega ${classe}">
      <div class="item-header">
        <div class="item-cliente">${p.cliente_nome}</div>
        ${badgeHtml}
      </div>
      <div class="item-descricao">${p.descricao}</div>
      <div class="flex-entre">
        <span class="item-valor">R$ ${Number(p.valor).toFixed(2).replace('.',',')}</span>
        <span style="font-size:12px;color:var(--cinza)">📅 ${dataFmt(p.data_entrega)}</span>
      </div>
      ${p.observacao ? `<div style="font-size:12px;color:var(--texto-suave);margin-top:8px;border-top:1px solid var(--cinza-claro);padding-top:8px">📝 ${p.observacao}</div>` : ''}
      ${botoesHtml}
    </div>`;
}

function filtrarEntregas(filtro, btn) {
  document.querySelectorAll('#tela-entregas .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarEntregas(filtro);
}

// ============================================================
// CLIENTES
// ============================================================
function renderizarClientes(lista) {
  const el = document.getElementById('lista-clientes');
  if (!lista.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">🏪</div><p>Nenhum cliente cadastrado</p></div>`;
    return;
  }
  el.innerHTML = lista.map(c => {
    const pedidosCliente = todosOsPedidos.filter(p => p.cliente_id === c.id);
    const devendo = pedidosCliente.filter(p => p.status !== 'entregue' && Number(p.valor) > 0).reduce((s, p) => s + Number(p.valor), 0);
    const badge = devendo > 0
      ? `<span class="badge badge-devendo">R$ ${devendo.toFixed(2).replace('.',',')} em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    return `
      <div class="item-cliente-card" onclick="verDetalheCliente(${c.id})">
        <div>
          <div class="cliente-nome">${c.nome}</div>
          <div class="cliente-info">${c.responsavel} · ${c.whatsapp}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function buscarCliente(termo) {
  const filtrado = todosOsClientes.filter(c =>
    c.nome.toLowerCase().includes(termo.toLowerCase()) ||
    (c.responsavel || '').toLowerCase().includes(termo.toLowerCase())
  );
  renderizarClientes(filtrado);
}

function verDetalheCliente(id) {
  const c = todosOsClientes.find(x => x.id === id);
  if (!c) return;
  clienteSelecionado = c;
  const pedidos = todosOsPedidos.filter(p => p.cliente_id === id);
  const dataFmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '–';

  document.getElementById('detalhe-cliente-nome').textContent = c.nome;
  document.getElementById('detalhe-cliente-conteudo').innerHTML = `
    <div style="background:var(--cinza-claro);border-radius:var(--raio);padding:14px;margin-bottom:16px">
      <div style="font-size:13px;color:var(--texto-suave);margin-bottom:4px">👤 ${c.responsavel}</div>
      <div style="font-size:13px;color:var(--texto-suave);margin-bottom:4px">📱 ${c.whatsapp}</div>
      <div style="font-size:13px;color:var(--texto-suave)">📍 ${c.endereco}</div>
    </div>
    <div class="separador">Histórico de pedidos</div>
    ${pedidos.length ? pedidos.map(p => `
      <div style="border-bottom:1px solid var(--cinza-claro);padding:10px 0">
        <div class="flex-entre">
          <span style="font-size:14px;font-weight:500">${p.descricao}</span>
          <span class="badge ${p.status === 'entregue' ? 'badge-entregue' : 'badge-pendente'}">${p.status === 'entregue' ? '✓' : '⏳'}</span>
        </div>
        <div style="font-size:12px;color:var(--cinza);margin-top:4px">
          R$ ${Number(p.valor).toFixed(2).replace('.',',')} · ${dataFmt(p.data_entrega)}
        </div>
      </div>`).join('') : '<div class="vazio" style="padding:24px"><p>Nenhum pedido ainda</p></div>'}
    <button class="btn-perigo w100 mt-16" onclick="excluirCliente(${c.id})">Excluir cliente</button>
  `;
  abrirModal('modal-detalhe-cliente');
}

// ============================================================
// FINANCEIRO
// ============================================================
function renderizarFinanceiro(filtro) {
  filtroFinanceiro = filtro;
  const fmtHoje = fmt(new Date());

  // Por cliente
  const porCliente = {};
  todosOsClientes.forEach(c => { porCliente[c.id] = { cliente: c, pedidos: [] }; });
  todosOsPedidos.forEach(p => {
    if (porCliente[p.cliente_id]) porCliente[p.cliente_id].pedidos.push(p);
  });

  let total_devendo = 0, total_recebido = 0;
  const mesAtual = new Date().toISOString().slice(0, 7);

  Object.values(porCliente).forEach(({ pedidos }) => {
    pedidos.forEach(p => {
      if (p.status !== 'entregue') total_devendo += Number(p.valor);
      if (p.status === 'entregue' && p.data_entrega?.startsWith(mesAtual)) total_recebido += Number(p.valor);
    });
  });

  document.getElementById('fin-total-devendo').textContent  = `R$ ${total_devendo.toFixed(2).replace('.',',')}`;
  document.getElementById('fin-total-recebido').textContent = `R$ ${total_recebido.toFixed(2).replace('.',',')}`;

  let lista = Object.values(porCliente).filter(({ pedidos }) => {
    const devendo   = pedidos.filter(p => p.status !== 'entregue');
    const atrasados = devendo.filter(p => isAtrasado(p));
    if (filtro === 'atrasado') return atrasados.length > 0;
    if (filtro === 'devendo')  return devendo.length > 0;
    if (filtro === 'em-dia')   return devendo.length === 0;
    return true;
  });

  const el = document.getElementById('lista-financeiro');
  if (!lista.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">💚</div><p>Nenhum resultado aqui</p></div>`;
    return;
  }

  el.innerHTML = lista.map(({ cliente: c, pedidos }) => {
    const devendo   = pedidos.filter(p => p.status !== 'entregue');
    const atrasados = devendo.filter(p => isAtrasado(p));
    const totalDev  = devendo.reduce((s, p) => s + Number(p.valor), 0);
    const badge     = atrasados.length > 0
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : totalDev > 0
        ? `<span class="badge badge-devendo">Em aberto</span>`
        : `<span class="badge badge-em-dia">Em dia</span>`;

    return `
      <div class="item-cliente-card" onclick="verFinanceiroCliente(${c.id})">
        <div>
          <div class="cliente-nome">${c.nome}</div>
          <div class="cliente-info">${atrasados.length ? atrasados.length + ' entrega(s) atrasada(s)' : devendo.length ? devendo.length + ' entrega(s) em aberto' : 'Sem pendências'}</div>
          ${totalDev > 0 ? `<div style="font-size:13px;color:var(--vermelho);font-weight:600;margin-top:4px">R$ ${totalDev.toFixed(2).replace('.',',')} devidos</div>` : ''}
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function filtrarFinanceiro(filtro, btn) {
  document.querySelectorAll('#tela-financeiro .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarFinanceiro(filtro);
}

function verFinanceiroCliente(id) {
  const c = todosOsClientes.find(x => x.id === id);
  if (!c) return;
  clienteSelecionado = c;
  const pedidos = todosOsPedidos.filter(p => p.cliente_id === id && p.status !== 'entregue');
  const dataFmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '–';

  document.getElementById('fin-cliente-nome').textContent = c.nome;
  document.getElementById('fin-cliente-conteudo').innerHTML = `
    <div style="font-size:13px;color:var(--texto-suave);margin-bottom:16px">📱 ${c.whatsapp}</div>
    <div class="separador">Entregas em aberto</div>
    ${pedidos.map(p => `
      <div style="border-bottom:1px solid var(--cinza-claro);padding:10px 0">
        <div class="flex-entre">
          <span style="font-size:14px">${p.descricao}</span>
          <span style="font-size:14px;font-weight:600;color:var(--vermelho)">R$ ${Number(p.valor).toFixed(2).replace('.',',')}</span>
        </div>
        <div style="font-size:12px;color:var(--cinza);margin-top:4px">
          Venc.: ${dataFmt(p.data_vencimento)} ${isAtrasado(p) ? '· <span style="color:var(--vermelho)">⚠ Atrasado</span>' : ''}
        </div>
      </div>`).join('')}
    <div style="margin-top:12px;font-weight:600;color:var(--verde)">
      Total: R$ ${pedidos.reduce((s,p)=>s+Number(p.valor),0).toFixed(2).replace('.',',')}
    </div>
    <a href="https://wa.me/55${c.whatsapp.replace(/\D/g,'')}" target="_blank"
       style="display:block;margin-top:12px;background:var(--verde-ok-claro);color:var(--verde-ok);border-radius:var(--raio);padding:12px;text-align:center;text-decoration:none;font-weight:600;font-size:14px">
      📲 Enviar cobrança no WhatsApp
    </a>
  `;
  abrirModal('modal-fin-cliente');
}

function marcarPagoCliente() {
  if (!clienteSelecionado) return;
  const ids = todosOsPedidos
    .filter(p => p.cliente_id === clienteSelecionado.id && p.status !== 'entregue')
    .map(p => p.id);

  ids.forEach(id => {
    const idx = todosOsPedidos.findIndex(p => p.id === id);
    if (idx >= 0) todosOsPedidos[idx].status = 'entregue';
    if (!MODO_DEMO) supabase('pedidos', 'PATCH', { status: 'entregue' }, `?id=eq.${id}`);
  });

  fecharModal('modal-fin-cliente');
  renderizarFinanceiro(filtroFinanceiro);
  renderizarDashboard();
}

// ============================================================
// MODAL NOVO PEDIDO
// ============================================================
function abrirModalNovoPedido() {
  const hoje = fmt(new Date());
  document.getElementById('pedido-data-entrega').value    = hoje;
  document.getElementById('pedido-data-vencimento').value = hoje;
  document.getElementById('pedido-descricao').value = '';
  document.getElementById('pedido-valor').value = '';
  popularSelectClientes();
  abrirModal('modal-pedido');
}

function popularSelectClientes() {
  const sel = document.getElementById('pedido-cliente');
  sel.innerHTML = '<option value="">Selecionar cliente...</option>' +
    todosOsClientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
}

async function salvarPedido() {
  const cliente_id = Number(document.getElementById('pedido-cliente').value);
  const descricao  = document.getElementById('pedido-descricao').value.trim();
  const valor      = parseFloat(document.getElementById('pedido-valor').value) || 0;
  const data_entrega    = document.getElementById('pedido-data-entrega').value;
  const data_vencimento = document.getElementById('pedido-data-vencimento').value;

  if (!cliente_id || !descricao || !data_entrega) {
    alert('Preencha cliente, descrição e data de entrega.');
    return;
  }

  const cliente = todosOsClientes.find(c => c.id === cliente_id);
  const novoPedido = {
    id: Date.now(),
    cliente_id,
    cliente_nome: cliente?.nome || '–',
    descricao, valor, status: 'pendente',
    data_entrega, data_vencimento, observacao: ''
  };

  if (!MODO_DEMO) {
    const resultado = await supabase('pedidos', 'POST', {
      cliente_id, descricao, valor, status: 'pendente',
      data_entrega, data_vencimento
    });
    if (resultado?.[0]) novoPedido.id = resultado[0].id;
  }

  todosOsPedidos.push(novoPedido);
  fecharModal('modal-pedido');
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
}

// ============================================================
// MODAL NOVO CLIENTE
// ============================================================
function abrirModalNovoCliente() {
  ['cliente-nome','cliente-responsavel','cliente-whatsapp','cliente-endereco'].forEach(id => {
    document.getElementById(id).value = '';
  });
  abrirModal('modal-cliente');
}

async function salvarCliente() {
  const nome         = document.getElementById('cliente-nome').value.trim();
  const responsavel  = document.getElementById('cliente-responsavel').value.trim();
  const whatsapp     = document.getElementById('cliente-whatsapp').value.trim();
  const endereco     = document.getElementById('cliente-endereco').value.trim();

  if (!nome) { alert('Informe o nome da loja.'); return; }

  const novoCliente = { id: Date.now(), nome, responsavel, whatsapp, endereco };

  if (!MODO_DEMO) {
    const res = await supabase('clientes', 'POST', { nome, responsavel, whatsapp, endereco });
    if (res?.[0]) novoCliente.id = res[0].id;
  }

  todosOsClientes.push(novoCliente);
  fecharModal('modal-cliente');
  renderizarClientes(todosOsClientes);
  popularSelectClientes();
  document.getElementById('num-clientes').textContent = todosOsClientes.length;
}

async function excluirCliente(id) {
  if (!confirm('Excluir este cliente? Os pedidos associados serão mantidos.')) return;
  todosOsClientes = todosOsClientes.filter(c => c.id !== id);
  if (!MODO_DEMO) await supabase('clientes', 'DELETE', null, `?id=eq.${id}`);
  fecharModal('modal-detalhe-cliente');
  renderizarClientes(todosOsClientes);
}

// ============================================================
// MODAL CONFIRMAR ENTREGA
// ============================================================
function abrirModalEntrega(id) {
  const pedido = todosOsPedidos.find(p => p.id === id);
  if (!pedido) return;
  pedidoSelecionado = pedido;
  const dataFmt = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '–';
  document.getElementById('modal-entrega-titulo').textContent = 'Confirmar entrega';
  document.getElementById('modal-entrega-info').innerHTML = `
    <strong>${pedido.cliente_nome}</strong>
    <div style="margin-top:6px">${pedido.descricao}</div>
    <div style="margin-top:6px;color:var(--verde);font-weight:600">R$ ${Number(pedido.valor).toFixed(2).replace('.',',')}</div>
    <div style="margin-top:4px;font-size:12px">Data: ${dataFmt(pedido.data_entrega)}</div>
  `;
  document.getElementById('entrega-obs').value = pedido.observacao || '';
  abrirModal('modal-entrega');
}

async function confirmarEntrega() {
  if (!pedidoSelecionado) return;
  const obs = document.getElementById('entrega-obs').value.trim();
  const idx = todosOsPedidos.findIndex(p => p.id === pedidoSelecionado.id);
  if (idx >= 0) {
    todosOsPedidos[idx].status = 'entregue';
    todosOsPedidos[idx].observacao = obs;
  }
  if (!MODO_DEMO) {
    await supabase('pedidos', 'PATCH', { status: 'entregue', observacao: obs },
      `?id=eq.${pedidoSelecionado.id}`);
  }
  fecharModal('modal-entrega');
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
}

// ============================================================
// HELPERS
// ============================================================
function isAtrasado(p) {
  if (p.status === 'entregue') return false;
  if (!p.data_vencimento) return false;
  return p.data_vencimento < fmt(new Date());
}

function pedidosAtrasados() {
  return todosOsPedidos.filter(p => isAtrasado(p));
}

function abrirModal(id) {
  document.getElementById(id).classList.add('aberto');
}

function fecharModal(id) {
  document.getElementById(id).classList.remove('aberto');
}

// Fechar modal ao clicar fora
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('aberto');
  });
});
