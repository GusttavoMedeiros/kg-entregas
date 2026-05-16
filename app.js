// ============================================================
// KG ENTREGAS v2 — app.js
// ============================================================
const SUPABASE_URL = 'https://eatmzxyckqrsjrlyosfg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhdG16eHlja3Fyc2pybHlvc2ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MzA0NzQsImV4cCI6MjA5NDMwNjQ3NH0.9Q23iGFuBdBWmag5Gl0KwCdmkCkjfxhq_IYddKClA7k';
const MODO_DEMO = (SUPABASE_URL === 'SUA_URL_AQUI');

// ============================================================
// USUÁRIOS
// ============================================================
const USUARIOS = {
  admin:      { senha: 'kg2024admin',  perfil: 'admin',       nome: 'Kleber'     },
  vendedor:   { senha: 'kg2024venda',  perfil: 'vendedor',    nome: 'Vendedor'   },
  entregador: { senha: 'kg2024',       perfil: 'entregador',  nome: 'Entregador' },
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let usuario            = null;
let pedidoSelecionado  = null;
let pedidoEmEdicao     = null;   // pedido sendo editado (null = novo pedido)
let clienteSelecionado = null;
let produtoSelecionado = null;
let filtroEntregas     = 'pendente';
let filtroFinanceiro   = 'atrasado';
let filtroCatalogo     = 'todos';
let filtroMeusPedidos  = 'pendente';
let carrinho           = [];      // [{produto, qtd}]
let autoRefreshTimer   = null;    // timer de sincronização automática
let todosOsPedidos     = [];
let todosOsClientes    = [];
let todosOsProdutos    = [];

// ============================================================
// HELPERS
// ============================================================
const fmt = d => d.toISOString().split('T')[0];

function dataBR(d) {
  if (!d) return '–';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt.getTime()) ? '–' : dt.toLocaleDateString('pt-BR');
}

function moeda(v) {
  const n = Number(v);
  return 'R$ ' + (isNaN(n) ? 0 : n).toFixed(2).replace('.', ',');
}

function esc(t) {
  if (t == null) return '';
  return String(t)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function badgeCategoria(cat) {
  const m = { 'Ração': 'badge-racao', 'Agropecuário': 'badge-agro' };
  return `<span class="badge ${m[cat] || 'badge-outros'}">${esc(cat)}</span>`;
}

// ============================================================
// DADOS DEMO
// ============================================================
const _h = new Date(), _o = new Date(_h), _a = new Date(_h), _s = new Date(_h);
_o.setDate(_o.getDate()-1); _a.setDate(_a.getDate()+1); _s.setDate(_s.getDate()+5);

const DEMO_CLIENTES = [
  { id:1, nome:'Agropet São João',  responsavel:'João Silva',  whatsapp:'(81) 99111-2222', endereco:'Rua das Flores, 123 - Caruaru' },
  { id:2, nome:'Pet Center Flores', responsavel:'Maria Lima',  whatsapp:'(81) 98222-3333', endereco:'Av. Brasil, 456 - Bezerros'   },
  { id:3, nome:'Ração & Cia',       responsavel:'Pedro Costa', whatsapp:'(81) 97333-4444', endereco:'Rua do Campo, 789 - Gravatá'  },
];

const DEMO_PRODUTOS = [
  { id:1, nome:'Ração Golden Adulto 15kg',   categoria:'Ração',        preco:142.90, estoque:20 },
  { id:2, nome:'Ração Premium Filhote 10kg', categoria:'Ração',        preco:98.50,  estoque:15 },
  { id:3, nome:'Ração Pedigree 3kg',         categoria:'Ração',        preco:36.90,  estoque:30 },
  { id:4, nome:'Ração Gatos Whiskas 3kg',    categoria:'Ração',        preco:42.00,  estoque:8  },
  { id:5, nome:'Farelo de Soja 60kg',        categoria:'Agropecuário', preco:188.00, estoque:50 },
  { id:6, nome:'Milho Triturado 30kg',       categoria:'Agropecuário', preco:74.00,  estoque:40 },
  { id:7, nome:'Sal Mineral Bovino 30kg',    categoria:'Agropecuário', preco:62.00,  estoque:25 },
  { id:8, nome:'Vermífugo Ivermectina',      categoria:'Agropecuário', preco:28.50,  estoque:3  },
];

const DEMO_PEDIDOS = [
  { id:1, cliente_id:1, cliente_nome:'Agropet São João',  descricao:'2x Ração Golden 15kg',      itens:[{produto_id:1,nome:'Ração Golden 15kg',qtd:2,preco_unit:142.90}], valor:285.80, status:'pendente', data_entrega:fmt(_h), data_vencimento:fmt(_a), observacao:'', vendedor:'vendedor' },
  { id:2, cliente_id:2, cliente_nome:'Pet Center Flores', descricao:'3x Farelo de Soja 60kg',    itens:[{produto_id:5,nome:'Farelo de Soja 60kg',qtd:3,preco_unit:188.00}], valor:564.00, status:'pendente', data_entrega:fmt(_h), data_vencimento:fmt(_o), observacao:'', vendedor:'admin'    },
  { id:3, cliente_id:3, cliente_nome:'Ração & Cia',       descricao:'1x Milho 30kg + 1x Sal Min.',itens:[{produto_id:6,nome:'Milho 30kg',qtd:1,preco_unit:74.00},{produto_id:7,nome:'Sal Mineral 30kg',qtd:1,preco_unit:62.00}], valor:136.00, status:'entregue', data_entrega:fmt(_o), data_vencimento:fmt(_s), observacao:'Entregue certo', vendedor:'vendedor' },
  { id:4, cliente_id:1, cliente_nome:'Agropet São João',  descricao:'5x Ração Pedigree 3kg',     itens:[{produto_id:3,nome:'Ração Pedigree 3kg',qtd:5,preco_unit:36.90}], valor:184.50, status:'pendente', data_entrega:fmt(_a), data_vencimento:fmt(_s), observacao:'', vendedor:'admin'    },
];

// ============================================================
// SUPABASE
// ============================================================
async function supabase(tabela, metodo='GET', dados=null, filtros='') {
  if (MODO_DEMO) return { ok:true, dados:null };
  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };
    if (metodo==='POST' || metodo==='PATCH') headers['Prefer'] = 'return=representation';
    const opts = { method:metodo, headers };
    if (dados) opts.body = JSON.stringify(dados);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtros}`, opts);
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[Supabase ${metodo} ${tabela}] HTTP ${res.status}:`, txt);
      return { ok:false, erro: `HTTP ${res.status}: ${txt}`, status: res.status };
    }
    if (metodo==='DELETE') return { ok:true, dados:true };
    return { ok:true, dados: await res.json() };
  } catch(e) {
    console.error(`[Supabase ${metodo} ${tabela}] Erro de rede:`, e);
    return { ok:false, erro: e.message };
  }
}

// ============================================================
// LOGIN / SAIR
// ============================================================
function fazerLogin() {
  const u = document.getElementById('input-usuario').value.trim().toLowerCase();
  const s = document.getElementById('input-senha').value;
  const user = USUARIOS[u];
  if (!user || user.senha !== s) {
    document.getElementById('erro-login').style.display = 'block';
    return;
  }
  usuario = { login:u, ...user };
  document.getElementById('erro-login').style.display = 'none';
  document.getElementById('tela-login').style.display = 'none';
  const appEl = document.getElementById('app');
  appEl.style.display = 'flex';
  appEl.classList.add('ativo-desktop');
  document.getElementById('tag-perfil').textContent =
    user.perfil==='admin' ? '👑 Admin' :
    user.perfil==='vendedor' ? '🤝 Vendedor' : '📦 Entregador';

  // Header verde especial para vendedor
  const hdr = document.getElementById('app-header');
  hdr.className = user.perfil==='vendedor' ? 'header vendedor' : 'header';

  if (MODO_DEMO) {
    document.getElementById('alerta-config').style.display = 'block';
    todosOsPedidos  = JSON.parse(JSON.stringify(DEMO_PEDIDOS));
    todosOsClientes = JSON.parse(JSON.stringify(DEMO_CLIENTES));
    todosOsProdutos = JSON.parse(JSON.stringify(DEMO_PRODUTOS));
  }
  configurarNav();
  carregarTudo();
}

document.getElementById('input-senha').addEventListener('keyup', e => { if(e.key==='Enter') fazerLogin(); });
document.getElementById('input-usuario').addEventListener('keyup', e => { if(e.key==='Enter') document.getElementById('input-senha').focus(); });

function sair() {
  pararAutoRefresh();
  usuario=null; todosOsPedidos=[]; todosOsClientes=[]; todosOsProdutos=[]; carrinho=[];
  filtroEntregas='pendente'; filtroFinanceiro='atrasado'; filtroCatalogo='todos'; filtroMeusPedidos='pendente';
  document.getElementById('tela-login').style.display='flex';
  const appEl = document.getElementById('app');
  appEl.style.display='none';
  appEl.classList.remove('ativo-desktop');
  document.getElementById('input-usuario').value='';
  document.getElementById('input-senha').value='';
  document.getElementById('erro-login').style.display='none';
  // Restaura telas
  ['tela-dashboard','tela-clientes','tela-financeiro','tela-catalogo','tela-meus-pedidos','tela-entregas']
    .forEach(id => { document.getElementById(id).style.display=''; });
  const abasEl = document.getElementById('abas-entregas');
  if (abasEl) abasEl.style.display='';
}

// ============================================================
// NAV BOTTOM
// ============================================================
const NAV = {
  admin: [
    { id:'dashboard',  icone:'🏠', label:'Início',     tela:'tela-dashboard'   },
    { id:'entregas',   icone:'🚚', label:'Entregas',   tela:'tela-entregas'    },
    { id:'clientes',   icone:'🏪', label:'Clientes',   tela:'tela-clientes'    },
    { id:'financeiro', icone:'💰', label:'Financeiro', tela:'tela-financeiro'  },
    { id:'catalogo',   icone:'🛒', label:'Catálogo',   tela:'tela-catalogo'    },
  ],
  vendedor: [
    { id:'meus-pedidos', icone:'📋', label:'Meus pedidos', tela:'tela-meus-pedidos' },
    { id:'catalogo',     icone:'🛒', label:'Catálogo',     tela:'tela-catalogo'     },
    { id:'clientes',     icone:'🏪', label:'Clientes',     tela:'tela-clientes'     },
  ],
  entregador: [
    { id:'entregas', icone:'🚚', label:'Entregas do dia', tela:'tela-entregas' },
  ],
};

const TITULOS = {
  dashboard:'Início', entregas:'Entregas', clientes:'Clientes',
  financeiro:'Financeiro', catalogo:'Catálogo', 'meus-pedidos':'Meus Pedidos',
};

function configurarNav() {
  const p = usuario.perfil;
  const itens = NAV[p] || NAV.entregador;
  const inicial = itens[0].id;
  const nav = document.getElementById('nav-bottom');
  nav.innerHTML = itens.map(i => `
    <button class="nav-item ${i.id===inicial?'ativo':''}" onclick="navegarPara('${i.id}')" id="nav-${i.id}">
      <span class="nav-icon">${i.icone}</span>
      <span class="nav-label">${esc(i.label)}</span>
    </button>`).join('');

  // Esconde telas que o perfil não usa
  const telasVisiveis = new Set(itens.map(i => i.tela));
  ['tela-dashboard','tela-entregas','tela-clientes','tela-financeiro','tela-catalogo','tela-meus-pedidos']
    .forEach(id => {
      document.getElementById(id).style.display = telasVisiveis.has(id) ? '' : 'none';
    });

  // Entregador não vê abas de filtro
  const abasEl = document.getElementById('abas-entregas');
  if (abasEl) abasEl.style.display = p==='entregador' ? 'none' : '';

  // Catálogo: botão adicionar só para admin
  const btnAdd = document.getElementById('btn-add-produto');
  if (btnAdd) btnAdd.innerHTML = p==='admin'
    ? '<button class="btn-primario mt-12" onclick="abrirModalProduto()">+ Novo Produto</button>' : '';

  // Ativa tela inicial
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  const telaInicial = itens[0].tela;
  const elInicial = document.getElementById(telaInicial);
  if (elInicial) elInicial.classList.add('ativa');
  document.getElementById('header-titulo').textContent = TITULOS[inicial] || '';
}

function navegarPara(id) {
  const p = usuario.perfil;
  const itens = NAV[p] || NAV.entregador;
  const item = itens.find(i => i.id===id);
  if (!item) return;
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  const el = document.getElementById(item.tela);
  if (el) { el.style.display=''; el.classList.add('ativa'); }
  document.getElementById('header-titulo').textContent = TITULOS[id] || '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  const btn = document.getElementById(`nav-${id}`);
  if (btn) btn.classList.add('ativo');

  if (id==='clientes')     renderizarClientes(todosOsClientes);
  if (id==='financeiro')   renderizarFinanceiro(filtroFinanceiro);
  if (id==='entregas')     renderizarEntregas(filtroEntregas);
  if (id==='catalogo')     renderizarCatalogo(filtroCatalogo);
  if (id==='meus-pedidos') renderizarMeusPedidos(filtroMeusPedidos);
  if (id==='dashboard')    renderizarDashboard();
}

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarTudo() {
  if (!MODO_DEMO) {
    const [resPed, resCli, resProd] = await Promise.all([
      supabase('pedidos','GET',null,'?order=data_entrega.asc&select=*,clientes(nome),itens_pedido(*)'),
      supabase('clientes','GET',null,'?order=nome.asc'),
      supabase('produtos','GET',null,'?order=nome.asc'),
    ]);
    if (!resPed.ok || !resCli.ok || !resProd.ok) {
      alert('Erro ao carregar dados. Verifique sua conexão e recarregue a página.');
      return;
    }
    todosOsClientes = resCli.dados || [];
    todosOsProdutos = resProd.dados || [];
    todosOsPedidos = (resPed.dados || []).map(p => ({
      ...p,
      cliente_nome: p.clientes?.nome || '–',
      itens: p.itens_pedido || [],
      descricao: (p.itens_pedido || []).map(i => `${i.qtd}x ${i.nome}`).join(', ') || p.descricao || '',
    }));
  }
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  renderizarCatalogo(filtroCatalogo);
  if (usuario.perfil==='vendedor') renderizarMeusPedidos(filtroMeusPedidos);
  popularSelectClientes();

  // Inicia sincronização automática a cada 30 segundos
  iniciarAutoRefresh();
}

// ============================================================
// SINCRONIZAÇÃO AUTOMÁTICA (a cada 30s)
// Pega pedidos/clientes/produtos novos sem o usuário precisar recarregar
// ============================================================
async function sincronizarDados() {
  // Não sincroniza em modo demo ou com modais abertos (não quebrar a UX)
  if (MODO_DEMO || !usuario) return;
  if (document.querySelector('.modal-overlay.aberto')) return;

  try {
    const [resPed, resCli, resProd] = await Promise.all([
      supabase('pedidos','GET',null,'?order=data_entrega.asc&select=*,clientes(nome),itens_pedido(*)'),
      supabase('clientes','GET',null,'?order=nome.asc'),
      supabase('produtos','GET',null,'?order=nome.asc'),
    ]);

    if (!resPed.ok || !resCli.ok || !resProd.ok) return; // falha silenciosa

    // Detecta se algo mudou (comparando quantidade ou IDs)
    const novosPedidos = (resPed.dados || []).map(p => ({
      ...p,
      cliente_nome: p.clientes?.nome || '–',
      itens: p.itens_pedido || [],
      descricao: (p.itens_pedido || []).map(i => `${i.qtd}x ${i.nome}`).join(', ') || p.descricao || '',
    }));

    const mudou = JSON.stringify(novosPedidos.map(p=>({id:p.id,status:p.status,valor:p.valor}))) !==
                  JSON.stringify(todosOsPedidos.map(p=>({id:p.id,status:p.status,valor:p.valor})));

    todosOsPedidos  = novosPedidos;
    todosOsClientes = resCli.dados || [];
    todosOsProdutos = resProd.dados || [];

    // Re-renderiza só se algo mudou (para não causar flicker)
    if (mudou) {
      renderizarDashboard();
      renderizarEntregas(filtroEntregas);
      renderizarCatalogo(filtroCatalogo);
      if (usuario.perfil==='vendedor') renderizarMeusPedidos(filtroMeusPedidos);
      if (usuario.perfil==='admin')    renderizarFinanceiro(filtroFinanceiro);
    }
  } catch (e) {
    console.warn('Sincronização falhou:', e);
  }
}

function iniciarAutoRefresh() {
  pararAutoRefresh();
  // Atualiza a cada 30 segundos
  autoRefreshTimer = setInterval(sincronizarDados, 30000);
  // Também atualiza quando o app volta a ficar visível (usuário trocou de aba e voltou)
  document.addEventListener('visibilitychange', handleVisibility);
}

function pararAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  document.removeEventListener('visibilitychange', handleVisibility);
}

function handleVisibility() {
  if (document.visibilityState === 'visible' && usuario) {
    sincronizarDados();
  }
}


// ============================================================
// DASHBOARD (admin)
// ============================================================
function renderizarDashboard() {
  if (usuario?.perfil !== 'admin') return;
  const fmtHoje = fmt(new Date());
  const hojeE   = todosOsPedidos.filter(p => p.data_entrega===fmtHoje);
  const pend    = todosOsPedidos.filter(p => p.status==='pendente');
  const atras   = todosOsPedidos.filter(p => isAtrasado(p));
  document.getElementById('num-hoje').textContent      = hojeE.length;
  document.getElementById('num-pendentes').textContent = pend.length;
  document.getElementById('num-atrasados').textContent = atras.length;
  document.getElementById('num-clientes').textContent  = todosOsClientes.length;

  const proximas = pend.slice().sort((a,b)=>(a.data_entrega||'').localeCompare(b.data_entrega||'')).slice(0,5);
  const el = document.getElementById('lista-proximas');
  if (!proximas.length) {
    el.innerHTML = `<div class="vazio"><div class="vazio-icone">✅</div><p>Sem entregas pendentes</p></div>`;
    return;
  }
  el.innerHTML = proximas.map(p => cardEntrega(p, false)).join('');
}

// ============================================================
// ENTREGAS (admin + entregador)
// ============================================================
function renderizarEntregas(filtro) {
  filtroEntregas = filtro;
  let lista;
  if (usuario.perfil==='entregador') {
    // Entregador vê TODOS os pedidos pendentes (não só os de hoje)
    // Assim, quando o vendedor lança um pedido, o entregador vê na hora
    lista = todosOsPedidos.filter(p => p.status==='pendente');
  } else {
    lista = filtro==='todos' ? todosOsPedidos.slice() : todosOsPedidos.filter(p => p.status===filtro);
  }
  // Ordena: pendentes primeiro, depois por data de entrega
  lista.sort((a,b) => (a.data_entrega||'').localeCompare(b.data_entrega||''));
  const el = document.getElementById('lista-entregas');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📭</div><p>Nenhuma entrega aqui</p></div>`;
    return;
  }
  el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
}

function cardEntrega(p, mostrarBotoes) {
  const atrasado = isAtrasado(p);
  const classe = p.status==='entregue' ? 'entregue' : (atrasado ? 'atrasado' : 'pendente');
  const badge  = p.status==='entregue'
    ? `<span class="badge badge-entregue">✓ Entregue</span>`
    : atrasado ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
    : `<span class="badge badge-pendente">Pendente</span>`;

  const itensHtml = p.itens?.length
    ? `<div style="font-size:11px;color:var(--c3);margin-top:4px">
        ${p.itens.map(i => esc(`${i.qtd}x ${i.nome || i.produto_nome || ''}`)).join(' · ')}
       </div>` : '';

  const vendedorHtml = usuario.perfil==='admin' && p.vendedor
    ? `<span style="font-size:11px;color:var(--c3)">por ${esc(p.vendedor)}</span>` : '';

  const podeEditar = p.status==='pendente' && podeEditarPedido(p);
  const podeEntregar = p.status==='pendente' && (usuario.perfil==='admin' || usuario.perfil==='entregador');
  const podeExcluir = p.status==='pendente' && podeEditarPedido(p);
  const botaoEditar = podeEditar
    ? `<button class="btn-azul" onclick="abrirModalNovoPedido(${p.id})" title="Editar pedido">✏️</button>`
    : '';
  const botaoEntregar = podeEntregar
    ? `<button class="btn-entregar" onclick="abrirModalEntrega(${p.id})">✓ Marcar entregue</button>`
    : '';
  const botaoExcluir = podeExcluir
    ? `<button class="btn-perigo" style="width:auto;padding:8px 12px;font-size:14px" onclick="excluirPedido(${p.id})" title="Excluir pedido">🗑️</button>`
    : '';

  const botoes = (mostrarBotoes && p.status==='pendente') ? `
    <div class="item-acoes">
      ${botaoEntregar}
      ${botaoEditar}
      <button class="btn-obs" onclick="verDetalhePedido(${p.id})">👁</button>
      ${botaoExcluir}
    </div>` : (mostrarBotoes && p.status==='entregue'
    ? `<div class="item-acoes"><button class="btn-sm" onclick="verDetalhePedido(${p.id})">Ver detalhes</button></div>` : '');

  return `
    <div class="item-card ${classe}">
      <div class="item-header">
        <div class="item-nome">${esc(p.cliente_nome)}</div>
        ${badge}
      </div>
      <div class="item-sub">${esc(p.descricao)}</div>
      ${itensHtml}
      <div class="flex-entre" style="margin-top:6px">
        <div>${vendedorHtml}</div>
        <span style="font-size:12px;color:var(--c3)">📅 ${dataBR(p.data_entrega)}</span>
      </div>
      <div class="flex-entre" style="margin-top:4px">
        <span class="item-valor">${moeda(p.valor)}</span>
        ${p.observacao ? `<span style="font-size:11px;color:var(--c3)">📝 ${esc(p.observacao)}</span>` : ''}
      </div>
      ${botoes}
    </div>`;
}

function filtrarEntregas(filtro, btn) {
  document.querySelectorAll('#tela-entregas .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarEntregas(filtro);
}

// ============================================================
// MEUS PEDIDOS (vendedor)
// ============================================================
function renderizarMeusPedidos(filtro) {
  filtroMeusPedidos = filtro;
  let lista = todosOsPedidos.filter(p => p.vendedor===usuario.login);
  if (filtro!=='todos') lista = lista.filter(p => p.status===filtro);
  lista.sort((a,b) => (b.data_entrega||'').localeCompare(a.data_entrega||''));
  const el = document.getElementById('lista-meus-pedidos');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📋</div><p>Nenhum pedido aqui</p></div>`;
    return;
  }
  el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
}

function filtrarMeusPedidos(filtro, btn) {
  document.querySelectorAll('#tela-meus-pedidos .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarMeusPedidos(filtro);
}

// ============================================================
// CATÁLOGO DE PRODUTOS
// ============================================================
function renderizarCatalogo(filtro) {
  filtroCatalogo = filtro;
  let lista = filtro==='todos' ? todosOsProdutos.slice() : todosOsProdutos.filter(p => p.categoria===filtro);
  lista.sort((a,b) => a.nome.localeCompare(b.nome));
  const el = document.getElementById('lista-catalogo');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📦</div><p>Nenhum produto aqui</p></div>`;
    return;
  }
  const isAdmin = usuario.perfil==='admin';
  el.innerHTML = lista.map(p => {
    const est = Number(p.estoque) || 0;
    const estoqueAv = est <= 5
      ? `<span class="badge badge-low">⚠ Estoque baixo (${est})</span>`
      : `<span class="produto-estoque">${est} un.</span>`;
    const botoesAdmin = isAdmin ? `
      <div class="row-gap" style="margin-top:10px">
        <button class="btn-sm" onclick="abrirModalProduto(${p.id})">✏️ Editar</button>
        <button class="btn-perigo" style="width:auto;padding:7px 12px;font-size:12px" onclick="excluirProduto(${p.id})">🗑️</button>
      </div>` : '';
    return `
      <div class="item-produto-card">
        <div class="flex-entre" style="margin-bottom:6px">
          <div class="produto-nome">${esc(p.nome)}</div>
          ${badgeCategoria(p.categoria)}
        </div>
        <div class="produto-meta">
          <span class="produto-preco">${moeda(p.preco)}</span>
          ${estoqueAv}
        </div>
        ${botoesAdmin}
      </div>`;
  }).join('');
}

function filtrarCatalogo(filtro, btn) {
  document.querySelectorAll('#abas-catalogo .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarCatalogo(filtro);
}

function buscarProduto(termo) {
  const t = (termo||'').toLowerCase();
  const lista = todosOsProdutos.filter(p =>
    p.nome.toLowerCase().includes(t) || (p.categoria||'').toLowerCase().includes(t)
  );
  const el = document.getElementById('lista-catalogo');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">🔍</div><p>Nenhum produto encontrado</p></div>`;
    return;
  }
  const isAdmin = usuario.perfil==='admin';
  el.innerHTML = lista.map(p => {
    const est = Number(p.estoque) || 0;
    const estoqueAv = est <= 5
      ? `<span class="badge badge-low">⚠ Estoque baixo (${est})</span>`
      : `<span class="produto-estoque">${est} un.</span>`;
    const botoesAdmin = isAdmin ? `
      <div class="row-gap" style="margin-top:10px">
        <button class="btn-sm" onclick="abrirModalProduto(${p.id})">✏️ Editar</button>
        <button class="btn-perigo" style="width:auto;padding:7px 12px;font-size:12px" onclick="excluirProduto(${p.id})">🗑️</button>
      </div>` : '';
    return `
      <div class="item-produto-card">
        <div class="flex-entre" style="margin-bottom:6px">
          <div class="produto-nome">${esc(p.nome)}</div>
          ${badgeCategoria(p.categoria)}
        </div>
        <div class="produto-meta">
          <span class="produto-preco">${moeda(p.preco)}</span>
          ${estoqueAv}
        </div>
        ${botoesAdmin}
      </div>`;
  }).join('');
}

// ============================================================
// CATÁLOGO NO MODAL DE PEDIDO (busca + carrinho)
// ============================================================
function buscarProdutoModal(termo) {
  const t = (termo||'').toLowerCase();
  const lista = todosOsProdutos.filter(p =>
    p.nome.toLowerCase().includes(t) || (p.categoria||'').toLowerCase().includes(t)
  );
  const el = document.getElementById('lista-produto-modal');
  if (!lista.length) {
    el.innerHTML=`<div style="padding:12px;text-align:center;font-size:13px;color:var(--c3)">Nenhum produto encontrado</div>`;
    return;
  }
  el.innerHTML = lista.map(p => {
    const noCarrinho = carrinho.find(c => c.produto.id===p.id);
    const jaAdicionado = noCarrinho ? `<span style="font-size:11px;color:var(--gn)">✓ ${noCarrinho.qtd}x</span>` : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 10px;
                  background:rgba(10,26,16,.5);border:1px solid var(--ol);border-radius:10px;margin-bottom:6px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--creme)">${esc(p.nome)}</div>
          <div style="font-size:12px;color:var(--o1)">${moeda(p.preco)} ${jaAdicionado}</div>
        </div>
        <button class="btn-azul" onclick="adicionarAoCarrinho(${p.id})">+ Adicionar</button>
      </div>`;
  }).join('');
}

function adicionarAoCarrinho(produtoId) {
  const p = todosOsProdutos.find(x => x.id===produtoId);
  if (!p) return;
  const idx = carrinho.findIndex(c => c.produto.id===produtoId);
  if (idx>=0) {
    carrinho[idx].qtd++;
  } else {
    carrinho.push({ produto:p, qtd:1 });
  }
  renderizarCarrinho();
  // Atualiza a lista para mostrar quantidade adicionada
  const termo = document.getElementById('busca-produto-modal').value;
  buscarProdutoModal(termo);
}

function alterarQtdCarrinho(produtoId, delta) {
  const idx = carrinho.findIndex(c => c.produto.id===produtoId);
  if (idx<0) return;
  carrinho[idx].qtd += delta;
  if (carrinho[idx].qtd <= 0) carrinho.splice(idx,1);
  renderizarCarrinho();
  const termo = document.getElementById('busca-produto-modal').value;
  buscarProdutoModal(termo);
}

function renderizarCarrinho() {
  const el = document.getElementById('carrinho-lista');
  const totalEl = document.getElementById('carrinho-total');
  if (!carrinho.length) {
    el.innerHTML=`<div style="padding:12px;text-align:center;font-size:13px;color:var(--c3)">Nenhum produto adicionado ainda</div>`;
    totalEl.textContent = 'R$ 0,00';
    return;
  }
  let total = 0;
  el.innerHTML = carrinho.map(c => {
    const subtotal = c.produto.preco * c.qtd;
    total += subtotal;
    return `
      <div class="carrinho-item">
        <div class="carrinho-nome">${esc(c.produto.nome)}</div>
        <div class="carrinho-qtd">
          <button class="btn-qtd" onclick="alterarQtdCarrinho(${c.produto.id},-1)">−</button>
          <span class="qtd-num">${c.qtd}</span>
          <button class="btn-qtd" onclick="alterarQtdCarrinho(${c.produto.id},1)">+</button>
        </div>
        <div class="carrinho-preco">${moeda(subtotal)}</div>
      </div>`;
  }).join('');
  totalEl.textContent = moeda(total);
}

// ============================================================
// CLIENTES
// ============================================================
function renderizarClientes(lista) {
  const el = document.getElementById('lista-clientes');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">🏪</div><p>Nenhum cliente cadastrado</p></div>`;
    return;
  }
  el.innerHTML = lista.map(c => {
    const pedidosCli = todosOsPedidos.filter(p => p.cliente_id===c.id);
    const devendo = pedidosCli.filter(p => p.status!=='entregue').reduce((s,p)=>s+Number(p.valor),0);
    const badge = devendo>0
      ? `<span class="badge badge-devendo">${moeda(devendo)} em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    return `
      <div class="item-cliente-card" onclick="verDetalheCliente(${c.id})">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-info">${esc(c.responsavel||'–')} · ${esc(c.whatsapp||'–')}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function buscarCliente(termo) {
  const t = (termo||'').toLowerCase();
  renderizarClientes(todosOsClientes.filter(c =>
    (c.nome||'').toLowerCase().includes(t) || (c.responsavel||'').toLowerCase().includes(t)
  ));
}

function verDetalheCliente(id) {
  const c = todosOsClientes.find(x => x.id===id);
  if (!c) return;
  clienteSelecionado = c;
  const pedidos = todosOsPedidos.filter(p => p.cliente_id===id);
  document.getElementById('detalhe-cliente-nome').textContent = c.nome;
  document.getElementById('detalhe-cliente-conteudo').innerHTML = `
    <div style="background:rgba(10,26,16,.6);border:1px solid var(--ol);border-radius:var(--r);padding:13px;margin-bottom:14px">
      <div style="font-size:13px;color:var(--c2);margin-bottom:5px">👤 ${esc(c.responsavel||'–')}</div>
      <div style="font-size:13px;color:var(--c2);margin-bottom:5px">📱 ${esc(c.whatsapp||'–')}</div>
      <div style="font-size:13px;color:var(--c2)">📍 ${esc(c.endereco||'–')}</div>
    </div>
    <div class="separador">Histórico de pedidos</div>
    ${pedidos.length ? pedidos.map(p => `
      <div style="border-bottom:1px solid var(--ol);padding:9px 0">
        <div class="flex-entre">
          <span style="font-size:13px;font-weight:600;color:var(--creme)">${esc(p.descricao)}</span>
          <span class="badge ${p.status==='entregue'?'badge-entregue':'badge-pendente'}">${p.status==='entregue'?'✓':'⏳'}</span>
        </div>
        <div style="font-size:12px;color:var(--c3);margin-top:3px">${moeda(p.valor)} · ${dataBR(p.data_entrega)}</div>
      </div>`).join('')
    : '<div class="vazio" style="padding:20px"><p>Nenhum pedido ainda</p></div>'}
    ${usuario.perfil==='admin' ? `<button class="btn-perigo w100 mt-12" onclick="excluirCliente(${c.id})">Excluir cliente</button>` : ''}`;
  abrirModal('modal-detalhe-cliente');
}

// ============================================================
// FINANCEIRO (admin)
// ============================================================
function renderizarFinanceiro(filtro) {
  filtroFinanceiro = filtro;
  const porCliente = {};
  todosOsClientes.forEach(c => { porCliente[c.id]={ cliente:c, pedidos:[] }; });
  todosOsPedidos.forEach(p => { if (porCliente[p.cliente_id]) porCliente[p.cliente_id].pedidos.push(p); });

  let totalDev=0, totalRec=0;
  const mes = new Date().toISOString().slice(0,7);
  Object.values(porCliente).forEach(({pedidos}) => {
    pedidos.forEach(p => {
      if (p.status!=='entregue') totalDev += Number(p.valor)||0;
      else if (p.data_entrega?.startsWith(mes)) totalRec += Number(p.valor)||0;
    });
  });
  document.getElementById('fin-total-devendo').textContent  = moeda(totalDev);
  document.getElementById('fin-total-recebido').textContent = moeda(totalRec);

  const lista = Object.values(porCliente).filter(({pedidos}) => {
    const dev  = pedidos.filter(p => p.status!=='entregue');
    const atras= dev.filter(p => isAtrasado(p));
    if (filtro==='atrasado') return atras.length>0;
    if (filtro==='devendo')  return dev.length>0;
    if (filtro==='em-dia')   return dev.length===0;
    return true;
  });

  const el = document.getElementById('lista-financeiro');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">💚</div><p>Nenhum resultado</p></div>`;
    return;
  }
  el.innerHTML = lista.map(({cliente:c, pedidos}) => {
    const dev  = pedidos.filter(p => p.status!=='entregue');
    const atras= dev.filter(p => isAtrasado(p));
    const totalD = dev.reduce((s,p)=>s+(Number(p.valor)||0),0);
    const badge = atras.length>0
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : totalD>0 ? `<span class="badge badge-devendo">Em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    const info = atras.length ? `${atras.length} entrega(s) atrasada(s)`
               : dev.length  ? `${dev.length} entrega(s) em aberto` : 'Sem pendências';
    return `
      <div class="item-cliente-card" onclick="verFinanceiroCliente(${c.id})">
        <div>
          <div class="cliente-nome">${esc(c.nome)}</div>
          <div class="cliente-info">${info}</div>
          ${totalD>0?`<div style="font-size:13px;color:#e05a4e;font-weight:700;margin-top:3px">${moeda(totalD)} devidos</div>`:''}
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
  const c = todosOsClientes.find(x => x.id===id);
  if (!c) return;
  clienteSelecionado = c;
  const pedidos = todosOsPedidos.filter(p => p.cliente_id===id && p.status!=='entregue');
  const total = pedidos.reduce((s,p)=>s+(Number(p.valor)||0),0);
  const wa = (c.whatsapp||'').replace(/\D/g,'');
  document.getElementById('fin-cliente-nome').textContent = c.nome;
  document.getElementById('fin-cliente-conteudo').innerHTML = `
    <div style="font-size:13px;color:var(--c2);margin-bottom:14px">📱 ${esc(c.whatsapp||'–')}</div>
    <div class="separador">Entregas em aberto</div>
    ${pedidos.length ? pedidos.map(p=>`
      <div style="border-bottom:1px solid var(--ol);padding:9px 0">
        <div class="flex-entre">
          <span style="font-size:13px;color:var(--creme)">${esc(p.descricao)}</span>
          <span style="font-size:14px;font-weight:700;color:#e05a4e">${moeda(p.valor)}</span>
        </div>
        <div style="font-size:12px;color:var(--c3);margin-top:3px">
          Venc.: ${dataBR(p.data_vencimento)} ${isAtrasado(p)?'· <span style="color:#e05a4e;font-weight:700">⚠ Atrasado</span>':''}
        </div>
      </div>`).join('')
    : '<div class="vazio" style="padding:20px"><p>Sem entregas em aberto</p></div>'}
    <div style="margin-top:12px;font-weight:700;color:var(--o1);font-size:15px">Total: ${moeda(total)}</div>
    ${wa?`<a href="https://wa.me/55${wa}" target="_blank" rel="noopener"
      style="display:block;margin-top:12px;background:var(--gnb);color:var(--gn);border:1px solid rgba(39,174,96,.3);
             border-radius:var(--r);padding:12px;text-align:center;text-decoration:none;font-weight:700;font-size:14px">
      📲 Enviar cobrança no WhatsApp</a>`:''}`;
  abrirModal('modal-fin-cliente');
}

async function marcarPagoCliente() {
  if (!clienteSelecionado) return;
  const paraPagar = todosOsPedidos.filter(p => p.cliente_id===clienteSelecionado.id && p.status!=='entregue');
  if (!paraPagar.length) { fecharModal('modal-fin-cliente'); return; }
  if (!MODO_DEMO) {
    const res = await Promise.all(paraPagar.map(p => supabase('pedidos','PATCH',{status:'entregue'},`?id=eq.${p.id}`)));
    if (res.some(r=>!r.ok)) { alert('Erro ao atualizar. Tente novamente.'); return; }
  }
  paraPagar.forEach(p => { p.status='entregue'; });
  fecharModal('modal-fin-cliente');
  renderizarFinanceiro(filtroFinanceiro);
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
}

// ============================================================
// MODAL NOVO PEDIDO
// ============================================================
function abrirModalNovoPedido(idEdit) {
  const hoje = fmt(new Date());
  document.getElementById('busca-produto-modal').value = '';
  document.getElementById('lista-produto-modal').innerHTML = '';

  if (idEdit) {
    // Modo edição
    const p = todosOsPedidos.find(x => x.id === idEdit);
    if (!p) { alert('Pedido não encontrado.'); return; }
    if (p.status === 'entregue') { alert('Pedido já entregue não pode ser editado.'); return; }
    if (!podeEditarPedido(p)) { alert('Você não tem permissão para editar este pedido.'); return; }

    pedidoEmEdicao = p;
    document.getElementById('modal-pedido-titulo').textContent = 'Editar Pedido';
    document.getElementById('pedido-data-entrega').value    = p.data_entrega || hoje;
    document.getElementById('pedido-data-vencimento').value = p.data_vencimento || hoje;
    document.getElementById('pedido-cliente').value         = p.cliente_id || '';
    document.getElementById('pedido-obs').value             = p.observacao || '';

    // Carrinho com os itens atuais do pedido
    carrinho = (p.itens || []).map(it => {
      const prod = todosOsProdutos.find(x => x.id === it.produto_id);
      return {
        produto: prod || { id: it.produto_id, nome: it.nome, preco: it.preco_unit },
        qtd: it.qtd
      };
    });
  } else {
    // Modo novo pedido
    pedidoEmEdicao = null;
    carrinho = [];
    document.getElementById('modal-pedido-titulo').textContent = 'Novo Pedido';
    document.getElementById('pedido-data-entrega').value    = hoje;
    document.getElementById('pedido-data-vencimento').value = hoje;
    document.getElementById('pedido-cliente').value = '';
    document.getElementById('pedido-obs').value = '';
  }

  renderizarCarrinho();
  popularSelectClientes();
  buscarProdutoModal('');
  abrirModal('modal-pedido');
}

// Regra: admin edita tudo, vendedor só os pedidos dele
function podeEditarPedido(p) {
  if (!usuario) return false;
  if (usuario.perfil === 'admin') return true;
  if (usuario.perfil === 'vendedor') return p.vendedor === usuario.login;
  return false;
}

function popularSelectClientes() {
  const sel = document.getElementById('pedido-cliente');
  if (!sel) return;
  sel.innerHTML = '<option value="">Selecionar cliente...</option>' +
    todosOsClientes.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('');
}

async function salvarPedido() {
  const cliente_id      = Number(document.getElementById('pedido-cliente').value);
  const data_entrega    = document.getElementById('pedido-data-entrega').value;
  const data_vencimento = document.getElementById('pedido-data-vencimento').value;
  const obs             = document.getElementById('pedido-obs').value.trim();

  if (!cliente_id || !data_entrega) { alert('Selecione o cliente e a data de entrega.'); return; }
  if (!carrinho.length) { alert('Adicione pelo menos um produto ao carrinho.'); return; }

  const valor    = carrinho.reduce((s,c)=>s+(c.produto.preco*c.qtd),0);
  const descricao= carrinho.map(c=>`${c.qtd}x ${c.produto.nome}`).join(', ');
  const cliente  = todosOsClientes.find(c=>c.id===cliente_id);
  const itens    = carrinho.map(c=>({ produto_id:c.produto.id, nome:c.produto.nome, qtd:c.qtd, preco_unit:c.produto.preco }));

  // === EDIÇÃO ===
  if (pedidoEmEdicao) {
    if (pedidoEmEdicao.status === 'entregue') {
      alert('Pedido já entregue não pode ser editado.');
      return;
    }
    if (!podeEditarPedido(pedidoEmEdicao)) {
      alert('Você não tem permissão para editar este pedido.');
      return;
    }
    const pedido_id = pedidoEmEdicao.id;

    if (!MODO_DEMO) {
      // Atualiza o pedido
      const resPed = await supabase('pedidos','PATCH',{
        cliente_id, descricao, valor,
        data_entrega, data_vencimento: data_vencimento||null,
        observacao: obs,
      }, `?id=eq.${pedido_id}`);
      if (!resPed.ok) {
        alert('Erro ao atualizar pedido.\n\nDetalhes: ' + (resPed.erro || 'desconhecido'));
        return;
      }
      // Apaga itens antigos
      const resDel = await supabase('itens_pedido','DELETE',null,`?pedido_id=eq.${pedido_id}`);
      if (!resDel.ok) {
        alert('Erro ao limpar itens antigos.\n\nDetalhes: ' + (resDel.erro || 'desconhecido'));
        return;
      }
      // Insere itens novos
      const resItens = await Promise.all(itens.map(it => supabase('itens_pedido','POST',{
        pedido_id, produto_id:it.produto_id, nome:it.nome, qtd:it.qtd, preco_unit:it.preco_unit
      })));
      if (resItens.some(r => !r.ok)) {
        alert('Erro ao salvar itens atualizados. Verifique no banco.');
        return;
      }
    }

    // Atualiza local
    const idx = todosOsPedidos.findIndex(p => p.id === pedido_id);
    if (idx >= 0) {
      Object.assign(todosOsPedidos[idx], {
        cliente_id,
        cliente_nome: cliente ? cliente.nome : todosOsPedidos[idx].cliente_nome,
        descricao, valor, data_entrega,
        data_vencimento: data_vencimento || null,
        observacao: obs,
        itens,
      });
    }

    pedidoEmEdicao = null;
    fecharModal('modal-pedido');
    renderizarDashboard();
    renderizarEntregas(filtroEntregas);
    if (usuario.perfil === 'vendedor') renderizarMeusPedidos(filtroMeusPedidos);
    if (usuario.perfil === 'admin')    renderizarFinanceiro(filtroFinanceiro);
    return;
  }

  // === NOVO PEDIDO ===
  const novoPedido = {
    id: Date.now(), cliente_id, cliente_nome: cliente?.nome||'–',
    descricao, valor, status:'pendente', data_entrega,
    data_vencimento: data_vencimento||null, observacao:obs,
    itens, vendedor: usuario.login,
  };

  if (!MODO_DEMO) {
    const resPed = await supabase('pedidos','POST',{
      cliente_id, descricao, valor, status:'pendente',
      data_entrega, data_vencimento:data_vencimento||null,
      observacao:obs, vendedor:usuario.login,
    });
    if (!resPed.ok||!resPed.dados?.[0]) {
      alert('Erro ao salvar pedido.\n\nDetalhes: ' + (resPed.erro || 'sem resposta'));
      return;
    }
    const pedido_id = resPed.dados[0].id;
    novoPedido.id = pedido_id;
    // Salvar itens do pedido e VERIFICAR cada um
    const resItens = await Promise.all(itens.map(it => supabase('itens_pedido','POST',{
      pedido_id, produto_id:it.produto_id, nome:it.nome, qtd:it.qtd, preco_unit:it.preco_unit
    })));
    const falhouItens = resItens.some(r => !r.ok);
    if (falhouItens) {
      // Rollback: deleta o pedido criado
      await supabase('pedidos','DELETE',null,`?id=eq.${pedido_id}`);
      alert('Erro ao salvar itens do pedido. Tente novamente.');
      return;
    }
  }

  todosOsPedidos.push(novoPedido);
  fecharModal('modal-pedido');
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  if (usuario.perfil==='vendedor') renderizarMeusPedidos(filtroMeusPedidos);
}

// ============================================================
// MODAL NOVO CLIENTE
// ============================================================
function abrirModalNovoCliente() {
  ['cliente-nome','cliente-responsavel','cliente-whatsapp','cliente-endereco'].forEach(id=>{
    document.getElementById(id).value='';
  });
  abrirModal('modal-cliente');
}

async function salvarCliente() {
  const nome        = document.getElementById('cliente-nome').value.trim();
  const responsavel = document.getElementById('cliente-responsavel').value.trim();
  const whatsapp    = document.getElementById('cliente-whatsapp').value.trim();
  const endereco    = document.getElementById('cliente-endereco').value.trim();
  if (!nome) { alert('Informe o nome da loja.'); return; }
  const novo = { id:Date.now(), nome, responsavel, whatsapp, endereco };
  if (!MODO_DEMO) {
    const res = await supabase('clientes','POST',{nome,responsavel,whatsapp,endereco});
    if (!res.ok||!res.dados?.[0]) { alert('Erro ao salvar. Tente novamente.'); return; }
    novo.id = res.dados[0].id;
  }
  todosOsClientes.push(novo);
  fecharModal('modal-cliente');
  renderizarClientes(todosOsClientes);
  popularSelectClientes();
  const numCli = document.getElementById('num-clientes');
  if (numCli) numCli.textContent = todosOsClientes.length;
}

async function excluirCliente(id) {
  const vinculados = todosOsPedidos.filter(p=>p.cliente_id===id);
  if (vinculados.length>0) {
    alert(`Este cliente tem ${vinculados.length} pedido(s) registrado(s) e não pode ser excluído. Isso preserva o histórico.`);
    return;
  }
  if (!confirm('Excluir este cliente? Esta ação não pode ser desfeita.')) return;
  if (!MODO_DEMO) {
    const res = await supabase('clientes','DELETE',null,`?id=eq.${id}`);
    if (!res.ok) { alert('Erro ao excluir. Tente novamente.'); return; }
  }
  todosOsClientes = todosOsClientes.filter(c=>c.id!==id);
  fecharModal('modal-detalhe-cliente');
  renderizarClientes(todosOsClientes);
  popularSelectClientes();
  const numCli = document.getElementById('num-clientes');
  if (numCli) numCli.textContent = todosOsClientes.length;
}

// ============================================================
// MODAL CONFIRMAR ENTREGA
// ============================================================
function abrirModalEntrega(id) {
  const p = todosOsPedidos.find(x=>x.id===id);
  if (!p) return;
  pedidoSelecionado = p;
  document.getElementById('modal-entrega-info').innerHTML = `
    <strong style="color:var(--o1)">${esc(p.cliente_nome)}</strong>
    <div style="margin-top:5px;color:var(--c2)">${esc(p.descricao)}</div>
    <div style="margin-top:5px;color:var(--o1);font-weight:700">${moeda(p.valor)}</div>
    <div style="margin-top:3px;font-size:12px;color:var(--c3)">Data: ${dataBR(p.data_entrega)}</div>`;
  document.getElementById('entrega-obs').value = p.observacao||'';
  abrirModal('modal-entrega');
}

async function confirmarEntrega() {
  if (!pedidoSelecionado) return;
  const obs = document.getElementById('entrega-obs').value.trim();
  const id  = pedidoSelecionado.id;
  if (!MODO_DEMO) {
    const res = await supabase('pedidos','PATCH',{status:'entregue',observacao:obs},`?id=eq.${id}`);
    if (!res.ok) { alert('Erro ao confirmar. Tente novamente.'); return; }
  }
  const idx = todosOsPedidos.findIndex(p=>p.id===id);
  if (idx>=0) { todosOsPedidos[idx].status='entregue'; todosOsPedidos[idx].observacao=obs; }
  fecharModal('modal-entrega');
  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  if (usuario.perfil==='admin') renderizarFinanceiro(filtroFinanceiro);
}

// ============================================================
// EXCLUIR PEDIDO
// ============================================================
async function excluirPedido(id) {
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p) return;
  if (p.status === 'entregue') {
    alert('Pedido já entregue não pode ser excluído.');
    return;
  }
  if (!podeEditarPedido(p)) {
    alert('Você não tem permissão para excluir este pedido.');
    return;
  }

  const confirmacao = confirm(
    `Excluir o pedido de "${p.cliente_nome}" no valor de ${moeda(p.valor)}?\n\n` +
    `Esta ação não pode ser desfeita.`
  );
  if (!confirmacao) return;

  if (!MODO_DEMO) {
    // Apaga os itens primeiro (mesmo com on delete cascade, garantimos)
    await supabase('itens_pedido','DELETE',null,`?pedido_id=eq.${id}`);
    // Apaga o pedido
    const res = await supabase('pedidos','DELETE',null,`?id=eq.${id}`);
    if (!res.ok) {
      alert('Erro ao excluir pedido.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
      return;
    }
  }

  todosOsPedidos = todosOsPedidos.filter(x => x.id !== id);

  renderizarDashboard();
  renderizarEntregas(filtroEntregas);
  if (usuario.perfil === 'vendedor') renderizarMeusPedidos(filtroMeusPedidos);
  if (usuario.perfil === 'admin')    renderizarFinanceiro(filtroFinanceiro);
}

// ============================================================
// MODAL PRODUTO (admin)
// ============================================================
function abrirModalProduto(id) {
  document.getElementById('modal-produto-titulo').textContent = id ? 'Editar Produto' : 'Novo Produto';
  if (id) {
    const p = todosOsProdutos.find(x=>x.id===id);
    if (!p) return;
    produtoSelecionado = p;
    document.getElementById('produto-id').value       = p.id;
    document.getElementById('produto-nome').value     = p.nome;
    document.getElementById('produto-categoria').value= p.categoria;
    document.getElementById('produto-preco').value    = p.preco;
    document.getElementById('produto-estoque').value  = p.estoque;
  } else {
    produtoSelecionado = null;
    document.getElementById('produto-id').value='';
    ['produto-nome','produto-preco','produto-estoque'].forEach(i=>{ document.getElementById(i).value=''; });
    document.getElementById('produto-categoria').value='Ração';
  }
  abrirModal('modal-produto');
}

async function salvarProduto() {
  const nome      = document.getElementById('produto-nome').value.trim();
  const categoria = document.getElementById('produto-categoria').value;
  const precoStr  = document.getElementById('produto-preco').value.replace(',','.');
  const preco     = parseFloat(precoStr)||0;
  const estoque   = parseInt(document.getElementById('produto-estoque').value)||0;
  const idEdit    = document.getElementById('produto-id').value;

  if (!nome) { alert('Informe o nome do produto.'); return; }

  if (idEdit) {
    // Editar
    const id = Number(idEdit);
    if (!id) { alert('ID inválido.'); return; }
    if (!MODO_DEMO) {
      const res = await supabase('produtos','PATCH',{nome,categoria,preco,estoque},`?id=eq.${id}`);
      if (!res.ok) {
        alert('Erro ao editar produto.\n\nDetalhes: ' + (res.erro || 'desconhecido') + '\n\nVerifique se as permissões da tabela produtos estão configuradas no Supabase.');
        return;
      }
    }
    const idx = todosOsProdutos.findIndex(p=>p.id===id);
    if (idx>=0) Object.assign(todosOsProdutos[idx],{nome,categoria,preco,estoque});
  } else {
    // Novo
    const novo = { id:Date.now(), nome, categoria, preco, estoque };
    if (!MODO_DEMO) {
      const res = await supabase('produtos','POST',{nome,categoria,preco,estoque});
      if (!res.ok||!res.dados?.[0]) {
        alert('Erro ao salvar produto.\n\nDetalhes: ' + (res.erro || 'sem resposta') + '\n\nVerifique se as permissões da tabela produtos estão configuradas no Supabase.');
        return;
      }
      novo.id = res.dados[0].id;
    }
    todosOsProdutos.push(novo);
  }
  fecharModal('modal-produto');
  renderizarCatalogo(filtroCatalogo);
}

async function excluirProduto(id) {
  if (!confirm('Excluir este produto do catálogo?')) return;
  if (!MODO_DEMO) {
    const res = await supabase('produtos','DELETE',null,`?id=eq.${id}`);
    if (!res.ok) { alert('Erro ao excluir. Tente novamente.'); return; }
  }
  todosOsProdutos = todosOsProdutos.filter(p=>p.id!==id);
  renderizarCatalogo(filtroCatalogo);
}

// ============================================================
// DETALHE PEDIDO
// ============================================================
function verDetalhePedido(id) {
  const p = todosOsPedidos.find(x=>x.id===id);
  if (!p) return;
  document.getElementById('detalhe-pedido-titulo').textContent = `Pedido — ${p.cliente_nome}`;
  const itensHtml = p.itens?.length
    ? p.itens.map(i=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--ol)">
          <span style="font-size:13px;color:var(--creme)">${i.qtd}x ${esc(i.nome||i.produto_nome||'')}</span>
          <span style="font-size:13px;color:var(--o1);font-weight:700">${moeda(i.preco_unit*i.qtd)}</span>
        </div>`).join('')
    : `<div style="font-size:13px;color:var(--c2);padding:8px 0">${esc(p.descricao)}</div>`;
  document.getElementById('detalhe-pedido-conteudo').innerHTML = `
    <div style="background:rgba(10,26,16,.6);border:1px solid var(--ol);border-radius:var(--r);padding:13px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--c3);margin-bottom:4px">📅 Entrega: ${dataBR(p.data_entrega)} · Venc.: ${dataBR(p.data_vencimento)}</div>
      <div style="font-size:12px;color:var(--c3)">📋 Pedido por: ${esc(p.vendedor||'–')}</div>
    </div>
    <div class="separador">Itens</div>
    ${itensHtml}
    <div style="display:flex;justify-content:space-between;padding:10px 0;margin-top:4px">
      <span style="font-size:14px;font-weight:700;color:var(--creme)">Total</span>
      <span style="font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:var(--o1)">${moeda(p.valor)}</span>
    </div>
    ${p.observacao?`<div style="font-size:12px;color:var(--c3);margin-top:4px">📝 ${esc(p.observacao)}</div>`:''}`;
  abrirModal('modal-detalhe-pedido');
}

// ============================================================
// HELPERS DE LÓGICA
// ============================================================
function isAtrasado(p) {
  if (p.status==='entregue' || !p.data_vencimento) return false;
  return p.data_vencimento < fmt(new Date());
}

function abrirModal(id) { const m=document.getElementById(id); if(m) m.classList.add('aberto'); }
function fecharModal(id) { const m=document.getElementById(id); if(m) m.classList.remove('aberto'); }

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if(e.target===o) o.classList.remove('aberto'); });
});
