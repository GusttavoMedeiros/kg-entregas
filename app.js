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
  admin:       { senha: 'kg2024admin',  perfil: 'admin',       nome: 'Kleber' },
  entregador:  { senha: 'kg2024',       perfil: 'funcionario', nome: 'Entregador' },
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let usuario            = null;
let pedidoSelecionado  = null;
let clienteSelecionado = null;
let filtroEntregas     = 'pendente';
let filtroFinanceiro   = 'atrasado';
let todosOsPedidos     = [];
let todosOsClientes    = [];

// ============================================================
// HELPERS BÁSICOS
// ============================================================
// Formata Date -> 'YYYY-MM-DD'
const fmt = d => d.toISOString().split('T')[0];

// Formata 'YYYY-MM-DD' -> 'DD/MM/YYYY' (seguro contra null/inválido)
function dataBR(d) {
  if (!d) return '–';
  const dt = new Date(d + 'T12:00:00');
  if (isNaN(dt.getTime())) return '–';
  return dt.toLocaleDateString('pt-BR');
}

// Formata número -> 'R$ 0,00' (seguro contra null/NaN)
function moeda(v) {
  const n = Number(v);
  return 'R$ ' + (isNaN(n) ? 0 : n).toFixed(2).replace('.', ',');
}

// Escapa HTML para evitar quebra de layout com caracteres especiais
function esc(texto) {
  if (texto == null) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// DADOS DEMO (quando Supabase não está configurado)
// ============================================================
const _hoje   = new Date();
const _ontem  = new Date(_hoje); _ontem.setDate(_ontem.getDate() - 1);
const _amanha = new Date(_hoje); _amanha.setDate(_amanha.getDate() + 1);
const _semana = new Date(_hoje); _semana.setDate(_semana.getDate() + 5);

const DEMO_CLIENTES = [
  { id: 1, nome: 'Agropet São João',  responsavel: 'João Silva',  whatsapp: '(81) 99111-2222', endereco: 'Rua das Flores, 123 - Caruaru' },
  { id: 2, nome: 'Pet Center Flores', responsavel: 'Maria Lima',  whatsapp: '(81) 98222-3333', endereco: 'Av. Brasil, 456 - Bezerros' },
  { id: 3, nome: 'Ração & Cia',       responsavel: 'Pedro Costa', whatsapp: '(81) 97333-4444', endereco: 'Rua do Campo, 789 - Gravatá' },
];

const DEMO_PEDIDOS = [
  { id: 1, cliente_id: 1, cliente_nome: 'Agropet São João',  descricao: '2 sacos ração Golden 15kg',      valor: 280.00, status: 'pendente', data_entrega: fmt(_hoje),   data_vencimento: fmt(_amanha), observacao: '' },
  { id: 2, cliente_id: 2, cliente_nome: 'Pet Center Flores', descricao: '1 cx ração Premium + 3 coleiras', valor: 195.50, status: 'pendente', data_entrega: fmt(_hoje),   data_vencimento: fmt(_ontem),  observacao: '' },
  { id: 3, cliente_id: 3, cliente_nome: 'Ração & Cia',       descricao: '5 sacos farelo de soja',         valor: 420.00, status: 'entregue', data_entrega: fmt(_ontem),  data_vencimento: fmt(_semana), observacao: 'Recebeu o auxiliar, tudo certo' },
  { id: 4, cliente_id: 1, cliente_nome: 'Agropet São João',  descricao: 'Vacinas e medicamentos',         valor: 150.00, status: 'pendente', data_entrega: fmt(_amanha), data_vencimento: fmt(_semana), observacao: '' },
];

// ============================================================
// SUPABASE HELPER
// ============================================================
// Retorna { ok: true, dados } em sucesso, { ok: false, erro } em falha.
// Distinguir explicitamente sucesso de erro evita o bug de array vazio ([])
// ser interpretado como "truthy = deu certo".
async function supabase(tabela, metodo = 'GET', dados = null, filtros = '') {
  if (MODO_DEMO) return { ok: true, dados: null };
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };
    // 'Prefer' só é necessário em POST/PATCH para retornar o registro
    if (metodo === 'POST' || metodo === 'PATCH') {
      headers['Prefer'] = 'return=representation';
    }
    const opts = { method: metodo, headers };
    if (dados) opts.body = JSON.stringify(dados);

    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtros}`, opts);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    if (metodo === 'DELETE') return { ok: true, dados: true };
    const json = await res.json();
    return { ok: true, dados: json };
  } catch (e) {
    console.error('Supabase erro:', e);
    return { ok: false, erro: e.message };
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
  document.getElementById('erro-login').style.display = 'none';
  document.getElementById('tela-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('tag-perfil').textContent = user.perfil === 'admin' ? '👑 Admin' : '📦 Entregador';

  configurarNav();

  if (MODO_DEMO) {
    document.getElementById('alerta-config').style.display = 'block';
    todosOsPedidos  = JSON.parse(JSON.stringify(DEMO_PEDIDOS));
    todosOsClientes = JSON.parse(JSON.stringify(DEMO_CLIENTES));
  }

  carregarTudo();
}

document.getElementById('input-senha').addEventListener('keyup', e => {
  if (e.key === 'Enter') fazerLogin();
});
document.getElementById('input-usuario').addEventListener('keyup', e => {
  if (e.key === 'Enter') document.getElementById('input-senha').focus();
});

function sair() {
  usuario = null;
  todosOsPedidos = [];
  todosOsClientes = [];
  document.getElementById('tela-login').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('input-usuario').value = '';
  document.getElementById('input-senha').value = '';
  document.getElementById('erro-login').style.display = 'none';
  // Restaura telas admin que podem ter sido escondidas para o funcionário
  ['tela-dashboard', 'tela-clientes', 'tela-financeiro'].forEach(id => {
    document.getElementById(id).style.display = '';
  });
  // Restaura abas de filtro de entregas
  const abasEntregas = document.querySelector('#tela-entregas .abas');
  if (abasEntregas) abasEntregas.style.display = '';
  // Reseta filtros para o padrão
  filtroEntregas = 'pendente';
  filtroFinanceiro = 'atrasado';
}

// ============================================================
// NAV BOTTOM
// ============================================================
const NAV_ADMIN = [
  { id: 'dashboard',  icone: '🏠', label: 'Início',     tela: 'tela-dashboard'  },
  { id: 'entregas',   icone: '📦', label: 'Entregas',   tela: 'tela-entregas'   },
  { id: 'clientes',   icone: '🏪', label: 'Clientes',   tela: 'tela-clientes'   },
  { id: 'financeiro', icone: '💰', label: 'Financeiro', tela: 'tela-financeiro' },
];

const NAV_FUNC = [
  { id: 'entregas', icone: '📦', label: 'Entregas do dia', tela: 'tela-entregas' },
];

const TITULOS = {
  dashboard: 'Início', entregas: 'Entregas',
  clientes: 'Clientes', financeiro: 'Financeiro'
};

function configurarNav() {
  const itens = usuario.perfil === 'admin' ? NAV_ADMIN : NAV_FUNC;
  const inicial = usuario.perfil === 'admin' ? 'dashboard' : 'entregas';
  const nav = document.getElementById('nav-bottom');

  nav.innerHTML = itens.map(i => `
    <button class="nav-item ${i.id === inicial ? 'ativo' : ''}"
            onclick="navegarPara('${i.id}')" id="nav-${i.id}">
      <span class="nav-icon">${i.icone}</span>
      <span class="nav-label">${esc(i.label)}</span>
    </button>
  `).join('');

  // Funcionário: esconde telas de admin e vai direto pra entregas
  if (usuario.perfil === 'funcionario') {
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('tela-clientes').style.display = 'none';
    document.getElementById('tela-financeiro').style.display = 'none';
    document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
    document.getElementById('tela-entregas').classList.add('ativa');
    document.getElementById('header-titulo').textContent = 'Entregas do dia';
    // Abas de filtro não fazem sentido para o funcionário (ele só vê pendentes do dia)
    const abasEntregas = document.querySelector('#tela-entregas .abas');
    if (abasEntregas) abasEntregas.style.display = 'none';
  } else {
    document.getElementById('header-titulo').textContent = 'Início';
    const abasEntregas = document.querySelector('#tela-entregas .abas');
    if (abasEntregas) abasEntregas.style.display = '';
  }
}

function navegarPara(id) {
  const navAtual = usuario.perfil === 'admin' ? NAV_ADMIN : NAV_FUNC;
  const item = navAtual.find(i => i.id === id);
  if (!item) return;

  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  document.getElementById(item.tela).classList.add('ativa');
  document.getElementById('header-titulo').textContent = TITULOS[id] || '';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  const btn = document.getElementById(`nav-${id}`);
  if (btn) btn.classList.add('ativo');

  if (id === 'clientes')   renderizarClientes(todosOsClientes);
  if (id === 'financeiro') renderizarFinanceiro(filtroFinanceiro);
  if (id === 'entregas')   renderizarEntregas(filtroEntregas);
  if (id === 'dashboard')  renderizarDashboard();
}

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarTudo() {
  if (!MODO_DEMO) {
    const [resPedidos, resClientes] = await Promise.all([
      supabase('pedidos', 'GET', null, '?order=data_entrega.asc&select=*,clientes(nome)'),
      supabase('clientes', 'GET', null, '?order=nome.asc'),
    ]);

    if (!resPedidos.ok || !resClientes.ok) {
      alert('Erro ao carregar dados do banco. Verifique sua conexão e recarregue a página.');
      return;
    }

    todosOsClientes = resClientes.dados || [];
    todosOsPedidos = (resPedidos.dados || []).map(p => ({
      ...p,
      cliente_nome: (p.clientes && p.clientes.nome) ? p.clientes.nome : '–',
    }));
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

  // Ordena pendentes por data de entrega
  const proximas = pendentes
    .slice()
    .sort((a, b) => (a.data_entrega || '').localeCompare(b.data_entrega || ''))
    .slice(0, 5);

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
  let lista;

  if (usuario.perfil === 'funcionario') {
    // Funcionário só vê pendentes do dia
    const fmtHoje = fmt(new Date());
    lista = todosOsPedidos.filter(p => p.status === 'pendente' && p.data_entrega === fmtHoje);
  } else {
    lista = filtro === 'todos'
      ? todosOsPedidos.slice()
      : todosOsPedidos.filter(p => p.status === filtro);
  }

  // Ordena por data de entrega
  lista.sort((a, b) => (a.data_entrega || '').localeCompare(b.data_entrega || ''));

  const el = document.getElementById('lista-entregas');
  if (!lista.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">📭</div><p>Nenhuma entrega aqui</p></div>`;
    return;
  }
  el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
}

function cardEntrega(p, mostrarBotoes) {
  const atrasado = isAtrasado(p);
  const classe = p.status === 'entregue' ? 'entregue' : (atrasado ? 'atrasado' : 'pendente');

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

  return `
    <div class="item-entrega ${classe}">
      <div class="item-header">
        <div class="item-cliente">${esc(p.cliente_nome)}</div>
        ${badgeHtml}
      </div>
      <div class="item-descricao">${esc(p.descricao)}</div>
      <div class="flex-entre">
        <span class="item-valor">${moeda(p.valor)}</span>
        <span style="font-size:12px;color:var(--c3)">📅 ${dataBR(p.data_entrega)}</span>
      </div>
      ${p.observacao ? `<div style="font-size:12px;color:var(--c2);margin-top:10px;border-top:1px solid var(--ol);padding-top:10px">📝 ${esc(p.observacao)}</div>` : ''}
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
    const devendo = pedidosCliente
      .filter(p => p.status !== 'entregue' && Number(p.valor) > 0)
      .reduce((s, p) => s + Number(p.valor), 0);
    const badge = devendo > 0
      ? `<span class="badge badge-devendo">${moeda(devendo)} em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    return `
      <div class="item-cliente-card" onclick="verDetalheCliente(${c.id})">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-info">${esc(c.responsavel || 'Sem responsável')} · ${esc(c.whatsapp || 'Sem contato')}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function buscarCliente(termo) {
  const t = (termo || '').toLowerCase();
  const filtrado = todosOsClientes.filter(c =>
    (c.nome || '').toLowerCase().includes(t) ||
    (c.responsavel || '').toLowerCase().includes(t)
  );
  renderizarClientes(filtrado);
}

function verDetalheCliente(id) {
  const c = todosOsClientes.find(x => x.id === id);
  if (!c) return;
  clienteSelecionado = c;
  const pedidos = todosOsPedidos.filter(p => p.cliente_id === id);

  document.getElementById('detalhe-cliente-nome').textContent = c.nome;
  document.getElementById('detalhe-cliente-conteudo').innerHTML = `
    <div style="background:rgba(10,26,16,.6);border:1px solid var(--ol);border-radius:var(--r);padding:14px;margin-bottom:16px">
      <div style="font-size:13px;color:var(--c2);margin-bottom:6px">👤 ${esc(c.responsavel || '–')}</div>
      <div style="font-size:13px;color:var(--c2);margin-bottom:6px">📱 ${esc(c.whatsapp || '–')}</div>
      <div style="font-size:13px;color:var(--c2)">📍 ${esc(c.endereco || '–')}</div>
    </div>
    <div class="separador">Histórico de pedidos</div>
    ${pedidos.length ? pedidos.map(p => `
      <div style="border-bottom:1px solid var(--ol);padding:10px 0">
        <div class="flex-entre">
          <span style="font-size:13px;font-weight:600;color:var(--creme)">${esc(p.descricao)}</span>
          <span class="badge ${p.status === 'entregue' ? 'badge-entregue' : 'badge-pendente'}">${p.status === 'entregue' ? '✓' : '⏳'}</span>
        </div>
        <div style="font-size:12px;color:var(--c3);margin-top:4px">
          ${moeda(p.valor)} · ${dataBR(p.data_entrega)}
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

  // Agrupa pedidos por cliente
  const porCliente = {};
  todosOsClientes.forEach(c => { porCliente[c.id] = { cliente: c, pedidos: [] }; });
  todosOsPedidos.forEach(p => {
    if (porCliente[p.cliente_id]) porCliente[p.cliente_id].pedidos.push(p);
  });

  // Totais
  let totalDevendo = 0, totalRecebido = 0;
  const mesAtual = new Date().toISOString().slice(0, 7);

  Object.values(porCliente).forEach(({ pedidos }) => {
    pedidos.forEach(p => {
      if (p.status !== 'entregue') {
        totalDevendo += Number(p.valor) || 0;
      } else if (p.data_entrega && p.data_entrega.startsWith(mesAtual)) {
        totalRecebido += Number(p.valor) || 0;
      }
    });
  });

  document.getElementById('fin-total-devendo').textContent  = moeda(totalDevendo);
  document.getElementById('fin-total-recebido').textContent = moeda(totalRecebido);

  // Filtra clientes conforme aba
  const lista = Object.values(porCliente).filter(({ pedidos }) => {
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
    const totalDev  = devendo.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const badge = atrasados.length > 0
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : totalDev > 0
        ? `<span class="badge badge-devendo">Em aberto</span>`
        : `<span class="badge badge-em-dia">Em dia</span>`;

    const info = atrasados.length
      ? `${atrasados.length} entrega(s) atrasada(s)`
      : devendo.length
        ? `${devendo.length} entrega(s) em aberto`
        : 'Sem pendências';

    return `
      <div class="item-cliente-card" onclick="verFinanceiroCliente(${c.id})">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-info">${info}</div>
          ${totalDev > 0 ? `<div style="font-size:13px;color:#e05a4e;font-weight:700;margin-top:4px">${moeda(totalDev)} devidos</div>` : ''}
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
  const total = pedidos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const whatsappLimpo = (c.whatsapp || '').replace(/\D/g, '');

  document.getElementById('fin-cliente-nome').textContent = c.nome;
  document.getElementById('fin-cliente-conteudo').innerHTML = `
    <div style="font-size:13px;color:var(--c2);margin-bottom:16px">📱 ${esc(c.whatsapp || '–')}</div>
    <div class="separador">Entregas em aberto</div>
    ${pedidos.length ? pedidos.map(p => `
      <div style="border-bottom:1px solid var(--ol);padding:10px 0">
        <div class="flex-entre">
          <span style="font-size:13px;color:var(--creme)">${esc(p.descricao)}</span>
          <span style="font-size:14px;font-weight:700;color:#e05a4e">${moeda(p.valor)}</span>
        </div>
        <div style="font-size:12px;color:var(--c3);margin-top:4px">
          Venc.: ${dataBR(p.data_vencimento)} ${isAtrasado(p) ? '· <span style="color:#e05a4e;font-weight:700">⚠ Atrasado</span>' : ''}
        </div>
      </div>`).join('') : '<div class="vazio" style="padding:24px"><p>Sem entregas em aberto</p></div>'}
    <div style="margin-top:14px;font-weight:700;color:var(--o1);font-size:15px">
      Total: ${moeda(total)}
    </div>
    ${whatsappLimpo ? `
      <a href="https://wa.me/55${whatsappLimpo}" target="_blank" rel="noopener"
         style="display:block;margin-top:14px;background:var(--gnb);color:var(--gn);border:1px solid rgba(39,174,96,.3);border-radius:var(--r);padding:12px;text-align:center;text-decoration:none;font-weight:700;font-size:14px">
        📲 Enviar cobrança no WhatsApp
      </a>` : ''}
  `;
  abrirModal('modal-fin-cliente');
}

async function marcarPagoCliente() {
  if (!clienteSelecionado) return;

  const pedidosParaPagar = todosOsPedidos.filter(
    p => p.cliente_id === clienteSelecionado.id && p.status !== 'entregue'
  );

  if (!pedidosParaPagar.length) {
    fecharModal('modal-fin-cliente');
    return;
  }

  // Atualiza no Supabase primeiro (se falhar, não altera local)
  if (!MODO_DEMO) {
    const resultados = await Promise.all(pedidosParaPagar.map(p =>
      supabase('pedidos', 'PATCH', { status: 'entregue' }, `?id=eq.${p.id}`)
    ));
    // Falha real = ok false. Array vazio em dados ainda é ok true.
    const algumaFalhou = resultados.some(r => !r.ok);
    if (algumaFalhou) {
      alert('Erro ao atualizar no banco. Verifique sua conexão e tente novamente.');
      return;
    }
  }

  // Atualiza local
  pedidosParaPagar.forEach(p => { p.status = 'entregue'; });

  fecharModal('modal-fin-cliente');
  renderizarFinanceiro(filtroFinanceiro);
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
}

// ============================================================
// MODAL NOVO PEDIDO
// ============================================================
function abrirModalNovoPedido() {
  const dataHoje = fmt(new Date());
  document.getElementById('pedido-data-entrega').value    = dataHoje;
  document.getElementById('pedido-data-vencimento').value = dataHoje;
  document.getElementById('pedido-descricao').value = '';
  document.getElementById('pedido-valor').value = '';
  document.getElementById('pedido-cliente').value = '';
  popularSelectClientes();
  abrirModal('modal-pedido');
}

function popularSelectClientes() {
  const sel = document.getElementById('pedido-cliente');
  sel.innerHTML = '<option value="">Selecionar cliente...</option>' +
    todosOsClientes.map(c => `<option value="${c.id}">${esc(c.nome)}</option>`).join('');
}

async function salvarPedido() {
  const cliente_id      = Number(document.getElementById('pedido-cliente').value);
  const descricao       = document.getElementById('pedido-descricao').value.trim();
  // Aceita tanto '280.50' quanto '280,50'
  const valorBruto      = document.getElementById('pedido-valor').value.replace(',', '.');
  const valor           = parseFloat(valorBruto) || 0;
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
    cliente_nome: cliente ? cliente.nome : '–',
    descricao, valor, status: 'pendente',
    data_entrega,
    data_vencimento: data_vencimento || null,
    observacao: ''
  };

  if (!MODO_DEMO) {
    const res = await supabase('pedidos', 'POST', {
      cliente_id, descricao, valor, status: 'pendente',
      data_entrega, data_vencimento: data_vencimento || null
    });
    if (!res.ok || !res.dados || !res.dados[0]) {
      alert('Erro ao salvar no banco. Verifique sua conexão e tente novamente.');
      return;
    }
    novoPedido.id = res.dados[0].id;
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
  ['cliente-nome', 'cliente-responsavel', 'cliente-whatsapp', 'cliente-endereco'].forEach(id => {
    document.getElementById(id).value = '';
  });
  abrirModal('modal-cliente');
}

async function salvarCliente() {
  const nome        = document.getElementById('cliente-nome').value.trim();
  const responsavel = document.getElementById('cliente-responsavel').value.trim();
  const whatsapp    = document.getElementById('cliente-whatsapp').value.trim();
  const endereco    = document.getElementById('cliente-endereco').value.trim();

  if (!nome) {
    alert('Informe o nome da loja.');
    return;
  }

  const novoCliente = { id: Date.now(), nome, responsavel, whatsapp, endereco };

  if (!MODO_DEMO) {
    const res = await supabase('clientes', 'POST', { nome, responsavel, whatsapp, endereco });
    if (!res.ok || !res.dados || !res.dados[0]) {
      alert('Erro ao salvar no banco. Verifique sua conexão e tente novamente.');
      return;
    }
    novoCliente.id = res.dados[0].id;
  }

  todosOsClientes.push(novoCliente);
  fecharModal('modal-cliente');
  renderizarClientes(todosOsClientes);
  popularSelectClientes();
  document.getElementById('num-clientes').textContent = todosOsClientes.length;
}

async function excluirCliente(id) {
  // Avisa se o cliente tem pedidos vinculados (o banco bloqueia a exclusão)
  const pedidosVinculados = todosOsPedidos.filter(p => p.cliente_id === id);
  if (pedidosVinculados.length > 0) {
    alert(
      'Este cliente tem ' + pedidosVinculados.length + ' pedido(s) registrado(s) e ' +
      'não pode ser excluído. Isso preserva o histórico. ' +
      'Se realmente precisar removê-lo, exclua antes os pedidos dele.'
    );
    return;
  }

  if (!confirm('Excluir este cliente? Esta ação não pode ser desfeita.')) return;

  if (!MODO_DEMO) {
    const res = await supabase('clientes', 'DELETE', null, `?id=eq.${id}`);
    if (!res.ok) {
      alert('Erro ao excluir no banco. Verifique sua conexão e tente novamente.');
      return;
    }
  }

  todosOsClientes = todosOsClientes.filter(c => c.id !== id);
  fecharModal('modal-detalhe-cliente');
  renderizarClientes(todosOsClientes);
  popularSelectClientes();
  document.getElementById('num-clientes').textContent = todosOsClientes.length;
}

// ============================================================
// MODAL CONFIRMAR ENTREGA
// ============================================================
function abrirModalEntrega(id) {
  const pedido = todosOsPedidos.find(p => p.id === id);
  if (!pedido) return;
  pedidoSelecionado = pedido;

  document.getElementById('modal-entrega-titulo').textContent = 'Confirmar Entrega';
  document.getElementById('modal-entrega-info').innerHTML = `
    <strong style="color:var(--o1)">${esc(pedido.cliente_nome)}</strong>
    <div style="margin-top:6px;color:var(--c2)">${esc(pedido.descricao)}</div>
    <div style="margin-top:6px;color:var(--o1);font-weight:700">${moeda(pedido.valor)}</div>
    <div style="margin-top:4px;font-size:12px;color:var(--c3)">Data: ${dataBR(pedido.data_entrega)}</div>
  `;
  document.getElementById('entrega-obs').value = pedido.observacao || '';
  abrirModal('modal-entrega');
}

async function confirmarEntrega() {
  if (!pedidoSelecionado) return;
  const obs = document.getElementById('entrega-obs').value.trim();
  const id = pedidoSelecionado.id;

  if (!MODO_DEMO) {
    const res = await supabase('pedidos', 'PATCH',
      { status: 'entregue', observacao: obs }, `?id=eq.${id}`);
    if (!res.ok) {
      alert('Erro ao confirmar no banco. Verifique sua conexão e tente novamente.');
      return;
    }
  }

  const idx = todosOsPedidos.findIndex(p => p.id === id);
  if (idx >= 0) {
    todosOsPedidos[idx].status = 'entregue';
    todosOsPedidos[idx].observacao = obs;
  }

  fecharModal('modal-entrega');
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  // Atualiza financeiro se o admin estiver usando
  if (usuario.perfil === 'admin') renderizarFinanceiro(filtroFinanceiro);
}

// ============================================================
// HELPERS DE LÓGICA
// ============================================================
function isAtrasado(p) {
  if (p.status === 'entregue') return false;
  if (!p.data_vencimento) return false;
  return p.data_vencimento < fmt(new Date());
}

function pedidosAtrasados() {
  return todosOsPedidos.filter(p => isAtrasado(p));
}

// ============================================================
// MODAIS
// ============================================================
function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add('aberto');
}

function fecharModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('aberto');
}

// Fechar modal ao clicar fora
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('aberto');
  });
});
