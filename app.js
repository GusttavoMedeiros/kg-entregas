// ============================================================
// KG ENTREGAS v2 — app.js
// ============================================================
const SUPABASE_URL = 'https://eatmzxyckqrsjrlyosfg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhdG16eHlja3Fyc2pybHlvc2ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MzA0NzQsImV4cCI6MjA5NDMwNjQ3NH0.9Q23iGFuBdBWmag5Gl0KwCdmkCkjfxhq_IYddKClA7k';
const MODO_DEMO = (SUPABASE_URL === 'SUA_URL_AQUI');

// ============================================================
// USUÁRIOS
// O login agora é REAL (Supabase Auth) — ver seção AUTENTICAÇÃO.
// Aqui só ficam o mapa usuário-curto → e-mail e o perfil/nome de UI.
// As SENHAS não vivem mais no código: ficam no Supabase.
// ============================================================

// Usuário curto digitado na tela → e-mail cadastrado no Supabase (Passo 1).
// ⚠️ AJUSTE os e-mails para EXATAMENTE os que você criou no painel do Supabase.
const LOGIN_EMAILS = {
  admin:      'admin@kgagropet.local',
  vendedor:   'vendedor@kgagropet.local',
  entregador: 'entregador@kgagropet.local',
};

// Fallback usado apenas no modo demo. Em produção, perfil e nome sempre vêm
// do app_metadata assinado no token do Supabase.
const PERFIS = {
  admin:      { perfil: 'admin',      nome: 'Kleber'     },
  vendedor:   { perfil: 'vendedor',   nome: 'Vendedor'   },
  entregador: { perfil: 'entregador', nome: 'Entregador' },
};

// ============================================================
// ESTADO GLOBAL
// ============================================================
let usuario            = null;
let sessao             = null;   // sessão do Supabase Auth: {access_token, refresh_token, expires_at}
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
let salvando           = false;   // trava anti double-submit em operações async
let geracaoAcesso      = 0;       // invalida respostas de uma sessão encerrada

// Feedback visual nos botões de salvar: desabilita e mostra "Salvando…"
// enquanto a operação roda. Em conexão lenta (3G), sem isso o usuário
// não vê nada acontecer e clica de novo achando que falhou.
function botaoSalvando(onclickNome, ativo, textoNormal) {
  const b = document.querySelector(`button[onclick="${onclickNome}()"]`);
  if (!b) return;
  b.disabled = ativo;
  b.style.opacity = ativo ? '.65' : '';
  b.textContent = ativo ? '⏳ Salvando…' : textoNormal;
}
let modoEntregas       = 'lista'; // 'lista' ou 'rota' (entregador)
let mostrarMargem      = false;   // admin: exibe custo/margem no catálogo
let ajusteCarrinhoIdx  = null;    // índice do item do carrinho sendo ajustado
let todosOsPedidos     = [];
let todosOsClientes    = [];
let todosOsProdutos    = [];
// Toda gravação confirmada avança esta revisão. Uma leitura iniciada antes da
// gravação nunca pode substituir o estado novo com uma resposta antiga.
let revisaoEstado      = 0;
let sincronizacaoPendente = false;

// ============================================================
// TOAST + CONFIRMAÇÃO (substituem os diálogos nativos do navegador,
// que travam a tela e destoam do visual do app)
// ============================================================

// Aviso flutuante, não-bloqueante. tipo: 'ok' | 'erro' | 'info'
// (se omitido, tenta adivinhar pelo conteúdo da mensagem)
function toast(msg, tipo) {
  const texto = (msg == null ? '' : String(msg));
  if (!tipo) {
    const t = texto.toLowerCase();
    // "Pedido não salvo", "A entrega não foi desfeita": a negação vem antes do teste de sucesso.
    if (/^❌|erro|falh|inválid|invalid|incorret|n[ãa]o (pode|p[ôo]de|foi|salv|atualiz|exclu|consegui)|obrigatóri/.test(t)) tipo = 'erro';
    else if (/^✅|^🎉|sucesso|salvo|atualizad|conclu[ií]|exclu[ií]d|removid/.test(t)) tipo = 'ok';
    else tipo = 'info';
  }
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const icones = { ok:'✅', erro:'⚠️', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.innerHTML = `<span class="ico"></span><span class="txt"></span>`;
  el.querySelector('.ico').textContent = icones[tipo] || 'ℹ️';
  el.querySelector('.txt').textContent = texto;   // textContent = seguro contra HTML
  wrap.appendChild(el);

  const dur = Math.min(7000, 3200 + texto.length * 40);
  const remover = () => { el.classList.add('saindo'); setTimeout(() => el.remove(), 260); };
  const timer = setTimeout(remover, dur);
  el.addEventListener('click', () => { clearTimeout(timer); remover(); }); // toque fecha
}

// Confirmação com visual do app. Retorna Promise<boolean>.
// Uso: if (!await confirmar('Tem certeza?')) return;
// opts: { titulo, okLabel, cancelLabel, perigo }
let resolverConfirmacao = null;
function confirmar(mensagem, opts = {}) {
  if (resolverConfirmacao) resolverConfirmacao(false);
  return new Promise(resolve => {
    const focoAnterior = document.activeElement;
    let encerrado = false;
    let overlay = document.getElementById('confirmar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'confirmar-overlay';
      document.body.appendChild(overlay);
    }
    const perigo = opts.perigo ? ' perigo' : '';
    overlay.innerHTML = `
      <div class="confirmar-box" role="dialog" aria-modal="true">
        <h3></h3>
        <div class="msg"></div>
        <div class="acoes">
          <button class="bt-cancelar" type="button"></button>
          <button class="bt-ok${perigo}" type="button"></button>
        </div>
      </div>`;
    overlay.querySelector('h3').textContent = opts.titulo || 'Confirmar';
    overlay.querySelector('.msg').textContent = (mensagem == null ? '' : String(mensagem));
    const btCancel = overlay.querySelector('.bt-cancelar');
    const btOk = overlay.querySelector('.bt-ok');
    btCancel.textContent = opts.cancelLabel || 'Cancelar';
    btOk.textContent = opts.okLabel || 'Confirmar';

    const fechar = (valor) => {
      if (encerrado) return;
      encerrado = true;
      resolverConfirmacao = null;
      overlay.classList.remove('aberto');
      document.removeEventListener('keydown', onKey);
      if (focoAnterior?.isConnected) focoAnterior.focus();
      resolve(valor);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
      if (e.key === 'Tab') {
        e.preventDefault();
        (document.activeElement === btOk ? btCancel : btOk).focus();
      }
    };
    resolverConfirmacao = fechar;
    btCancel.addEventListener('click', () => fechar(false));
    btOk.addEventListener('click', () => fechar(true));
    document.addEventListener('keydown', onKey);
    overlay.classList.add('aberto');
    btOk.focus();
  });
}

// ============================================================
// HELPERS
// ============================================================
const fmt = d => dataHojeBrasil(d);

// Data civil no fuso da operação. Não usa UTC para evitar registrar o dia
// seguinte perto da meia-noite no Brasil.
const formatadorDataBrasil = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});
function dataHojeBrasil(agora = new Date()) {
  const partes = formatadorDataBrasil.formatToParts(agora);
  const valor = tipo => partes.find(p => p.type === tipo)?.value;
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

// Pedidos antigos não têm data_entregue_em; nesses casos, a previsão antiga
// continua sendo o fallback de compatibilidade nos relatórios e consolidações.
function dataRealEntrega(p) {
  return p?.data_entregue_em || p?.data_entrega || null;
}

// Usado pelo fluxo online e pela fila offline para capturar a data no momento
// em que o entregador conclui o pedido, e não apenas quando houver sincronização.
function dadosEntregaConcluida(agora = new Date()) {
  return { status: 'entregue', data_entregue_em: dataHojeBrasil(agora) };
}

function periodoMesBrasil(agora = new Date()) {
  const [ano, mes] = dataHojeBrasil(agora).split('-').map(Number);
  const inicio = deslocamento => new Date(Date.UTC(ano, mes - 1 + deslocamento, 1)).toISOString().slice(0,10);
  return { inicioMes:inicio(0), inicioMesPassado:inicio(-1), inicioProximoMes:inicio(1) };
}

function dataBR(d) {
  if (!d) return '–';
  const dt = new Date(d + 'T12:00:00');
  return isNaN(dt.getTime()) ? '–' : dt.toLocaleDateString('pt-BR');
}

function moeda(v) {
  const n = Number(v);
  const valor = isNaN(n) ? 0 : n;
  // Formato brasileiro: 00.000,00 (ponto nos milhares, vírgula decimal)
  const [intPart, decPart] = valor.toFixed(2).split('.');
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + intFmt + ',' + decPart;
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

// Determina se um pedido foi efetivamente pago.
// REGRA DE RETROCOMPATIBILIDADE: pedidos antigos (sem status_pagamento) que estão
// 'entregue' são considerados pagos (mantém o comportamento antigo).
function foiPago(p) {
  if (p.status_pagamento === 'pago') return true;
  if (p.status_pagamento === 'pendente' || p.status_pagamento === 'recusado') return false;
  // Legado: sem status_pagamento → assume pago se foi entregue
  return p.status === 'entregue';
}

// Detecta se o pedido tem QUALQUER item com preço diferente do catálogo.
// Itens sem preco_catalogo (legado) NÃO são considerados ajustes.
function temAjusteDePreco(p) {
  if (!p.itens?.length) return false;
  return p.itens.some(it => {
    if (it.preco_catalogo == null) return false;
    const diff = Math.abs(Number(it.preco_unit) - Number(it.preco_catalogo));
    return diff > 0.005;
  });
}

// Retorna lista de ajustes para exibir no detalhe (cada item com diferença)
function listaAjustesPrecos(p) {
  if (!p.itens?.length) return [];
  return p.itens
    .filter(it => it.preco_catalogo != null && Math.abs(Number(it.preco_unit) - Number(it.preco_catalogo)) > 0.005)
    .map(it => {
      const unit = Number(it.preco_unit) || 0;
      const cat  = Number(it.preco_catalogo) || 0;
      const diff = unit - cat;
      const pct = cat > 0 ? (diff / cat * 100) : 0;
      return {
        nome: it.nome,
        qtd: it.qtd,
        precoCatalogo: cat,
        precoCobrado: unit,
        diff,
        pct,
        impactoTotal: diff * (Number(it.qtd) || 0),
      };
    });
}

// ============================================================
// BUSCA INTELIGENTE — normalização + tolerância a typos + highlight
// ============================================================

// Tira acentos, ç vira c, deixa minúsculo. "Ração" → "racao"
function normalizar(texto) {
  if (texto == null) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')              // separa letra base do acento
    .replace(/[\u0300-\u036f]/g, '') // remove os acentos
    .replace(/ç/g, 'c');           // ç → c (caso o NFD não pegue)
}

// Aplica substituições fonéticas para tolerar typos comuns em português.
// Ex: "rasao", "raçao", "racao", "Ração" → todos viram "raçao" depois "rasao"
// IMPORTANTE: ordem das substituições importa — vamos do mais específico ao mais geral.
function fuzzyKey(texto) {
  let s = normalizar(texto);
  // Dígrafos (precisam vir antes das letras isoladas)
  s = s.replace(/qu/g, 'k')
       .replace(/ch/g, 'x')
       .replace(/lh/g, 'li')
       .replace(/nh/g, 'ni')
       .replace(/sh/g, 'x')
       .replace(/ph/g, 'f');
  // Letras isoladas comumente confundidas
  s = s.replace(/[cz]/g, 's')   // c, z → s
       .replace(/[kq]/g, 'k')   // k, q → k
       .replace(/y/g, 'i')
       .replace(/w/g, 'v');
  // Duplicações: "ss" → "s", "rr" → "r", etc.
  s = s.replace(/(.)\1+/g, '$1');
  return s;
}

// Testa se um item (com vários campos texto) bate com o termo de busca.
// Retorna true se TODAS as palavras do termo aparecem em ALGUM campo.
// Aceita acento OU não, ç OU c, e tolera typos foneticamente.
function matchBusca(termo, ...campos) {
  if (!termo || !termo.trim()) return true;
  // Divide o termo em palavras (espaço ou múltiplos espaços)
  const palavras = termo.trim().split(/\s+/).filter(Boolean);
  // Versões normalizadas e fuzzy de cada palavra
  const palavrasNorm = palavras.map(p => normalizar(p));
  const palavrasFuzzy = palavras.map(p => fuzzyKey(p));
  // Concatena todos os campos numa string só, normalizada
  const conteudoNorm = campos.map(c => normalizar(c)).join(' ');
  const conteudoFuzzy = campos.map(c => fuzzyKey(c)).join(' ');
  // Cada palavra precisa bater em pelo menos uma versão (exata OU fuzzy)
  return palavras.every((_, i) => {
    return conteudoNorm.includes(palavrasNorm[i]) ||
           conteudoFuzzy.includes(palavrasFuzzy[i]);
  });
}

// Aplica highlight dourado nas palavras encontradas (com escape de HTML).
// Mostra o texto ORIGINAL mas destaca os pedaços que casaram (com ou sem acento).
function highlightBusca(textoOriginal, termo) {
  const original = String(textoOriginal ?? '');
  if (!termo || !termo.trim()) return esc(original);
  const palavras = [...new Set(termo.trim().split(/\s+/).filter(Boolean))];
  // Para cada palavra, gera regex que ignora acentos do texto original
  const padroes = palavras.map(palavra => {
    const palavraNorm = normalizar(palavra);
    if (!palavraNorm) return;
    // Constrói regex que casa a sequência de caracteres ignorando acentos
    // Ex: "rac" casa "Rac", "ráç", "Raç" etc.
    const padraoChars = palavraNorm.split('').map(c => {
      // Map letra normalizada → classe de caracteres que ela representa
      const variantes = {
        'a': '[aáàãâäAÁÀÃÂÄ]', 'e': '[eéèêëEÉÈÊË]', 'i': '[iíìîïIÍÌÎÏ]',
        'o': '[oóòõôöOÓÒÕÔÖ]', 'u': '[uúùûüUÚÙÛÜ]', 'c': '[cçCÇ]',
        'n': '[nñNÑ]'
      };
      return variantes[c] || c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    return padraoChars;
  }).filter(Boolean);
  if (!padroes.length) return esc(original);
  // Uma passagem pelo texto original: nunca busca dentro do HTML já criado.
  const re = new RegExp(padroes.join('|'), 'gi');
  let fim = 0, resultado = '';
  for (const match of original.matchAll(re)) {
    resultado += esc(original.slice(fim, match.index)) + '<mark class="busca-match">' + esc(match[0]) + '</mark>';
    fim = match.index + match[0].length;
  }
  return resultado + esc(original.slice(fim));
}

// Debounce — evita re-render a cada tecla digitada em buscas (150ms = imperceptível)
function debounce(fn, ms = 150) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Mostra/esconde botão X na barra de busca baseado se há texto digitado.
// Aplica classe .tem-texto no .search-bar pai (que ativa o display do botão).
function atualizarBotaoLimpar(inputEl) {
  if (!inputEl) return;
  const bar = inputEl.closest('.search-bar');
  if (bar) bar.classList.toggle('tem-texto', !!inputEl.value);
}

// Limpa o input de busca e chama a função de busca com string vazia.
// Volta o foco para o input (UX: usuário pode digitar de novo sem tocar de novo).
function limparBusca(inputId, fnBusca) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = '';
  atualizarBotaoLimpar(input);
  if (typeof fnBusca === 'function') fnBusca('');
  input.focus();
}

// Reseta todas as barras de busca e filtros visuais ao trocar de tela
function resetarBuscasEFiltros() {
  // Apaga todos os inputs de busca conhecidos
  ['busca-clientes', 'busca-catalogo', 'busca-produto-modal'].forEach(id => {
    const inp = document.getElementById(id);
    if (inp) {
      inp.value = '';
      atualizarBotaoLimpar(inp);
    }
  });

  // Reseta filtros internos para o padrão (alinhado com a 1ª aba ativa do HTML)
  filtroEntregas     = 'pendente';
  filtroCatalogo     = 'todos';
  filtroFinanceiro   = 'atrasado';
  filtroMeusPedidos  = 'pendente';

  // Reseta a primeira aba ativa de cada grupo de abas
  document.querySelectorAll('.abas').forEach(grupo => {
    const botoes = grupo.querySelectorAll('.aba');
    botoes.forEach(b => b.classList.remove('ativa'));
    if (botoes[0]) botoes[0].classList.add('ativa');
  });

  // Volta scroll pro topo da tela
  window.scrollTo({top: 0, behavior: 'instant'});
}

// ============================================================
// SCHEDULER DE RENDERS — agrupa múltiplas re-renderizações
// num único frame do browser (60fps) para evitar flicker.
// Uso: agendarRender('dashboard'); agendarRender('entregas'); → executa tudo junto.
// ============================================================
const _rendersPendentes = new Set();
let _renderFrameId = null;
function agendarRender(tela) {
  _rendersPendentes.add(tela);
  if (_renderFrameId !== null) return; // já tem um frame agendado
  _renderFrameId = requestAnimationFrame(() => {
    const telas = new Set(_rendersPendentes);
    _rendersPendentes.clear();
    _renderFrameId = null;
    telas.forEach(t => {
      try {
        if (t === 'dashboard')        renderizarDashboard();
        else if (t === 'entregas')    renderizarEntregas(filtroEntregas);
        else if (t === 'catalogo')    rerenderizarCatalogoMantendoBusca();
        else if (t === 'clientes')    rerenderizarClientesMantendoBusca();
        else if (t === 'financeiro')  renderizarFinanceiro(filtroFinanceiro);
        else if (t === 'meus-pedidos') renderizarMeusPedidos(filtroMeusPedidos);
        else if (t === 'inicio-vendedor') renderizarInicioVendedor();
        else if (t === 'carrinho')    renderizarCarrinho();
      } catch(e) { console.error('Erro ao renderizar', t, e); }
    });
  });
}

function rerenderizarClientesMantendoBusca() {
  const busca = document.getElementById('busca-clientes');
  if (busca?.value.trim()) _buscarClienteImpl(busca.value);
  else renderizarClientes(todosOsClientes);
}

// Matriz central de dependências. Qualquer mudança em pedido atualiza todos os
// cálculos derivados da mesma fonte: listas, filtros, clientes, financeiro e
// painéis dos dois perfis. Isso evita que cada botão mantenha uma lista própria.
function invalidarInterfaces(...entidades) {
  const telas = new Set();
  if (entidades.includes('pedidos')) {
    ['dashboard','entregas','clientes','financeiro','meus-pedidos','inicio-vendedor']
      .forEach(t => telas.add(t));
  }
  if (entidades.includes('clientes')) {
    ['dashboard','entregas','clientes','financeiro','inicio-vendedor']
      .forEach(t => telas.add(t));
    popularSelectClientes();
  }
  if (entidades.includes('produtos')) telas.add('catalogo');
  // As telas ocultas serão renderizadas ao abrir pela navegação. Evitar montar
  // todas as listas a cada evento Realtime reduz muito o trabalho em celulares
  // modestos sem deixar dados antigos visíveis.
  telas.forEach(tela => {
    const elemento = document.getElementById(`tela-${tela}`);
    if (!elemento || elemento.classList.contains('ativa')) agendarRender(tela);
  });
  atualizarDetalhesAbertos(entidades);
}

function registrarMudancaLocal(...entidades) {
  revisaoEstado++;
  invalidarInterfaces(...entidades);
}

function formularioDeDadosAberto() {
  return ['modal-pedido','modal-cliente','modal-produto','modal-entrega','modal-ajustar-preco','modal-reset']
    .some(id => document.getElementById(id)?.classList.contains('aberto'));
}

function atualizarDetalhesAbertos(entidades) {
  const atualizar = (modalId, fn) => {
    const modal = document.getElementById(modalId);
    const id = Number(modal?.dataset.registroId);
    if (modal?.classList.contains('aberto') && Number.isSafeInteger(id)) fn(id);
  };
  if (entidades.includes('pedidos')) {
    atualizar('modal-detalhe-pedido', verDetalhePedido);
    atualizar('modal-detalhe-cliente', verDetalheCliente);
    atualizar('modal-fin-cliente', verFinanceiroCliente);
  }
  if (entidades.includes('clientes')) {
    atualizar('modal-detalhe-cliente', verDetalheCliente);
    atualizar('modal-fin-cliente', verFinanceiroCliente);
  }
  if (entidades.includes('produtos')) atualizar('modal-detalhe-produto', verDetalheProduto);
}

// Wrappers públicos com debounce (chamados pelo oninput do HTML).
// As funções _Impl podem ser chamadas DIRETAMENTE quando precisamos resposta imediata
// (ex: ao adicionar item no carrinho, atualizar lista sem esperar 150ms).
const buscarProduto      = debounce((t) => _buscarProdutoImpl(t), 150);
const buscarProdutoModal = (t) => _buscarProdutoModalImpl(t); // chamado por código JS, sem debounce
const buscarProdutoModalDebounced = debounce((t) => _buscarProdutoModalImpl(t), 150);
const buscarCliente      = debounce((t) => _buscarClienteImpl(t), 150);

// ============================================================
// CHECKLIST DE CARREGAMENTO (entregador, offline-first)
// Persiste no localStorage SEM tocar no Supabase a cada clique.
// Chave: kg-checklist-{pedidoId}  | Valor: {itens:[produto_id...], ts:timestamp}
// Usa produto_id (estável) em vez de índice do array (que pode mudar se admin edita).
// ============================================================
const CHECKLIST_PREFIX = 'kg-checklist-';
const CHECKLIST_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function getChecklist(pedidoId) {
  try {
    const raw = localStorage.getItem(CHECKLIST_PREFIX + pedidoId);
    if (!raw) return new Set();
    const obj = JSON.parse(raw);
    return new Set(Array.isArray(obj?.itens) ? obj.itens : []);
  } catch(e) {
    console.warn('Erro ao ler checklist do pedido', pedidoId, e);
    return new Set();
  }
}

function salvarChecklist(pedidoId, marcadosSet) {
  try {
    if (marcadosSet.size === 0) {
      localStorage.removeItem(CHECKLIST_PREFIX + pedidoId);
      return;
    }
    localStorage.setItem(CHECKLIST_PREFIX + pedidoId, JSON.stringify({
      itens: [...marcadosSet],
      ts: Date.now(),
    }));
  } catch(e) {
    // localStorage cheio ou indisponível — degrada graciosamente (não persiste)
    console.warn('Não foi possível salvar checklist:', e);
  }
}

// Toggle de um item do checklist (chamado por onclick no <li>)
function toggleChecklistItem(pedidoId, produtoId, btnEl) {
  const marcados = getChecklist(pedidoId);
  produtoId = Number(produtoId);
  if (marcados.has(produtoId)) marcados.delete(produtoId);
  else marcados.add(produtoId);
  salvarChecklist(pedidoId, marcados);

  // Atualiza só o <li> clicado (zero re-render do card)
  if (btnEl) {
    btnEl.classList.toggle('marcado', marcados.has(produtoId));
  }
  // Atualiza o contador no card (se existir)
  const cardEl = btnEl?.closest('.item-card');
  if (cardEl) {
    const contadorEl = cardEl.querySelector('.checklist-contador');
    const totalItens = cardEl.querySelectorAll('.check-item').length;
    if (contadorEl) {
      contadorEl.textContent = `${marcados.size}/${totalItens}`;
      contadorEl.classList.toggle('completo', marcados.size === totalItens && totalItens > 0);
    }
  }
}

// Limpa o checklist quando o pedido é entregue (não precisa mais)
function limparChecklist(pedidoId) {
  try { localStorage.removeItem(CHECKLIST_PREFIX + pedidoId); } catch(e) {}
}

// Limpeza automática: remove entradas antigas (>30 dias) e órfãs (pedido deletado)
function limpezaChecklistAntigos() {
  try {
    const idsExistentes = new Set(todosOsPedidos.map(p => String(p.id)));
    const agora = Date.now();
    const remover = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(CHECKLIST_PREFIX)) continue;
      const pedidoId = key.slice(CHECKLIST_PREFIX.length);
      try {
        const obj = JSON.parse(localStorage.getItem(key));
        const expirado = !obj?.ts || (agora - obj.ts) > CHECKLIST_TTL_MS;
        const orfao = !idsExistentes.has(pedidoId);
        if (expirado || orfao) remover.push(key);
      } catch(e) { remover.push(key); }
    }
    remover.forEach(k => localStorage.removeItem(k));
  } catch(e) { /* silencioso */ }
}

// ============================================================
// MÁSCARAS DE INPUT (CNPJ, CPF, telefones, IE)
// ============================================================
function soDigitos(s) { return String(s || '').replace(/\D/g, ''); }

// Aplica máscara de CNPJ: 00.000.000/0000-00 (14 dígitos)
function mascaraCNPJ(v) {
  const d = soDigitos(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

// Aplica máscara de CPF: 000.000.000-00 (11 dígitos)
function mascaraCPF(v) {
  const d = soDigitos(v).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

// Aplica máscara de telefone: (00) 00000-0000 ou (00) 0000-0000
function mascaraTelefone(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2)  return d.replace(/^(\d{0,2})/, '($1');
  if (d.length <= 6)  return d.replace(/^(\d{2})(\d{0,4})/, '($1) $2');
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

// Aplica máscara de Inscrição Estadual (formato livre, só pontos e dígitos)
function mascaraIE(v) {
  // IE varia muito por estado — vamos manter livre, só limitar a 14 dígitos
  return soDigitos(v).slice(0, 14);
}

// Validação real de CNPJ (dígitos verificadores)
function validarCNPJ(cnpj) {
  const d = soDigitos(cnpj);
  if (d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false; // todos iguais
  const calc = (base) => {
    let soma = 0, pos = base.length - 7;
    for (let i = base.length; i >= 1; i--) {
      soma += Number(base[base.length - i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(d.slice(0, 12)) === Number(d[12]) && calc(d.slice(0, 13)) === Number(d[13]);
}

// Validação real de CPF (dígitos verificadores)
function validarCPF(cpf) {
  const d = soDigitos(cpf);
  if (d.length !== 11) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base, fator) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (fator - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(d.slice(0, 9), 10) === Number(d[9]) && calc(d.slice(0, 10), 11) === Number(d[10]);
}

// Validação simples de e-mail (não exaustiva, só evita erros óbvios)
function validarEmail(email) {
  if (!email) return true; // opcional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Alterna o tipo de pessoa no modal de cliente
function alternarTipoPessoa(tipo) {
  const modal = document.querySelector('#modal-cliente .modal-sheet');
  if (!modal) return;
  modal.dataset.tipoPessoa = tipo;

  // Atualiza botões
  document.querySelectorAll('#modal-cliente .pagto-opcao').forEach(b => {
    b.classList.toggle('ativo', b.dataset.valor === tipo);
  });

  // Atualiza labels e placeholder do CNPJ/CPF
  const labelNome = document.getElementById('cliente-nome-label');
  const labelDoc  = document.getElementById('cliente-doc-label');
  const inputDoc  = document.getElementById('cliente-cnpj-cpf');
  if (!labelNome || !labelDoc || !inputDoc) return;

  if (tipo === 'fisica') {
    labelNome.innerHTML = 'Nome completo <span class="campo-obrig">*</span>';
    labelDoc.innerHTML  = 'CPF <span class="campo-obrig">*</span>';
    inputDoc.placeholder = '000.000.000-00';
  } else {
    labelNome.innerHTML = 'Nome da loja <span class="campo-obrig">*</span>';
    labelDoc.innerHTML  = 'CNPJ <span class="campo-obrig">*</span>';
    inputDoc.placeholder = '00.000.000/0000-00';
  }

  // Re-aplica máscara correta no que já está digitado
  if (inputDoc.value) {
    const formatado = tipo === 'fisica' ? mascaraCPF(inputDoc.value) : mascaraCNPJ(inputDoc.value);
    inputDoc.value = formatado;
  }
}

// Marca/desmarca IE como ISENTO
function marcarIsento() {
  const input = document.getElementById('cliente-ie');
  const btn = document.querySelector('.btn-isento');
  if (!input || !btn) return;
  if (input.value.toUpperCase() === 'ISENTO') {
    input.value = '';
    input.disabled = false;
    btn.classList.remove('ativo');
  } else {
    input.value = 'ISENTO';
    input.disabled = true;
    btn.classList.add('ativo');
  }
}


// ============================================================
// CONSULTA DE CNPJ NA BRASILAPI (gratuita, sem cadastro)
// ============================================================
// Cache em memória: evita consultar o mesmo CNPJ múltiplas vezes
const _cacheCNPJ = new Map();

async function consultarCNPJ(cnpjLimpo) {
  // cnpjLimpo: só 14 dígitos, sem máscara
  if (!cnpjLimpo || cnpjLimpo.length !== 14) return { ok: false, erro: 'CNPJ inválido' };

  // Verifica cache
  if (_cacheCNPJ.has(cnpjLimpo)) {
    return { ok: true, dados: _cacheCNPJ.get(cnpjLimpo), cached: true };
  }

  // Timeout de 8s (rede ruim não trava o app)
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 8000);

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 404) {
      return { ok: false, erro: 'CNPJ não encontrado na Receita Federal.' };
    }
    if (!res.ok) {
      return { ok: false, erro: `Erro ao consultar (HTTP ${res.status})` };
    }
    const dados = await res.json();
    _cacheCNPJ.set(cnpjLimpo, dados);
    return { ok: true, dados };
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { ok: false, erro: 'Tempo esgotado. Verifique sua internet.' };
    }
    return { ok: false, erro: 'Não foi possível consultar a Receita Federal agora.' };
  }
}

// Aplica dados retornados da Receita nos campos do modal de cliente
// Lida com nome divergente (alerta) e CNPJ inativo (aviso)
async function aplicarDadosReceita(dados, aindaAtual = () => true) {
  if (!dados || !aindaAtual()) return;

  // 1) Avisa se CNPJ inativo/suspenso/baixado ANTES de preencher
  const descSit = (dados.descricao_situacao_cadastral || '').toUpperCase();
  if (descSit && descSit !== 'ATIVA') {
    const continuar = await confirmar(
      `⚠ Atenção! Este CNPJ está com situação cadastral "${descSit}" na Receita Federal.\n\n` +
      `Pode indicar que a empresa está inativa, suspensa ou baixada.\n\n` +
      `Deseja preencher os dados mesmo assim?`
    );
    if (!continuar || !aindaAtual()) return;
  }

  // 2) Decide qual nome usar (nome_fantasia > razao_social)
  const nomeReceita = (dados.nome_fantasia || dados.razao_social || '').trim();

  // 3) Verifica divergência com nome já digitado
  const inputNome = document.getElementById('cliente-nome');
  const nomeAtual = (inputNome?.value || '').trim();
  let usarNomeReceita = true;
  if (nomeAtual && nomeReceita && normalizar(nomeAtual) !== normalizar(nomeReceita)) {
    usarNomeReceita = await confirmar(
      `⚠ O nome digitado não bate com o cadastrado na Receita Federal.\n\n` +
      `Digitado: ${nomeAtual}\n` +
      `Receita:  ${nomeReceita}\n\n` +
      `Deseja substituir pelo nome da Receita?`
    );
  }

  // 4) Preenche os campos (só sobrescreve se vazio OU se usuário autorizou)
  if (!aindaAtual()) return;
  if (inputNome && nomeReceita && (!nomeAtual || usarNomeReceita)) {
    inputNome.value = nomeReceita;
  }

  // Endereço completo
  const inputEnd = document.getElementById('cliente-endereco');
  if (inputEnd && !inputEnd.value.trim()) {
    const partes = [
      dados.logradouro,
      dados.numero,
      dados.bairro,
      dados.municipio,
      dados.uf,
    ].filter(Boolean).map(s => String(s).trim());
    if (partes.length) {
      const cep = dados.cep ? ` - CEP ${dados.cep}` : '';
      inputEnd.value = partes.join(', ') + cep;
    }
  }

  // Telefone da Receita: limpa TUDO que não é dígito antes de classificar.
  // 11 dígitos (DDD + 9) = celular → preenche o WhatsApp.
  // 10 dígitos (DDD + 8) = fixo → não há mais campo; o número aparece
  // no painel de status da consulta para o usuário decidir o que fazer.
  const inputWa = document.getElementById('cliente-whatsapp');
  const telReceita = soDigitos(String(dados.ddd_telefone_1 || ''));
  if (telReceita.length === 11 && inputWa && !inputWa.value.trim()) {
    inputWa.value = mascaraTelefone(telReceita);
  }

  // E-mail
  const inputEmail = document.getElementById('cliente-email');
  if (inputEmail && !inputEmail.value.trim() && dados.email) {
    inputEmail.value = String(dados.email).toLowerCase().trim();
  }

  // Inscrição estadual — BrasilAPI traz array `inscricoes_estaduais` ou pode não vir
  const inputIE = document.getElementById('cliente-ie');
  const btnIsento = document.querySelector('.btn-isento');
  if (inputIE && !inputIE.value.trim() && !inputIE.disabled) {
    const ies = Array.isArray(dados.inscricoes_estaduais) ? dados.inscricoes_estaduais : [];
    const ativa = ies.find(i => i.ativo === true);
    if (ativa?.inscricao_estadual) {
      inputIE.value = ativa.inscricao_estadual;
    }
  }
}

// Dispara consulta automática quando CNPJ está completo (14 dígitos)
async function tentarConsultarCNPJ() {
  const input = document.getElementById('cliente-cnpj-cpf');
  const status = document.getElementById('cnpj-status');
  if (!input || !status) return;

  // Só consulta no modo CNPJ (não em CPF)
  const modal = document.querySelector('#modal-cliente .modal-sheet');
  const tipo = modal?.dataset.tipoPessoa || 'juridica';
  if (tipo !== 'juridica') {
    status.style.display = 'none';
    return;
  }

  const digitos = soDigitos(input.value);
  if (digitos.length !== 14) {
    status.style.display = 'none';
    return;
  }

  // Valida antes de gastar requisição
  if (!validarCNPJ(digitos)) {
    status.style.display = 'block';
    status.className = 'cnpj-status erro';
    status.innerHTML = '⚠ CNPJ inválido (dígitos verificadores não batem)';
    return;
  }

  // Mostra loading
  status.style.display = 'block';
  status.className = 'cnpj-status carregando';
  status.innerHTML = '<span class="spinner-mini"></span> Consultando Receita Federal...';

  const abertura = document.getElementById('modal-cliente')?.dataset.abertura;
  const consulta = {};
  modal.consultaAtual = consulta;
  const aindaAtual = () => modal.consultaAtual === consulta &&
    document.getElementById('modal-cliente')?.classList.contains('aberto') &&
    document.getElementById('modal-cliente')?.dataset.abertura === abertura &&
    modal.dataset.tipoPessoa !== 'fisica' && soDigitos(input.value) === digitos;

  const res = await consultarCNPJ(digitos);
  if (!aindaAtual()) return;

  if (!res.ok) {
    status.className = 'cnpj-status aviso';
    status.innerHTML = `ℹ ${esc(res.erro)} <button type="button" onclick="tentarConsultarCNPJ()" style="background:none;border:none;color:var(--o0);text-decoration:underline;cursor:pointer;font-size:11px">tentar novamente</button>`;
    return;
  }

  const d = res.dados;
  const nomeUsar = d.nome_fantasia || d.razao_social || 'sem nome';
  const sitTxt = (d.descricao_situacao_cadastral || 'ATIVA').toUpperCase();
  const sitClass = sitTxt === 'ATIVA' ? 'ok' : 'aviso';

  // Checklist transparente: o que a Receita forneceu e o que não está disponível.
  // (A Receita Federal NÃO divulga e-mail/telefone de todas as empresas, e a
  //  Inscrição Estadual é dado da SEFAZ estadual — raramente vem nessa consulta.)
  const telLimpo = soDigitos(String(d.ddd_telefone_1 || ''));
  const checks = [
    { ok: !!(d.logradouro || d.municipio), label: 'Endereço' },
    { ok: telLimpo.length === 11, label: 'Celular' },
    { ok: !!d.email, label: 'E-mail' },
  ];
  const linhaChecks = checks.map(c =>
    `<span style="opacity:${c.ok ? '1' : '.45'}">${c.ok ? '✓' : '✗'} ${c.label}</span>`
  ).join(' · ');

  // Se a Receita só tem telefone FIXO (10 dígitos), mostra como informação —
  // não preenche campo nenhum (fixo não serve para cobrança via WhatsApp).
  const linhaFixo = telLimpo.length === 10
    ? `<div style="font-size:11px;margin-top:3px;opacity:.8">ℹ Fixo na Receita: ${mascaraTelefone(telLimpo)} (anote na observação se precisar)</div>`
    : '';

  status.className = 'cnpj-status ' + sitClass;
  status.innerHTML = `
    <div style="font-weight:700;margin-bottom:3px">${sitTxt === 'ATIVA' ? '✓' : '⚠'} ${esc(nomeUsar)}</div>
    <div style="font-size:11px;opacity:.85">Situação: ${esc(sitTxt)}${res.cached ? ' · em cache' : ''}</div>
    <div style="font-size:11px;margin-top:4px">${linhaChecks}</div>
    ${linhaFixo}
    <div style="font-size:10px;opacity:.6;margin-top:3px">Itens com ✗ não são divulgados pela Receita para este CNPJ</div>`;

  // Aplica os dados (com confirmações se necessário)
  await aplicarDadosReceita(d, aindaAtual);
}

// Aplica máscaras nos inputs do modal de cliente (delegação por evento)
function aplicarMascarasCliente() {
  const inputDoc = document.getElementById('cliente-cnpj-cpf');
  const inputWa  = document.getElementById('cliente-whatsapp');
  const inputIE  = document.getElementById('cliente-ie');
  if (!inputDoc) return; // modal não está aberto

  // Evita registrar múltiplas vezes
  if (inputDoc.dataset.maskAttached === '1') return;

  inputDoc.addEventListener('input', e => {
    const modal = document.querySelector('#modal-cliente .modal-sheet');
    const tipo = modal?.dataset.tipoPessoa || 'juridica';
    e.target.value = tipo === 'fisica' ? mascaraCPF(e.target.value) : mascaraCNPJ(e.target.value);

    // Esconde status anterior enquanto digita
    const status = document.getElementById('cnpj-status');
    if (status && tipo === 'juridica') {
      const digitos = soDigitos(e.target.value);
      if (digitos.length < 14) {
        status.style.display = 'none';
      } else if (digitos.length === 14) {
        // Consulta automática quando completa 14 dígitos
        tentarConsultarCNPJ();
      }
    }
  });
  inputWa.addEventListener('input',  e => { e.target.value = mascaraTelefone(e.target.value); });
  inputIE.addEventListener('input',  e => {
    if (e.target.value.toUpperCase() === 'ISENTO') return;
    e.target.value = mascaraIE(e.target.value);
  });

  inputDoc.dataset.maskAttached = '1';
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
  { id:1, nome:'Ração Golden Adulto 15kg',   categoria:'Ração',        preco:142.90 },
  { id:2, nome:'Ração Premium Filhote 10kg', categoria:'Ração',        preco:98.50  },
  { id:3, nome:'Ração Pedigree 3kg',         categoria:'Ração',        preco:36.90  },
  { id:4, nome:'Ração Gatos Whiskas 3kg',    categoria:'Ração',        preco:42.00  },
  { id:5, nome:'Farelo de Soja 60kg',        categoria:'Agropecuário', preco:188.00 },
  { id:6, nome:'Milho Triturado 30kg',       categoria:'Agropecuário', preco:74.00  },
  { id:7, nome:'Sal Mineral Bovino 30kg',    categoria:'Agropecuário', preco:62.00  },
  { id:8, nome:'Vermífugo Ivermectina',      categoria:'Agropecuário', preco:28.50  },
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
async function apiSupabase(tabela, metodo='GET', dados=null, filtros='', _retry=true, opcoes={}) {
  const acessoInicial = geracaoAcesso;
  if (MODO_DEMO) return { ok:true, dados:null };
  // Sem sessão logada, a RLS bloqueia tudo — nem tenta a chamada.
  if (!sessao) return { ok:false, erro:'Sessão expirada. Faça login novamente.', status:401 };

  // Renova o token proativamente se estiver perto de expirar
  if (navigator.onLine) await garantirTokenValido();
  if (geracaoAcesso !== acessoInicial) return { ok:false, status:499, erro:'A sessão foi alterada. Reabra a operação.' };
  if (!sessao) return { ok:false, erro:'Sessão expirada. Faça login novamente.', status:401 };

  try {
    const headers = {
      'apikey': SUPABASE_KEY,                          // anon key: só identifica o projeto
      'Authorization': `Bearer ${sessao.access_token}`, // token do usuário: é o que a RLS valida
      'Content-Type': 'application/json',
    };
    if (metodo === 'POST') headers['Prefer'] = 'return=representation';
    if (metodo === 'GET' && opcoes.contar) headers['Prefer'] = 'count=exact';
    if (metodo === 'PATCH' || metodo === 'DELETE') {
      headers['Prefer'] = opcoes.retorno === 'minimal'
        ? 'return=minimal,count=exact'
        : 'return=representation,count=exact';
    }
    const opts = { method:metodo, headers };
    if (dados) opts.body = JSON.stringify(dados);

    // Timeout de 15s — se a rede do entregador estiver ruim, aborta
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15000);
    opts.signal = ctrl.signal;

    let res, texto;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtros}`, opts);
      texto = res.status === 204 ? '' : await res.text();
    } finally {
      clearTimeout(timeoutId);
    }

    if (geracaoAcesso !== acessoInicial) return { ok:false, status:499, erro:'A sessão foi alterada. Reabra a operação.' };
    // Token expirou/ficou inválido no meio do uso: renova UMA vez e refaz.
    if (res.status === 401 && _retry) {
      const renovou = await authRefresh();
      if (geracaoAcesso !== acessoInicial) return { ok:false, status:499, erro:'A sessão foi alterada.' };
      if (renovou) return apiSupabase(tabela, metodo, dados, filtros, false, opcoes);
      forcarRelogin();
      return { ok:false, erro:'Sessão expirada. Faça login novamente.', status:401 };
    }

    if (!res.ok) {
      const txt = texto;
      console.error(`[Supabase ${metodo} ${tabela}] HTTP ${res.status}:`, txt);
      return { ok:false, erro: `HTTP ${res.status}: ${txt}`, status: res.status };
    }
    let resposta = true;
    if (texto) {
      try { resposta = JSON.parse(texto); }
      catch (e) { return { ok:false, erro:'Resposta inválida do servidor.', status:502 }; }
    }
    const faixa = res.headers?.get?.('Content-Range') || '';
    const total = Number(faixa.match(/\/(\d+)$/)?.[1]);
    const count = Number.isFinite(total) ? total : (Array.isArray(resposta) ? resposta.length : null);
    // Sem rede, o service worker devolve a última cópia salva e a marca com
    // x-from-cache. Ela serve para o app funcionar offline, mas não confirma
    // nada com o servidor.
    const deCache = res.headers?.get?.('x-from-cache') === '1';
    return { ok:true, dados:resposta, count, total:Number.isFinite(total) ? total : null, deCache };
  } catch(e) {
    if (geracaoAcesso !== acessoInicial) return { ok:false, status:499, erro:'A sessão foi alterada.' };
    if (e.name === 'AbortError') {
      console.warn(`[Supabase ${metodo} ${tabela}] Timeout (15s) — verifique a internet`);
      return { ok:false, rede:true, erro: 'Tempo esgotado. Verifique sua conexão de internet e tente novamente.' };
    }
    console.error(`[Supabase ${metodo} ${tabela}] Erro de rede:`, e);
    return { ok:false, rede:true, erro: e.message };
  }
}

// ============================================================
// AUTENTICAÇÃO (Supabase Auth / GoTrue)
// Login REAL: troca usuário/senha por um token do Supabase. Esse token
// é o que a RLS valida — sem ele, o banco bloqueia tudo (anon barrado).
// ============================================================
const SESSAO_KEY = 'kg-sessao';

// Monta o objeto de sessão a partir da resposta do GoTrue
function montarSessao(d) {
  return {
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    expires_at:    Date.now() + ((d.expires_in || 3600) * 1000),
  };
}

// O perfil confiável vem do JWT assinado pelo Supabase, nunca do localStorage
// nem do botão escolhido na tela de login.
function usuarioDoToken(token) {
  try {
    const parte = token.split('.')[1];
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const meta = JSON.parse(new TextDecoder().decode(bytes)).app_metadata || {};
    if (!['admin', 'vendedor', 'entregador'].includes(meta.app_role)) return null;
    if (!LOGIN_EMAILS[meta.app_login]) return null;
    return {
      login: meta.app_login,
      perfil: meta.app_role,
      nome: meta.app_name || PERFIS[meta.app_login]?.nome || meta.app_login,
    };
  } catch (e) {
    return null;
  }
}

// Salva sessão + usuário no localStorage (reabrir o PWA sem relogar)
function persistirSessao() {
  try {
    if (sessao && usuario) {
      localStorage.setItem(SESSAO_KEY, JSON.stringify({ sessao, usuario }));
    } else {
      localStorage.removeItem(SESSAO_KEY);
    }
  } catch(e) { /* silencioso */ }
}

// Login real: e-mail + senha → tokens
async function authLogin(email, senha) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:'POST',
      headers:{ 'apikey':SUPABASE_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password: senha }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok:false };
    return { ok:true, sessao: montarSessao(await res.json()) };
  } catch(e) {
    // Erro de rede ≠ senha errada — quem chama mostra mensagem apropriada
    return { ok:false, rede:true, erro:e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Renova o access_token usando o refresh_token
let _refreshEmAndamento = null;
function authRefresh() {
  if (_refreshEmAndamento) return _refreshEmAndamento;
  if (!sessao?.refresh_token) return false;
  _refreshEmAndamento = (async () => {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15000);
    try {
      const refreshToken = sessao.refresh_token;
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method:'POST',
        headers:{ 'apikey':SUPABASE_KEY, 'Content-Type':'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      const novaSessao = montarSessao(await res.json());
      const identidade = usuarioDoToken(novaSessao.access_token);
      if (!identidade) return false;
      // O usuário pode ter saído enquanto a renovação estava em andamento.
      // Nesse caso, não restaura silenciosamente a sessão encerrada.
      if (!sessao || sessao.refresh_token !== refreshToken) return false;
      sessao = novaSessao;
      usuario = identidade;
      persistirSessao();
      atualizarTokenRealtime(novaSessao.access_token);
      return true;
    } catch(e) {
      return false;
    } finally {
      clearTimeout(timeoutId);
      _refreshEmAndamento = null;
    }
  })();
  return _refreshEmAndamento;
}

// Garante um token válido antes de uma chamada (renova 60s antes de expirar)
async function garantirTokenValido() {
  if (!sessao) return false;
  if (Date.now() > sessao.expires_at - 60000) {
    return await authRefresh();
  }
  return true;
}

// Sessão morreu de vez (refresh falhou) → volta pro login
function forcarRelogin() {
  toast('Sua sessão expirou. Faça login novamente.');
  sair();
}

// Ao abrir o app, tenta restaurar a sessão salva (PWA reaberto)
async function restaurarSessao() {
  let salvo;
  try { salvo = JSON.parse(localStorage.getItem(SESSAO_KEY) || 'null'); }
  catch(e) { salvo = null; }
  if (!salvo?.sessao?.refresh_token || !salvo?.usuario) return;

  sessao  = salvo.sessao;
  usuario = usuarioDoToken(sessao.access_token);
  if (!usuario) {
    sessao = null; persistirSessao();
    return;
  }

  // Reutiliza o access token até a margem de renovação. A API continua
  // validando o JWT e as permissões em cada consulta e operação.
  // Offline não aguarda uma renovação que não pode terminar com sucesso.
  if (!navigator.onLine || Date.now() < sessao.expires_at - 60000) {
    entrarNoApp();
    return;
  }

  // Renova apenas perto da expiração. Se a conexão cair durante a espera,
  // preserva o acesso offline; expirado e online exige nova autenticação.
  const renovou = await authRefresh();
  // Logout ou outro login durante a espera invalidam esta restauração.
  if (!sessao || !usuario || (!renovou && sessao !== salvo.sessao)) return;
  if (!renovou && !navigator.onLine) {
    entrarNoApp();
    return;
  }
  if (!renovou && Date.now() >= sessao.expires_at) {
    sessao = null; usuario = null; persistirSessao();
    return;
  }
  entrarNoApp();
}

// ============================================================
// LOGIN / SAIR
// ============================================================
function mostrarErroLogin(msg) {
  const el = document.getElementById('erro-login');
  if (msg) el.textContent = msg;
  el.style.display = 'block';
}

// Leigo toca no perfil em vez de digitar o usuário.
// Guarda a escolha no input escondido (que fazerLogin já lê) e foca a senha.
function selecionarPerfilLogin(perfil) {
  const hidden = document.getElementById('input-usuario');
  if (hidden) hidden.value = perfil;
  document.querySelectorAll('#perfil-login-grid .perfil-login-btn').forEach(b => {
    b.classList.toggle('ativo', b.dataset.perfil === perfil);
  });
  document.getElementById('erro-login').style.display = 'none';
  const s = document.getElementById('input-senha');
  if (s) s.focus();
}

// Limpa a escolha de perfil (ao sair)
function resetarPerfilLogin() {
  document.querySelectorAll('#perfil-login-grid .perfil-login-btn').forEach(b => b.classList.remove('ativo'));
}

let loginEmAndamento = false;
async function fazerLogin() {
  if (loginEmAndamento) return;
  const u = document.getElementById('input-usuario').value.trim().toLowerCase();
  const s = document.getElementById('input-senha').value;   // senha é case-sensitive — NÃO alterar
  const email  = LOGIN_EMAILS[u];
  const perfil = PERFIS[u]; // apenas valida se o botão escolhido existe
  if (!u)             { mostrarErroLogin('Toque no seu perfil antes de entrar'); return; }
  if (!email || !perfil) { mostrarErroLogin('Perfil inválido'); return; }
  if (!s)             { mostrarErroLogin('Digite a senha'); return; }

  // Feedback: evita duplo-clique e mostra que está acontecendo algo
  const btn = document.querySelector('#tela-login .btn-primario');
  const acessoInicial = geracaoAcesso;
  loginEmAndamento = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
  try {
  const r = await authLogin(email, s);
  if (geracaoAcesso !== acessoInicial) return;

  if (!r.ok) {
    if (r.rede) {
      toast('📡 Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'erro');
    } else {
      mostrarErroLogin('Senha incorreta. Tente novamente.');
    }
    return;
  }

  const identidade = usuarioDoToken(r.sessao.access_token);
  if (!identidade || identidade.login !== u) {
    mostrarErroLogin('Este acesso não corresponde ao perfil escolhido.');
    return;
  }

  sessao  = r.sessao;
  usuario = identidade;
  persistirSessao();
  document.getElementById('erro-login').style.display = 'none';
  entrarNoApp();
  } finally {
    loginEmAndamento = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  }
}

// Configura a UI e carrega os dados depois que já há sessão + usuario.
// Usado tanto no login manual quanto na restauração de sessão.
function entrarNoApp() {
  geracaoAcesso++;
  const user = usuario;
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
    todosOsPedidos  = structuredClone(DEMO_PEDIDOS);
    todosOsClientes = structuredClone(DEMO_CLIENTES);
    todosOsProdutos = structuredClone(DEMO_PRODUTOS);
  }
  configurarNav();
  carregarTudo();
}

// Listeners de login (defensivos: só registra se o elemento existir)
const elSenha = document.getElementById('input-senha');
const elUsuario = document.getElementById('input-usuario');
if (elSenha) elSenha.addEventListener('keyup', e => { if(e.key==='Enter') fazerLogin(); });
if (elUsuario) elUsuario.addEventListener('keyup', e => { if(e.key==='Enter') {
  const s = document.getElementById('input-senha');
  if (s) s.focus();
}});

function sair() {
  if (resolverConfirmacao) resolverConfirmacao(false);
  geracaoAcesso++;
  carregandoDados = false;
  pararAutoRefresh();
  pararRealtime();
  let acoesOfflinePendentes = 0;
  try { acoesOfflinePendentes = lerFilaOffline().length; }
  catch (e) { toast('A fila offline não pôde ser lida. Seus dados serão preservados ao sair.'); }

  // Encerra a sessão no Supabase (best-effort) e apaga o token local
  if (sessao) {
    const tk = sessao.access_token;
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method:'POST',
      headers:{ 'apikey':SUPABASE_KEY, 'Authorization':`Bearer ${tk}` },
    }).catch(()=>{});
  }
  sessao = null;
  try { localStorage.removeItem(SESSAO_KEY); } catch(e) { /* silencioso */ }

  // Respostas da API podem conter dados de outro perfil neste aparelho.
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.endsWith('-data')).map(k => caches.delete(k))
    )).catch(() => {});
  }

  // Limpa TODOS os checklists do localStorage (evita herança entre usuários)
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(CHECKLIST_PREFIX)) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch(e) { /* silencioso */ }

  // Reset completo de TODOS os estados
  usuario = null;
  todosOsPedidos = []; todosOsClientes = []; todosOsProdutos = [];
  carrinho = [];
  pedidoSelecionado = null;
  pedidoEmEdicao = null;
  clienteSelecionado = null;
  produtoSelecionado = null;
  filtroEntregas = 'pendente';
  filtroFinanceiro = 'atrasado';
  filtroCatalogo = 'todos';
  filtroMeusPedidos = 'pendente';
  revisaoEstado++;
  sincronizacaoPendente = false;

  // Fecha qualquer modal aberto
  document.querySelectorAll('.modal-overlay.aberto').forEach(m => m.classList.remove('aberto'));
  document.body.classList.remove('modal-aberto');

  document.getElementById('tela-login').style.display='flex';
  const appEl = document.getElementById('app');
  appEl.style.display='none';
  appEl.classList.remove('ativo-desktop');
  document.getElementById('input-usuario').value='';
  document.getElementById('input-senha').value='';
  document.getElementById('erro-login').style.display='none';
  resetarPerfilLogin();
  // Restaura telas que podem ter sido escondidas por outro perfil
  ['tela-dashboard','tela-clientes','tela-financeiro','tela-catalogo','tela-meus-pedidos','tela-entregas','tela-inicio-vendedor']
    .forEach(id => { document.getElementById(id).style.display=''; });
  const abasEl = document.getElementById('abas-entregas');
  if (abasEl) abasEl.style.display='';
  if (acoesOfflinePendentes) {
    toast(`${acoesOfflinePendentes} entrega(s) offline foram preservadas e serão sincronizadas no próximo acesso do entregador.`);
  }
}

// ============================================================
// NAV BOTTOM
// ============================================================
// Ícones em SVG (traço, herdam a cor via currentColor) — visual mais
// profissional e idêntico em qualquer aparelho, ao contrário dos emojis.
const ICO = {
  home:  '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.6"/><path d="M9.5 21v-6h5v6"/></svg>',
  truck: '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5h11v9.5H3z"/><path d="M14 9.5h4l3 3.2V16h-7z"/><circle cx="7" cy="18.5" r="1.7"/><circle cx="17.5" cy="18.5" r="1.7"/></svg>',
  store: '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"/><path d="M3.5 9.5 5 4h14l1.5 5.5a3 3 0 0 1-5.6 0 3 3 0 0 1-5.8 0 3 3 0 0 1-5.6 0Z"/><path d="M9.5 21v-5h5v5"/></svg>',
  wallet:'<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18"/><circle cx="16.5" cy="14.5" r="1.15"/></svg>',
  cart:  '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="17.5" cy="20" r="1.5"/><path d="M3 4h2.2l2.1 11a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L20 8H6"/></svg>',
  list:  '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 4.5v-.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5"/><path d="M9 10h6M9 13.5h6M9 17h4"/></svg>',
};

const NAV = {
  admin: [
    { id:'dashboard',  icone:ICO.home,  label:'Início',     tela:'tela-dashboard'   },
    { id:'entregas',   icone:ICO.truck, label:'Entregas',   tela:'tela-entregas'    },
    { id:'clientes',   icone:ICO.store, label:'Clientes',   tela:'tela-clientes'    },
    { id:'financeiro', icone:ICO.wallet,label:'Financeiro', tela:'tela-financeiro'  },
    { id:'catalogo',   icone:ICO.cart,  label:'Catálogo',   tela:'tela-catalogo'    },
  ],
  vendedor: [
    { id:'inicio-vendedor', icone:ICO.home, label:'Início',       tela:'tela-inicio-vendedor' },
    { id:'meus-pedidos',    icone:ICO.list, label:'Meus pedidos', tela:'tela-meus-pedidos'    },
    { id:'catalogo',        icone:ICO.cart, label:'Catálogo',     tela:'tela-catalogo'        },
    { id:'clientes',        icone:ICO.store,label:'Clientes',     tela:'tela-clientes'        },
  ],
  entregador: [
    { id:'entregas', icone:ICO.truck, label:'Entregas do dia', tela:'tela-entregas' },
  ],
};

const TITULOS = {
  dashboard:'Início', entregas:'Entregas', clientes:'Clientes',
  financeiro:'Financeiro', catalogo:'Catálogo',
  'meus-pedidos':'Meus Pedidos', 'inicio-vendedor':'Início',
};

// Estado visual da navegação móvel. A barra acompanha a intenção de rolagem
// com um pequeno limiar para não piscar durante movimentos de poucos pixels.
let navScrollRaf = 0;
let navUltimoScrollY = 0;
let navScrollInicializado = false;
let navOculta = false;
let navDeltaAcumulado = 0;

function posicionarIndicadorNav(id, animar = true) {
  const nav = document.getElementById('nav-bottom');
  const indicador = nav?.querySelector('.nav-indicator');
  const btn = id ? document.getElementById(`nav-${id}`) : nav?.querySelector('.nav-item.ativo');
  if (!nav || !indicador || !btn) return;

  // Posição dentro da barra (no computador a barra é lateral e pode rolar)
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  const x = Math.max(0, btnRect.left - navRect.left - nav.clientLeft + nav.scrollLeft);
  const y = Math.max(0, btnRect.top - navRect.top - nav.clientTop + nav.scrollTop);
  indicador.style.setProperty('--nav-indicator-x', `${x}px`);
  indicador.style.setProperty('--nav-indicator-y', `${y}px`);
  indicador.style.setProperty('--nav-indicator-w', `${btnRect.width}px`);
  indicador.style.setProperty('--nav-indicator-h', `${btnRect.height}px`);

  if (animar) nav.classList.add('nav-indicator-ready');
  else {
    nav.classList.remove('nav-indicator-ready');
    requestAnimationFrame(() => {
      if (nav.isConnected) nav.classList.add('nav-indicator-ready');
    });
  }
}

function reposicionarIndicadorNav() {
  const nav = document.getElementById('nav-bottom');
  if (window.matchMedia('(min-width: 900px)').matches) {
    nav?.classList.remove('nav-recolhida');
    navOculta = false;
  }
  const ativo = document.querySelector('#nav-bottom .nav-item.ativo');
  if (ativo) posicionarIndicadorNav(ativo.id.replace(/^nav-/, ''), false);
}

// Gota "gooey" atrás da aba ativa dos grupos de abas (Pendentes/Entregues/Todas,
// catálogo, financeiro, relatório, lista/rota). Um só lugar cuida de todos:
// observa a troca da classe "ativa" (feita em vários pontos do app) e o tamanho
// do grupo (tela que aparece, giro do celular). O visual fica no CSS.
const GRUPOS_ABAS = '.abas, .resumo-entregador-abas';

function posicionarGotaAba(grupo, animar = true) {
  const gota = grupo.querySelector(':scope > .aba-gota');
  const ativa = grupo.querySelector(':scope > .aba.ativa, :scope > .aba-rota.ativa');
  if (!gota || !ativa || !ativa.offsetWidth) return; // grupo escondido: espera aparecer
  gota.style.setProperty('--gx', `${ativa.offsetLeft}px`);
  gota.style.setProperty('--gy', `${ativa.offsetTop}px`);
  gota.style.setProperty('--gw', `${ativa.offsetWidth}px`);
  gota.style.setProperty('--gh', `${ativa.offsetHeight}px`);
  if (animar && grupo.classList.contains('gota-pronta')) return;
  // Primeira vez (ou depois de mudar de tamanho): aparece no lugar, sem viajar
  grupo.classList.remove('gota-pronta');
  requestAnimationFrame(() => requestAnimationFrame(() => grupo.classList.add('gota-pronta')));
}

function iniciarGotasAbas() {
  if (typeof MutationObserver === 'undefined') return;
  const pendentes = new Set();
  let agendado = false;
  const agendar = (grupo, animar) => {
    pendentes.add(grupo); grupo._gotaAnimar = (grupo._gotaAnimar ?? true) && animar;
    if (agendado) return;
    agendado = true;
    requestAnimationFrame(() => {
      agendado = false;
      pendentes.forEach(g => { posicionarGotaAba(g, g._gotaAnimar); g._gotaAnimar = undefined; });
      pendentes.clear();
    });
  };
  const redimensionou = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entradas => entradas.forEach(e => agendar(e.target, false)))
    : null;
  document.querySelectorAll(GRUPOS_ABAS).forEach(grupo => {
    if (grupo.querySelector(':scope > .aba-gota')) return;
    grupo.insertAdjacentHTML('afterbegin', '<span class="aba-gota" aria-hidden="true"></span>');
    grupo.classList.add('com-gota');
    new MutationObserver(regs => { if (regs.some(r => r.target !== grupo)) agendar(grupo, true); })
      .observe(grupo, { subtree: true, attributes: true, attributeFilter: ['class'] });
    redimensionou?.observe(grupo);
    agendar(grupo, false);
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarGotasAbas);
else iniciarGotasAbas();

function atualizarVisibilidadeNav() {
  navScrollRaf = 0;
  const nav = document.getElementById('nav-bottom');
  if (!nav || window.matchMedia('(min-width: 900px)').matches) return;

  const y = Math.max(0, window.scrollY || document.documentElement.scrollTop || 0);
  if (!navScrollInicializado) {
    navUltimoScrollY = y;
    navScrollInicializado = true;
    return;
  }

  const delta = y - navUltimoScrollY;
  navUltimoScrollY = y;
  if (Math.abs(delta) < 1) return;
  if (navDeltaAcumulado && Math.sign(delta) !== Math.sign(navDeltaAcumulado)) {
    navDeltaAcumulado = 0;
  }
  navDeltaAcumulado += delta;
  if (y <= 8) {
    navDeltaAcumulado = 0;
    navOculta = false;
  } else if (navDeltaAcumulado <= -18) {
    navDeltaAcumulado = 0;
    navOculta = false;
  } else if (navDeltaAcumulado >= 18 && y > 56) {
    navDeltaAcumulado = 0;
    navOculta = true;
  }
  nav.classList.toggle('nav-recolhida', navOculta);
}

function agendarAtualizacaoNav() {
  if (navScrollRaf) return;
  navScrollRaf = requestAnimationFrame(atualizarVisibilidadeNav);
}

function resetarVisibilidadeNav() {
  const nav = document.getElementById('nav-bottom');
  navOculta = false;
  navDeltaAcumulado = 0;
  navScrollInicializado = false;
  if (nav) nav.classList.remove('nav-recolhida');
  agendarAtualizacaoNav();
}

window.addEventListener('scroll', agendarAtualizacaoNav, { passive: true });

function configurarNav() {
  const p = usuario.perfil;
  const itens = NAV[p] || NAV.entregador;
  const inicial = itens[0].id;
  const nav = document.getElementById('nav-bottom');
  nav.innerHTML = `<span class="nav-indicator" aria-hidden="true"></span>${itens.map(i => `
    <button class="nav-item ${i.id===inicial?'ativo':''}" onclick="navegarPara('${i.id}')" id="nav-${i.id}">
      <span class="nav-icon">${i.icone}</span>
      <span class="nav-label">${esc(i.label)}</span>
    </button>`).join('')}`;

  // Esconde telas que o perfil não usa
  const telasVisiveis = new Set(itens.map(i => i.tela));
  ['tela-dashboard','tela-entregas','tela-clientes','tela-financeiro','tela-catalogo','tela-meus-pedidos','tela-inicio-vendedor']
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
  resetarVisibilidadeNav();
  posicionarIndicadorNav(inicial, false);
}

function navegarPara(id) {
  const p = usuario.perfil;
  const itens = NAV[p] || NAV.entregador;
  const item = itens.find(i => i.id===id);
  if (!item) return;

  const ativoAnterior = document.querySelector('#nav-bottom .nav-item.ativo');
  const indiceAnterior = itens.findIndex(i => `nav-${i.id}` === ativoAnterior?.id);
  const indiceNovo = itens.findIndex(i => i.id === id);
  const deslocamentoTela = indiceAnterior >= 0 && indiceNovo !== indiceAnterior
    ? (indiceNovo > indiceAnterior ? '12px' : '-12px')
    : '0px';

  // Reset completo ao trocar de aba: limpa buscas + filtros + scroll
  resetarBuscasEFiltros();

  document.querySelectorAll('.tela').forEach(t => t.classList.remove('ativa'));
  const el = document.getElementById(item.tela);
  if (el) {
    el.style.setProperty('--kg-screen-shift', deslocamentoTela);
    el.style.display='';
    el.classList.add('ativa');
  }
  animarEntradaTela(el);
  document.getElementById('header-titulo').textContent = TITULOS[id] || '';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
  const btn = document.getElementById(`nav-${id}`);
  if (btn) btn.classList.add('ativo');
  posicionarIndicadorNav(id);

  if (id==='clientes')     renderizarClientes(todosOsClientes);
  if (id==='financeiro')   renderizarFinanceiro(filtroFinanceiro);
  if (id==='entregas')     renderizarEntregas(filtroEntregas);
  if (id==='catalogo')     renderizarCatalogo(filtroCatalogo);
  if (id==='meus-pedidos') renderizarMeusPedidos(filtroMeusPedidos);
  if (id==='dashboard')    renderizarDashboard();
  if (id==='inicio-vendedor') renderizarInicioVendedor();
}

window.addEventListener('resize', reposicionarIndicadorNav, { passive: true });

// ============================================================
// CARREGAR DADOS
// ============================================================
async function listarTodos(tabela, select='*') {
  const dados = [];
  let ultimo = 0;
  let deCache = false; // alguma página veio da cópia offline do service worker
  while (true) {
    const res = await apiSupabase(tabela,'GET',null,
      `?select=${select}&order=id.asc&limit=500&id=gt.${ultimo}`, true, { contar:true });
    if (!res.ok) return res;
    if (!Array.isArray(res.dados)) return { ok:false, erro:'Resposta de dados inválida.' };
    deCache = deCache || !!res.deCache;
    if (!res.dados.length) return { ok:true, dados, deCache };
    const proximo = Number(res.dados.at(-1).id);
    if (!Number.isSafeInteger(proximo) || proximo <= ultimo) return { ok:false, erro:'Paginação inválida.' };
    dados.push(...res.dados);
    // O total é dos registros restantes (id > ultimo), não das páginas já
    // acumuladas. Sem total (cache antigo), mantém a paginação conservadora.
    if (Number.isSafeInteger(res.total) && res.total >= 0 && res.dados.length >= res.total) {
      return { ok:true, dados, deCache };
    }
    ultimo = proximo;
  }
}

function normalizarPedidos(dados) {
  return (dados || []).map(p => ({
    ...p,
    cliente_nome: p.clientes?.nome || '–',
    itens: p.itens_pedido || [],
    descricao: (p.itens_pedido || []).map(i => `${i.qtd}x ${i.nome}`).join(', ') || p.descricao || '',
  }));
}

async function carregarListas() {
  const resultados = await Promise.all([
    listarTodos('pedidos','*,clientes(nome),itens_pedido(*)'),
    listarTodos('clientes'),
    usuario?.perfil === 'entregador' ? { ok:true, dados:[] } : listarTodos('produtos','*,produto_custos(preco_custo)'),
  ]);
  for (const res of resultados.slice(1)) {
    if (res.ok) res.dados.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR'));
  }
  const produtos = resultados[2];
  if (produtos.ok) produtos.dados = produtos.dados.map(p => ({ ...p,
    preco_custo: p.produto_custos?.preco_custo ?? null,
  }));
  return resultados;
}

let carregandoDados = false;
async function carregarTudo() {
  if (carregandoDados || !usuario) return;
  carregandoDados = true;
  const loginInicial = usuario?.login;
  const acessoInicial = geracaoAcesso;
  const revisaoInicial = revisaoEstado;
  const aviso = document.getElementById('status-carregamento');
  if (aviso) {
    aviso.hidden = false;
    aviso.innerHTML = '<span class="spinner-mini" aria-hidden="true"></span> Carregando informações…';
  }
  try {
  if (!MODO_DEMO) {
    const [resPed, resCli, resProd] = await carregarListas();
    if (geracaoAcesso !== acessoInicial || !usuario || usuario.login !== loginInicial) return;
    if (!resPed.ok || !resCli.ok || !resProd.ok) {
      throw new Error('Falha no carregamento das listas');
    }
    if (revisaoEstado !== revisaoInicial || formularioDeDadosAberto()) {
      throw new Error('Os dados mudaram durante a leitura. Tente novamente.');
    }
    todosOsClientes = resCli.dados || [];
    todosOsProdutos = resProd.dados || [];
    todosOsPedidos = normalizarPedidos(resPed.dados);
    aplicarFilaOffline(todosOsPedidos);
  }
  animarEntradaTela(document.querySelector('.tela.ativa'));
  // Só monta a primeira tela. As demais são montadas quando o usuário as abre,
  // evitando criar centenas de nós invisíveis logo após o login.
  const telaAtiva = document.querySelector('.tela.ativa')?.id;
  const telaInicial = NAV[usuario.perfil]?.[0]?.tela;
  if (telaAtiva && telaAtiva !== telaInicial) agendarRender(telaAtiva.replace('tela-', ''));
  else if (usuario.perfil === 'admin') renderizarDashboard();
  else if (usuario.perfil === 'vendedor') renderizarInicioVendedor();
  else renderizarEntregas(filtroEntregas);
  popularSelectClientes();

  // Limpa checklists antigos (>30 dias) e órfãos (pedidos deletados)
  if (usuario.perfil === 'entregador') limpezaChecklistAntigos();

  // Uma entrega feita offline pode ter sobrevivido a um logout ou sessão
  // expirada. Tenta sincronizar imediatamente após o próximo login correto.
  if (navigator.onLine) processarFilaOffline();

  // Realtime atualiza outras abas/aparelhos; o intervalo permanece como
  // recuperação caso o WebSocket seja bloqueado pela rede.
  iniciarRealtime();
  iniciarAutoRefresh();
  if (aviso) aviso.hidden = true;
  } catch (e) {
    if (geracaoAcesso !== acessoInicial) return;
    console.warn('Carregamento inicial falhou:', e.message);
    if (aviso) aviso.innerHTML = 'Não foi possível carregar as informações. <button type="button" class="btn-azul" onclick="carregarTudo()">Tentar novamente</button>';
  } finally {
    if (geracaoAcesso === acessoInicial) carregandoDados = false;
  }
}

function animarEntradaTela(el) {
  if (!el) return;
  clearTimeout(el.fimEntrada);
  el.classList.add('entrada');
  el.fimEntrada = setTimeout(() => el.classList.remove('entrada'), 400);
}

// ============================================================
// SINCRONIZAÇÃO AUTOMÁTICA (a cada 30s)
// Pega pedidos/clientes/produtos novos sem o usuário precisar recarregar
// ============================================================
let sincronizandoDados = false;
async function sincronizarDados() {
  if (MODO_DEMO || !usuario || !navigator.onLine || document.hidden) return;
  if (sincronizandoDados || formularioDeDadosAberto()) {
    sincronizacaoPendente = true;
    return;
  }
  const loginInicial = usuario.login;
  const revisaoInicial = revisaoEstado;
  sincronizandoDados = true;

  try {
    const [resPed, resCli, resProd] = await carregarListas();

    if (!resPed.ok || !resCli.ok || !resProd.ok) {
      console.warn('Sincronização incompleta:', {
        pedidos:resPed.status || resPed.erro, clientes:resCli.status || resCli.erro,
        produtos:resProd.status || resProd.erro,
      });
      return;
    }
    if (!usuario || usuario.login !== loginInicial) return;
    // A requisição pode ter começado antes de uma entrega ou edição. Nesse caso
    // a resposta é obsoleta e não deve reverter a interface recém-atualizada.
    if (revisaoEstado !== revisaoInicial || formularioDeDadosAberto()) {
      sincronizacaoPendente = true;
      return;
    }

    // Detecta se algo mudou (comparando hash completo dos pedidos)
    const novosPedidos = normalizarPedidos(resPed.dados);

    aplicarFilaOffline(novosPedidos);

    // Hash incluindo TODOS os campos que importam para a UI
    const hashPedido = (p) => {
      const itensHash = (p.itens || []).map(i =>
        `${i.produto_id}:${i.nome||''}:${i.qtd}:${i.preco_unit ?? ''}:${i.preco_catalogo ?? ''}`
      ).sort().join(',');
      return `${p.id}|${p.status}|${p.status_pagamento||''}|${p.forma_pagamento_real||''}|${p.data_pagamento||''}|${p.valor}|${p.cliente_id}|${p.data_entrega}|${p.data_entregue_em||''}|${p.data_vencimento}|${p.observacao||''}|${p.forma_pagamento||''}|${p.prazo_dias ?? ''}|${p.prazos_boleto||''}|${p.vendedor||''}|${itensHash}`;
    };
    // Hash de produtos e clientes: detecta EDIÇÕES, não só adições/remoções.
    // (Antes comparava por length — preço editado pelo admin não aparecia
    //  na tela do vendedor até a quantidade de itens mudar.)
    const hashProduto = (p) => `${p.id}|${p.nome}|${p.preco}|${p.preco_custo||''}|${p.categoria||''}`;
    const hashCliente = (c) => `${c.id}|${c.nome}|${c.responsavel||''}|${c.whatsapp||''}|${c.endereco||''}|${c.email||''}|${c.cnpj_cpf||''}|${c.tipo_pessoa||''}|${c.inscricao_estadual||''}|${c.observacao||''}`;
    const mudou =
      novosPedidos.map(hashPedido).join('\n') !== todosOsPedidos.map(hashPedido).join('\n') ||
      (resCli.dados || []).map(hashCliente).join('\n') !== todosOsClientes.map(hashCliente).join('\n') ||
      (resProd.dados || []).map(hashProduto).join('\n') !== todosOsProdutos.map(hashProduto).join('\n');

    todosOsPedidos  = novosPedidos;
    todosOsClientes = resCli.dados || [];
    todosOsProdutos = resProd.dados || [];

    if (mudou) invalidarInterfaces('pedidos','clientes','produtos');
  } catch (e) {
    console.warn('Sincronização falhou:', e);
  } finally {
    sincronizandoDados = false;
    if (sincronizacaoPendente && !formularioDeDadosAberto() && usuario && navigator.onLine) {
      sincronizacaoPendente = false;
      queueMicrotask(sincronizarDados);
    }
  }
}

function solicitarSincronizacao() {
  if (formularioDeDadosAberto() || sincronizandoDados) {
    sincronizacaoPendente = true;
    return;
  }
  sincronizarDados();
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
    solicitarSincronizacao();
  }
}

// O SDK é carregado somente depois do login. Assim o primeiro desenho continua
// leve em celulares fracos; se ele falhar, a revalidação periódica permanece.
let clienteRealtime = null;
let canalRealtime = null;
let loginRealtime = null;
let sdkRealtimePromise = null;
let loginRealtimeIniciando = null;

function carregarSdkRealtime() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (sdkRealtimePromise) return sdkRealtimePromise;
  sdkRealtimePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'supabase.min.js?v=2.116.0';
    script.async = true;
    script.onload = () => window.supabase?.createClient
      ? resolve(window.supabase)
      : reject(new Error('SDK Realtime indisponível'));
    script.onerror = () => {
      script.remove();
      sdkRealtimePromise = null;
      reject(new Error('SDK Realtime não carregou'));
    };
    document.head.appendChild(script);
  });
  return sdkRealtimePromise;
}

async function iniciarRealtime() {
  if (MODO_DEMO || !usuario || !sessao || !navigator.onLine) return;
  const acessoInicial = geracaoAcesso;
  const loginInicial = usuario.login;
  if ((canalRealtime && loginRealtime === loginInicial) || loginRealtimeIniciando === loginInicial) return;
  loginRealtimeIniciando = loginInicial;
  pararRealtime();
  try {
    const sdk = await carregarSdkRealtime();
    if (geracaoAcesso !== acessoInicial || !usuario || usuario.login !== loginInicial || !sessao) return;
    const cliente = sdk.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
      realtime:{ params:{ eventsPerSecond:2 } },
    });
    await cliente.realtime.setAuth(sessao.access_token);
    const aoMudar = debounce(solicitarSincronizacao, 250);
    const canal = cliente.channel('kg-dados')
      .on('postgres_changes',{event:'*',schema:'public',table:'pedidos'},aoMudar)
      .on('postgres_changes',{event:'*',schema:'public',table:'clientes'},aoMudar)
      .on('postgres_changes',{event:'*',schema:'public',table:'produtos'},aoMudar)
      .on('postgres_changes',{event:'*',schema:'public',table:'produto_custos'},aoMudar)
      .subscribe((status, erro) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime indisponível; usando revalidação periódica:', status, erro || '');
        }
      });
    clienteRealtime = cliente;
    canalRealtime = canal;
    loginRealtime = loginInicial;
  } catch (e) {
    console.warn('Realtime não iniciou; usando revalidação periódica:', e.message);
  } finally {
    if (loginRealtimeIniciando === loginInicial) loginRealtimeIniciando = null;
  }
}

function atualizarTokenRealtime(token) {
  if (!clienteRealtime || !token) return;
  clienteRealtime.realtime.setAuth(token)
    .catch(e => console.warn('Realtime não renovou a sessão:', e.message));
}

function pararRealtime() {
  if (clienteRealtime && canalRealtime) clienteRealtime.removeChannel(canalRealtime).catch(() => {});
  clienteRealtime = null;
  canalRealtime = null;
  loginRealtime = null;
}


// ============================================================
// DASHBOARD (admin)
// ============================================================
function renderizarDashboard() {
  if (usuario?.perfil !== 'admin') return;
  const { inicioMes, inicioMesPassado, inicioProximoMes } = periodoMesBrasil();

  // Pedidos do mês (FATURAMENTO REAL = entregues E PAGOS)
  const pedidosMes = todosOsPedidos.filter(p => {
    const data = dataRealEntrega(p);
    return p.status === 'entregue' && foiPago(p) && data &&
      data >= inicioMes && data < inicioProximoMes;
  });
  const pedidosMesPassado = todosOsPedidos.filter(p => {
    const data = dataRealEntrega(p);
    return p.status === 'entregue' && foiPago(p) && data &&
      data >= inicioMesPassado && data < inicioMes;
  });

  const faturamento = pedidosMes.reduce((s,p)=>s+(Number(p.valor)||0),0);
  const faturamentoAnterior = pedidosMesPassado.reduce((s,p)=>s+(Number(p.valor)||0),0);

  // Card 1: Faturamento
  document.getElementById('num-faturamento').textContent = moeda(faturamento);
  const tend = document.getElementById('tendencia-faturamento');
  if (faturamentoAnterior > 0) {
    const pct = ((faturamento - faturamentoAnterior) / faturamentoAnterior * 100).toFixed(0);
    const sinal = pct >= 0 ? '↑' : '↓';
    const classe = pct > 0 ? 'alta' : pct < 0 ? 'baixa' : 'neutro';
    tend.className = 'resumo-tendencia ' + classe;
    tend.textContent = `${sinal} ${Math.abs(pct)}% vs mês anterior`;
  } else {
    tend.className = 'resumo-tendencia neutro';
    tend.textContent = faturamento > 0 ? 'Primeiro mês com vendas' : 'Sem vendas ainda';
  }

  // Card 2: A receber = dinheiro que ainda não entrou (qualquer pedido não-pago).
  // Pedido pago adiantado (antes da entrega) NÃO conta como a receber.
  const pendentesEntrega = todosOsPedidos.filter(p => p.status === 'pendente');
  const entreguesNaoPagos = todosOsPedidos.filter(p => p.status === 'entregue' && !foiPago(p));
  const aReceberLista = [...pendentesEntrega.filter(p => !foiPago(p)), ...entreguesNaoPagos];
  const aReceber = aReceberLista.reduce((s,p)=>s+(Number(p.valor)||0),0);
  document.getElementById('num-areceber').textContent = moeda(aReceber);
  const pendentesNaoPagos = pendentesEntrega.filter(p => !foiPago(p));
  const detalheReceber = entreguesNaoPagos.length
    ? `${pendentesNaoPagos.length} em aberto · ${entreguesNaoPagos.length} entregue(s) sem pagar`
    : `${pendentesNaoPagos.length} pedido(s) em aberto`;
  document.getElementById('info-areceber').textContent = detalheReceber;

  // Card 3: atraso LOGÍSTICO. Pagamento vencido é outro conceito e aparece
  // no Financeiro/atalho de cobrança. Assim o número bate com Entregas.
  const entregasAtrasadas = todosOsPedidos.filter(p => isEntregaAtrasada(p));
  const valorEntregasAtrasadas = entregasAtrasadas.reduce((s,p)=>s+(Number(p.valor)||0),0);
  document.getElementById('num-atrasados').textContent = entregasAtrasadas.length;
  document.getElementById('info-atrasados').textContent = entregasAtrasadas.length
    ? moeda(valorEntregasAtrasadas) : 'Tudo em dia ✓';

  // Card 4: clientes com pelo menos um pedido no histórico.
  const clientesAtivos = new Set(todosOsPedidos.map(p => p.cliente_id)).size;
  document.getElementById('num-clientes').textContent = clientesAtivos;
  document.getElementById('info-clientes').textContent = `${todosOsClientes.length} cadastrados`;

  // ATALHOS — badges
  const pagamentosAtrasados = todosOsPedidos.filter(p => isPagamentoAtrasado(p));
  document.getElementById('badge-cobrar').textContent = pagamentosAtrasados.length || '';

  // GRÁFICO de vendas dos últimos 30 dias
  renderizarGraficoVendas('grafico-vendas', 'grafico-total-30d', null);

  // TOP CLIENTES do mês
  renderizarTopClientes('top-clientes', pedidosMes);

  // TOP PRODUTOS do mês
  renderizarTopProdutos('top-produtos', pedidosMes);

  // PERFORMANCE dos vendedores no mês
  renderizarPerformanceVendedores('performance-vendedores', pedidosMes);

  // PRÓXIMAS ENTREGAS
  const proximas = pendentesEntrega.slice().sort((a,b)=>(a.data_entrega||'').localeCompare(b.data_entrega||'')).slice(0,5);
  const elProx = document.getElementById('lista-proximas');
  if (!proximas.length) {
    elProx.innerHTML = `<div class="vazio"><div class="vazio-icone">✅</div><p>Sem entregas pendentes</p></div>`;
  } else {
    elProx.innerHTML = proximas.map(p => cardEntrega(p, false)).join('');
  }
}

// ============================================================
// DASHBOARD VENDEDOR (tela própria de início)
// ============================================================
function renderizarInicioVendedor() {
  if (usuario?.perfil !== 'vendedor') return;
  const { inicioMes, inicioMesPassado, inicioProximoMes } = periodoMesBrasil();

  const meusPedidos = todosOsPedidos.filter(p => p.vendedor === usuario.login);
  const meusPedidosMes = meusPedidos.filter(p => {
    const data = dataRealEntrega(p);
    return p.status === 'entregue' && foiPago(p) && data &&
      data >= inicioMes && data < inicioProximoMes;
  });
  const meusPedidosMesAnt = meusPedidos.filter(p => {
    const data = dataRealEntrega(p);
    return p.status === 'entregue' && foiPago(p) && data &&
      data >= inicioMesPassado && data < inicioMes;
  });
  const minhasVendas = meusPedidosMes.reduce((s,p)=>s+(Number(p.valor)||0),0);
  const vendasAnt = meusPedidosMesAnt.reduce((s,p)=>s+(Number(p.valor)||0),0);

  document.getElementById('v-vendas-mes').textContent = moeda(minhasVendas);
  const tend = document.getElementById('v-tendencia');
  if (vendasAnt > 0) {
    const pct = ((minhasVendas - vendasAnt) / vendasAnt * 100).toFixed(0);
    const sinal = pct >= 0 ? '↑' : '↓';
    const classe = pct > 0 ? 'alta' : pct < 0 ? 'baixa' : 'neutro';
    tend.className = 'resumo-tendencia ' + classe;
    tend.textContent = `${sinal} ${Math.abs(pct)}% vs mês anterior`;
  } else {
    tend.className = 'resumo-tendencia neutro';
    tend.textContent = minhasVendas > 0 ? 'Primeiro mês' : 'Sem vendas ainda';
  }

  // Pendentes
  document.getElementById('v-pendentes').textContent =
    meusPedidos.filter(p => p.status === 'pendente').length;

  // Entregues no mês
  document.getElementById('v-entregues').textContent = meusPedidosMes.length;

  // Clientes inativos (vendedor): clientes que ele já atendeu mas não compram há +30d
  const limite = new Date(); limite.setDate(limite.getDate() - 30);
  const meusClientesIds = new Set(meusPedidos.map(p => p.cliente_id));
  const inativos = [];
  meusClientesIds.forEach(cid => {
    const ult = meusPedidos
      .filter(p => p.cliente_id === cid && p.data_entrega)
      .sort((a,b)=>(b.data_entrega||'').localeCompare(a.data_entrega||''))[0];
    if (ult && new Date(ult.data_entrega+'T12:00:00') < limite) {
      const c = todosOsClientes.find(x => x.id === cid);
      if (c) inativos.push({ cliente: c, ultimoPedido: ult });
    }
  });
  document.getElementById('v-inativos').textContent = inativos.length;

  // Gráfico de vendas pessoal
  renderizarGraficoVendas('v-grafico-vendas', 'v-grafico-total', usuario.login);

  // Meus melhores clientes (todo tempo)
  const porCli = Object.create(null);
  meusPedidos.filter(p=>p.status==='entregue').forEach(p => {
    if (!porCli[p.cliente_id]) porCli[p.cliente_id] = { nome:p.cliente_nome, total:0, qtd:0 };
    porCli[p.cliente_id].total += Number(p.valor) || 0;
    porCli[p.cliente_id].qtd++;
  });
  const topCli = Object.values(porCli).sort((a,b)=>b.total-a.total).slice(0,5);
  const elTop = document.getElementById('v-top-clientes');
  if (!topCli.length) {
    elTop.innerHTML = `<div class="ranking-vazio">Ainda sem vendas fechadas</div>`;
  } else {
    elTop.innerHTML = topCli.map((c,i)=>`
      <div class="ranking-item">
        <div class="ranking-pos pos-${i+1}">${i+1}º</div>
        <div class="ranking-info">
          <div class="ranking-nome">${esc(c.nome)}</div>
          <div class="ranking-sub">${c.qtd} pedido(s)</div>
        </div>
        <div class="ranking-valor">${moeda(c.total)}</div>
      </div>`).join('');
  }

  // Clientes inativos
  const elInat = document.getElementById('v-clientes-inativos');
  if (!inativos.length) {
    elInat.innerHTML = `<div class="ranking-vazio">Todos os seus clientes estão ativos! 🎉</div>`;
  } else {
    elInat.innerHTML = inativos.slice(0,8).map(({cliente,ultimoPedido}) => {
      const dias = Math.floor((new Date() - new Date(ultimoPedido.data_entrega+'T12:00:00'))/(1000*60*60*24));
      const wa = (cliente.whatsapp||'').replace(/\D/g,'');
      const msg = `Olá ${cliente.responsavel || cliente.nome}, tudo bem? Faz um tempo que não passamos por aí! Precisa repor algum produto da KG Agropet? 🌿`;
      const link = wa ? `https://wa.me/55${wa}?text=${encodeURIComponent(msg)}` : '';
      return `
        <div class="ranking-item" style="gap:10px;flex-wrap:wrap">
          <div class="ranking-info">
            <div class="ranking-nome">${esc(cliente.nome)}</div>
            <div class="ranking-sub">Última compra: ${dataBR(ultimoPedido.data_entrega)} · ${dias} dias atrás</div>
          </div>
          ${link ? `<a href="${link}" target="_blank" rel="noopener" class="btn-whatsapp-aviso">📲 Reativar</a>` : ''}
        </div>`;
    }).join('');
  }
}

// vendedorLogin: se passado, filtra só por esse vendedor
// ============================================================
function renderizarGraficoVendas(idDiv, idTotal, vendedorLogin) {
  const dias = 30;
  const agora = new Date();
  const mapa = Object.create(null);
  for (let i = dias-1; i >= 0; i--) {
    const d = new Date(agora);
    d.setDate(d.getDate() - i);
    mapa[fmt(d)] = 0;
  }
  let total = 0;
  todosOsPedidos.forEach(p => {
    const data = dataRealEntrega(p);
    if (p.status !== 'entregue' || !foiPago(p) || !data) return;
    if (vendedorLogin && p.vendedor !== vendedorLogin) return;
    if (mapa[data] !== undefined) {
      const v = Number(p.valor) || 0;
      mapa[data] += v;
      total += v;
    }
  });
  const valores = Object.values(mapa);
  const maxV = Math.max(...valores, 1);
  const el = document.getElementById(idDiv);
  el.innerHTML = valores.map((v, i) => {
    const altura = (v / maxV * 100).toFixed(0);
    const data = Object.keys(mapa)[i];
    const dataBR_ = dataBR(data);
    const cls = v === 0 ? 'grafico-barra zero' : 'grafico-barra';
    return `<div class="${cls}" style="height:${altura}%"><div class="grafico-tooltip">${dataBR_} · ${moeda(v)}</div></div>`;
  }).join('');
  document.getElementById(idTotal).textContent = moeda(total);
}

// ============================================================
// TOP CLIENTES do mês
// ============================================================
function renderizarTopClientes(idDiv, pedidosMes) {
  const totalPorCliente = Object.create(null);
  pedidosMes.forEach(p => {
    if (!totalPorCliente[p.cliente_id]) {
      totalPorCliente[p.cliente_id] = { nome: p.cliente_nome, total: 0, qtd: 0 };
    }
    totalPorCliente[p.cliente_id].total += Number(p.valor) || 0;
    totalPorCliente[p.cliente_id].qtd++;
  });
  const top = Object.values(totalPorCliente).sort((a,b)=>b.total-a.total).slice(0,5);
  const el = document.getElementById(idDiv);
  if (!top.length) {
    el.innerHTML = `<div class="ranking-vazio">Nenhuma venda fechada este mês ainda</div>`;
    return;
  }
  el.innerHTML = top.map((c, i) => `
    <div class="ranking-item">
      <div class="ranking-pos pos-${i+1}">${i+1}º</div>
      <div class="ranking-info">
        <div class="ranking-nome">${esc(c.nome)}</div>
        <div class="ranking-sub">${c.qtd} pedido(s)</div>
      </div>
      <div class="ranking-valor">${moeda(c.total)}</div>
    </div>`).join('');
}

// ============================================================
// TOP PRODUTOS do mês
// ============================================================
function renderizarTopProdutos(idDiv, pedidosMes) {
  const totalPorProduto = Object.create(null);
  pedidosMes.forEach(p => {
    (p.itens || []).forEach(it => {
      const nome = it.nome || 'Produto';
      if (!totalPorProduto[nome]) totalPorProduto[nome] = { qtd: 0, valor: 0 };
      totalPorProduto[nome].qtd += Number(it.qtd) || 0;
      totalPorProduto[nome].valor += (Number(it.qtd) || 0) * (Number(it.preco_unit) || 0);
    });
  });
  const top = Object.entries(totalPorProduto)
    .map(([nome, d]) => ({ nome, ...d }))
    .sort((a,b) => b.valor - a.valor)
    .slice(0, 5);
  const el = document.getElementById(idDiv);
  if (!top.length) {
    el.innerHTML = `<div class="ranking-vazio">Sem vendas este mês ainda</div>`;
    return;
  }
  el.innerHTML = top.map((p, i) => `
    <div class="ranking-item">
      <div class="ranking-pos pos-${i+1}">${i+1}º</div>
      <div class="ranking-info">
        <div class="ranking-nome">${esc(p.nome)}</div>
        <div class="ranking-sub">${p.qtd} unidade(s)</div>
      </div>
      <div class="ranking-valor">${moeda(p.valor)}</div>
    </div>`).join('');
}

// ============================================================
// PERFORMANCE dos vendedores
// ============================================================
function renderizarPerformanceVendedores(idDiv, pedidosMes) {
  const porVendedor = Object.create(null);
  pedidosMes.forEach(p => {
    const v = p.vendedor || '—';
    if (!porVendedor[v]) porVendedor[v] = { qtd: 0, valor: 0 };
    porVendedor[v].qtd++;
    porVendedor[v].valor += Number(p.valor) || 0;
  });
  const lista = Object.entries(porVendedor)
    .map(([v,d]) => ({ vendedor: v, ...d }))
    .sort((a,b) => b.valor - a.valor);
  const el = document.getElementById(idDiv);
  if (!lista.length) {
    el.innerHTML = `<div class="ranking-vazio">Nenhuma venda fechada este mês ainda</div>`;
    return;
  }
  el.innerHTML = lista.map((v, i) => {
    const emoji = v.vendedor === 'admin' ? '👑' : v.vendedor === 'vendedor' ? '🤝' : '👤';
    const nomeBonito = v.vendedor === 'admin' ? 'Admin (Kleber)' :
                       v.vendedor === 'vendedor' ? 'Vendedor' : v.vendedor;
    return `
      <div class="ranking-item">
        <div class="ranking-pos pos-${i+1}">${emoji}</div>
        <div class="ranking-info">
          <div class="ranking-nome">${esc(nomeBonito)}</div>
          <div class="ranking-sub">${v.qtd} pedido(s) fechado(s)</div>
        </div>
        <div class="ranking-valor">${moeda(v.valor)}</div>
      </div>`;
  }).join('');
}

// ============================================================
// ATALHO: Cobrar todos os atrasados (gera lista de WhatsApps)
// ============================================================
function cobrarTodosAtrasados() {
  const atras = todosOsPedidos.filter(p => isPagamentoAtrasado(p));
  if (!atras.length) {
    toast('🎉 Nenhum pagamento atrasado no momento!');
    return;
  }
  // Agrupa por cliente
  const porCliente = Object.create(null);
  atras.forEach(p => {
    if (!porCliente[p.cliente_id]) {
      const c = todosOsClientes.find(x => x.id === p.cliente_id);
      porCliente[p.cliente_id] = { cliente: c, total: 0, pedidos: [] };
    }
    porCliente[p.cliente_id].total += Number(p.valor) || 0;
    porCliente[p.cliente_id].pedidos.push(p);
  });

  // Abre modal com lista de clientes para cobrar
  const lista = Object.values(porCliente).sort((a,b)=>b.total-a.total);
  const html = `
    <div style="margin-bottom:14px;color:var(--c2);font-size:13px">
      Clique no botão de WhatsApp ao lado de cada cliente para enviar a cobrança personalizada.
    </div>
    ${lista.map(({cliente,total,pedidos}) => {
      const wa = (cliente?.whatsapp || '').replace(/\D/g,'');
      // Usa a MESMA mensagem completa da ficha do cliente (saudação por hora,
      // pedidos com vencimento, nota de mensagem automática) — antes o atalho
      // enviava um texto genérico diferente, inconsistente com o resto do app.
      const msg = montarMensagemCobranca(cliente || {}, pedidos, total);
      const link = wa ? `https://wa.me/55${wa}?text=${encodeURIComponent(msg)}` : '';
      return `
        <div style="background:rgba(10,26,16,.5);border:1px solid var(--ol);border-radius:var(--r);
                    padding:12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:140px">
            <div style="font-size:14px;font-weight:700;color:var(--creme)">${esc(cliente?.nome || 'Cliente')}</div>
            <div style="font-size:11px;color:var(--c3);margin-top:3px">${pedidos.length} pedido(s) · ${moeda(total)}</div>
          </div>
          ${link
            ? `<a href="${link}" target="_blank" rel="noopener" class="btn-whatsapp-aviso">📲 Cobrar</a>`
            : `<span style="font-size:11px;color:var(--c3)">Sem WhatsApp</span>`}
        </div>`;
    }).join('')}
  `;
  // A janela é a mesma do detalhe do pedido: sem o pedido anterior, nem os botões dele
  // (via, desfazer entrega), nem a atualização automática que traria o pedido de volta.
  const modal = document.getElementById('modal-detalhe-pedido');
  delete modal.dataset.registroId;
  const acoesVia = document.getElementById('detalhe-pedido-acoes-via');
  if (acoesVia) acoesVia.innerHTML = '';
  document.getElementById('detalhe-pedido-titulo').textContent = `📲 Cobrar Atrasados (${lista.length} cliente${lista.length>1?'s':''})`;
  document.getElementById('detalhe-pedido-conteudo').innerHTML = html;
  abrirModal('modal-detalhe-pedido');
}

// ============================================================
// RESET HISTÓRICO DE PEDIDOS (admin only, dupla confirmação)
// ============================================================
// Cópia de segurança obrigatória: o reset só apaga os pedidos que estão na
// cópia baixada, e a cópia vem do servidor (nunca da memória do aparelho).
let resetBackup = null; // { ids:[...], nome, quando }

function csvCelula(v) {
  let s = v == null ? '' : String(v);
  // Texto que começa com = + - @ viraria fórmula no Excel.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const csvNumero = n => (n == null || n === '' || Number.isNaN(Number(n))) ? '' : Number(n).toFixed(2).replace('.', ',');

// Uma linha por item do pedido (pedido sem itens vira uma linha só), em planilha.
function montarCsvBackup(pedidos) {
  const cab = ['Pedido', 'Cliente', 'Vendedor', 'Status', 'Data entrega prevista', 'Data entregue', 'Forma de pagamento',
    'Pagamento', 'Forma de pagamento real', 'Data pagamento', 'Vencimento', 'Valor do pedido', 'Produto', 'Qtd pedida',
    'Qtd entregue', 'Preço unitário', 'Subtotal', 'Observação'];
  const linhas = [cab];
  for (const p of pedidos) {
    const base = [p.id, p.clientes?.nome || p.cliente_nome || '', p.vendedor, p.status, p.data_entrega, p.data_entregue_em,
      p.forma_pagamento, p.status_pagamento, p.forma_pagamento_real, p.data_pagamento, p.data_vencimento];
    const itens = p.itens_pedido || p.itens || [];
    if (!itens.length) { linhas.push([...base, csvNumero(p.valor), '', '', '', '', '', p.observacao]); continue; }
    for (const i of itens) {
      linhas.push([...base, csvNumero(p.valor), i.nome, i.qtd_pedida ?? i.qtd, i.qtd, csvNumero(i.preco_unit),
        csvNumero(Number(i.qtd) * Number(i.preco_unit)), p.observacao]);
    }
  }
  // BOM + ponto e vírgula: o Excel em português abre direto, com acentos.
  return '﻿' + linhas.map(l => l.map(csvCelula).join(';')).join('\r\n');
}

function montarBackupPedidos(pedidos, quando = new Date()) {
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    .format(quando).replace(/[^\d]/g, '').replace(/^(\d{8})/, '$1-');
  const nome = `kg-backup-pedidos-${stamp}`;
  const ids = pedidos.map(p => Number(p.id)).filter(Number.isSafeInteger);
  const json = JSON.stringify({ gerado_em: quando.toISOString(), tabela: 'pedidos', total: pedidos.length, pedidos }, null, 1);
  return { nome, ids, json, csv: montarCsvBackup(pedidos) };
}

function baixarArquivoTexto(nomeArquivo, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function atualizarEstadoReset() {
  const qtd = document.getElementById('reset-qtd-pedidos');
  const status = document.getElementById('reset-backup-status');
  const btn = document.getElementById('btn-confirmar-reset');
  if (qtd) qtd.textContent = resetBackup ? resetBackup.ids.length : todosOsPedidos.length;
  if (status) {
    status.className = 'reset-backup-status' + (resetBackup ? ' ok' : '');
    status.textContent = resetBackup
      ? `✓ Cópia baixada (${resetBackup.ids.length} pedidos): ${resetBackup.nome}.csv e .json. Confira que os 2 arquivos estão no aparelho.`
      : 'Ainda não há cópia. O botão de apagar só libera depois dela.';
  }
  if (btn) btn.disabled = !resetBackup;
}

function abrirModalReset() {
  if (usuario?.perfil !== 'admin') {
    toast('Apenas o admin pode executar essa ação.');
    return;
  }
  resetBackup = null;
  document.getElementById('confirma-reset').value = '';
  atualizarEstadoReset();
  abrirModal('modal-reset');
}

async function baixarBackupReset() {
  if (salvando) return;
  if (usuario?.perfil !== 'admin') { toast('Apenas o admin pode executar essa ação.'); return; }
  const btn = document.getElementById('btn-backup-reset');
  salvando = true;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Preparando cópia…'; }
  try {
    let pedidos = todosOsPedidos;
    if (!MODO_DEMO) {
      if (!navigator.onLine) { toast('Sem internet. A cópia precisa vir do servidor; conecte-se e tente de novo.'); return; }
      await processarFilaOffline();
      if (lerFilaOffline().some(a => !a.falha && acaoOfflinePertenceAoUsuario(a))) {
        toast('Há entregas feitas sem internet que ainda não foram enviadas. Aguarde o envio antes de limpar.');
        return;
      }
      const res = await listarTodos('pedidos', '*,clientes(nome),itens_pedido(*)');
      if (!res.ok) { toast('Não consegui buscar os pedidos no servidor: ' + (res.erro || 'erro desconhecido')); return; }
      if (res.deCache) { toast('O servidor não respondeu; a cópia seria dos dados antigos. Tente de novo.'); return; }
      pedidos = res.dados;
    }
    if (!pedidos.length) { toast('Não há pedidos para apagar.'); return; }
    const copia = montarBackupPedidos(pedidos);
    baixarArquivoTexto(copia.nome + '.csv', copia.csv, 'text/csv;charset=utf-8');
    setTimeout(() => baixarArquivoTexto(copia.nome + '.json', copia.json, 'application/json'), 500);
    resetBackup = { ids: copia.ids, nome: copia.nome, quando: new Date() };
    atualizarEstadoReset();
    toast(`✓ Cópia de ${copia.ids.length} pedidos baixada. Se o navegador perguntar, permita os 2 downloads.`);
  } catch (e) {
    console.error('Erro ao gerar cópia:', e);
    toast('Erro ao gerar a cópia: ' + e.message);
  } finally {
    salvando = false;
    if (btn) { btn.disabled = false; btn.textContent = resetBackup ? '💾 Baixar a cópia de novo' : '💾 Baixar cópia dos pedidos'; }
  }
}

async function executarResetPedidos() {
  if (salvando) return;
  if (usuario?.perfil !== 'admin') {
    toast('Apenas o admin pode executar essa ação.');
    return;
  }
  if (!resetBackup) {
    toast('Baixe a cópia de segurança primeiro (passo 1).');
    return;
  }

  // CONFIRMAÇÃO 1: precisa digitar LIMPAR
  const confirma = document.getElementById('confirma-reset').value.trim().toUpperCase();
  if (confirma !== 'LIMPAR') {
    toast('Você precisa digitar exatamente a palavra "LIMPAR" para confirmar.');
    return;
  }

  // Só apaga o que está na cópia: pedido criado depois dela é preservado.
  const idsConfirmados = [...resetBackup.ids];
  const qtd = idsConfirmados.length;
  if (qtd === 0) {
    toast('Não há pedidos para apagar.');
    fecharModal('modal-reset');
    return;
  }

  // CONFIRMAÇÃO 2
  const ok = await confirmar(
    `⚠️ ÚLTIMA CONFIRMAÇÃO\n\n` +
    `Você vai apagar ${qtd} pedido(s) PERMANENTEMENTE.\n\n` +
    `A cópia "${resetBackup.nome}" (.csv e .json) já foi baixada.\n\n` +
    `Tem certeza absoluta?`
  );
  if (!ok) return;

  salvando = true;
  const btn = document.getElementById('btn-confirmar-reset');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Apagando, aguarde...'; }
  let qtdApagada = qtd;

  try {
    if (!MODO_DEMO) {
      // O servidor apaga somente os pedidos da cópia. Pedidos criados
      // simultaneamente em outro aparelho são preservados.
      const resPed = await apiSupabase('rpc/limpar_pedidos','POST',{ p_ids:idsConfirmados });
      if (!resPed.ok) {
        toast('Erro ao apagar pedidos.\n\nDetalhes: ' + (resPed.erro || 'desconhecido'));
        return;
      }
      qtdApagada = Number(resPed.dados);
      if (!Number.isSafeInteger(qtdApagada) || qtdApagada < 0) {
        toast('O servidor não confirmou quantos pedidos foram apagados. Os dados serão recarregados.');
        solicitarSincronizacao();
        return;
      }
    }

    // Limpa estado local
    const idsApagados = new Set(idsConfirmados);
    todosOsPedidos = todosOsPedidos.filter(p => !idsApagados.has(Number(p.id)));
    idsConfirmados.forEach(limparChecklist);
    resetBackup = null;

    fecharModal('modal-reset');

    registrarMudancaLocal('pedidos');

    toast(`✓ Histórico de ${qtdApagada} pedido(s) foi apagado com sucesso.\n\nClientes e produtos foram mantidos.`);
  } catch (e) {
    console.error('Erro ao resetar:', e);
    toast('Erro inesperado ao resetar: ' + e.message);
  } finally {
    salvando = false;
    if (btn) { btn.textContent = '🗑️ Sim, apagar tudo definitivamente'; btn.disabled = !resetBackup; }
  }
}

// ============================================================
// ENTREGAS (admin + entregador)
// ============================================================
function renderizarEntregas(filtro) {
  filtroEntregas = filtro;
  let lista;
  if (usuario.perfil==='entregador') {
    // Entregador vê TODOS os pedidos pendentes (não só os de hoje)
    lista = todosOsPedidos.filter(p => p.status==='pendente');
  } else {
    lista = filtro==='todos' ? todosOsPedidos.slice() : todosOsPedidos.filter(p => p.status===filtro);
  }

  // RESUMO DO DIA para entregador
  const resumoEnt = document.getElementById('resumo-entregador');
  if (resumoEnt) {
    if (usuario.perfil === 'entregador') {
      resumoEnt.classList.add('ativo');
      const fmtHoje = fmt(new Date());
      const pend = lista.filter(p => p.status === 'pendente');
      const hoje = pend.filter(p => p.data_entrega === fmtHoje);
      const valor = pend.reduce((s,p)=>s+(Number(p.valor)||0),0);
      document.getElementById('ent-num-pendentes').textContent = pend.length;
      document.getElementById('ent-num-hoje').textContent = hoje.length;
      document.getElementById('ent-valor-total').textContent = moeda(valor);
    } else {
      resumoEnt.classList.remove('ativo');
    }
  }

  // Ordena: pendentes pela data mais próxima; entregues pelas mais recentes
  // (assim, com a lista paginada, o que importa aparece primeiro)
  const dt = p => p.data_entrega || '';
  lista.sort((a,b) => {
    const ea = a.status === 'entregue', eb = b.status === 'entregue';
    if (ea !== eb) return ea ? 1 : -1;
    return ea ? dt(b).localeCompare(dt(a)) : dt(a).localeCompare(dt(b));
  });
  const el = document.getElementById('lista-entregas');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📭</div><p>Nenhuma entrega aqui</p></div>`;
    return;
  }

  // Modo rota: agrupa por bairro (entregador vê a rota inteira, sem paginar)
  if (modoEntregas === 'rota' && usuario.perfil === 'entregador') {
    el.innerHTML = renderizarRotaPorBairro(lista);
  } else if (usuario.perfil === 'entregador') {
    el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
  } else {
    // Admin: lista em lotes ("Ver mais"), pois pode ter centenas de pedidos
    const mostrar = lista.slice(0, entregasVisiveis);
    const restantes = lista.length - mostrar.length;
    el.innerHTML = mostrar.map(p => cardEntrega(p, true)).join('')
      + (restantes > 0
        ? `<button class="btn-ver-mais" onclick="verMaisEntregas()">
             Ver mais ${Math.min(restantes, ENTREGAS_LOTE)}
             <span class="ver-mais-cont">${restantes} restantes</span>
           </button>`
        : (lista.length > ENTREGAS_LOTE
            ? `<div class="fim-lista">Todas as ${lista.length} entregas exibidas</div>` : ''));
  }
}

// Quantas entregas aparecem por vez na lista do admin (igual ao catálogo)
const ENTREGAS_LOTE = 30;
let entregasVisiveis = ENTREGAS_LOTE;

function verMaisEntregas() {
  entregasVisiveis += ENTREGAS_LOTE;
  const y = window.scrollY;
  renderizarEntregas(filtroEntregas);
  window.scrollTo({ top: y, behavior: 'instant' }); // mantém a posição de leitura
}

// Endereço salvo: logradouro, número, bairro, município/UF, CEP.
function extrairBairro(endereco) {
  if (!endereco) return 'Sem endereço';
  const partes = endereco.split(',').map(s => s.trim()).filter(Boolean);
  const bairro = partes.length >= 3 ? partes[2].split(/\s+-\s+/)[0] : '';
  return bairro && !/^(CEP\b|\d{5}[- ]?\d{3}$)/i.test(bairro) ? bairro : 'Bairro não informado';
}

// Renderiza entregas agrupadas por bairro
function renderizarRotaPorBairro(lista) {
  const porBairro = Object.create(null);
  const clientesPorId = new Map(todosOsClientes.map(c => [c.id, c]));
  lista.forEach(p => {
    const cliente = clientesPorId.get(p.cliente_id);
    const bairro = extrairBairro(cliente?.endereco);
    if (!porBairro[bairro]) porBairro[bairro] = [];
    porBairro[bairro].push({ pedido: p, cliente });
  });
  // Ordena bairros alfabeticamente (mesmo bairro fica junto)
  const bairros = Object.keys(porBairro).sort();
  return bairros.map(bairro => {
    const itens = porBairro[bairro];
    const valor = itens.reduce((s,i)=>s+(Number(i.pedido.valor)||0),0);
    return `
      <div class="bairro-grupo">
        <div class="bairro-header">📍 ${esc(bairro)} (${itens.length} · ${moeda(valor)})</div>
        ${itens.map(i => cardEntrega(i.pedido, true, i.cliente)).join('')}
      </div>`;
  }).join('');
}

// Alterna modo lista vs rota
function alternarModoRota(modo, btn) {
  modoEntregas = modo;
  document.querySelectorAll('.aba-rota').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarEntregas(filtroEntregas);
}

function cardEntrega(p, mostrarBotoes, clienteOpc) {
  const atrasado = isEntregaAtrasada(p);
  const classe = p.status==='entregue' ? 'entregue' : (atrasado ? 'atrasado' : 'pendente');

  // Badge principal: status da entrega + status do pagamento (se entregue)
  let badge;
  if (p.status === 'entregue') {
    if (foiPago(p)) {
      badge = `<span class="badge badge-entregue">✓ Entregue + Pago</span>`;
    } else if (p.status_pagamento === 'recusado') {
      badge = `<span class="badge badge-pag-recusado">✓ Entregue · ✗ Não pagou</span>`;
    } else {
      // status_pagamento = 'pendente' ou pedido boleto entregue sem pagar
      badge = `<span class="badge badge-pag-pendente">✓ Entregue · ⏰ Aguardando pgto</span>`;
    }
  } else if (atrasado) {
    badge = `<span class="badge badge-atrasado">⚠ Atrasado</span>`;
  } else {
    badge = `<span class="badge badge-pendente">Pendente</span>`;
  }

  // Badge extra para ADMIN: indica se houve ajuste de preço em algum item
  let badgePrecoAjustado = '';
  if (usuario.perfil === 'admin' && temAjusteDePreco(p)) {
    badgePrecoAjustado = `<span class="badge badge-preco-ajustado" title="Preço ajustado pelo vendedor">⚠ Preço ajustado</span>`;
  }
  badge = badge + (badgePrecoAjustado ? ' ' + badgePrecoAjustado : '');

  // Itens do pedido: para ENTREGADOR em pedido PENDENTE, vira CHECKLIST interativo.
  // Para outros perfis ou pedido entregue, mostra como texto corrido (mesmo de antes).
  let conteudoLinha;
  const ehEntregadorChecklist = usuario.perfil === 'entregador' && p.status === 'pendente' && p.itens?.length;
  if (ehEntregadorChecklist) {
    const marcados = getChecklist(p.id);
    const totalItens = p.itens.length;
    const qtdMarcados = p.itens.filter(i => marcados.has(Number(i.produto_id))).length;
    const completo = qtdMarcados === totalItens && totalItens > 0;
    conteudoLinha = `
      <div class="checklist-header">
        <span class="checklist-titulo">🚚 Conferência de carga</span>
        <span class="checklist-contador ${completo ? 'completo' : ''}">${qtdMarcados}/${totalItens}</span>
      </div>
      <ul class="checklist-itens">
        ${p.itens.map(i => {
          const pid = Number(i.produto_id);
          const marcado = marcados.has(pid);
          return `<li class="check-item ${marcado ? 'marcado' : ''}"
                       onclick="toggleChecklistItem(${p.id}, ${pid}, this)">
            <span class="check-box" aria-hidden="true"></span>
            <span class="check-txt">${esc(`${i.qtd}x ${i.nome || i.produto_nome || ''}`)}</span>
          </li>`;
        }).join('')}
      </ul>`;
  } else if (p.itens?.length) {
    conteudoLinha = `<div class="item-sub">${p.itens.map(i => esc(`${i.qtd}x ${i.nome || i.produto_nome || ''}`)).join(' · ')}</div>`;
  } else {
    conteudoLinha = `<div class="item-sub">${esc(p.descricao)}</div>`;
  }

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

  // Botões extras para entregador: Maps e WhatsApp
  const cliente = clienteOpc || todosOsClientes.find(c => c.id === p.cliente_id);
  let acoesEntregador = '';
  if (usuario.perfil === 'entregador' && cliente && p.status === 'pendente') {
    const end = cliente.endereco;
    const wa = (cliente.whatsapp || '').replace(/\D/g,'');
    const mapsLink = end ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end)}` : '';
    const msgWa = `Olá ${cliente.responsavel || cliente.nome}! Aqui é da KG Agropet. Estou a caminho com seu pedido. Até já! 🚚`;
    const waLink = wa ? `https://wa.me/55${wa}?text=${encodeURIComponent(msgWa)}` : '';
    acoesEntregador = `
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        ${mapsLink ? `<a href="${mapsLink}" target="_blank" rel="noopener" class="btn-maps">🗺️ Abrir no Maps</a>` : ''}
        ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener" class="btn-whatsapp-aviso">📲 Avisar cliente</a>` : ''}
      </div>`;
  }

  const enderecoHtml = (usuario.perfil === 'entregador' && cliente?.endereco)
    ? `<div style="font-size:11px;color:var(--c2);margin-top:4px">📍 ${esc(cliente.endereco)}</div>` : '';

  const botoes = (mostrarBotoes && p.status==='pendente') ? `
    ${acoesEntregador}
    <div class="item-acoes">
      ${botaoEntregar}
      ${botaoEditar}
      <button class="btn-obs" onclick="verDetalhePedido(${p.id})" aria-label="Ver detalhes do pedido" title="Ver detalhes">👁</button>
      ${botaoExcluir}
    </div>` : (mostrarBotoes && p.status==='entregue'
    ? `<div class="item-acoes"><button class="btn-sm" onclick="verDetalhePedido(${p.id})">Ver detalhes</button></div>` : '');

  return `
    <div class="item-card stagger-in ${classe}">
      <div class="item-header">
        <div class="item-nome">${esc(p.cliente_nome)}</div>
        ${badge}
      </div>
      ${conteudoLinha}
      ${enderecoHtml}
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
  entregasVisiveis = ENTREGAS_LOTE; // trocar de aba recomeça do início
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
// Quantos produtos aparecem por vez no catálogo (lista completa).
// 24 = ~6 telas de rolagem no celular: dá pra escanear rápido sem
// virar maratona de cliques. A busca NÃO usa paginação (já filtra).
const CATALOGO_LOTE = 24;
let catalogoVisiveis = CATALOGO_LOTE;

function renderizarCatalogo(filtro) {
  filtroCatalogo = filtro;
  catalogoVisiveis = CATALOGO_LOTE; // toda troca de aba recomeça do início
  _pintarCatalogo();
}

// Mostra mais um lote (botão "Ver mais")
function verMaisCatalogo() {
  catalogoVisiveis += CATALOGO_LOTE;
  _pintarCatalogo(true);
}

function _pintarCatalogo(manterScroll) {
  const filtro = filtroCatalogo;
  let lista = filtro==='todos' ? todosOsProdutos.slice() : todosOsProdutos.filter(p => p.categoria===filtro);
  lista.sort((a,b) => a.nome.localeCompare(b.nome));
  const el = document.getElementById('lista-catalogo');
  const isAdmin = usuario.perfil==='admin';

  // Mostra o toggle só pro admin
  const toggle = document.getElementById('toggle-margem-catalogo');
  if (toggle) toggle.style.display = isAdmin ? '' : 'none';

  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📦</div><p>Nenhum produto aqui</p></div>`;
    return;
  }

  const y = manterScroll ? window.scrollY : null;
  const mostrar  = lista.slice(0, catalogoVisiveis);
  const restantes = lista.length - mostrar.length;

  el.innerHTML = mostrar.map(p => montarCardProduto(p, isAdmin)).join('')
    + (restantes > 0
      ? `<button class="btn-ver-mais" onclick="verMaisCatalogo()">
           Ver mais ${Math.min(restantes, CATALOGO_LOTE)}
           <span class="ver-mais-cont">${restantes} restantes</span>
         </button>`
      : (lista.length > CATALOGO_LOTE
          ? `<div class="fim-lista">Todos os ${lista.length} produtos exibidos</div>` : ''));

  // Ao carregar mais, mantém a posição de leitura (não pula pro topo)
  if (y !== null) window.scrollTo({ top: y, behavior: 'instant' });
}

// Helper para montar card de produto (usado em renderizar e buscar)
function montarCardProduto(p, isAdmin, termoBusca = '') {
  const custo = Number(p.preco_custo) || 0;
  const preco = Number(p.preco) || 0;

  // Linha de custo/margem (só admin + toggle ligado)
  let custoMargemHtml = '';
  if (isAdmin && mostrarMargem) {
    if (custo > 0 && preco > 0) {
      const lucro = preco - custo;
      const pct = (lucro / custo * 100);
      let cls = 'margem-pill';
      if (lucro < 0) cls += ' negativa';
      else if (pct < 20) cls += ' baixa';
      custoMargemHtml = `
        <div class="produto-custo-info">
          <span class="custo-val">Custo: ${moeda(custo)}</span>
          <span class="${cls}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% (${moeda(lucro)})</span>
        </div>`;
    } else {
      custoMargemHtml = `
        <div class="produto-custo-info">
          <span class="custo-val" style="font-style:italic">Custo não cadastrado</span>
        </div>`;
    }
  }

  const botoesAdmin = isAdmin ? `
    <div class="row-gap" style="margin-top:10px">
      <button class="btn-sm" onclick="verDetalheProduto(${p.id})" aria-label="Ver detalhes" title="Ver detalhes e histórico">📊 Detalhes</button>
      <button class="btn-sm" onclick="abrirModalProduto(${p.id})" aria-label="Editar produto">✏️ Editar</button>
      <button class="btn-perigo" style="width:auto;padding:7px 12px;font-size:12px" onclick="excluirProduto(${p.id})" aria-label="Excluir produto" title="Excluir">🗑️</button>
    </div>` : '';

  // Aplica highlight no nome se houver termo de busca
  const nomeHtml = termoBusca ? highlightBusca(p.nome, termoBusca) : esc(p.nome);

  return `
    <div class="item-produto-card stagger-in">
      <div class="flex-entre" style="margin-bottom:6px">
        <div class="produto-nome">${nomeHtml}</div>
        ${badgeCategoria(p.categoria)}
      </div>
      <div class="produto-meta">
        <span class="produto-preco">${moeda(preco)}</span>
      </div>
      ${custoMargemHtml}
      ${botoesAdmin}
    </div>`;
}

function filtrarCatalogo(filtro, btn) {
  document.querySelectorAll('#abas-catalogo .aba').forEach(b => b.classList.remove('ativa'));
  btn.classList.add('ativa');
  renderizarCatalogo(filtro);
}

function _buscarProdutoImpl(termo) {
  const t = termo || '';
  const lista = todosOsProdutos.filter(p =>
    matchBusca(t, p.nome, p.categoria || '')
  );
  const el = document.getElementById('lista-catalogo');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">🔍</div><p>Nenhum produto encontrado</p></div>`;
    return;
  }
  const isAdmin = usuario.perfil==='admin';
  el.innerHTML = lista.map(p => montarCardProduto(p, isAdmin, t)).join('');
}

// ============================================================
// CATÁLOGO NO MODAL DE PEDIDO (busca + carrinho)
// ============================================================
function _buscarProdutoModalImpl(termo) {
  const t = termo || '';
  const lista = todosOsProdutos.filter(p =>
    matchBusca(t, p.nome, p.categoria || '')
  );
  const el = document.getElementById('lista-produto-modal');
  if (!lista.length) {
    el.innerHTML=`<div style="padding:12px;text-align:center;font-size:13px;color:var(--c3)">Nenhum produto encontrado</div>`;
    return;
  }
  el.innerHTML = lista.map(p => {
    const noCarrinho = carrinho.find(c => c.produto.id===p.id);
    const jaAdicionado = noCarrinho ? `<span style="font-size:11px;color:var(--gn)">✓ ${noCarrinho.qtd}x</span>` : '';
    const nomeHtml = t ? highlightBusca(p.nome, t) : esc(p.nome);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 10px;
                  background:rgba(10,26,16,.5);border:1px solid var(--ol);border-radius:10px;margin-bottom:6px">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--creme)">${nomeHtml}</div>
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
    // Ao adicionar, guarda DOIS valores:
    // - preco_unit: o que será cobrado do cliente (pode ser ajustado)
    // - preco_catalogo: valor de referência do catálogo (para detectar ajustes)
    carrinho.push({
      produto: p,
      qtd: 1,
      preco_unit: Number(p.preco) || 0,
      preco_catalogo: Number(p.preco) || 0,
    });
  }
  renderizarCarrinho();
  // Atualiza a lista para mostrar quantidade adicionada
  const buscaEl = document.getElementById('busca-produto-modal');
  const termo = buscaEl ? buscaEl.value : '';
  buscarProdutoModal(termo);
}

function alterarQtdCarrinho(idx, delta) {
  if (!carrinho[idx]) return;
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
  el.innerHTML = carrinho.map((c, idx) => {
    // Compat com itens carregados de pedidos antigos que não têm preco_unit/preco_catalogo
    const precoUnit = (c.preco_unit != null) ? Number(c.preco_unit) : Number(c.produto.preco) || 0;
    const precoCat  = (c.preco_catalogo != null) ? Number(c.preco_catalogo) : Number(c.produto.preco) || 0;
    const ajustado = Math.abs(precoUnit - precoCat) > 0.001;
    const subtotal = precoUnit * c.qtd;
    total += subtotal;

    // Visual do preço: se ajustado, mostra original riscado + novo
    const precoVisual = ajustado
      ? `<span class="preco-original-riscado">${moeda(precoCat)}</span><span class="preco-ajustado-novo">${moeda(precoUnit)}</span> cada`
      : `${moeda(precoUnit)} cada`;

    return `
      <div class="carrinho-item">
        <div class="carrinho-info">
          <div class="carrinho-nome">${esc(c.produto.nome)}</div>
          <div class="carrinho-preco-unit">${precoVisual}</div>
          <button class="btn-ajustar-preco ${ajustado ? 'preco-mudou' : ''}" onclick="abrirAjustePreco(${idx})">
            ✏️ ${ajustado ? 'Preço ajustado' : 'Ajustar preço'}
          </button>
        </div>
        <div class="carrinho-controle">
          <div class="carrinho-qtd">
            <button class="btn-qtd" onclick="alterarQtdCarrinho(${idx},-1)" aria-label="Diminuir 1">−</button>
            <input type="number" class="qtd-input" value="${c.qtd}" min="1" step="1"
                   inputmode="numeric"
                   onchange="definirQtdCarrinho(${idx}, this.value)"
                   onfocus="this.select()">
            <button class="btn-qtd" onclick="alterarQtdCarrinho(${idx},1)" aria-label="Aumentar 1">+</button>
          </div>
          <div class="carrinho-acoes">
            <div class="carrinho-subtotal">${moeda(subtotal)}</div>
            <button class="btn-remover" onclick="removerDoCarrinho(${idx})" aria-label="Remover produto">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
  totalEl.textContent = moeda(total);
}

// Permite definir quantidade exata digitando
function definirQtdCarrinho(idx, valorStr) {
  if (!carrinho[idx]) return;
  const qtd = Number(valorStr);
  if (!Number.isSafeInteger(qtd) || qtd < 1 || qtd > 2147483647) {
    toast('Informe uma quantidade inteira válida.');
    renderizarCarrinho();
    return;
  }
  carrinho[idx].qtd = qtd;
  renderizarCarrinho();
  const termo = document.getElementById('busca-produto-modal').value;
  buscarProdutoModal(termo);
}

// Remove totalmente o produto do carrinho
function removerDoCarrinho(idx) {
  if (!carrinho[idx]) return;
  carrinho.splice(idx, 1);
  renderizarCarrinho();
  const termo = document.getElementById('busca-produto-modal').value;
  buscarProdutoModal(termo);
}

// ============================================================
// AJUSTE DE PREÇO POR PEDIDO (vendedor/admin)
// ============================================================
function abrirAjustePreco(idx) {
  if (idx < 0 || idx >= carrinho.length) return;
  ajusteCarrinhoIdx = idx;
  const c = carrinho[idx];
  const precoUnit = Number(c.preco_unit) || 0;
  const precoCat  = Number(c.preco_catalogo) || 0;

  document.getElementById('ajustar-preco-info').innerHTML = `
    <div style="font-weight:700;color:var(--o1);margin-bottom:4px">${esc(c.produto.nome)}</div>
    <div style="font-size:12px;color:var(--c3)">📁 Preço do catálogo: ${moeda(precoCat)}</div>
    <div style="font-size:12px;color:var(--c3);margin-top:2px">📦 Quantidade no pedido: ${c.qtd}x</div>`;

  const input = document.getElementById('ajustar-preco-input');
  input.value = precoUnit.toFixed(2);
  atualizarDiferencaPreco();
  abrirModal('modal-ajustar-preco');
  // Foco + seleciona o valor para edição rápida
  setTimeout(() => { input.focus(); input.select(); }, 80);
}

function atualizarDiferencaPreco() {
  if (ajusteCarrinhoIdx == null) return;
  const c = carrinho[ajusteCarrinhoIdx];
  if (!c) return;
  const precoCat = Number(c.preco_catalogo) || 0;
  const novoStr = document.getElementById('ajustar-preco-input').value.replace(',', '.');
  const novo = parseFloat(novoStr);
  const diffEl = document.getElementById('ajustar-preco-diferenca');
  if (!diffEl) return;

  if (isNaN(novo) || precoCat <= 0) {
    diffEl.style.display = 'none';
    return;
  }
  const diff = novo - precoCat;
  const pct = (diff / precoCat) * 100;
  diffEl.style.display = 'block';
  diffEl.classList.remove('subiu', 'desceu', 'igual');

  if (Math.abs(diff) < 0.005) {
    diffEl.classList.add('igual');
    diffEl.textContent = '✓ Mesmo preço do catálogo';
  } else if (diff > 0) {
    diffEl.classList.add('subiu');
    diffEl.textContent = `↑ ${moeda(diff)} acima (+${pct.toFixed(0)}%) · Subtotal: ${moeda(novo * c.qtd)}`;
  } else {
    diffEl.classList.add('desceu');
    diffEl.textContent = `↓ ${moeda(Math.abs(diff))} de desconto (${pct.toFixed(0)}%) · Subtotal: ${moeda(novo * c.qtd)}`;
  }
}

function confirmarAjustePreco() {
  if (ajusteCarrinhoIdx == null) return;
  const c = carrinho[ajusteCarrinhoIdx];
  if (!c) return;
  const novoStr = document.getElementById('ajustar-preco-input').value.replace(',', '.');
  const novo = Number(novoStr);
  if (!novoStr.trim() || !Number.isFinite(novo) || novo < 0) {
    toast('Informe um preço válido (maior ou igual a zero).');
    return;
  }
  c.preco_unit = Math.round((novo + Number.EPSILON) * 100) / 100;
  ajusteCarrinhoIdx = null;
  fecharModal('modal-ajustar-preco');
  renderizarCarrinho();
}

function resetarPrecoCatalogo() {
  if (ajusteCarrinhoIdx == null) return;
  const c = carrinho[ajusteCarrinhoIdx];
  if (!c) return;
  c.preco_unit = Number(c.preco_catalogo) || 0;
  ajusteCarrinhoIdx = null;
  fecharModal('modal-ajustar-preco');
  renderizarCarrinho();
}

// ============================================================
// CLIENTES
// ============================================================
function renderizarClientes(lista, termoBusca = '') {
  const el = document.getElementById('lista-clientes');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">🏪</div><p>Nenhum cliente cadastrado</p></div>`;
    return;
  }
  const dividaPorCliente = new Map();
  for (const p of todosOsPedidos) {
    if (!foiPago(p)) dividaPorCliente.set(p.cliente_id,
      (dividaPorCliente.get(p.cliente_id) || 0) + (Number(p.valor) || 0));
  }
  el.innerHTML = lista.map(c => {
    // "Em aberto" = tudo que ainda não foi PAGO (inclui entregue sem pagar),
    // mesma régua do Financeiro — antes usava só o status de entrega e divergia.
    const devendo = dividaPorCliente.get(c.id) || 0;
    const badge = devendo>0
      ? `<span class="badge badge-devendo">${moeda(devendo)} em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    const nomeHtml = termoBusca ? highlightBusca(c.nome, termoBusca) : esc(c.nome);
    const responsavelHtml = termoBusca ? highlightBusca(c.responsavel || '–', termoBusca) : esc(c.responsavel || '–');
    const whatsappHtml = termoBusca ? highlightBusca(c.whatsapp || '–', termoBusca) : esc(c.whatsapp || '–');
    return `
      <div class="item-cliente-card stagger-in" onclick="verDetalheCliente(${c.id})">
        <div>
          <div class="cliente-nome">${nomeHtml}</div>
          <div class="cliente-info">${responsavelHtml} · ${whatsappHtml}</div>
        </div>
        ${badge}
      </div>`;
  }).join('');
}

function _buscarClienteImpl(termo) {
  const t = termo || '';
  const filtrados = todosOsClientes.filter(c =>
    matchBusca(t, c.nome, c.responsavel, c.whatsapp, c.endereco, c.email, c.cnpj_cpf)
  );
  renderizarClientes(filtrados, t);
}

function verDetalheCliente(id) {
  const c = todosOsClientes.find(x => x.id===id);
  if (!c) return;
  clienteSelecionado = c;
  document.getElementById('modal-detalhe-cliente').dataset.registroId = String(id);
  const pedidos = todosOsPedidos.filter(p => p.cliente_id===id);

  // Formata documento de acordo com o tipo
  let docFmt = '';
  if (c.cnpj_cpf) {
    docFmt = (c.tipo_pessoa === 'fisica')
      ? `🆔 CPF: ${mascaraCPF(c.cnpj_cpf)}`
      : `🏢 CNPJ: ${mascaraCNPJ(c.cnpj_cpf)}`;
  }

  // Monta linhas só com o que tem (não polui com "–" vazios)
  const linhas = [];
  if (docFmt) linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">${docFmt}</div>`);
  if (c.responsavel)        linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">👤 ${esc(c.responsavel)}</div>`);
  if (c.whatsapp)           linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">📲 ${esc(mascaraTelefone(c.whatsapp))}</div>`);
  if (c.email)              linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">📧 ${esc(c.email)}</div>`);
  if (c.endereco)           linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">📍 ${esc(c.endereco)}</div>`);
  if (c.inscricao_estadual) linhas.push(`<div style="font-size:13px;color:var(--c2);margin-bottom:5px">🏷️ IE: ${esc(c.inscricao_estadual)}</div>`);
  if (c.observacao)         linhas.push(`<div style="font-size:13px;color:var(--c2);margin-top:8px;padding-top:8px;border-top:1px solid var(--ol);font-style:italic">📝 ${esc(c.observacao)}</div>`);

  document.getElementById('detalhe-cliente-nome').textContent = c.nome;
  document.getElementById('detalhe-cliente-conteudo').innerHTML = `
    <div style="background:rgba(10,26,16,.6);border:1px solid var(--ol);border-radius:var(--r);padding:13px;margin-bottom:14px">
      ${linhas.length ? linhas.join('') : '<div style="font-size:12px;color:var(--c3);font-style:italic">Sem informações adicionais cadastradas.</div>'}
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
    ${(usuario.perfil==='admin' || usuario.perfil==='vendedor') ? `<button class="btn-azul w100 mt-12" onclick="fecharModal('modal-detalhe-cliente'); abrirModalNovoCliente(${c.id})">✏️ Editar cliente</button>` : ''}
    ${usuario.perfil==='admin' ? `<button class="btn-perigo w100 mt-8" onclick="fecharModal('modal-detalhe-cliente'); excluirCliente(${c.id})">Excluir cliente</button>` : ''}`;
  abrirModal('modal-detalhe-cliente');
}

// ============================================================
// FINANCEIRO (admin)
// ============================================================
function renderizarFinanceiro(filtro) {
  filtroFinanceiro = filtro;
  const porCliente = Object.create(null);
  todosOsClientes.forEach(c => { porCliente[c.id]={ cliente:c, pedidos:[] }; });
  todosOsPedidos.forEach(p => { if (porCliente[p.cliente_id]) porCliente[p.cliente_id].pedidos.push(p); });

  let totalDev=0, totalRec=0;
  const mes = fmt(new Date()).slice(0,7);
  Object.values(porCliente).forEach(({pedidos}) => {
    pedidos.forEach(p => {
      // DEVE: ainda não foi pago de verdade (pendente OU entregue sem pagar)
      if (!foiPago(p)) totalDev += Number(p.valor)||0;
      // RECEBIDO: foi pago de fato, no mês atual (usa data_pagamento se houver, senão data_entrega)
      else {
        const dataRef = p.data_pagamento || dataRealEntrega(p);
        if (dataRef?.startsWith(mes)) totalRec += Number(p.valor)||0;
      }
    });
  });
  document.getElementById('fin-total-devendo').textContent  = moeda(totalDev);
  document.getElementById('fin-total-recebido').textContent = moeda(totalRec);

  const lista = Object.values(porCliente).filter(({pedidos}) => {
    const dev  = pedidos.filter(p => !foiPago(p));
    const atras= dev.filter(p => isPagamentoAtrasado(p));
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
    const dev  = pedidos.filter(p => !foiPago(p));
    const atras= dev.filter(p => isPagamentoAtrasado(p));
    const totalD = dev.reduce((s,p)=>s+(Number(p.valor)||0),0);
    const badge = atras.length>0
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : totalD>0 ? `<span class="badge badge-devendo">Em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    const info = atras.length ? `${atras.length} pagamento(s) atrasado(s)`
               : dev.length  ? `${dev.length} pagamento(s) em aberto` : 'Sem pendências';
    return `
      <div class="item-cliente-card stagger-in" onclick="verFinanceiroCliente(${c.id})">
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

// Baixa de pagamento: quais pedidos o cliente pagou e como. Fica fora da tela
// porque a janela é redesenhada quando chegam dados novos, e a escolha em
// andamento não pode se perder.
let finSelecionados = new Set(); // ids dos pedidos marcados como pagos
let finForma = '';               // 'dinheiro' | 'pix' | 'cheque'
const FIN_FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX / Cartão', cheque: 'Cheque' };
const FIN_ICONES = { dinheiro: '💵', pix: '💳', cheque: '📝' };

function statusPedidoAberto(p) {
  if (isPagamentoAtrasado(p)) return '<span style="color:#e05a4e;font-weight:700">⚠ Atrasado</span>';
  if (p.status_pagamento === 'recusado') return '<span style="color:#ee7d6f;font-weight:700">✗ Cliente não pagou na entrega</span>';
  if (p.status !== 'entregue') return '<span style="color:#f4a04a;font-weight:700">📦 Ainda não entregue</span>';
  return '';
}

function verFinanceiroCliente(id) {
  const c = todosOsClientes.find(x => x.id===id);
  if (!c) return;
  const modal = document.getElementById('modal-fin-cliente');
  // Redesenho por atualização automática mantém a escolha; abrir outro cliente começa limpo.
  const mesmaJanela = modal.classList.contains('aberto') && clienteSelecionado?.id === id;
  clienteSelecionado = c;
  modal.dataset.registroId = String(id);
  // Cobrança = tudo que ainda não foi PAGO (inclui entregue sem pagar —
  // que é justamente quem mais precisa ser cobrado)
  const pedidos = todosOsPedidos.filter(p => p.cliente_id===id && !foiPago(p));
  if (!mesmaJanela) { finSelecionados = new Set(); finForma = ''; }
  // Pedido quitado em outro aparelho sai da escolha.
  finSelecionados = new Set([...finSelecionados].filter(pid => pedidos.some(p => p.id === pid)));
  const total = pedidos.reduce((s,p)=>s+(Number(p.valor)||0),0);
  const wa = (c.whatsapp||'').replace(/\D/g,'');

  // Monta mensagem de cobrança pronta e inteligente
  const msgCobranca = montarMensagemCobranca(c, pedidos, total);
  const linkWa = wa ? `https://wa.me/55${wa}?text=${encodeURIComponent(msgCobranca)}` : '';

  document.getElementById('fin-cliente-nome').textContent = c.nome;
  document.getElementById('fin-cliente-conteudo').innerHTML = `
    <div style="font-size:13px;color:var(--c2);margin-bottom:14px">📱 ${esc(c.whatsapp||'–')}</div>
    <div class="separador">Pagamentos em aberto</div>
    ${pedidos.length ? `
      <div class="fin-instrucao">Marque só os pedidos que o cliente pagou agora.</div>
      <div class="fin-selecao-atalhos">
        <button type="button" onclick="selecionarPedidosPagos(true)">Marcar todos</button>
        <button type="button" onclick="selecionarPedidosPagos(false)">Limpar</button>
      </div>
      ${pedidos.map(p=>`
      <label class="fin-pedido">
        <input type="checkbox" data-pedido="${esc(p.id)}" onchange="alternarPedidoPago(${Number(p.id)}, this.checked)"${finSelecionados.has(p.id) ? ' checked' : ''}>
        <span class="fin-pedido-corpo">
          <span class="flex-entre">
            <span style="font-size:13px;color:var(--creme)">${esc(p.descricao)}</span>
            <span style="font-size:14px;font-weight:700;color:#e05a4e">${moeda(p.valor)}</span>
          </span>
          <span style="display:block;font-size:12px;color:var(--c3);margin-top:3px">
            Pedido nº ${esc(p.id)} · Venc.: ${dataBR(p.data_vencimento)} ${statusPedidoAberto(p) ? '· ' + statusPedidoAberto(p) : ''}
          </span>
        </span>
      </label>`).join('')}`
    : '<div class="vazio" style="padding:20px"><p>Sem pagamentos em aberto</p></div>'}
    <div style="margin-top:12px;font-weight:700;color:var(--o1);font-size:15px">Total em aberto: ${moeda(total)}</div>
    ${pedidos.length ? `
      <div class="fin-forma-bloco">
        <label class="bloco-pagto-label">💰 Como o cliente pagou? <span class="campo-obrig">*</span></label>
        <div class="pagto-recebido-grupo">
          ${Object.entries(FIN_FORMAS).map(([valor, rotulo]) => `
          <button type="button" class="pagto-recebido pagto-pago${finForma === valor ? ' ativo' : ''}" data-forma="${valor}" onclick="escolherFormaPaga('${valor}')">
            <span class="pagto-recebido-icone">${FIN_ICONES[valor]}</span>
            <span class="pagto-recebido-label">${esc(rotulo)}</span>
          </button>`).join('')}
        </div>
      </div>
      <div id="fin-resumo-selecao" class="fin-resumo-selecao" role="status" aria-live="polite"></div>` : ''}
    ${linkWa?`<a href="${linkWa}" target="_blank" rel="noopener"
      style="display:block;margin-top:12px;background:var(--gnb);color:var(--gn);border:1px solid rgba(39,174,96,.3);
             border-radius:var(--r);padding:12px;text-align:center;text-decoration:none;font-weight:700;font-size:14px">
      📲 Enviar cobrança no WhatsApp</a>`:''}`;
  atualizarResumoPagos();
  abrirModal('modal-fin-cliente');
}

// Pedidos em aberto do cliente que está na janela.
function pedidosAbertosDoCliente() {
  if (!clienteSelecionado) return [];
  return todosOsPedidos.filter(p => p.cliente_id === clienteSelecionado.id && !foiPago(p));
}

function atualizarResumoPagos() {
  const el = document.getElementById('fin-resumo-selecao');
  if (!el) return;
  const marcados = pedidosAbertosDoCliente().filter(p => finSelecionados.has(p.id));
  if (!marcados.length) { el.className = 'fin-resumo-selecao'; el.textContent = 'Nenhum pedido marcado.'; return; }
  const totalC = marcados.reduce((s, p) => s + Math.round((Number(p.valor) || 0) * 100), 0);
  el.className = 'fin-resumo-selecao ativo';
  el.textContent = `${marcados.length} pedido(s) marcado(s): ${moeda(totalC / 100)}`;
}

function alternarPedidoPago(id, marcado) {
  if (marcado) finSelecionados.add(id); else finSelecionados.delete(id);
  atualizarResumoPagos();
}

function selecionarPedidosPagos(todos) {
  finSelecionados = new Set(todos ? pedidosAbertosDoCliente().map(p => p.id) : []);
  document.querySelectorAll('#fin-cliente-conteudo input[data-pedido]').forEach(inp => {
    inp.checked = finSelecionados.has(Number(inp.dataset.pedido));
  });
  atualizarResumoPagos();
}

function escolherFormaPaga(forma) {
  if (!FIN_FORMAS[forma]) return;
  finForma = forma;
  document.querySelectorAll('#fin-cliente-conteudo .pagto-recebido').forEach(b => {
    b.classList.toggle('ativo', b.dataset.forma === forma);
  });
}

// Monta uma mensagem de cobrança pronta, educada e detalhada.
// Lista cada pedido com vencimento, marca atrasados e fecha com o total.
function montarMensagemCobranca(cliente, pedidos, total) {
  const saudacao = obterSaudacao(); // Bom dia / Boa tarde / Boa noite
  const nome = cliente.responsavel || cliente.nome || 'cliente';

  // Se tem mais de um pedido, lista item por item
  let corpo;
  if (pedidos.length === 1) {
    const p = pedidos[0];
    const atrasado = isPagamentoAtrasado(p);
    // NÃO usar esc() aqui: mensagem de WhatsApp é texto puro, não HTML —
    // esc() faria "Ração & Cia" virar "Ração &amp; Cia" na conversa.
    corpo = atrasado
      ? `Consta em nosso sistema um pagamento *em atraso* referente ao pedido de ${p.descricao}, no valor de *${moeda(p.valor)}*, com vencimento em ${dataBR(p.data_vencimento)}.`
      : `Passando para lembrar do pagamento referente ao pedido de ${p.descricao}, no valor de *${moeda(p.valor)}*, com vencimento em ${dataBR(p.data_vencimento)}.`;
  } else {
    const linhas = pedidos.map(p => {
      const flag = isPagamentoAtrasado(p) ? ' ⚠ (em atraso)' : '';
      return `• ${p.descricao} — ${moeda(p.valor)} (venc. ${dataBR(p.data_vencimento)})${flag}`;
    }).join('\n');
    const temAtraso = pedidos.some(p => isPagamentoAtrasado(p));
    corpo = `${temAtraso ? 'Constam alguns pagamentos pendentes' : 'Segue um resumo dos pagamentos em aberto'} referentes aos seus pedidos:\n\n${linhas}\n\n*Total: ${moeda(total)}*`;
  }

  return `${saudacao}, ${nome}! 🌿\n\nAqui é da *KG Agropet*. ${corpo}\n\nQualquer dúvida estou à disposição. Agradecemos a preferência! 🙏\n\n_Mensagem automática de lembrete. Se já efetuou o pagamento, por favor desconsidere._ 😊`;
}

// Retorna saudação conforme a hora do dia
function obterSaudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

async function marcarPagoCliente() {
  if (salvando) return;
  if (!clienteSelecionado) return;
  const cliente = clienteSelecionado;
  const abertos = pedidosAbertosDoCliente();
  if (!abertos.length) { fecharModal('modal-fin-cliente'); return; }
  // Só o que foi marcado na tela: quitar um pedido não pode quitar os outros do cliente.
  const paraPagar = abertos.filter(p => finSelecionados.has(p.id));
  if (!paraPagar.length) { toast('Marque os pedidos que o cliente pagou.'); return; }
  if (!FIN_FORMAS[finForma]) { toast('Escolha como o cliente pagou: dinheiro, PIX / Cartão ou cheque.'); return; }
  const forma = finForma;
  const totalC = paraPagar.reduce((s, p) => s + Math.round((Number(p.valor) || 0) * 100), 0);
  const naoEntregues = paraPagar.filter(p => p.status !== 'entregue');
  const ok = await confirmar(
    `Marcar como PAGO ${paraPagar.length} pedido(s) de "${cliente.nome}"?\n\n` +
    `Pedido(s) nº ${paraPagar.map(p => p.id).join(', ')}\n` +
    `Total: ${moeda(totalC / 100)}\n` +
    `Forma: ${FIN_FORMAS[forma]}` +
    (naoEntregues.length ? `\n\n⚠ ${naoEntregues.length} ainda não foi entregue (pagamento adiantado). A entrega continua pendente.` : '')
  );
  if (!ok) return;
  salvando = true;
  botaoSalvando('marcarPagoCliente', true, '✓ Marcar como Pago');
  try {
    const hojeStr = fmt(new Date());
    // IMPORTANTE: baixa manual só mexe no PAGAMENTO. O status de ENTREGA não
    // muda — pedido pago adiantado continua aparecendo para o entregador.
    const payload = {
      status_pagamento: 'pago',
      forma_pagamento_real: forma,
      data_pagamento: hojeStr,
    };
    let confirmados = paraPagar;
    if (!MODO_DEMO) {
      // Uma única instrução evita baixa parcial se a conexão cair entre pedidos.
      // O filtro "ainda não pago" impede sobrescrever um pagamento que outro
      // aparelho registrou enquanto esta janela estava aberta.
      const ids = paraPagar.map(p => Number(p.id)).filter(Number.isFinite);
      const res = await apiSupabase('pedidos','PATCH', payload,
        `?id=in.(${ids.join(',')})&or=(status_pagamento.is.null,status_pagamento.neq.pago)`);
      if (!res.ok || !Array.isArray(res.dados)) { toast('Erro ao atualizar. Tente novamente.'); return; }
      const porId = new Map(res.dados.map(p => [Number(p.id), p]));
      paraPagar.forEach(p => { if (porId.has(Number(p.id))) Object.assign(p, porId.get(Number(p.id))); });
      confirmados = paraPagar.filter(p => porId.has(Number(p.id)));
      if (confirmados.length !== ids.length) {
        toast(`Só ${confirmados.length} de ${ids.length} pedido(s) foram atualizados: os outros já tinham sido pagos ou mudaram. Os dados serão recarregados.`);
        solicitarSincronizacao();
      }
    } else {
      paraPagar.forEach(p => { Object.assign(p, payload); });
    }
    finSelecionados = new Set();
    fecharModal('modal-fin-cliente');
    registrarMudancaLocal('pedidos');
    if (confirmados.length === paraPagar.length) {
      const pagoC = confirmados.reduce((s, p) => s + Math.round((Number(p.valor) || 0) * 100), 0);
      toast(`✓ ${confirmados.length} pedido(s) de "${cliente.nome}" marcado(s) como pago: ${moeda(pagoC / 100)}`);
    }
  } finally {
    salvando = false;
    botaoSalvando('marcarPagoCliente', false, '✓ Marcar como Pago');
  }
}

// ============================================================
// MODAL NOVO PEDIDO
// ============================================================
let chaveNovoPedido = null;
function abrirModalNovoPedido(idEdit) {
  if (carregandoDados) { toast('Aguarde o carregamento das informações.'); return; }
  if (!idEdit) chaveNovoPedido = crypto.randomUUID();
  const hoje = fmt(new Date());
  document.getElementById('busca-produto-modal').value = '';
  document.getElementById('lista-produto-modal').innerHTML = '';

  // IMPORTANTE: popula o select de clientes ANTES de tentar definir o valor selecionado.
  // Sem isso, o .value é resetado quando innerHTML é reescrito depois.
  popularSelectClientes();

  if (idEdit) {
    // Modo edição
    const p = todosOsPedidos.find(x => x.id === idEdit);
    if (!p) { toast('Pedido não encontrado.'); return; }
    if (p.status === 'entregue') { toast('Pedido já entregue não pode ser editado.'); return; }
    if (!podeEditarPedido(p)) { toast('Você não tem permissão para editar este pedido.'); return; }

    pedidoEmEdicao = p;
    document.getElementById('modal-pedido-titulo').textContent = 'Editar Pedido';
    document.getElementById('pedido-data-entrega').value    = p.data_entrega || hoje;
    document.getElementById('pedido-cliente').value         = p.cliente_id || '';
    document.getElementById('pedido-obs').value             = p.observacao || '';

    // Forma de pagamento: usa o valor salvo, ou tenta deduzir, ou padrão "avista"
    const forma = p.forma_pagamento || (p.prazo_dias ? 'boleto' : 'avista');
    selecionarPagamento(forma);
    if (forma === 'boleto') {
      // Tenta ler parcelas múltiplas (prazos_boleto = "7,14") ou cai pra prazo_dias único antigo
      let prazos = [];
      if (p.prazos_boleto) {
        prazos = String(p.prazos_boleto).split(',').map(x => Number(x.trim())).filter(x => x > 0);
      } else if (p.prazo_dias) {
        prazos = [Number(p.prazo_dias)];
      }
      if (prazos.length) {
        definirQtdParcelas(prazos.length, prazos);
      }
    }

    // Carrinho com os itens atuais do pedido (AGRUPA duplicados de pedidos antigos)
    carrinho = [];
    (p.itens || []).forEach(it => {
      const prod = todosOsProdutos.find(x => x.id === it.produto_id);
      const produto = prod || { id: it.produto_id, nome: it.nome, preco: it.preco_unit };
      // Compat: itens antigos não têm preco_catalogo — usa o do catálogo atual ou o próprio preco_unit
      const precoUnit = Number(it.preco_unit ?? produto.preco ?? 0);
      const precoCat  = (it.preco_catalogo != null)
        ? Number(it.preco_catalogo)
        : (prod ? Number(prod.preco) : precoUnit);
      const existente = carrinho.find(c => c.produto.id === produto.id &&
        c.preco_unit === precoUnit && c.preco_catalogo === precoCat);
      if (existente) {
        existente.qtd += Number(it.qtd) || 0;
        // Mantém preço já carregado (não sobrescreve em duplicatas)
      } else {
        carrinho.push({
          produto,
          qtd: Number(it.qtd) || 0,
          preco_unit: precoUnit,
          preco_catalogo: precoCat,
        });
      }
    });
  } else {
    // Modo novo pedido
    pedidoEmEdicao = null;
    carrinho = [];
    document.getElementById('modal-pedido-titulo').textContent = 'Novo Pedido';
    document.getElementById('pedido-data-entrega').value    = hoje;
    document.getElementById('pedido-cliente').value = '';
    document.getElementById('pedido-obs').value = '';
    // Padrão: à vista, sem prazo selecionado
    selecionarPagamento('avista');
  }

  renderizarCarrinho();
  buscarProdutoModal('');
  abrirModal('modal-pedido');
}

// ============================================================
// FORMA DE PAGAMENTO + PARCELAMENTO (admin + vendedor)
// ============================================================
const PRAZOS_DISPONIVEIS = [7, 14, 21, 28];

function selecionarPagamento(valor) {
  const modal = document.querySelector('#modal-pedido .modal-sheet');
  if (!modal) return;
  modal.dataset.pagamento = valor;
  document.querySelectorAll('#pagto-grupo .pagto-opcao').forEach(b => {
    b.classList.toggle('ativo', b.dataset.valor === valor);
  });
  if (valor === 'boleto') {
    // Reset: 1 parcela com primeiro prazo livre
    definirQtdParcelas(1);
  } else {
    // Limpa o bloco de parcelas
    document.getElementById('parcelas-lista').innerHTML = '';
    const info = document.getElementById('prazo-info-venc');
    if (info) info.textContent = '';
  }
}

// Cria N selects de prazo (n=1,2,3 ou 4)
function definirQtdParcelas(n, prazosPredefinidos) {
  n = Math.min(4, Math.max(1, Number(n) || 1));
  document.querySelectorAll('.qtd-parc').forEach(b => {
    b.classList.toggle('ativo', Number(b.dataset.n) === n);
  });
  const lista = document.getElementById('parcelas-lista');
  if (!lista) return;

  // Sugere prazos sequenciais como padrão (7, 14, 21, 28...)
  const sugeridos = prazosPredefinidos || PRAZOS_DISPONIVEIS.slice(0, n);

  lista.innerHTML = Array.from({ length: n }, (_, i) => {
    const valorAtual = sugeridos[i] || PRAZOS_DISPONIVEIS[i] || 7;
    return `
      <div class="parcela-linha">
        <span class="parcela-num">${i + 1}ª</span>
        <select class="parcela-select" data-idx="${i}" onchange="atualizarParcelas()">
          ${PRAZOS_DISPONIVEIS.map(p =>
            `<option value="${p}" ${p === valorAtual ? 'selected' : ''}>${p} dias</option>`
          ).join('')}
        </select>
        <span class="parcela-data" id="parc-data-${i}"></span>
      </div>`;
  }).join('');

  atualizarParcelas();
}

// Lê todos os selects, valida e atualiza datas previstas
function atualizarParcelas() {
  const selects = document.querySelectorAll('.parcela-select');
  const dataEntrega = document.getElementById('pedido-data-entrega').value;
  const valores = Array.from(selects).map(s => Number(s.value));

  // Validação: não pode ter prazos repetidos
  const repetidos = new Set();
  const duplicados = new Set();
  valores.forEach(v => {
    if (repetidos.has(v)) duplicados.add(v);
    repetidos.add(v);
  });

  // Marca visualmente os selects inválidos
  selects.forEach((s, i) => {
    s.classList.toggle('invalido', duplicados.has(Number(s.value)));
    // Atualiza a data prevista de cada parcela
    const dataEl = document.getElementById(`parc-data-${i}`);
    if (dataEl && dataEntrega) {
      const d = new Date(dataEntrega + 'T12:00:00');
      d.setDate(d.getDate() + valores[i]);
      dataEl.textContent = d.toLocaleDateString('pt-BR');
    }
  });

  // Resumo final
  const info = document.getElementById('prazo-info-venc');
  if (info) {
    if (duplicados.size > 0) {
      info.style.color = '#e05a4e';
      info.textContent = `⚠ Não pode repetir o prazo (${[...duplicados].join(', ')} dias). Cada parcela precisa ter um prazo diferente.`;
    } else if (valores.length > 1) {
      info.style.color = '';
      info.textContent = `📅 ${valores.length}× boleto: ${valores.join(' + ')} dias`;
    } else {
      info.style.color = '';
      info.textContent = '';
    }
  }
}

// Lê estado atual do form de pagamento
function obterFormaPagamento() {
  const modal = document.querySelector('#modal-pedido .modal-sheet');
  const forma = modal?.dataset.pagamento || 'avista';
  if (forma !== 'boleto') {
    return { forma, prazo: null, prazos: [] };
  }
  const selects = document.querySelectorAll('.parcela-select');
  const prazos = Array.from(selects).map(s => Number(s.value));
  // Primeiro vencimento (compatibilidade com prazo_dias antigo)
  const primeiro = prazos[0] || null;
  return { forma, prazo: primeiro, prazos };
}

// Valida prazos do boleto (sem repetição)
function validarPrazosBoleto(prazos) {
  if (!prazos?.length) return 'Selecione pelo menos uma parcela.';
  const repetidos = prazos.filter((v, i) => prazos.indexOf(v) !== i);
  if (repetidos.length) {
    return `Não pode repetir o prazo de ${repetidos[0]} dias. Cada parcela precisa ter um prazo diferente.`;
  }
  const invalidos = prazos.filter(p => !PRAZOS_DISPONIVEIS.includes(p));
  if (invalidos.length) {
    return `Prazo inválido: ${invalidos.join(', ')}. Use apenas 7, 14, 21 ou 28 dias.`;
  }
  return null;
}

// Calcula data_vencimento com base na forma + primeiro prazo + data_entrega
function calcularDataVencimento(data_entrega, forma, prazo) {
  if (!data_entrega) return null;
  if (forma === 'boleto' && prazo) {
    const d = new Date(data_entrega + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + Number(prazo));
    return fmt(d);
  }
  // À vista e Cheque: vencimento = data do pedido
  return data_entrega;
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
  const selecionado = sel.value;
  sel.innerHTML = '<option value="">Selecionar cliente...</option>' +
    todosOsClientes.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('');
  sel.value = selecionado;
}

async function salvarPedido() {
  if (salvando) return;  // bloqueia double-click
  const cliente_id      = Number(document.getElementById('pedido-cliente').value);
  const data_entrega    = document.getElementById('pedido-data-entrega').value;
  const obs             = document.getElementById('pedido-obs').value.trim();
  const { forma, prazo, prazos } = obterFormaPagamento();

  if (!cliente_id || !data_entrega) { toast('Selecione o cliente e a data do pedido.'); return; }
  if (!carrinho.length) { toast('Adicione pelo menos um produto ao carrinho.'); return; }

  // Data no passado em pedido NOVO: quase sempre é erro de digitação no
  // seletor de data — avisa mas não bloqueia (pedido retroativo é legítimo).
  // Na EDIÇÃO não avisa: pedidos antigos têm data passada por natureza.
  if (!pedidoEmEdicao && data_entrega < fmt(new Date())) {
    const seguir = await confirmar(
      `⚠️ A data de entrega (${dataBR(data_entrega)}) já passou.\n\n` +
      `Salvar mesmo assim?`
    );
    if (!seguir) return;
  }

  // Validação: se boleto, valida prazos
  if (forma === 'boleto') {
    const erro = validarPrazosBoleto(prazos);
    if (erro) { toast(erro); return; }
  }

  // Calcula data de vencimento da PRIMEIRA parcela (compat)
  const data_vencimento = calcularDataVencimento(data_entrega, forma, prazo);
  // CSV das parcelas (vazio se não-boleto)
  const prazos_boleto = (forma === 'boleto' && prazos?.length) ? prazos.join(',') : null;

  salvando = true;
  botaoSalvando('salvarPedido', true, 'Salvar Pedido');
  try {
    await _executarSalvarPedido(cliente_id, data_entrega, data_vencimento, obs, forma, prazo, prazos_boleto);
  } catch (e) {
    console.error('Erro inesperado ao salvar pedido:', e);
    toast('Ocorreu um erro inesperado ao salvar o pedido.\n\nDetalhes: ' + (e.message || 'desconhecido') + '\n\nVerifique sua conexão e tente novamente.');
  } finally {
    salvando = false;
    botaoSalvando('salvarPedido', false, 'Salvar Pedido');
  }
}

async function _executarSalvarPedido(cliente_id, data_entrega, data_vencimento, obs, forma_pagamento, prazo_dias, prazos_boleto) {
  if (carrinho.some(c => !Number.isSafeInteger(c.qtd) || c.qtd < 1 || c.qtd > 2147483647 ||
      !Number.isFinite(Number(c.preco_unit ?? c.produto.preco)) || Number(c.preco_unit ?? c.produto.preco) < 0)) {
    toast('Revise as quantidades e preços do pedido.');
    return;
  }
  // Valor calculado com o preço EFETIVO (preco_unit), que pode ter sido ajustado
  const precoUnitDe = c => (c.preco_unit != null ? Number(c.preco_unit) : Number(c.produto.preco)) || 0;
  const precoCatDe  = c => (c.preco_catalogo != null ? Number(c.preco_catalogo) : Number(c.produto.preco)) || 0;
  const valor    = carrinho.reduce((s,c)=>s+(precoUnitDe(c)*c.qtd),0);
  const descricao= carrinho.map(c=>`${c.qtd}x ${c.produto.nome}`).join(', ');
  const cliente  = todosOsClientes.find(c=>c.id===cliente_id);
  const itens    = carrinho.map(c=>({
    produto_id: c.produto.id,
    nome: c.produto.nome,
    qtd: c.qtd,
    preco_unit: precoUnitDe(c),
    preco_catalogo: precoCatDe(c),
  }));

  if (pedidoEmEdicao && !podeEditarPedido(pedidoEmEdicao)) {
    toast('Pedido indisponível para edição.');
    return;
  }
  const idEdit = pedidoEmEdicao?.id || null;
  const dados = { cliente_id, data_entrega, data_vencimento: data_vencimento || null,
    observacao: obs, forma_pagamento, prazo_dias: prazo_dias || null,
    prazos_boleto: prazos_boleto || null };
  let salvo = { ...dados, id: idEdit || Date.now(), descricao, valor, itens,
    status:'pendente', vendedor:usuario.login };
  if (!MODO_DEMO) {
    const res = await apiSupabase('rpc/salvar_pedido','POST', {
      p_pedido: dados, p_itens: itens, p_id: idEdit, p_chave: chaveNovoPedido,
    });
    if (!res.ok || !res.dados?.id) {
      toast('Pedido não salvo. Seus itens continuam aqui para tentar novamente.\n\n' + (res.erro || 'Sem resposta do servidor.'));
      return;
    }
    salvo = res.dados;
  }
  salvo.cliente_nome = cliente?.nome || '–';
  const idx = todosOsPedidos.findIndex(p => p.id === salvo.id);
  if (idx >= 0) Object.assign(todosOsPedidos[idx], salvo);
  else todosOsPedidos.push(salvo);
  fecharModal('modal-pedido');
  registrarMudancaLocal('pedidos');
}

// ============================================================
// MODAL NOVO CLIENTE
// ============================================================
function abrirModalNovoCliente(idEdit) {
  const ids = ['cliente-nome','cliente-responsavel','cliente-whatsapp',
               'cliente-email','cliente-endereco','cliente-cnpj-cpf','cliente-ie','cliente-observacao'];

  if (idEdit) {
    // Modo edição
    const c = todosOsClientes.find(x => x.id === idEdit);
    if (!c) { toast('Cliente não encontrado.'); return; }
    clienteSelecionado = c;
    document.getElementById('cliente-modal-titulo').textContent = 'Editar Cliente';
    alternarTipoPessoa(c.tipo_pessoa || 'juridica');
    document.getElementById('cliente-nome').value           = c.nome || '';
    document.getElementById('cliente-responsavel').value    = c.responsavel || '';
    document.getElementById('cliente-whatsapp').value       = c.whatsapp ? mascaraTelefone(c.whatsapp) : '';
    document.getElementById('cliente-email').value          = c.email || '';
    document.getElementById('cliente-endereco').value       = c.endereco || '';
    document.getElementById('cliente-observacao').value     = c.observacao || '';

    // CNPJ/CPF: formata pela máscara correta conforme tipo
    const inputDoc = document.getElementById('cliente-cnpj-cpf');
    if (c.cnpj_cpf) {
      inputDoc.value = (c.tipo_pessoa === 'fisica') ? mascaraCPF(c.cnpj_cpf) : mascaraCNPJ(c.cnpj_cpf);
    } else {
      inputDoc.value = '';
    }

    // IE — restaurar estado
    const inputIE = document.getElementById('cliente-ie');
    const btnIsento = document.querySelector('.btn-isento');
    if ((c.inscricao_estadual || '').toUpperCase() === 'ISENTO') {
      inputIE.value = 'ISENTO';
      inputIE.disabled = true;
      btnIsento.classList.add('ativo');
    } else {
      inputIE.value = c.inscricao_estadual || '';
      inputIE.disabled = false;
      btnIsento.classList.remove('ativo');
    }
  } else {
    // Modo novo
    clienteSelecionado = null;
    document.getElementById('cliente-modal-titulo').textContent = 'Novo Cliente';
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const inputIE = document.getElementById('cliente-ie');
    const btnIsento = document.querySelector('.btn-isento');
    if (inputIE) inputIE.disabled = false;
    if (btnIsento) btnIsento.classList.remove('ativo');
    alternarTipoPessoa('juridica');
  }

  abrirModal('modal-cliente');
  aplicarMascarasCliente();

  // Esconde status de consulta anterior
  const statusEl = document.getElementById('cnpj-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.innerHTML = '';
  }
}

async function salvarCliente() {
  if (salvando) return;

  // Lê todos os campos
  const modal       = document.querySelector('#modal-cliente .modal-sheet');
  const tipo_pessoa = modal?.dataset.tipoPessoa || 'juridica';
  const nome        = document.getElementById('cliente-nome').value.trim();
  const responsavel = document.getElementById('cliente-responsavel').value.trim();
  const docRaw      = soDigitos(document.getElementById('cliente-cnpj-cpf').value);
  const whatsappRaw = soDigitos(document.getElementById('cliente-whatsapp').value);
  const email       = document.getElementById('cliente-email').value.trim();
  const endereco    = document.getElementById('cliente-endereco').value.trim();
  const ieRaw       = document.getElementById('cliente-ie').value.trim();
  const observacao  = document.getElementById('cliente-observacao').value.trim();

  // ==== VALIDAÇÕES OBRIGATÓRIAS ====
  if (!nome) {
    toast(tipo_pessoa === 'fisica' ? 'Informe o nome completo.' : 'Informe o nome da loja.');
    return;
  }
  if (!docRaw) {
    toast(`Informe o ${tipo_pessoa === 'fisica' ? 'CPF' : 'CNPJ'}.`);
    return;
  }
  if (tipo_pessoa === 'fisica' && !validarCPF(docRaw)) {
    toast('CPF inválido. Verifique se digitou corretamente.');
    return;
  }
  if (tipo_pessoa === 'juridica' && !validarCNPJ(docRaw)) {
    toast('CNPJ inválido. Verifique se digitou corretamente.');
    return;
  }
  if (!whatsappRaw) {
    toast('Informe o WhatsApp do cliente.');
    return;
  }
  if (whatsappRaw.length < 10) {
    toast('WhatsApp incompleto. Inclua o DDD + número.');
    return;
  }
  if (email && !validarEmail(email)) {
    toast('E-mail inválido. Verifique se digitou corretamente.');
    return;
  }

  salvando = true;
  botaoSalvando('salvarCliente', true, 'Salvar Cliente');
  try {
    // ==== EDIÇÃO ====
    if (clienteSelecionado) {
      const id = clienteSelecionado.id;
      const payload = {
        nome, responsavel,
        whatsapp: whatsappRaw,
        email: email || null,
        endereco,
        cnpj_cpf: docRaw,
        tipo_pessoa,
        inscricao_estadual: ieRaw || null,
        observacao: observacao || null,
      };
      if (!MODO_DEMO) {
        const res = await apiSupabase('clientes','PATCH', payload, `?id=eq.${id}`);
        if (!res.ok || res.count !== 1 || !res.dados?.[0]) {
          toast('Cliente não atualizado. Ele pode ter sido alterado ou removido em outra sessão.');
          solicitarSincronizacao();
          return;
        }
        Object.assign(payload, res.dados[0]);
      }
      const idx = todosOsClientes.findIndex(c => c.id === id);
      if (idx >= 0) Object.assign(todosOsClientes[idx], payload);

      // Atualiza cliente_nome nos pedidos relacionados (para refletir mudança de nome)
      todosOsPedidos.forEach(p => { if (p.cliente_id === id) p.cliente_nome = nome; });

      clienteSelecionado = null;
      fecharModal('modal-cliente');
      fecharModal('modal-detalhe-cliente');
      registrarMudancaLocal('clientes');
      return;
    }

    // ==== NOVO ====
    let novo = {
      nome, responsavel,
      whatsapp: whatsappRaw,
      email: email || null,
      endereco,
      cnpj_cpf: docRaw,
      tipo_pessoa,
      inscricao_estadual: ieRaw || null,
      observacao: observacao || null,
    };
    if (!MODO_DEMO) {
      const res = await apiSupabase('clientes','POST', novo);
      if (!res.ok || !res.dados?.[0]) {
        toast('Erro ao salvar.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
        return;
      }
      novo = res.dados[0];
    } else {
      novo.id = Date.now();
    }
    todosOsClientes.push(novo);
    fecharModal('modal-cliente');
    registrarMudancaLocal('clientes');
  } finally {
    salvando = false;
    botaoSalvando('salvarCliente', false, 'Salvar Cliente');
  }
}

async function excluirCliente(id) {
  if (salvando) return;
  const vinculados = todosOsPedidos.filter(p=>p.cliente_id===id);
  if (vinculados.length>0) {
    toast(`Este cliente tem ${vinculados.length} pedido(s) registrado(s) e não pode ser excluído. Isso preserva o histórico.`);
    return;
  }
  if (!await confirmar('Excluir este cliente? Esta ação não pode ser desfeita.')) return;
  salvando = true;
  try {
    if (!MODO_DEMO) {
      const res = await apiSupabase('clientes','DELETE',null,`?id=eq.${id}`);
      if (!res.ok || res.count !== 1) {
        toast('Cliente não excluído. Atualize os dados e tente novamente.');
        solicitarSincronizacao();
        return;
      }
    }
    todosOsClientes = todosOsClientes.filter(c=>c.id!==id);
    fecharModal('modal-detalhe-cliente');
    registrarMudancaLocal('clientes');
  } finally {
    salvando = false;
  }
}

// ============================================================
// MODAL CONFIRMAR ENTREGA
// ============================================================
// ------------------------------------------------------------
// ENTREGA PARCIAL: o que não chegou é cancelado e o cliente paga só o que
// recebeu. O entregador ajusta a quantidade entregue de cada item; o banco
// (rpc/concluir_entrega_parcial) reduz os itens e recalcula o valor.
// ------------------------------------------------------------
const chaveItemEntrega = (item, idx) => String(item.id != null ? item.id : 'n' + idx);
const centavosEntrega = v => Math.round((Number(v) || 0) * 100);
const chaveEntregue = e => String(e.id != null ? e.id : e.chave);

// Quantidades digitadas na tela, na ordem dos itens.
function lerItensEntrega() {
  return [...document.querySelectorAll('#entrega-itens-lista .entrega-item-qtd')].map(inp => ({
    id: inp.dataset.id === '' ? null : Number(inp.dataset.id),
    chave: inp.dataset.chave,
    qtd: Number(inp.dataset.max),
    qtd_entregue: inp.value.trim() === '' ? NaN : Number(inp.value),
  }));
}

const entregaInvalida = e => !Number.isInteger(e.qtd_entregue) || e.qtd_entregue < 0 || e.qtd_entregue > e.qtd;

function valorEntregaParcial(pedido, entregues) {
  const porChave = new Map(entregues.map(e => [chaveEntregue(e), e.qtd_entregue]));
  return (pedido.itens || []).reduce((soma, i, idx) => {
    const chave = chaveItemEntrega(i, idx);
    const qtd = porChave.has(chave) ? porChave.get(chave) : Number(i.qtd);
    return soma + centavosEntrega(i.preco_unit) * qtd;
  }, 0) / 100;
}

// Reflete no aparelho o que o banco faz: reduz/remove itens e recalcula o valor.
function aplicarEntregaParcialLocal(pedido, entregues) {
  const porChave = new Map(entregues.map(e => [chaveEntregue(e), Number(e.qtd_entregue)]));
  pedido.itens = (pedido.itens || []).flatMap((i, idx) => {
    const chave = chaveItemEntrega(i, idx);
    const qtd = porChave.has(chave) ? porChave.get(chave) : Number(i.qtd);
    if (!(qtd > 0)) return [];
    return [qtd < Number(i.qtd) ? { ...i, qtd, qtd_pedida: i.qtd_pedida ?? i.qtd } : i];
  });
  pedido.valor = pedido.itens.reduce((s, i) => s + centavosEntrega(i.preco_unit) * Number(i.qtd), 0) / 100;
  pedido.descricao = pedido.itens.map(i => `${i.qtd}x ${i.nome}`).join(', ');
}

function renderizarItensEntrega(p) {
  const bloco = document.getElementById('entrega-itens');
  const lista = document.getElementById('entrega-itens-lista');
  if (!bloco || !lista) return;
  const itens = p.itens || [];
  bloco.hidden = !itens.length;
  // Quem pagou adiantado teria pago mais do que recebeu: o admin ajusta o pedido antes.
  const travado = p.status_pagamento === 'pago';
  lista.innerHTML = itens.map((i, idx) => {
    const chave = chaveItemEntrega(i, idx);
    const nome = esc(i.nome || i.produto_nome || 'Produto');
    const chaveJs = esc(JSON.stringify(chave));
    return `
      <div class="entrega-item">
        <div class="entrega-item-info"><span class="entrega-item-nome">${nome}</span><small>pedido: ${esc(i.qtd)}</small></div>
        <div class="carrinho-qtd">
          <button type="button" class="btn-qtd" onclick="ajustarQtdEntrega(${chaveJs}, -1)" aria-label="Diminuir ${nome}"${travado ? ' disabled' : ''}>−</button>
          <input type="number" class="qtd-input entrega-item-qtd" inputmode="numeric" min="0" max="${esc(i.qtd)}" step="1" value="${esc(i.qtd)}"
            data-id="${i.id != null ? esc(i.id) : ''}" data-chave="${esc(chave)}" data-max="${esc(i.qtd)}"
            oninput="atualizarResumoEntrega()" aria-label="Quantidade entregue de ${nome}"${travado ? ' disabled' : ''}>
          <button type="button" class="btn-qtd" onclick="ajustarQtdEntrega(${chaveJs}, 1)" aria-label="Aumentar ${nome}"${travado ? ' disabled' : ''}>+</button>
        </div>
      </div>`;
  }).join('') + (travado
    ? '<div class="entrega-itens-resumo aviso">Pedido já pago adiantado. Para entregar menos, peça ao administrador para ajustar o pedido.</div>' : '');
  atualizarResumoEntrega();
}

function ajustarQtdEntrega(chave, delta) {
  const inp = [...document.querySelectorAll('#entrega-itens-lista .entrega-item-qtd')].find(x => x.dataset.chave === chave);
  if (!inp) return;
  const max = Number(inp.dataset.max);
  const atual = Number.isInteger(Number(inp.value)) && inp.value.trim() !== '' ? Number(inp.value) : max;
  inp.value = String(Math.min(max, Math.max(0, atual + delta)));
  atualizarResumoEntrega();
}

function atualizarResumoEntrega() {
  const resumo = document.getElementById('entrega-itens-resumo');
  const valorEl = document.getElementById('entrega-valor');
  const p = pedidoSelecionado;
  if (!resumo || !p) return;
  const entregues = lerItensEntrega();
  const define = (classe, texto) => { resumo.className = 'entrega-itens-resumo' + (classe ? ' ' + classe : ''); resumo.textContent = texto; };
  if (!entregues.length) { define('', ''); return; }
  if (entregues.some(entregaInvalida)) {
    if (valorEl) valorEl.textContent = moeda(p.valor);
    define('aviso', 'Confira as quantidades: use números inteiros de 0 até o que foi pedido.');
    return;
  }
  const novo = valorEntregaParcial(p, entregues);
  if (valorEl) valorEl.textContent = moeda(novo);
  if (entregues.every(e => e.qtd_entregue === 0)) {
    define('aviso', 'Nenhum item marcado como entregue. Se nada chegou ao cliente, não confirme a entrega.');
  } else if (entregues.some(e => e.qtd_entregue < e.qtd)) {
    define('aviso', `⚠ Entrega parcial: ${moeda(p.valor)} → ${moeda(novo)}. O que faltou será cancelado e o cliente paga só ${moeda(novo)}.`);
  } else {
    define('', '');
  }
}

function abrirModalEntrega(id) {
  const p = todosOsPedidos.find(x=>x.id===id);
  if (!p) return;
  pedidoSelecionado = p;

  // Verifica se este pedido precisa de confirmação de pagamento
  // Só para À VISTA e CHEQUE (boleto tem prazo, paga depois)
  const precisaPagamento = p.status_pagamento !== 'pago' &&
    (p.forma_pagamento === 'avista' || p.forma_pagamento === 'cheque');
  const modalSheet = document.querySelector('#modal-entrega .modal-sheet');
  if (modalSheet) {
    modalSheet.dataset.precisaPagamento = precisaPagamento ? '1' : '0';
    modalSheet.dataset.pagamentoEscolhido = ''; // reseta a escolha
  }
  // Limpa estado visual dos botões
  document.querySelectorAll('#modal-entrega .pagto-recebido').forEach(b => b.classList.remove('ativo'));

  // Texto adicional sobre a forma de pagamento
  let pagtoInfo = '';
  if (p.status_pagamento === 'pago') pagtoInfo = '<div style="margin-top:6px;font-size:12px;color:var(--gn)">✓ Pagamento já registrado — confirme apenas a entrega</div>';
  else if (p.forma_pagamento === 'avista') pagtoInfo = '<div style="margin-top:6px;font-size:12px;color:var(--o1)">💵 Pagamento à vista — confirme se recebeu</div>';
  else if (p.forma_pagamento === 'cheque') pagtoInfo = '<div style="margin-top:6px;font-size:12px;color:var(--o1)">📝 Pagamento em cheque — confirme se recebeu</div>';
  else if (p.forma_pagamento === 'boleto') {
    const prazos = p.prazos_boleto ? ` (${p.prazos_boleto.split(',').join('+')} dias)` : (p.prazo_dias ? ` (${p.prazo_dias} dias)` : '');
    pagtoInfo = `<div style="margin-top:6px;font-size:12px;color:var(--c3)">📄 Boleto${prazos} — pagamento por boleto</div>`;
  }

  document.getElementById('modal-entrega-info').innerHTML = `
    <strong style="color:var(--o1)">${esc(p.cliente_nome)}</strong>
    <div style="margin-top:5px;color:var(--c2)">${esc(p.descricao)}</div>
    <div style="margin-top:5px;color:var(--o1);font-weight:700" id="entrega-valor">${moeda(p.valor)}</div>
    <div style="margin-top:3px;font-size:12px;color:var(--c3)">Entrega prevista: ${dataBR(p.data_entrega)}</div>
    ${pagtoInfo}`;
  renderizarItensEntrega(p);
  document.getElementById('entrega-obs').value = p.observacao||'';
  abrirModal('modal-entrega');
}

// Marca qual opção de pagamento o entregador escolheu
function selecionarPagamentoRecebido(valor) {
  const modalSheet = document.querySelector('#modal-entrega .modal-sheet');
  if (!modalSheet) return;
  modalSheet.dataset.pagamentoEscolhido = valor;
  document.querySelectorAll('#modal-entrega .pagto-recebido').forEach(b => {
    b.classList.toggle('ativo', b.dataset.valor === valor);
  });
}

async function confirmarEntrega() {
  if (salvando) return;
  if (!pedidoSelecionado) return;
  if (pedidoSelecionado.status === 'entregue') {
    toast('Este pedido já foi entregue. A data original foi preservada.');
    return;
  }
  const obs = document.getElementById('entrega-obs').value.trim();
  const id  = pedidoSelecionado.id;

  // ====== ENTREGA PARCIAL: quantidade entregue de cada item ======
  const entregues = lerItensEntrega();
  if (entregues.some(entregaInvalida)) {
    toast('Confira as quantidades entregues: use números inteiros de 0 até o que foi pedido.');
    return;
  }
  if (entregues.length && entregues.every(e => e.qtd_entregue === 0)) {
    toast('Nenhum item foi marcado como entregue. Se nada chegou ao cliente, não confirme a entrega.');
    return;
  }
  const parcial = entregues.some(e => e.qtd_entregue < e.qtd);
  if (parcial && pedidoSelecionado.status_pagamento === 'pago') {
    toast('Este pedido já foi pago adiantado. Para entregar menos, peça ao administrador para ajustar o pedido.');
    return;
  }

  // ====== VALIDAÇÃO DE PAGAMENTO (à vista ou cheque) ======
  const modalSheet = document.querySelector('#modal-entrega .modal-sheet');
  const pagamentoJaRegistrado = pedidoSelecionado.status_pagamento === 'pago';
  const precisaPagamento = !pagamentoJaRegistrado && modalSheet?.dataset.precisaPagamento === '1';
  const pagtoEscolhido = modalSheet?.dataset.pagamentoEscolhido || '';

  if (precisaPagamento && !pagtoEscolhido) {
    toast(
      '⚠ Você precisa informar como o cliente pagou.\n\n' +
      'Escolha uma das 5 opções:\n' +
      '• 💵 Pagou em dinheiro\n' +
      '• 💳 PIX / Cartão\n' +
      '• 📝 Cheque\n' +
      '• ⏰ Vai pagar depois\n' +
      '• ✗ Não quis pagar'
    );
    return;
  }

  // Define os campos de pagamento que vão pro banco
  let status_pagamento = null;
  let forma_pagamento_real = null;
  let data_pagamento = null;

  if (pagamentoJaRegistrado) {
    status_pagamento = pedidoSelecionado.status_pagamento;
    forma_pagamento_real = pedidoSelecionado.forma_pagamento_real;
    data_pagamento = pedidoSelecionado.data_pagamento;
  } else if (precisaPagamento) {
    if (FIN_FORMAS[pagtoEscolhido]) {
      status_pagamento = 'pago';
      forma_pagamento_real = pagtoEscolhido;
      data_pagamento = fmt(new Date());
    } else if (pagtoEscolhido === 'pendente') {
      status_pagamento = 'pendente';
    } else if (pagtoEscolhido === 'recusado') {
      status_pagamento = 'recusado';
    }
  } else {
    // Boleto: a entrega não confirma o pagamento, fica pendente até a data
    status_pagamento = 'pendente';
  }

  // ====== VALIDAÇÃO DO CHECKLIST (só para entregador) ======
  if (usuario.perfil === 'entregador' && pedidoSelecionado.itens?.length) {
    const marcados = getChecklist(id);
    // Item que não chegou (quantidade 0) não precisa estar conferido na carga.
    const zerados = new Set(entregues.filter(e => e.qtd_entregue === 0).map(chaveEntregue));
    const aConferir = pedidoSelecionado.itens.filter((i, idx) => !zerados.has(chaveItemEntrega(i, idx)));
    const total = aConferir.length;
    const qtdMarcados = aConferir.filter(i => marcados.has(Number(i.produto_id))).length;
    if (qtdMarcados < total) {
      const faltam = total - qtdMarcados;
      const ok = await confirmar(
        `⚠ Atenção!\n\n` +
        `Faltam ${faltam} ${faltam === 1 ? 'item não conferido' : 'itens não conferidos'} ` +
        `na carga deste pedido.\n\n` +
        `Confirmar a entrega mesmo assim?`
      );
      if (!ok) return;
    }
  }

  if (parcial) {
    const novoValor = valorEntregaParcial(pedidoSelecionado, entregues);
    const ok = await confirmar(
      `⚠ Entrega PARCIAL\n\n` +
      `O que não chegou será CANCELADO. O pedido passa de ${moeda(pedidoSelecionado.valor)} ` +
      `para ${moeda(novoValor)} e o cliente paga só o que recebeu.\n\n` +
      `Confirmar a entrega parcial?`
    );
    if (!ok) return;
  }

  salvando = true;
  botaoSalvando('confirmarEntrega', true, '✓ Confirmar Entrega');
  try {
    const payload = {
      ...dadosEntregaConcluida(),
      observacao: obs,
      status_pagamento,
      forma_pagamento_real,
      data_pagamento,
    };
    // Só na entrega parcial: quanto chegou de cada item.
    const itensEntregues = parcial ? entregues.map(e => ({ id: e.id, qtd_entregue: e.qtd_entregue })) : null;
    const acaoFila = { tipo: 'marcar-entregue', pedidoId: id, payload, ...(itensEntregues ? { itensEntregues } : {}) };
    let respostaServidor = null;

    if (!MODO_DEMO) {
      // Se está offline, enfileira em vez de tentar enviar (e falhar)
      if (!navigator.onLine) {
        await adicionarNaFilaOffline(acaoFila);
        toast(
          '📡 Sem internet no momento.\n\n' +
          'O pedido foi marcado localmente como ENTREGUE e será sincronizado ' +
          'automaticamente quando a conexão voltar.\n\n' +
          'Continue suas entregas normalmente.'
        );
      } else {
        const res = itensEntregues
          ? await apiSupabase('rpc/concluir_entrega_parcial','POST', { p_id:id, p_dados:payload, p_itens:itensEntregues })
          : await apiSupabase('rpc/concluir_entrega','POST', { p_id:id, p_dados:payload });
        if (!res.ok) {
          // Se falhou por timeout (rede ruim), também enfileira
          if (res.rede || res.status === 408 || res.status === 429 || res.status >= 500) {
            await adicionarNaFilaOffline(acaoFila);
            toast(
              '⚠ Conexão lenta — pedido marcado localmente.\n\n' +
              'Vai sincronizar automaticamente quando a internet melhorar.'
            );
          } else {
            toast('Erro ao confirmar entrega.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
            return;
          }
        } else {
          Object.assign(payload, res.dados);
          respostaServidor = res.dados;
        }
      }
    }
    // Atualiza estado local em ambos os casos (sucesso ou offline)
    const idx = todosOsPedidos.findIndex(p=>p.id===id);
    if (idx>=0) {
      Object.assign(todosOsPedidos[idx], payload);
      // O servidor devolve os itens já reduzidos; sem resposta dele (offline,
      // demonstração), reduz aqui do mesmo jeito.
      if (parcial && !Array.isArray(respostaServidor?.itens)) aplicarEntregaParcialLocal(todosOsPedidos[idx], entregues);
    }
    // Pedido entregue: limpa o checklist (não precisa mais)
    limparChecklist(id);
    fecharModal('modal-entrega');
    registrarMudancaLocal('pedidos');
  } catch (e) {
    console.error('Erro ao concluir entrega:', e);
    toast('A entrega não foi registrada. ' + e.message);
  } finally {
    salvando = false;
    botaoSalvando('confirmarEntrega', false, '✓ Confirmar Entrega');
  }
}

// ============================================================
// EXCLUIR PEDIDO
// ============================================================
async function excluirPedido(id) {
  if (salvando) return;
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p) return;
  if (p.status === 'entregue') {
    toast('Pedido já entregue não pode ser excluído.');
    return;
  }
  if (!podeEditarPedido(p)) {
    toast('Você não tem permissão para excluir este pedido.');
    return;
  }

  const confirmacao = await confirmar(
    `Excluir o pedido de "${p.cliente_nome}" no valor de ${moeda(p.valor)}?\n\n` +
    `Esta ação não pode ser desfeita.`
  );
  if (!confirmacao) return;

  salvando = true;
  try {
    if (!MODO_DEMO) {
      // A FK remove os itens em cascata; assim uma falha não deixa o pedido vazio.
      const res = await apiSupabase('pedidos','DELETE',null,`?id=eq.${id}`);
      if (!res.ok || res.count !== 1) {
        toast('Erro ao excluir pedido.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
        solicitarSincronizacao();
        return;
      }
    }

    todosOsPedidos = todosOsPedidos.filter(x => x.id !== id);
    limparChecklist(id);

    registrarMudancaLocal('pedidos');
  } finally {
    salvando = false;
  }
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
    document.getElementById('produto-custo').value    = (p.preco_custo != null) ? p.preco_custo : '';
  } else {
    produtoSelecionado = null;
    document.getElementById('produto-id').value='';
    ['produto-nome','produto-preco','produto-custo'].forEach(i=>{ document.getElementById(i).value=''; });
    document.getElementById('produto-categoria').value='Ração';
  }
  atualizarMargemModal();
  abrirModal('modal-produto');
}

// Calcula e mostra a margem em tempo real no modal de cadastro/edição
function atualizarMargemModal() {
  const preco = parseFloat((document.getElementById('produto-preco').value || '0').replace(',','.')) || 0;
  const custo = parseFloat((document.getElementById('produto-custo').value || '0').replace(',','.')) || 0;
  const info = document.getElementById('margem-info');
  if (!info) return;
  if (!custo || !preco) { info.classList.remove('visivel'); info.innerHTML = ''; return; }
  const lucro = preco - custo;
  const pct = custo > 0 ? (lucro / custo * 100) : 0;
  // Classifica visualmente
  info.classList.remove('lucro-bom','lucro-baixo','lucro-negativo');
  if (lucro < 0)        info.classList.add('lucro-negativo');
  else if (pct < 20)    info.classList.add('lucro-baixo');
  else                  info.classList.add('lucro-bom');
  info.classList.add('visivel');
  info.innerHTML = `
    <div>
      <div class="margem-info-label">Margem de lucro</div>
      <div class="margem-info-valor">${moeda(lucro)}</div>
    </div>
    <div class="margem-info-pct">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</div>`;
}

async function salvarProduto() {
  if (salvando) return;
  const nome      = document.getElementById('produto-nome').value.trim();
  const categoria = document.getElementById('produto-categoria').value;
  const precoStr  = document.getElementById('produto-preco').value.replace(',','.');
  const preco     = Math.max(0, parseFloat(precoStr) || 0);
  const custoStr  = document.getElementById('produto-custo').value.replace(',','.');
  // Custo é opcional — null se vazio
  const preco_custo = (custoStr.trim() === '' || isNaN(parseFloat(custoStr)))
    ? null
    : Math.max(0, parseFloat(custoStr));
  const idEdit    = document.getElementById('produto-id').value;

  if (!nome) { toast('Informe o nome do produto.'); return; }
  if (!Number.isFinite(preco) || preco <= 0 || (preco_custo != null && !Number.isFinite(preco_custo))) { toast('Informe preços válidos.'); return; }

  salvando = true;
  botaoSalvando('salvarProduto', true, 'Salvar Produto');
  try {
    let salvo = { id: Number(idEdit) || Date.now(), nome, categoria, preco, preco_custo };
    if (!MODO_DEMO) {
      const res = await apiSupabase('rpc/salvar_produto','POST', {
        p_produto: { nome, categoria, preco, preco_custo }, p_id: Number(idEdit) || null,
      });
      if (!res.ok || !res.dados?.id) {
        toast('Produto não salvo. Tente novamente.\n\n' + (res.erro || 'Sem resposta do servidor.'));
        return;
      }
      salvo = res.dados;
    }
    const idx = todosOsProdutos.findIndex(p => p.id === salvo.id);
    if (idx >= 0) Object.assign(todosOsProdutos[idx], salvo);
    else todosOsProdutos.push(salvo);
    fecharModal('modal-produto');
    registrarMudancaLocal('produtos');
  } finally {
    salvando = false;
    botaoSalvando('salvarProduto', false, 'Salvar Produto');
  }
}

// Re-renderiza o catálogo respeitando busca ativa.
// Se o usuário tem texto digitado na busca, mantém a busca.
// Senão, usa o filtro de aba (Todos/Ração/Agro).
function rerenderizarCatalogoMantendoBusca() {
  const buscaEl = document.getElementById('busca-catalogo');
  const termo = buscaEl ? buscaEl.value.trim() : '';
  if (termo) {
    _buscarProdutoImpl(termo);
  } else {
    // Mantém quantos produtos já estavam à mostra: se o usuário carregou
    // 3 lotes e editou um item, a lista não volta pro início.
    _pintarCatalogo(true);
  }
}

// ============================================================
// MARGEM / HISTÓRICO DE PREÇOS (admin only)
// ============================================================
function alternarMostrarMargem() {
  mostrarMargem = !mostrarMargem;
  const toggle = document.getElementById('toggle-margem-catalogo');
  if (toggle) toggle.classList.toggle('ativo', mostrarMargem);
  rerenderizarCatalogoMantendoBusca();
}

async function excluirProduto(id) {
  if (salvando) return;
  if (!await confirmar('Excluir este produto do catálogo?')) return;
  salvando = true;
  try {
    if (!MODO_DEMO) {
      const res = await apiSupabase('produtos','DELETE',null,`?id=eq.${id}`);
      if (!res.ok || res.count !== 1) {
        toast('Produto não excluído. Ele pode estar vinculado a pedidos ou ter sido alterado.');
        solicitarSincronizacao();
        return;
      }
    }
    todosOsProdutos = todosOsProdutos.filter(p=>p.id!==id);
    registrarMudancaLocal('produtos');
  } finally {
    salvando = false;
  }
}

// Mostra modal com detalhes do produto + histórico de preços
async function verDetalheProduto(id) {
  if (usuario?.perfil !== 'admin') return;
  const acessoInicial = geracaoAcesso;
  const p = todosOsProdutos.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-detalhe-produto').dataset.registroId = String(id);

  // Mostra modal com loading enquanto busca histórico
  document.getElementById('detalhe-produto-nome').textContent = p.nome;
  document.getElementById('detalhe-produto-conteudo').innerHTML = `
    <div class="loading"><div class="spinner"></div> Carregando histórico...</div>`;
  const carregamento = document.getElementById('detalhe-produto-conteudo').firstElementChild;
  abrirModal('modal-detalhe-produto');

  // Calcula margem atual
  const custo = Number(p.preco_custo) || 0;
  const preco = Number(p.preco) || 0;
  const lucro = (custo > 0 && preco > 0) ? (preco - custo) : null;
  const pct = (custo > 0 && preco > 0) ? ((preco - custo) / custo * 100) : null;
  let classeLucro = '';
  if (lucro != null) {
    if (lucro < 0) classeLucro = 'lucro-negativo';
    else if (pct < 20) classeLucro = 'lucro-baixo';
    else classeLucro = 'lucro-bom';
  }

  // Busca histórico no banco
  let historico = [];
  let falhaHistorico = false;
  let modoDemoSemHistorico = false;
  if (!MODO_DEMO) {
    const res = await apiSupabase('historico_precos', 'GET', null,
      `?produto_id=eq.${id}&order=criado_em.desc&limit=20`);
    if (res.ok && Array.isArray(res.dados)) historico = res.dados;
    else falhaHistorico = true;
  } else {
    modoDemoSemHistorico = true;
  }

  // Resumo
  if (geracaoAcesso !== acessoInicial ||
      document.getElementById('detalhe-produto-conteudo').firstElementChild !== carregamento ||
      !document.getElementById('modal-detalhe-produto').classList.contains('aberto')) return;
  let resumoHtml = `
    <div class="historico-resumo">
      <div class="historico-resumo-linha">
        <span class="historico-resumo-label">📁 Categoria</span>
        <span class="historico-resumo-valor" style="font-family:Nunito,sans-serif;font-size:13px">${esc(p.categoria || '–')}</span>
      </div>
      <div class="historico-resumo-linha">
        <span class="historico-resumo-label">💰 Preço de venda</span>
        <span class="historico-resumo-valor" style="color:#7ec850">${moeda(preco)}</span>
      </div>
      <div class="historico-resumo-linha">
        <span class="historico-resumo-label">📦 Preço de custo</span>
        <span class="historico-resumo-valor" style="color:#f4a04a">${custo > 0 ? moeda(custo) : 'Não cadastrado'}</span>
      </div>`;
  if (lucro != null) {
    // Define a cor diretamente baseado na classe
    let corLucro = '#7ec850'; // bom (verde)
    if (classeLucro === 'lucro-negativo') corLucro = '#ee7d6f';
    else if (classeLucro === 'lucro-baixo') corLucro = '#f4a04a';
    resumoHtml += `
      <div class="historico-resumo-linha">
        <span class="historico-resumo-label">📈 Margem de lucro</span>
        <span class="historico-resumo-valor" style="color:${corLucro}">${moeda(lucro)} <span style="font-size:11px;margin-left:4px;opacity:.85">(${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)</span></span>
      </div>`;
  }
  resumoHtml += `</div>`;

  // Histórico
  let historicoHtml = '<div class="separador">📊 Histórico de preços</div>';
  if (modoDemoSemHistorico) {
    historicoHtml += `<div class="historico-vazio">Histórico só fica disponível no modo real (com banco conectado).</div>`;
  } else if (falhaHistorico) {
    historicoHtml += '<div class="historico-vazio">Não foi possível carregar o histórico. Feche e abra novamente para tentar.</div>';
  } else if (!historico.length) {
    historicoHtml += `<div class="historico-vazio">Nenhuma alteração registrada ainda.<br>O histórico começa a partir da próxima alteração.</div>`;
  } else {
    historicoHtml += '<div class="historico-lista">';
    historico.forEach((h, i) => {
      const dataObj = new Date(h.criado_em);
      const dataStr = dataObj.toLocaleDateString('pt-BR') + ' às ' + dataObj.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
      const venda = Number(h.preco_venda) || 0;
      const custoH = Number(h.preco_custo) || 0;
      const margemH = (custoH > 0 && venda > 0) ? (venda - custoH) : null;

      // Detecta variação vs próximo (mais antigo)
      let variacaoHtml = '';
      const proximo = historico[i + 1];
      if (proximo) {
        const vendaAnt = Number(proximo.preco_venda) || 0;
        if (vendaAnt > 0 && venda !== vendaAnt) {
          const diff = ((venda - vendaAnt) / vendaAnt * 100);
          const sinal = diff > 0 ? '↑' : '↓';
          const cls = diff > 0 ? 'subiu' : 'desceu';
          variacaoHtml = `<span class="historico-variacao ${cls}">${sinal} ${Math.abs(diff).toFixed(0)}% no preço de venda</span>`;
        }
      }

      historicoHtml += `
        <div class="historico-item">
          <div class="historico-item-data">📅 ${dataStr}${h.alterado_por ? ` · por ${esc(h.alterado_por)}` : ''}</div>
          <div class="historico-item-precos">
            <div><span class="lbl">Custo</span><span class="val custo">${custoH > 0 ? moeda(custoH) : '—'}</span></div>
            <div><span class="lbl">Venda</span><span class="val venda">${moeda(venda)}</span></div>
            ${margemH != null ? `<div><span class="lbl">Margem</span><span class="val margem">${moeda(margemH)}</span></div>` : ''}
          </div>
          ${variacaoHtml}
        </div>`;
    });
    historicoHtml += '</div>';
  }

  // Botões de ação
  const botoes = `
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn-azul" style="flex:1" onclick="fecharModal('modal-detalhe-produto'); abrirModalProduto(${p.id})">✏️ Editar</button>
      <button class="btn-perigo" style="flex:1" onclick="fecharModal('modal-detalhe-produto'); excluirProduto(${p.id})">🗑️ Excluir</button>
    </div>`;

  document.getElementById('detalhe-produto-conteudo').innerHTML = resumoHtml + historicoHtml + botoes;
}


// ============================================================
// DETALHE PEDIDO
// ============================================================
// Formata a forma de pagamento de um pedido em texto legível.
// Usado no detalhe do pedido e na via de impressão.
function formatarPagamento(p) {
  if (p.forma_pagamento === 'avista') return '💵 À vista';
  if (p.forma_pagamento === 'cheque') return '📝 Cheque';
  if (p.forma_pagamento === 'boleto') {
    // Tenta usar prazos_boleto (CSV); senão cai pra prazo_dias antigo
    let prazos = [];
    if (p.prazos_boleto) {
      prazos = String(p.prazos_boleto).split(',').map(x => Number(x.trim())).filter(x => x > 0);
    } else if (p.prazo_dias) {
      prazos = [Number(p.prazo_dias)];
    }
    if (prazos.length > 1) return `📄 Boleto ${prazos.length}× (${prazos.join(' + ')} dias)`;
    if (prazos.length === 1) return `📄 Boleto ${prazos[0]} dias`;
    return '📄 Boleto';
  }
  return 'Não informado';
}

// Forma de pagamento sem o emoji do começo ("À vista" mantém o "À").
function pagamentoSemEmoji(p) {
  return formatarPagamento(p).replace(/^[^\p{L}\p{N}]+/u, '');
}

// Usa sempre o preço efetivamente cobrado e reconhece pesos como 20kg, 20 KG e 10,1 kg.
function formatarPrecoItemPedido(item) {
  const nome = String(item?.nome || item?.produto_nome || '').trim();
  const quantidadeInformada = Number(item?.qtd);
  const precoInformado = Number(item?.preco_unit);
  const quantidade = Number.isFinite(quantidadeInformada) ? quantidadeInformada : 0;
  const precoUnitario = Number.isFinite(precoInformado) ? precoInformado : 0;
  const pesoEncontrado = nome.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  const pesoExtraido = pesoEncontrado ? Number(pesoEncontrado[1].replace(',', '.')) : 0;
  const pesoKg = Number.isFinite(pesoExtraido) && pesoExtraido > 0 ? pesoExtraido : null;
  const valorPorKgCalculado = pesoKg && Number.isFinite(precoInformado) ? precoUnitario / pesoKg : null;
  const valorPorKg = Number.isFinite(valorPorKgCalculado) ? valorPorKgCalculado : null;
  const subtotalCalculado = precoUnitario * quantidade;
  const subtotal = Number.isFinite(subtotalCalculado) ? subtotalCalculado : 0;

  return {
    nome, quantidade, precoUnitario, subtotal, pesoKg, valorPorKg,
    textoUnidade: valorPorKg == null ? `Unid.: ${moeda(precoUnitario)}` : `Unid./kg: ${moeda(valorPorKg)}`,
    textoEmbalagem: valorPorKg == null ? '' : `Saco: ${moeda(precoUnitario)}`,
    textoSubtotal: `Subtotal: ${moeda(subtotal)}`,
  };
}

// ============================================================
// VIA DE PEDIDO — geração de PDF real via jsPDF
//
// Por que PDF e não HTML + window.print()?
// O print preview do Safari (especialmente iOS) é um snapshot que ignora
// @page, aplica margens próprias (~25mm), não respeita inline styles em
// alguns casos e pode cortar conteúdo à direita. Resultado: a coluna
// SUBTOTAL e o TOTAL sumiam no iPhone, mesmo com várias tentativas de
// CSS/HTML.
//
// Solução: gerar um PDF A4 vetorial em JavaScript (jsPDF + autoTable).
// Posições, margens, fontes e quebras de linha ficam definidas no PDF
// em si. O Safari só precisa VISUALIZAR o PDF — não decide mais nada
// sobre layout. iOS tem suporte nativo a PDF com Share/Print/Save.
// ============================================================

// Cache em memória das fontes TTF e da logo (carregadas sob demanda).
const _viaAssets = {
  cinzel: null,    // base64 da TTF Cinzel variable
  nunito: null,    // base64 da TTF Nunito variable
  logoPng: null,   // base64 da logo KG Agropet
  promise: null,
};

// Estado da renderização atual. A geração e a renderização do PDF são
// assíncronas; sem um identificador, fechar a overlay durante um await deixa
// callbacks antigos escrevendo em elementos que já não existem.
let _viaOverlaySeq = 0;
let _viaOverlayState = null;
let _viaFlowToken = 0;
const _pdfScriptPromises = new Map();

function _carregarScriptPdf(src, pronto) {
  if (pronto()) return Promise.resolve();
  if (_pdfScriptPromises.has(src)) return _pdfScriptPromises.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.kgPdfLib = src;
    script.onload = () => {
      if (pronto()) resolve();
      else { script.remove(); reject(new Error(`Biblioteca não inicializou: ${src}`)); }
    };
    script.onerror = () => { script.remove(); reject(new Error(`Falha ao carregar ${src}`)); };
    document.head.appendChild(script);
  }).catch(err => {
    _pdfScriptPromises.delete(src);
    throw err;
  });
  _pdfScriptPromises.set(src, promise);
  return promise;
}

async function _carregarBibliotecasPdf() {
  if (window.jspdf?.jsPDF && window.pdfjsLib) return;
  await _carregarScriptPdf('vendor/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF);
  await _carregarScriptPdf('vendor/jspdf-autotable.min.js', () => !!window.jspdf?.jsPDF?.API?.autoTable);
  await _carregarScriptPdf('vendor/pdf.min.js', () => !!window.pdfjsLib);
  if (!window.jspdf?.jsPDF) throw new Error('Biblioteca jsPDF não está disponível.');
}

function _liberarViaOverlayState(state) {
  if (!state) return;
  state.active = false;
  try { state.pdf?.destroy?.(); } catch (_) { /* limpeza best-effort */ }
  if (state.url) {
    try { URL.revokeObjectURL(state.url); } catch (_) { /* URL pode já ter sido revogada */ }
  }
}

function _viaOverlayAtual(state) {
  return _viaOverlayState === state && state.active;
}

// Carrega as fontes TTF + logo PNG do diretório vendor (cached após 1ª vez).
async function _carregarAssetsVia() {
  if (_viaAssets.cinzel && _viaAssets.nunito && _viaAssets.logoPng) return;
  if (_viaAssets.promise) return _viaAssets.promise;

  const toB64 = async (path) => {
    const resp = await fetch(path);
    if (!resp.ok) throw new Error(`Falha ao carregar ${path}: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  };

  _viaAssets.promise = (async () => {
    try {
      _viaAssets.cinzel   = await toB64('vendor/Cinzel.ttf');
      _viaAssets.nunito   = await toB64('vendor/Nunito.ttf');
      _viaAssets.logoPng  = await toB64('logo.png');
    } catch (e) {
      console.warn('[via] Falha ao carregar assets — usando fallback Helvetica:', e.message);
      _viaAssets.cinzel = null;
      _viaAssets.nunito = null;
      _viaAssets.logoPng = null;
      // Permite uma nova tentativa em caso de falha transitória de rede.
      _viaAssets.promise = null;
    }
  })();

  return _viaAssets.promise;
}

// A fonte embutida (Nunito/Cinzel, recortada) só desenha estes caracteres. No
// jsPDF, o primeiro caractere que ela não tem CORTA o resto da linha ("Boa
// Safra & Cia" saía "Boa Safra "). Texto com qualquer outro caractere usa a
// Helvetica, que tem o alfabeto latino completo.
const PDF_FONTE_TEM = /^[A-Za-z0-9 \n\r\t\u00e7\u00e3\u00f5\u00e1\u00e9\u00ed\u00f3\u00fa\u00e2\u00ea\u00f4\u00e0\u00c7\u00c3\u00d5\u00c1\u00c9\u00cd\u00d3\u00da\u00c2\u00ca\u00d4\u00c0(),.:\/$\u00b0\u00ba\u2014\u2022\u00d7-]*$/;
const pdfPrecisaFonteReserva = t => !PDF_FONTE_TEM.test(String(t ?? ''));
// Emoji e símbolos fora do Latin-1 nem a Helvetica desenha: viram "?".
const pdfTextoSeguro = t => String(t ?? '').replace(/[^\u0000-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122]/g, '?');

function _registrarFontesPdf(doc) {
  const FONT_CINZEL = _viaAssets.cinzel ? 'Cinzel' : 'helvetica';
  const FONT_NUNITO = _viaAssets.nunito ? 'Nunito' : 'helvetica';
  if (_viaAssets.cinzel) {
    doc.addFileToVFS('Cinzel.ttf', _viaAssets.cinzel);
    doc.addFont('Cinzel.ttf', 'Cinzel', 'normal');
    doc.addFont('Cinzel.ttf', 'Cinzel', 'bold');
  }
  if (_viaAssets.nunito) {
    doc.addFileToVFS('Nunito.ttf', _viaAssets.nunito);
    doc.addFont('Nunito.ttf', 'Nunito', 'normal');
    doc.addFont('Nunito.ttf', 'Nunito', 'bold');
  }
  return { FONT_CINZEL, FONT_NUNITO };
}

// Pedido e cliente para a via: do servidor quando há internet; os dados salvos
// no aparelho só se estiver sem conexão ou com entrega ainda na fila offline.
async function _pedidoParaVia(id) {
  const local = todosOsPedidos.find(x => x.id === id);
  const doAparelho = () => {
    if (!local) throw new Error('Pedido não encontrado: ' + id);
    return { p: local, c: todosOsClientes.find(x => x.id === local.cliente_id), conferido: false };
  };
  if (MODO_DEMO || !navigator.onLine) return doAparelho();
  // Ação deste aparelho que o servidor ainda não recebeu: a tela está mais certa que o servidor.
  if (lerFilaOffline().some(a => a.pedidoId === id && !a.falha)) return doAparelho();
  let res;
  try { res = await apiSupabase('pedidos', 'GET', null, `?id=eq.${encodeURIComponent(id)}&select=*,clientes(*),itens_pedido(*)`); }
  catch (_) { return doAparelho(); }
  if (!res.ok || res.deCache || !Array.isArray(res.dados)) return doAparelho();
  if (!res.dados.length) throw new Error('Este pedido não existe mais no servidor. Atualize a lista de pedidos.');
  const bruto = res.dados[0];
  const p = normalizarPedidos([bruto])[0];
  return { p, c: bruto.clientes || todosOsClientes.find(x => x.id === p.cliente_id), conferido: true };
}

// Gera o Blob do PDF da via. Retorna { blob, url, nomeArquivo }.
async function gerarPdfViaPedido(id) {
  await _carregarBibliotecasPdf();
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Biblioteca jsPDF não está carregada. Verifique vendor/jspdf.umd.min.js.');
  }

  // Carrega fontes e logo antes de montar o documento.
  await _carregarAssetsVia();

  // A via é entregue ao cliente: usa o pedido como está no servidor, não a cópia
  // que pode estar velha neste aparelho.
  const { p, c, conferido } = await _pedidoParaVia(id);

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210, pageH = 297;
  const mL = 14, mR = 14, mT = 14, mB = 18;
  const cW = pageW - mL - mR; // 182mm

  // Registra as fontes customizadas (se carregaram). jsPDF usa 'helvetica' como
  // fallback quando elas não estão disponíveis.
  const { FONT_CINZEL, FONT_NUNITO } = _registrarFontesPdf(doc);
  const fontesEmbutidas = FONT_NUNITO !== 'helvetica';

  // Texto com caractere que a fonte embutida não tem sai em Helvetica (mesmo
  // tamanho e estilo), em vez de perder o resto da linha.
  const comFonteReserva = (t, fn) => {
    const lista = Array.isArray(t) ? t : [t];
    if (!fontesEmbutidas || !lista.some(pdfPrecisaFonteReserva)) return fn(t);
    const atual = doc.getFont();
    doc.setFont('helvetica', atual.fontStyle === 'bold' ? 'bold' : 'normal');
    try { return fn(Array.isArray(t) ? t.map(pdfTextoSeguro) : pdfTextoSeguro(t)); }
    finally { doc.setFont(atual.fontName, atual.fontStyle); }
  };
  const escrever = (t, x, y, opcoes) => comFonteReserva(t, texto => doc.text(texto, x, y, opcoes));
  const quebrar = (t, largura) => comFonteReserva(t, texto => doc.splitTextToSize(texto, largura));

  const pagto = pagamentoSemEmoji(p);

  // ========== CORES DA MARCA ==========
  const COR = {
    verdeEscuro:   [13, 34, 24],
    verdeTexto:    [25, 66, 42],
    verdeMedio:    [22, 56, 40],
    dourado:       [212, 175, 55],
    douradoClaro:  [232, 200, 100],
    branco:        [255, 255, 255],
    cinzaClaro:    [245, 245, 245],
    cinzaMedio:    [180, 180, 180],
    cinzaTexto:    [80, 80, 80],
    preto:         [20, 20, 20],
  };

  // ========== CABEÇALHO (leve para economizar tinta) ==========
  const ALTURA_CABECALHO = 25;
  const drawCabecalho = (yRef) => {
    doc.setDrawColor(...COR.dourado);
    doc.setLineWidth(0.45);
    doc.line(mL, yRef + ALTURA_CABECALHO, mL + cW, yRef + ALTURA_CABECALHO);

    if (_viaAssets.logoPng) {
      try { doc.addImage(_viaAssets.logoPng, 'PNG', mL, yRef + 1, 19, 19, undefined, 'FAST'); }
      catch (e) { /* ignora erro de imagem */ }
    }

    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...COR.verdeTexto);
    escrever('KG AGROPET', mL + 23, yRef + 8);

    doc.setFont(FONT_NUNITO, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COR.cinzaTexto);
    escrever('Glória do Goitá — PE', mL + 23, yRef + 14);

    doc.setFontSize(7);
    doc.setTextColor(...COR.cinzaTexto);
    escrever('Pedido para conferência e entrega', mL + 23, yRef + 19);

    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...COR.verdeTexto);
    escrever('VIA DO PEDIDO', pageW - mR, yRef + 8, { align: 'right' });

    doc.setFont(FONT_NUNITO, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COR.cinzaTexto);
    escrever(`Nº ${String(p.id).padStart(4, '0')}`, pageW - mR, yRef + 13.5, { align: 'right' });

    doc.setFont(FONT_NUNITO, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(p.status === 'entregue' ? 50 : 110, p.status === 'entregue' ? 100 : 110, p.status === 'entregue' ? 65 : 110);
    escrever(p.status === 'entregue' ? 'ENTREGUE' : 'PENDENTE', pageW - mR, yRef + 19, { align: 'right' });

    return yRef + ALTURA_CABECALHO + 6;
  };

  // ========== RODAPÉ ==========
  const drawRodape = (cur, pageCount) => {
    const y = pageH - mB + 4;
    doc.setDrawColor(...COR.cinzaMedio);
    doc.setLineWidth(0.2);
    doc.line(mL, y - 4, pageW - mR, y - 4);

    doc.setFont(FONT_NUNITO, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    escrever('Este documento não substitui documento fiscal.', mL, y);
    if (!conferido && !MODO_DEMO) {
      doc.setTextColor(170, 40, 30);
      escrever('Gerado com os dados salvos neste aparelho, sem conferir com o servidor.', mL, y + 3.5);
    }

    doc.setTextColor(...COR.cinzaTexto);
    escrever(`Página ${cur} de ${pageCount}`, pageW - mR, y, { align: 'right' });

    doc.setTextColor(120, 120, 120);
    escrever(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageW / 2, y, { align: 'center' });
  };

  // ========== BLOCO DO CLIENTE ==========
  const drawCliente = (yRef) => {
    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR.dourado);
    escrever('CLIENTE', mL, yRef);
    doc.setDrawColor(...COR.dourado);
    doc.setLineWidth(0.4);
    doc.line(mL, yRef + 1.5, mL + 18, yRef + 1.5);

    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COR.preto);
    escrever(p.cliente_nome || c?.nome || '—', mL, yRef + 9);

    let yLocal = yRef + 15;
    const colW = (cW - 4) / 2;

    if (c?.responsavel) {
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      escrever('RESPONSÁVEL', mL, yLocal);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
      const txt = quebrar(c.responsavel, colW);
      escrever(txt, mL, yLocal + 4);
    }
    if (c?.whatsapp) {
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      escrever('WHATSAPP', mL + colW + 4, yLocal);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
      escrever(mascaraTelefone(c.whatsapp), mL + colW + 4, yLocal + 4);
    }
    yLocal += 10;

    if (c?.endereco) {
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      escrever('ENDEREÇO', mL, yLocal);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
      const endLines = quebrar(c.endereco, cW);
      escrever(endLines, mL, yLocal + 4);
      yLocal += 4 + (endLines.length * 4.2) + 2;
    }

    if (c?.cnpj_cpf) {
      const docFmt = (c.tipo_pessoa === 'fisica') ? mascaraCPF(c.cnpj_cpf) : mascaraCNPJ(c.cnpj_cpf);
      const labelDoc = c.tipo_pessoa === 'fisica' ? 'CPF' : 'CNPJ';
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      escrever(labelDoc, mL, yLocal);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
      escrever(docFmt, mL, yLocal + 4);
      yLocal += 10;
    }
    return yLocal;
  };

  // ========== TABELA DE ITENS ==========
  const itens = (p.itens && p.itens.length)
    ? p.itens.map(i => {
        const d = formatarPrecoItemPedido(i);
        return [
          String(d.quantidade),
          d.nome + (Number(i.qtd_pedida) > Number(i.qtd) ? ` (pediu ${i.qtd_pedida})` : ''),
          moeda(d.precoUnitario),
          moeda(d.subtotal),
        ];
      })
    : [['', p.descricao || '—', '', '']];

  // ========== PAGAMENTO E PRAZOS ==========
  const drawPagamento = (yRef) => {
    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR.dourado);
    escrever('PAGAMENTO E PRAZOS', mL, yRef);
    doc.setDrawColor(...COR.dourado);
    doc.setLineWidth(0.4);
    doc.line(mL, yRef + 1.5, mL + 38, yRef + 1.5);

    let yLocal = yRef + 7;
    const colW = (cW - 4) / 2;
    const campos = [
      ['Forma de pagamento', pagto],
      ['Entrega prevista', dataBR(p.data_entrega)],
    ];
    if (p.status === 'entregue' && p.data_entregue_em) campos.push(['Entregue em', dataBR(p.data_entregue_em)]);
    if (p.data_vencimento) campos.push(['Vencimento', dataBR(p.data_vencimento)]);

    for (let i = 0; i < campos.length; i += 2) {
      const [lbl1, val1] = campos[i];
      const col2 = campos[i + 1];
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
      escrever(lbl1.toUpperCase(), mL, yLocal);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
      escrever(String(val1 || '—'), mL, yLocal + 4);
      if (col2) {
        doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(7); doc.setTextColor(120, 120, 120);
        escrever(col2[0].toUpperCase(), mL + colW + 4, yLocal);
        doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(...COR.preto);
        escrever(String(col2[1] || '—'), mL + colW + 4, yLocal + 4);
      }
      yLocal += 10;
    }
    return yLocal;
  };

  // ========== OBSERVAÇÕES ==========
  const drawObservacoes = (yRef) => {
    if (!p.observacao) return yRef;
    doc.setFont(FONT_CINZEL, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COR.dourado);
    escrever('OBSERVAÇÕES', mL, yRef);
    doc.setDrawColor(...COR.dourado);
    doc.setLineWidth(0.4);
    doc.line(mL, yRef + 1.5, mL + 28, yRef + 1.5);

    doc.setFont(FONT_NUNITO, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...COR.preto);
    const obsLines = quebrar(p.observacao, cW);
    escrever(obsLines, mL, yRef + 6);
    return yRef + 6 + (obsLines.length * 4.2) + 2;
  };

  // ========== MONTAGEM DA PÁGINA ==========
  let y = mT;
  y = drawCabecalho(y);
  y = drawCliente(y) + 4;

  doc.setFont(FONT_CINZEL, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COR.dourado);
  escrever('ITENS DO PEDIDO', mL, y);
  doc.setDrawColor(...COR.dourado);
  doc.setLineWidth(0.4);
  doc.line(mL, y + 1.5, mL + 36, y + 1.5);
  y += 6;

  doc.autoTable({
    startY: y,
    head: [['Qtd', 'Produto', 'Unitário', 'Subtotal']],
    body: itens,
    margin: { left: mL, right: mR, top: mT + 18, bottom: mB + 8 },
    styles: {
      font: FONT_NUNITO,
      fontSize: 8.5,
      cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
      lineColor: [185, 185, 185],
      lineWidth: 0.12,
      textColor: COR.preto,
      overflow: 'linebreak',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [250, 250, 248],
      textColor: COR.verdeTexto,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      font: FONT_CINZEL,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 14, fontStyle: 'bold' },
      1: { halign: 'left', font: FONT_NUNITO },
      2: { halign: 'right', cellWidth: 34, font: FONT_NUNITO },
      3: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
    },
    // Cabeçalho e rodapé são desenhados no fim, em todas as páginas.
    didParseCell: data => {
      if (fontesEmbutidas && pdfPrecisaFonteReserva(data.cell.text.join('\n'))) {
        data.cell.text = data.cell.text.map(pdfTextoSeguro);
        data.cell.styles.font = 'helvetica';
        if (data.section === 'body') data.cell.styles.textColor = [60, 60, 60];
        if (data.column.index !== 0) data.cell.styles.fontStyle = data.section === 'head' ? 'bold' : 'normal';
      }
    },
  });

  let yAfterTable = doc.lastAutoTable.finalY + 8;

  // TOTAL — destaque apenas com contorno, para gastar pouca tinta.
  if (yAfterTable > pageH - mB - 28) {
    doc.addPage();
    yAfterTable = mT + 18;
  }

  const totalBoxH = 15;
  const totalBoxW = 78;
  const totalBoxX = pageW - mR - totalBoxW;
  doc.setDrawColor(...COR.dourado);
  doc.setLineWidth(0.6);
  doc.rect(totalBoxX, yAfterTable, totalBoxW, totalBoxH, 'S');

  doc.setFont(FONT_CINZEL, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COR.verdeTexto);
  escrever('TOTAL DO PEDIDO', totalBoxX + 4, yAfterTable + 5);

  doc.setFont(FONT_CINZEL, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...COR.verdeTexto);
  escrever(moeda(p.valor), totalBoxX + totalBoxW - 4, yAfterTable + 11.5, { align: 'right' });

  yAfterTable += totalBoxH + 8;

  // Pagamento
  if (yAfterTable > pageH - mB - 40) {
    doc.addPage();
    yAfterTable = mT + 18;
  }
  yAfterTable = drawPagamento(yAfterTable) + 3;

  // Observações
  if (p.observacao) {
    if (yAfterTable > pageH - mB - 30) {
      doc.addPage();
      yAfterTable = mT + 18;
    }
    yAfterTable = drawObservacoes(yAfterTable);
  }

  // Cabeçalho das páginas seguintes e rodapé de todas, com o total de páginas certo.
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    if (i > 1) {
      // Cabeçalho compacto, sem bloco de tinta.
      if (_viaAssets.logoPng) {
        try { doc.addImage(_viaAssets.logoPng, 'PNG', mL, mT, 10, 10, undefined, 'FAST'); }
        catch (e) { /* ignora erro de imagem */ }
      }
      doc.setFont(FONT_CINZEL, 'bold'); doc.setFontSize(9); doc.setTextColor(...COR.dourado);
      escrever('KG AGROPET', mL + 13, mT + 6.5);
      doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(8); doc.setTextColor(...COR.verdeTexto);
      escrever(`Via do Pedido — Nº ${String(p.id).padStart(4, '0')}`, pageW - mR, mT + 7, { align: 'right' });
      doc.setDrawColor(...COR.dourado); doc.setLineWidth(0.4);
      doc.line(mL, mT + 12, pageW - mR, mT + 12);
    }
    drawRodape(i, totalPaginas);
  }

  // Gera o blob
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const cliNome = (p.cliente_nome || c?.nome || 'pedido').replace(/[^\w]+/g, '-').toLowerCase();
  const nomeArquivo = `via-pedido-${p.id}-${cliNome}.pdf`;
  return { blob, url, nomeArquivo };
}

// Mostra a via (PDF) na overlay do app. Renderiza num <canvas> via PDF.js
// (funciona em qualquer browser/dispositivo, inclusive Safari iOS PWA —
// iframe com blob URL não funciona lá). Fallback para iframe se PDF.js falhar.
async function gerarViaPedido(id) {
  const flowToken = ++_viaFlowToken;
  const overlay = document.getElementById('via-overlay');
  const papel = document.getElementById('via-papel');
  if (overlay) overlay.style.display = 'flex';
  // Loading externo (referenciado depois pelo showPdfViaOverlay pra remover)
  const loadingEl = document.createElement('div');
  loadingEl.className = 'via-loading';
  loadingEl.innerHTML = '<div class="via-spinner"></div><div class="via-loading-text">Gerando PDF...</div>';
  if (papel) { papel.innerHTML = ''; papel.appendChild(loadingEl); }
  window.__viaLoadingEl = loadingEl;
  window.scrollTo({ top: 0, behavior: 'instant' });
  try {
    const { blob, url, nomeArquivo } = await gerarPdfViaPedido(id);
    if (flowToken !== _viaFlowToken) {
      try { URL.revokeObjectURL(url); } catch (_) {}
      return;
    }
    await showPdfViaOverlay(url, nomeArquivo, blob, id);
  } catch (e) {
    if (flowToken !== _viaFlowToken) return;
    console.error('Erro ao gerar PDF da via:', e);
    if (loadingEl) loadingEl.remove();
    window.__viaLoadingEl = null;
    if (papel) papel.innerHTML = `<div class="via-erro">❌ ${esc(e.message)}<br><br>Tente reabrir ou atualizar o aplicativo.</div>`;
    toast('Erro ao gerar PDF: ' + e.message, 'erro');
  }
}

// Renderiza o PDF no canvas via PDF.js. Retorna Promise resolvida quando o
// canvas está pronto (ou rejeitada se cair no fallback de iframe).
async function showPdfViaOverlay(url, nomeArquivo, blob, pedidoId) {
  const overlay = document.getElementById('via-overlay');
  const papel = document.getElementById('via-papel');
  const btnImprimir = document.getElementById('via-btn-imprimir');
  const btnZap = document.getElementById('via-btn-whatsapp');
  const btnSalvar = document.getElementById('via-btn-salvar');
  const btnFechar = document.querySelector('.via-btn-fechar');

  // Também abre a overlay quando o chamador é um relatório (o fluxo de
  // pedido já a abria antes de iniciar a geração).
  if (overlay) overlay.style.display = 'flex';
  if (btnZap) btnZap.style.display = 'none';
  const state = { id: ++_viaOverlaySeq, url, pdf: null, active: true };
  _liberarViaOverlayState(_viaOverlayState);
  _viaOverlayState = state;
  const atual = () => _viaOverlayAtual(state);
  if (!papel) {
    _liberarViaOverlayState(state);
    if (_viaOverlayState === state) _viaOverlayState = null;
    return;
  }

  // ===== Tenta PDF.js primeiro =====
  if (window.pdfjsLib) {
    try {
      // Configura worker (CDN ou local — tenta o local do vendor)
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
      }

      papel.innerHTML = `
        <div class="via-canvas-wrap" id="via-canvas-wrap">
          <canvas id="via-pdf-canvas" tabindex="0" style="display:none"></canvas>
        </div>
        <div class="via-paginacao" id="via-paginacao" style="display:none">
          <button class="via-pag-btn" id="via-pag-prev" aria-label="Página anterior">‹</button>
          <span id="via-pag-info">— / —</span>
          <button class="via-pag-btn" id="via-pag-next" aria-label="Próxima página">›</button>
        </div>
      `;

      const data = await blob.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data }).promise;
      if (!atual()) { try { pdf.destroy?.(); } catch (_) {} return; }
      state.pdf = pdf;
      const canvas = papel.querySelector('#via-pdf-canvas');
      const info = papel.querySelector('#via-pag-info');
      const prev = papel.querySelector('#via-pag-prev');
      const next = papel.querySelector('#via-pag-next');
      const paginacao = papel.querySelector('#via-paginacao');

      let pageNum = 1;
      let renderSeq = 0;
      const renderPage = async (n) => {
        if (!atual()) return;
        const targetPage = Math.max(1, Math.min(n, pdf.numPages));
        const seq = ++renderSeq;
        const page = await pdf.getPage(targetPage);
        if (!atual() || seq !== renderSeq) return;
        // Calcula scale pra caber na largura do canvas (CSS pixels)
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.min(papel.clientWidth - 24, 900); /* padding; no computador não passa de 900px */
        const viewport = page.getViewport({ scale: 1 });
        const scale = (cssW / viewport.width) * dpr;
        const scaledVp = page.getViewport({ scale });
        canvas.width = scaledVp.width;
        canvas.height = scaledVp.height;
        canvas.style.width = (scaledVp.width / dpr) + 'px';
        canvas.style.height = (scaledVp.height / dpr) + 'px';
        canvas.style.display = '';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledVp }).promise;
        if (!atual() || seq !== renderSeq) return;
        pageNum = targetPage;
        // Remove o loading externo (mostrado pelo gerarViaPedido) quando o
        // canvas renderiza a primeira página.
        if (window.__viaLoadingEl) {
          window.__viaLoadingEl.remove();
          window.__viaLoadingEl = null;
        }
        info.textContent = `${pageNum} / ${pdf.numPages}`;
        prev.disabled = pageNum <= 1;
        next.disabled = pageNum >= pdf.numPages;
      };

      prev.onclick = () => { if (atual()) renderPage(pageNum - 1); };
      next.onclick = () => { if (atual()) renderPage(pageNum + 1); };
      // Suporte a seta esquerda/direita no teclado
      canvas.addEventListener('keydown', (ev) => {
        if (!atual()) return;
        if (ev.key === 'ArrowLeft') renderPage(pageNum - 1);
        else if (ev.key === 'ArrowRight') renderPage(pageNum + 1);
      });

      await renderPage(1);
      if (!atual()) return;
      canvas.focus();

      // Botões de ação
      btnImprimir.textContent = '🖨️ Imprimir';
      btnImprimir.title = 'Abre no visualizador do sistema (AirPrint no iOS, Salvar como PDF no Android/Desktop)';
      btnImprimir.onclick = () => {
        if (!atual()) return;
        // Abre o blob URL em nova aba — Safari iOS abre o viewer PDF nativo
        // (que tem botão Compartilhar/AirPrint/Salvar). Funciona melhor que
        // tentar imprimir o canvas.
        const w = window.open(url, '_blank', 'noopener');
        if (!w) {
          toast('Permita pop-ups para imprimir, ou use "Salvar" e abra do app Arquivos.', 'info');
        }
      };

      if (btnSalvar) {
        btnSalvar.onclick = () => {
          if (!atual()) return;
          const a = document.createElement('a');
          a.href = url;
          a.download = nomeArquivo;
          document.body.appendChild(a);
          a.click();
          a.remove();
        };
        btnSalvar.style.display = '';
      }

      if (btnZap && pedidoId != null) {
        btnZap.textContent = '📤 Compartilhar';
        btnZap.onclick = async () => {
          if (!atual()) return;
          try {
            const file = new File([blob], nomeArquivo, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: nomeArquivo, text: 'Via do Pedido - KG Agropet' });
            } else {
              enviarPedidoWhatsApp(pedidoId);
            }
          } catch (e) { /* usuário cancelou */ }
        };
        btnZap.style.display = '';
      } else if (btnZap) {
        // Relatórios não possuem um pedido/cliente para o fallback do
        // WhatsApp. Ocultar evita um botão que não executa nenhuma ação.
        btnZap.style.display = 'none';
      }

      return;
    } catch (e) {
      console.warn('[via] PDF.js falhou, usando iframe fallback:', e);
      // Cai no fallback abaixo
    }
  }

  if (!atual()) return;

  // ===== FALLBACK: iframe (só pra browsers antigos ou PDF.js com bug) =====
  papel.innerHTML = `<iframe id="via-pdf-frame" src="${url}" style="width:100%;height:calc(100vh - 70px);border:0;background:#525659" title="${nomeArquivo}"></iframe>`;
  btnImprimir.textContent = '🖨️ Imprimir';
  btnImprimir.onclick = () => {
    if (!atual()) return;
    const w = window.open(url, '_blank', 'noopener');
    if (!w) toast('Permita pop-ups para imprimir, ou use "Salvar".', 'info');
  };
  if (btnSalvar) {
    btnSalvar.onclick = () => {
      if (!atual()) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    btnSalvar.style.display = '';
  }
  if (btnZap && pedidoId != null) {
    btnZap.textContent = '📤 Compartilhar';
    btnZap.onclick = async () => {
      if (!atual()) return;
      try {
        const file = new File([blob], nomeArquivo, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: nomeArquivo, text: 'Via do Pedido - KG Agropet' });
        } else {
          enviarPedidoWhatsApp(pedidoId);
        }
      } catch (e) {}
    };
    btnZap.style.display = '';
  } else if (btnZap) {
    btnZap.style.display = 'none';
  }
}

function fecharViaPedido() {
  const overlay = document.getElementById('via-overlay');
  const papel = document.getElementById('via-papel');
  _viaFlowToken++;
  _liberarViaOverlayState(_viaOverlayState);
  _viaOverlayState = null;
  window.__viaLoadingEl = null;
  // Limpa iframe/canvas antes de revogar a URL para liberar recursos.
  if (papel) papel.innerHTML = '';
  if (overlay) overlay.style.display = 'none';
}

// Envia o resumo do pedido (texto formatado) direto no WhatsApp do cliente
function enviarPedidoWhatsApp(id) {
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p) return;
  const c = todosOsClientes.find(x => x.id === p.cliente_id);
  const waNum = (c?.whatsapp || '').replace(/\D/g, '');
  if (!waNum) { toast('Este cliente não tem WhatsApp cadastrado.'); return; }

  const itensTxt = (p.itens?.length)
    ? p.itens.map(i => {
      const d = formatarPrecoItemPedido(i);
      return `• ${d.quantidade}x ${d.nome}\n${[d.textoUnidade, d.textoEmbalagem, d.textoSubtotal].filter(Boolean).join(' | ')}`;
    }).join('\n\n')
    : `• ${p.descricao || ''}`;
  const observacao = String(p.observacao || '').trim();
  const detalhes = [
    `*Pedido nº ${p.id}*`,
    `*Total do pedido: ${moeda(p.valor)}*`,
    p.forma_pagamento ? `Pagamento: ${pagamentoSemEmoji(p)}` : '',
    p.data_entrega ? `Entrega prevista: ${dataBR(p.data_entrega)}` : '',
    p.status === 'entregue' && p.data_entregue_em ? `Entregue em: ${dataBR(p.data_entregue_em)}` : '',
    p.data_vencimento ? `Vencimento: ${dataBR(p.data_vencimento)}` : '',
    observacao ? `Observação: ${observacao}` : '',
  ].filter(Boolean).join('\n');
  const nomeCliente = c?.responsavel || c?.nome || '';

  const msg = `${obterSaudacao()}${nomeCliente ? `, ${nomeCliente}` : ''}! 🌿\n\n` +
    `Segue o resumo do seu pedido na *KG Agropet*:\n\n${itensTxt}\n\n` +
    `${detalhes}` +
    `\n\nQualquer dúvida estou à disposição. Obrigado pela preferência! 🙏`;

  window.open(`https://wa.me/55${waNum}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

function verDetalhePedido(id) {
  const p = todosOsPedidos.find(x=>x.id===id);
  if (!p) return;
  document.getElementById('modal-detalhe-pedido').dataset.registroId = String(id);
  document.getElementById('detalhe-pedido-titulo').textContent = `Pedido — ${p.cliente_nome}`;
  const itensHtml = p.itens?.length
    ? p.itens.map(i=>`
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--ol)">
          <span style="font-size:13px;color:var(--creme)">${i.qtd}x ${esc(i.nome||i.produto_nome||'')}${i.qtd_pedida > i.qtd ? ` <small style="color:#f4a04a">(pedido: ${esc(i.qtd_pedida)})</small>` : ''}</span>
          <span style="font-size:13px;color:var(--o1);font-weight:700">${moeda(i.preco_unit*i.qtd)}</span>
        </div>`).join('') + (p.itens.some(i => i.qtd_pedida > i.qtd)
      ? '<div style="font-size:12px;color:#f4a04a;padding:8px 0">⚠ Entrega parcial: o que faltou foi cancelado e o cliente paga só o que recebeu.</div>' : '')
    : `<div style="font-size:13px;color:var(--c2);padding:8px 0">${esc(p.descricao)}</div>`;

  const pagtoTxt = formatarPagamento(p);
  const entregueEmLinha = p.status === 'entregue' && p.data_entregue_em
    ? `<div style="font-size:12px;color:var(--c3);margin-bottom:4px">✅ Entregue em: ${dataBR(p.data_entregue_em)}</div>`
    : '';

  // Status de pagamento (se entregue)
  let statusPagtoLinha = '';
  if (p.status === 'entregue') {
    if (foiPago(p)) {
      const formaReal = ({ dinheiro: 'Dinheiro', pix: 'PIX/Cartão', cheque: 'Cheque' })[p.forma_pagamento_real] || '';
      const dataPgto = p.data_pagamento ? ` em ${dataBR(p.data_pagamento)}` : '';
      statusPagtoLinha = `<div style="font-size:12px;color:#7ec850;margin-bottom:4px;font-weight:700">✓ Pago${formaReal?' ('+formaReal+')':''}${dataPgto}</div>`;
    } else if (p.status_pagamento === 'recusado') {
      statusPagtoLinha = `<div style="font-size:12px;color:#ee7d6f;margin-bottom:4px;font-weight:700">✗ Cliente não pagou</div>`;
    } else {
      statusPagtoLinha = `<div style="font-size:12px;color:#f4a04a;margin-bottom:4px;font-weight:700">⏰ Aguardando pagamento</div>`;
    }
  }

  // Bloco de ajustes de preço (só admin vê — auditoria)
  let blocoAjustes = '';
  if (usuario.perfil === 'admin') {
    const ajustes = listaAjustesPrecos(p);
    if (ajustes.length) {
      blocoAjustes = `
        <div class="bloco-ajustes-precos">
          <div class="bloco-ajustes-precos-titulo">⚠ Preços ajustados neste pedido</div>
          ${ajustes.map(a => `
            <div class="bloco-ajustes-precos-item">
              <span class="nome-prod">${esc(a.nome)} (${a.qtd}x)</span>
              <span style="font-size:11px;color:var(--c3)">
                ${moeda(a.precoCatalogo)} → ${moeda(a.precoCobrado)}
              </span>
              <span class="diff ${a.diff > 0 ? 'subiu' : 'desceu'}">
                ${a.diff > 0 ? '+' : ''}${moeda(a.diff)} (${a.pct > 0 ? '+' : ''}${a.pct.toFixed(0)}%)
              </span>
            </div>
          `).join('')}
        </div>`;
    }
  }

  document.getElementById('detalhe-pedido-conteudo').innerHTML = `
    <div style="background:rgba(10,26,16,.6);border:1px solid var(--ol);border-radius:var(--r);padding:13px;margin-bottom:14px">
      <div style="font-size:12px;color:var(--c3);margin-bottom:4px">📅 Entrega prevista: ${dataBR(p.data_entrega)}${p.data_vencimento ? ` · Venc.: ${dataBR(p.data_vencimento)}` : ''}</div>
      ${entregueEmLinha}
      <div style="font-size:12px;color:var(--c3);margin-bottom:4px">💰 Forma: ${esc(pagtoTxt)}</div>
      ${statusPagtoLinha}
      <div style="font-size:12px;color:var(--c3)">📋 Pedido por: ${esc(p.vendedor||'–')}</div>
    </div>
    ${blocoAjustes}
    <div class="separador">Itens</div>
    ${itensHtml}
    <div style="display:flex;justify-content:space-between;padding:10px 0;margin-top:4px">
      <span style="font-size:14px;font-weight:700;color:var(--creme)">Total</span>
      <span style="font-family:'Cinzel',serif;font-size:16px;font-weight:700;color:var(--o1)">${moeda(p.valor)}</span>
    </div>
    ${p.observacao?`<div style="font-size:12px;color:var(--c3);margin-top:4px">📝 ${esc(p.observacao)}</div>`:''}
    <div id="historico-pedido" data-pedido-id="${p.id}"></div>`;

  // Botão de via do pedido: admin e vendedor (entregador não emite documento)
  const acoesVia = document.getElementById('detalhe-pedido-acoes-via');
  if (acoesVia) {
    acoesVia.innerHTML = ((usuario.perfil === 'admin' || usuario.perfil === 'vendedor')
      ? `<button class="btn-primario mt-12" onclick="fecharModal('modal-detalhe-pedido'); gerarViaPedido(${p.id})">📄 Via do pedido (PDF / Imprimir)</button>`
      : '') +
      // Só o admin desfaz uma entrega (ex.: devolução): o pedido volta a pendente para ser corrigido.
      (usuario.perfil === 'admin' && p.status === 'entregue'
        ? `<button class="btn-perigo w100 mt-8" onclick="desfazerEntrega(${p.id})">↩ Desfazer entrega</button>`
        : '');
  }
  abrirModal('modal-detalhe-pedido');
  carregarHistoricoPedido(p.id);
}

// Desfazer entrega (só admin): o pedido volta a pendente para ser corrigido (devolução,
// item errado) e entregue de novo. Pedido entregue não pode ser editado; este é o caminho.
// O pagamento já recebido continua valendo; "a receber" e "não pagou" são apagados e
// voltam a ser perguntados na próxima entrega. A data da entrega antiga fica no histórico.
let _desfazendoEntrega = false;
async function desfazerEntrega(id) {
  if (_desfazendoEntrega || usuario.perfil !== 'admin') return;
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p || p.status !== 'entregue') return;
  if (!MODO_DEMO && !navigator.onLine) { toast('Sem internet. Para desfazer uma entrega é preciso estar conectado.'); return; }
  const pago = p.status_pagamento === 'pago';
  const parcial = (p.itens || []).some(i => Number(i.qtd_pedida) > Number(i.qtd));
  const ok = await confirmar(
    `Pedido nº ${p.id} — ${p.cliente_nome || 'Cliente'}\n` +
    `Entregue em ${dataBR(dataRealEntrega(p))} · ${moeda(p.valor)}\n\n` +
    'O pedido volta para PENDENTE: sai do relatório de entregas, volta para a lista de entregas e pode ser editado (por exemplo, numa devolução). Depois, marque a entrega de novo.\n\n' +
    (pago ? 'O pagamento já registrado continua valendo.\n\n'
          : 'A situação do pagamento é apagada e será informada de novo na próxima entrega.\n\n') +
    (parcial ? 'Os itens que faltaram na entrega parcial não voltam sozinhos: ajuste o pedido se precisar.\n\n' : '') +
    'Se a comissão deste período já foi acertada, o relatório vai mostrar a mudança.',
    { titulo: 'Desfazer a entrega?', okLabel: 'Desfazer entrega', perigo: true });
  if (!ok) return;
  _desfazendoEntrega = true;
  try {
    const mudancas = pago
      ? { status: 'pendente' }
      : { status: 'pendente', status_pagamento: null, forma_pagamento_real: null, data_pagamento: null };
    if (!MODO_DEMO) {
      // "status=eq.entregue": se outro aparelho já desfez, não faz de novo.
      const res = await apiSupabase('pedidos', 'PATCH', mudancas, `?id=eq.${Number(id)}&status=eq.entregue`);
      if (!res.ok) { toast('A entrega não foi desfeita.\n\nDetalhes: ' + (res.erro || 'desconhecido')); return; }
      if (!Array.isArray(res.dados) || !res.dados.length) {
        toast('Este pedido já não estava entregue no servidor. Os dados serão recarregados.');
        solicitarSincronizacao();
        return;
      }
      const { clientes, itens_pedido, ...linha } = res.dados[0];
      Object.assign(p, linha);
    } else {
      Object.assign(p, mudancas);
    }
    fecharModal('modal-detalhe-pedido');
    registrarMudancaLocal('pedidos');
    toast('↩ Entrega desfeita. O pedido voltou para pendente.');
  } catch (e) {
    toast('A entrega não foi desfeita. ' + e.message);
  } finally {
    _desfazendoEntrega = false;
  }
}

async function carregarHistoricoPedido(pedidoId) {
  const el = document.getElementById('historico-pedido');
  if (!el || MODO_DEMO || usuario.perfil === 'entregador') return;

  el.innerHTML = '<div class="separador">🕘 Histórico do pedido</div><div class="loading"><div class="spinner"></div> Carregando histórico...</div>';
  const res = await apiSupabase('historico_pedidos', 'GET', null,
    `?pedido_id=eq.${pedidoId}&select=acao,alterado_por,campos,criado_em&order=criado_em.desc&limit=20`);

  if (!el.isConnected || el.dataset.pedidoId !== String(pedidoId)) return;
  if (!res.ok) {
    el.innerHTML = '<div class="separador">🕘 Histórico do pedido</div><div class="historico-vazio">Não foi possível carregar o histórico.</div>';
    return;
  }

  const historico = res.dados || [];
  const acoes = { criado:'Pedido criado', editado:'Pedido editado', entregue:'Entrega concluída', pagamento:'Pagamento atualizado' };
  const nomesCampos = {
    cliente_id:'cliente', descricao:'itens', valor:'valor', status:'status',
    data_entrega:'entrega prevista', data_entregue_em:'entregue em', data_vencimento:'vencimento', observacao:'observação',
    forma_pagamento:'forma de pagamento', prazo_dias:'prazo', prazos_boleto:'parcelas',
    status_pagamento:'status do pagamento', forma_pagamento_real:'pagamento recebido',
    data_pagamento:'data do pagamento', vendedor:'vendedor'
  };

  el.innerHTML = '<div class="separador">🕘 Histórico do pedido</div>' +
    (historico.length ? `<div class="historico-lista">${historico.map(h => {
      const data = new Date(h.criado_em);
      const quando = data.toLocaleDateString('pt-BR') + ' às ' + data.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
      const campos = (h.campos || []).map(c => nomesCampos[c]).filter(Boolean);
      // Status mudou sem ser a conclusão da entrega: só acontece quando o admin desfaz a entrega.
      const titulo = h.acao !== 'entregue' && (h.campos || []).includes('status') ? 'Entrega desfeita' : (acoes[h.acao] || h.acao);
      return `<div class="historico-item">
        <div style="font-size:13px;font-weight:700;color:var(--creme)">${esc(titulo)}</div>
        ${campos.length ? `<div style="font-size:11px;color:var(--c2);margin-top:3px">Alterou: ${esc(campos.join(', '))}</div>` : ''}
        <div class="historico-item-data" style="margin-top:5px">📅 ${esc(quando)} · por ${esc(h.alterado_por)}</div>
      </div>`;
    }).join('')}</div>` : '<div class="historico-vazio">Nenhuma alteração registrada.</div>');
}

// ============================================================
// HELPERS DE LÓGICA
// ============================================================
function isEntregaAtrasada(p) {
  return p.status === 'pendente' && !!p.data_entrega && p.data_entrega < fmt(new Date());
}

function isPagamentoAtrasado(p) {
  // Já foi pago de fato? O pagamento não está atrasado.
  if (foiPago(p)) return false;
  if (!p.data_vencimento) return false;
  return p.data_vencimento < fmt(new Date());
}

let _scrollSalvo = 0;
function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) {
    m.dataset.abertura = String(Number(m.dataset.abertura || 0) + 1);
    // Salva a posição de scroll da área que rola (desktop = .conteudo)
    const sc = document.querySelector('.conteudo');
    _scrollSalvo = sc ? sc.scrollTop : window.scrollY;
    m.parentElement.appendChild(m); // O último modal aberto fica acima dos anteriores.
    m.classList.add('aberto');
    document.body.classList.add('modal-aberto'); // congela o app por trás
  }
}
function fecharModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove('aberto');
  // Limpa o estado de edição quando fecha o modal de pedido
  if (id === 'modal-pedido') pedidoEmEdicao = null;
  // Só libera a trava do body se NÃO houver outro modal ainda aberto
  if (!document.querySelector('.modal-overlay.aberto')) {
    document.body.classList.remove('modal-aberto');
    // Restaura a posição de scroll (evita o "pulo" ao fechar no desktop)
    const sc = document.querySelector('.conteudo');
    if (sc && _scrollSalvo) sc.scrollTop = _scrollSalvo;
  }
  if (sincronizacaoPendente && !formularioDeDadosAberto()) {
    sincronizacaoPendente = false;
    solicitarSincronizacao();
  }
}

// Modais só fecham pelo X, pelo botão Cancelar ou pela tecla ESC.
// O click no overlay (área escura) NÃO fecha mais — evita perder dados acidentalmente.

// Fecha modal aberto ao pressionar ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Caixa de confirmação aberta? Ela tem prioridade e trata o ESC sozinha —
    // não fecha o modal que está por trás junto.
    if (document.getElementById('confirmar-overlay')?.classList.contains('aberto')) return;
    // Via de pedido aberta? Fecha ela primeiro
    const via = document.getElementById('via-overlay');
    if (via && via.style.display !== 'none') {
      fecharViaPedido();
      return;
    }
    const aberto = [...document.querySelectorAll('.modal-overlay.aberto')].at(-1);
    if (aberto) {
      fecharModal(aberto.id);
    }
  }
});

// ============================================================
// SERVICE WORKER + ATUALIZAÇÃO AUTOMÁTICA + DETECÇÃO OFFLINE
// ============================================================

let registroServiceWorker = null;
let atualizacaoPendente = false;
let atualizacaoAplicando = false;
let atualizacaoAvisada = false;
let verificacaoAtualizacaoTimer = null;
const INTERVALO_VERIFICACAO_SW = 5 * 60 * 1000;

function formularioLoginEmUso() {
  if (usuario) return false;
  const usuarioInput = document.getElementById('input-usuario');
  const senhaInput = document.getElementById('input-senha');
  const ativo = document.activeElement;
  return Boolean(
    usuarioInput?.value || senhaInput?.value ||
    ativo === usuarioInput || ativo === senhaInput
  );
}

function appOcupadoParaAtualizacao() {
  const confirmacaoAberta = document.getElementById('confirmar-overlay')?.classList.contains('aberto');
  return formularioDeDadosAberto() || confirmacaoAberta || carregandoDados || salvando || sincronizandoDados || _processandoFila || formularioLoginEmUso();
}

function aplicarAtualizacaoSeSegura() {
  if (!atualizacaoPendente || atualizacaoAplicando || appOcupadoParaAtualizacao()) return;
  atualizacaoAplicando = true;
  atualizacaoPendente = false;
  if (verificacaoAtualizacaoTimer) {
    clearInterval(verificacaoAtualizacaoTimer);
    verificacaoAtualizacaoTimer = null;
  }
  // Dá tempo para o novo Service Worker concluir a troca antes de recarregar.
  setTimeout(() => {
    if (appOcupadoParaAtualizacao()) {
      atualizacaoAplicando = false;
      atualizacaoPendente = true;
      iniciarVerificacaoAtualizacaoPendente();
      return;
    }
    location.reload();
  }, 180);
}

function iniciarVerificacaoAtualizacaoPendente() {
  if (verificacaoAtualizacaoTimer) return;
  verificacaoAtualizacaoTimer = setInterval(() => {
    if (!atualizacaoPendente) {
      clearInterval(verificacaoAtualizacaoTimer);
      verificacaoAtualizacaoTimer = null;
      return;
    }
    aplicarAtualizacaoSeSegura();
  }, 1500);
}

function agendarAtualizacaoAutomatica() {
  atualizacaoPendente = true;
  if (appOcupadoParaAtualizacao()) {
    if (usuario && !atualizacaoAvisada) {
      atualizacaoAvisada = true;
      toast('Nova versão pronta. Ela será aplicada quando terminar a ação atual.');
    }
    iniciarVerificacaoAtualizacaoPendente();
    return;
  }
  aplicarAtualizacaoSeSegura();
}

function verificarAtualizacaoServiceWorker() {
  if (!registroServiceWorker || !navigator.onLine) return;
  registroServiceWorker.update().catch(() => {});
}

// Registra e verifica o Service Worker em segundo plano. A atualização é
// aplicada sozinha quando a tela está livre; rascunhos e gravações ficam intactos.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // A primeira troca instala o SW e não precisa recarregar. Depois dela,
    // cada nova troca de controlador representa uma versão nova do app.
    let controladorAnterior = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      registroServiceWorker = reg;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        if (!novo) return;
        novo.addEventListener('statechange', () => {
          if (novo.state === 'installed' && navigator.serviceWorker.controller) {
            novo.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });

      verificarAtualizacaoServiceWorker();
      setInterval(() => {
        if (!document.hidden) verificarAtualizacaoServiceWorker();
      }, INTERVALO_VERIFICACAO_SW);
    }).catch(err => console.warn('SW falhou ao registrar:', err));

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!controladorAnterior) {
        controladorAnterior = true;
        return; // primeira instalação não precisa recarregar
      }
      agendarAtualizacaoAutomatica();
    });
  });
}

// ============================================================
// DETECÇÃO DE STATUS ONLINE/OFFLINE
// ============================================================
function atualizarStatusConexao() {
  const offline = !navigator.onLine;
  document.body.classList.toggle('offline', offline);
  // Se voltou online, tenta processar fila de ações pendentes
  if (!offline && usuario) {
    iniciarRealtime();
    processarFilaOffline();
    solicitarSincronizacao();
  } else if (offline) {
    pararRealtime();
  }
}

window.addEventListener('online',  atualizarStatusConexao);
window.addEventListener('offline', atualizarStatusConexao);
// Estado inicial
atualizarStatusConexao();

// ============================================================
// FILA OFFLINE DE "MARCAR ENTREGUE"
// Quando entregador marca entregue offline, ação fica enfileirada
// em localStorage. Quando volta online, envia tudo automaticamente.
// ============================================================
const FILA_OFFLINE_KEY = 'kg-fila-offline';

function lerFilaOffline() {
  const raw = localStorage.getItem(FILA_OFFLINE_KEY);
  const fila = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(fila)) throw new Error('Fila offline inválida. Preserve os dados deste aparelho e procure suporte.');
  return fila;
}

function gravarFilaOffline(fila) {
  try {
    localStorage.setItem(FILA_OFFLINE_KEY, JSON.stringify(fila));
  } catch (e) {
    throw new Error('Não foi possível guardar a entrega neste aparelho. Libere espaço ou conecte-se à internet e tente novamente.');
  }
}

async function alterarFilaOffline(alterar) {
  const executar = () => gravarFilaOffline(alterar(lerFilaOffline()));
  // Evita que duas abas sobrescrevam entregas uma da outra.
  if (navigator.locks) await navigator.locks.request(FILA_OFFLINE_KEY, executar);
  else executar();
}

async function adicionarNaFilaOffline(acao) {
  const nova = { ...acao, usuarioLogin: usuario?.login || null, ts: Date.now(), acaoId:crypto.randomUUID() };
  await alterarFilaOffline(fila => {
    const repetida = fila.findIndex(a => a.tipo === nova.tipo && a.pedidoId === nova.pedidoId &&
      (a.usuarioLogin || null) === nova.usuarioLogin);
    if (repetida >= 0) fila[repetida] = nova;
    else fila.push(nova);
    return fila;
  });
  atualizarAvisoFila();
}

function acaoOfflinePertenceAoUsuario(acao) {
  if (!usuario) return false;
  if (acao.usuarioLogin) return acao.usuarioLogin === usuario.login;
  return usuario.perfil === 'entregador';
}

// Recusas que não se resolvem tentando de novo (pedido apagado, sem permissão,
// data no futuro...). A entrega continua guardada, marcada com o motivo, e não
// é reenviada sozinha: quem está com o aparelho decide tentar de novo ou descartar.
// Rede, sessão expirada, excesso de pedidos e erro do servidor seguem tentando.
function falhaDefinitivaFila(res) {
  const status = Number(res.status);
  return !res.rede && status >= 400 && status < 500 && ![401, 408, 429, 499].includes(status);
}

function motivoFalhaFila(res) {
  const texto = String(res.erro || '');
  try {
    const corpo = JSON.parse(texto.replace(/^HTTP \d+:\s*/, ''));
    if (corpo?.message) return corpo.message;
  } catch (e) { /* resposta sem JSON: usa o texto como veio */ }
  return texto || 'Recusada pelo servidor.';
}

// Identifica a ação mesmo depois de ganhar o campo "falha".
function chaveAcaoFila(a) {
  return a.acaoId || (a.ts ? `${a.pedidoId}-${a.ts}` : JSON.stringify(a));
}

function falhasDaFila() {
  return lerFilaOffline().filter(a => a.falha && acaoOfflinePertenceAoUsuario(a));
}

function atualizarAvisoFila() {
  const aviso = document.getElementById('aviso-fila-offline');
  if (!aviso) return;
  try {
    const minhas = lerFilaOffline().filter(acaoOfflinePertenceAoUsuario);
    const recusadas = minhas.filter(a => a.falha).length;
    const aguardando = minhas.length - recusadas;
    aviso.hidden = !minhas.length;
    aviso.innerHTML = [
      aguardando ? `${aguardando} entrega(s) aguardando envio. Mantenha este aparelho com os dados do aplicativo até sincronizar.` : '',
      recusadas ? `<b>⚠ ${recusadas} entrega(s) recusada(s) pelo servidor.</b> <button type="button" class="btn-azul" onclick="abrirFalhasFila()">Ver e resolver</button>` : '',
    ].filter(Boolean).join('<br>');
  } catch (e) {
    aviso.hidden = false;
    aviso.textContent = 'Não foi possível ler as entregas offline. Preserve os dados deste aparelho e procure suporte.';
  }
}

// Lista as entregas recusadas, com o motivo, para tentar de novo ou descartar.
function abrirFalhasFila() {
  const el = document.getElementById('fila-falhas-conteudo');
  if (!el) return;
  let falhas;
  try { falhas = falhasDaFila(); } catch (e) { toast(e.message); return; }
  if (!falhas.length) { fecharModal('modal-fila-falhas'); return; }
  el.innerHTML = falhas.map(a => {
    const p = todosOsPedidos.find(x => x.id === a.pedidoId);
    const chave = esc(JSON.stringify(chaveAcaoFila(a)));
    return `
      <div class="fila-falha">
        <div><b>${esc(p?.cliente_nome || 'Pedido não encontrado')}</b> <small>nº ${esc(a.pedidoId)} · entregue em ${esc(dataBR(a.payload?.data_entregue_em))}</small></div>
        <div class="fila-falha-motivo">Motivo: ${esc(a.falha.motivo)}</div>
        <div class="fila-falha-botoes">
          <button type="button" class="btn-azul" onclick="tentarNovamenteFila(${chave})">Tentar de novo</button>
          <button type="button" class="btn-secundario" onclick="descartarAcaoFila(${chave})">Descartar</button>
        </div>
      </div>`;
  }).join('');
  if (!document.getElementById('modal-fila-falhas')?.classList.contains('aberto')) abrirModal('modal-fila-falhas');
}

async function tentarNovamenteFila(chave) {
  try {
    await alterarFilaOffline(fila => fila.map(a => {
      if (chaveAcaoFila(a) !== chave) return a;
      const { falha, ...semFalha } = a;
      return semFalha;
    }));
    await processarFilaOffline();
    const aindaFalha = falhasDaFila().find(a => chaveAcaoFila(a) === chave);
    toast(aindaFalha ? `O servidor recusou de novo: ${aindaFalha.falha.motivo}`
      : 'Tentativa feita. Se não houver outro aviso, a entrega foi registrada.');
  } catch (e) { toast(e.message); }
  abrirFalhasFila();
}

async function descartarAcaoFila(chave) {
  let acao;
  try { acao = falhasDaFila().find(a => chaveAcaoFila(a) === chave); } catch (e) { toast(e.message); return; }
  if (!acao) { abrirFalhasFila(); return; }
  const ok = await confirmar(
    `Descartar a entrega do pedido nº ${acao.pedidoId}?\n\n` +
    `Ela NÃO será registrada no sistema. Se o produto foi mesmo entregue, ` +
    `avise o administrador para registrar a entrega.`
  );
  if (!ok) return;
  try {
    await alterarFilaOffline(fila => fila.filter(a => chaveAcaoFila(a) !== chave));
  } catch (e) { toast(e.message); }
  atualizarAvisoFila();
  abrirFalhasFila();
}

function aplicarFilaOffline(pedidos) {
  try {
    for (const acao of lerFilaOffline()) {
      if (acao.tipo !== 'marcar-entregue' || !acaoOfflinePertenceAoUsuario(acao)) continue;
      // Recusada pelo servidor: o pedido continua como o servidor diz (pendente).
      if (acao.falha) continue;
      const pedido = pedidos.find(p => p.id === acao.pedidoId);
      if (pedido && pedido.status !== 'entregue') {
        const pagamento = pedido.status_pagamento === 'pago' ? {
          status_pagamento: pedido.status_pagamento,
          forma_pagamento_real: pedido.forma_pagamento_real,
          data_pagamento: pedido.data_pagamento,
        } : {};
        Object.assign(pedido, acao.payload, pagamento);
        if (acao.itensEntregues?.length) aplicarEntregaParcialLocal(pedido, acao.itensEntregues);
      }
    }
  } catch (e) { toast(e.message); }
  atualizarAvisoFila();
}

let _processandoFila = false;
async function processarFilaOffline() {
  if (_processandoFila || MODO_DEMO || !navigator.onLine || !usuario) return;
  const loginInicial = usuario.login;
  _processandoFila = true;
  const sucesso = [];
  const recusadas = new Map(); // chave da ação -> motivo
  try {
    for (const acao of lerFilaOffline()) {
      if (usuario?.login !== loginInicial) break;
      if (!acaoOfflinePertenceAoUsuario(acao) || acao.tipo !== 'marcar-entregue' || acao.falha) continue;
      const res = acao.itensEntregues?.length
        ? await apiSupabase('rpc/concluir_entrega_parcial','POST', { p_id:acao.pedidoId, p_dados:acao.payload, p_itens:acao.itensEntregues })
        : await apiSupabase('rpc/concluir_entrega','POST', { p_id:acao.pedidoId, p_dados:acao.payload });
      if (!res.ok) {
        if (falhaDefinitivaFila(res)) recusadas.set(chaveAcaoFila(acao), motivoFalhaFila(res));
        continue;
      }
      sucesso.push(chaveAcaoFila(acao));
      if (usuario?.login === loginInicial) {
        const pedido = todosOsPedidos.find(p => p.id === acao.pedidoId);
        if (pedido) Object.assign(pedido, res.dados);
      }
    }
    // Remove apenas as ações efetivamente enviadas, preservando novas entregas
    // acrescentadas enquanto a rede estava respondendo. As recusadas ficam,
    // marcadas com o motivo, até o usuário decidir.
    if (sucesso.length || recusadas.size) {
      await alterarFilaOffline(fila => fila
        .filter(a => !sucesso.includes(chaveAcaoFila(a)))
        .map(a => recusadas.has(chaveAcaoFila(a))
          ? { ...a, acaoId: a.acaoId || crypto.randomUUID(), falha: { motivo: recusadas.get(chaveAcaoFila(a)), em: Date.now() } }
          : a));
    }
  } catch (e) {
    console.warn('Fila de entregas preservada:', e);
  } finally {
    _processandoFila = false;
    atualizarAvisoFila();
  }
  if ((sucesso.length || recusadas.size) && usuario?.login === loginInicial) {
    registrarMudancaLocal('pedidos');
    // A recusada tinha sido mostrada como entregue neste aparelho; recarrega
    // para voltar a mostrar o que o servidor diz.
    if (recusadas.size) solicitarSincronizacao();
  }
}

// Tenta processar a fila a cada 30s quando online
setInterval(() => {
  if (navigator.onLine && usuario) processarFilaOffline();
}, 30000);

// ============================================================
// INSTALAR PWA (botão "Adicionar à tela inicial")
// ============================================================
let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  // Previne o prompt automático do Chrome
  e.preventDefault();
  _deferredPrompt = e;
  // Mostra nosso banner customizado (só se não foi descartado antes)
  if (!localStorage.getItem('kg-instalar-fechado') && usuario) {
    const banner = document.getElementById('banner-instalar');
    if (banner) banner.style.display = 'flex';
  }
});

async function instalarApp() {
  if (!_deferredPrompt) {
    // Em iOS o prompt automático não existe — instrui manualmente
    toast(
      '📱 Para instalar o KG Entregas:\n\n' +
      '• iPhone (Safari): toque no ícone de compartilhar e escolha "Adicionar à Tela de Início"\n\n' +
      '• Android (Chrome): toque nos 3 pontos do menu e escolha "Instalar app" ou "Adicionar à tela inicial"'
    );
    return;
  }
  _deferredPrompt.prompt();
  await _deferredPrompt.userChoice;
  _deferredPrompt = null;
  fecharBannerInstalar();
}

function fecharBannerInstalar() {
  const banner = document.getElementById('banner-instalar');
  if (banner) banner.style.display = 'none';
  // Lembra que o usuário descartou (não mostra de novo nesta sessão)
  try { localStorage.setItem('kg-instalar-fechado', '1'); } catch(e) {}
}

// Se já está instalado (rodando como PWA), esconde permanentemente
window.addEventListener('appinstalled', () => {
  _deferredPrompt = null;
  fecharBannerInstalar();
});

// ============================================================
// BOTÃO FLUTUANTE "VOLTAR AO TOPO"
// Aparece quando rola mais de 500px. No mobile quem rola é a janela;
// no desktop quem rola é a área .conteudo — escutamos os dois.
// ============================================================
(function() {
  const btn = document.getElementById('btn-topo');
  if (!btn) return;
  let visivel = false;

  function getScroller() {
    const conteudo = document.querySelector('.conteudo');
    // No desktop a .conteudo tem rolagem própria; usamos ela se tiver scroll
    if (conteudo && conteudo.scrollHeight > conteudo.clientHeight + 5
        && getComputedStyle(conteudo).overflowY === 'auto') {
      return conteudo;
    }
    return window;
  }

  function checar() {
    // Não mostra o botão se um modal ou a via estiver aberto
    const viaAberta = document.getElementById('via-overlay')?.style.display !== 'none';
    const modalAberto = !!document.querySelector('.modal-overlay.aberto');
    if (viaAberta || modalAberto) {
      if (visivel) { visivel = false; btn.classList.remove('visivel'); }
      return;
    }
    const sc = getScroller();
    const y = (sc === window) ? window.scrollY : sc.scrollTop;
    const deve = y > 500;
    if (deve !== visivel) {
      visivel = deve;
      btn.classList.toggle('visivel', deve);
    }
  }

  // checar() mede a página (getComputedStyle, scrollHeight): no máximo uma vez
  // por quadro, e não a cada evento, para não travar a rolagem.
  let quadroPendente = 0;
  const agendarChecagem = () => {
    if (quadroPendente) return;
    quadroPendente = requestAnimationFrame(() => { quadroPendente = 0; checar(); });
  };
  // Um ouvinte só: a captura no document recebe a rolagem da janela e a da
  // .conteudo (desktop), já que o evento scroll de elemento não borbulha.
  document.addEventListener('scroll', agendarChecagem, { passive: true, capture: true });

  // Ação do botão: rola o container certo de volta ao topo
  btn.onclick = () => {
    const sc = getScroller();
    if (sc === window) window.scrollTo({ top: 0, behavior: 'smooth' });
    else sc.scrollTo({ top: 0, behavior: 'smooth' });
  };
})();

// ============================================================
// RELATÓRIOS — semanal, quinzenal e mensal (admin e vendedor)
// O relatório é usado para acertar a comissão, então TODO pedido entregue no
// período aparece, um por linha, e soma no total. Os "top 5" são apenas
// complemento, nunca a única listagem.
// Admin vê todos os pedidos; vendedor vê apenas os dele.
// Base do período: data real da entrega, com fallback para pedidos antigos.
// ============================================================
let relTipo = 'semanal';   // 'semanal' | 'quinzenal' | 'mensal'
let relOffset = 0;         // 0 = período atual, -1 = anterior...
let relVendedor = '';      // admin: '' = todos, ou o login do vendedor

// Pedidos buscados no servidor no momento em que o relatório é aberto/impresso.
// A lista em memória pode estar parada se a sincronização automática falhou
// (sem internet, sessão expirada); para a comissão isso não é aceitável.
// acertos: acertos de comissão registrados (null = não foi possível consultar).
let relFonte = { pedidos: null, filaPendente: [], acertos: null, atualizadoEm: null, erro: null, carregando: false };
let relToken = 0;

async function buscarPedidosRelatorio() {
  if (MODO_DEMO) return { ok: true, pedidos: todosOsPedidos, filaPendente: [], acertos: [] };
  const loginInicial = usuario?.login;
  // Entregas feitas sem internet neste aparelho: tenta enviá-las antes de conferir.
  if (navigator.onLine) await processarFilaOffline();
  const [res, acertos] = await Promise.all([
    listarTodos('pedidos', '*,clientes(nome),itens_pedido(*)'),
    buscarAcertosRelatorio(),
  ]);
  if (!usuario || usuario.login !== loginInicial) return { ok: false, erro: 'A sessão foi alterada.' };
  if (!res.ok) return { ok: false, erro: res.erro || 'Falha ao consultar o servidor.' };
  if (res.deCache) return { ok: false, erro: 'O servidor não respondeu; os dados são os do último acesso.' };
  // Aqui NÃO se aplica a fila offline: o total do acerto é só o que o banco confirmou.
  const pedidos = normalizarPedidos(res.dados);
  return { ok: true, pedidos, filaPendente: entregasNaFilaOffline(pedidos), acertos };
}

// Acertos de comissão já registrados. Falha aqui não impede o relatório: só
// deixa de mostrar o que mudou depois do acerto (e o botão de registrar).
async function buscarAcertosRelatorio() {
  try {
    const res = await apiSupabase('acertos_comissao', 'GET', null, '?select=*&order=registrado_em.desc&limit=1000');
    if (!res.ok || res.deCache || !Array.isArray(res.dados)) return null;
    return res.dados;
  } catch (_) { return null; }
}

// Pedidos que este aparelho marcou como entregues, mas que o servidor ainda
// não recebeu. Ficam fora do total e aparecem à parte no relatório.
function entregasNaFilaOffline(pedidos) {
  return lerFilaOffline()
    .filter(a => a.tipo === 'marcar-entregue' && acaoOfflinePertenceAoUsuario(a))
    .map(a => {
      const p = pedidos.find(x => x.id === a.pedidoId);
      return p && p.status !== 'entregue' ? { ...p, data_entregue_em: a.payload?.data_entregue_em || null } : null;
    })
    .filter(Boolean);
}

async function atualizarFonteRelatorio() {
  const token = ++relToken;
  relFonte = { ...relFonte, carregando: true };
  renderizarRelatorio();
  let r;
  try { r = await buscarPedidosRelatorio(); }
  catch (e) { r = { ok: false, erro: e.message }; }
  if (token !== relToken) return relFonte;
  relFonte = r.ok
    ? { pedidos: r.pedidos, filaPendente: r.filaPendente || [], acertos: Array.isArray(r.acertos) ? r.acertos : null, atualizadoEm: new Date(), erro: null, carregando: false }
    : { pedidos: null, filaPendente: [], acertos: null, atualizadoEm: null, erro: r.erro, carregando: false };
  renderizarRelatorio();
  return relFonte;
}

// Sem confirmação do servidor, usa o que está em memória (com aviso na tela e no PDF).
function pedidosBaseRelatorio() {
  return relFonte.pedidos || todosOsPedidos;
}

function abrirModalRelatorio() {
  relTipo = 'semanal';
  relOffset = 0;
  relVendedor = '';
  relFonte = { pedidos: null, filaPendente: [], acertos: null, atualizadoEm: null, erro: null, carregando: true };
  // Reseta abas visuais para a primeira
  document.querySelectorAll('#abas-relatorio .aba').forEach((b, i) => {
    b.classList.toggle('ativa', i === 0);
  });
  renderizarRelatorio();
  abrirModal('modal-relatorio');
  atualizarFonteRelatorio();
}

function mudarTipoRelatorio(tipo, btn) {
  relTipo = tipo;
  relOffset = 0; // sempre volta pro período atual ao trocar de tipo
  document.querySelectorAll('#abas-relatorio .aba').forEach(b => b.classList.remove('ativa'));
  if (btn) btn.classList.add('ativa');
  renderizarRelatorio();
}

function navegarPeriodoRelatorio(delta) {
  // Não deixa avançar para o futuro
  if (relOffset + delta > 0) return;
  relOffset += delta;
  renderizarRelatorio();
}

// Calcula a janela [ini, fim] (strings YYYY-MM-DD) + label legível.
// Todos os períodos são FIXOS no calendário: o mesmo período sempre cobre os
// mesmos dias, não importa quando o relatório é aberto. Assim os acertos de
// comissão encaixam um no outro, sem dia esquecido nem contado duas vezes.
function calcularJanelaRelatorio(tipo, offset) {
  const hoje = new Date(fmt(new Date()) + 'T12:00:00Z');
  offset = Math.trunc(Number(offset) || 0);

  if (tipo === 'semanal') {
    // Semana de segunda a domingo
    const base = new Date(hoje);
    base.setUTCDate(base.getUTCDate() + offset * 7);
    const diaSemana = (base.getUTCDay() + 6) % 7; // 0 = segunda
    const ini = new Date(base); ini.setUTCDate(base.getUTCDate() - diaSemana);
    const fim = new Date(ini);  fim.setUTCDate(ini.getUTCDate() + 6);
    return { ini: fmt(ini), fim: fmt(fim), label: `Semana ${dataBR(fmt(ini))} — ${dataBR(fmt(fim))}` };
  }

  if (tipo === 'quinzenal') {
    // 1ª quinzena = dias 1 a 15; 2ª quinzena = dia 16 até o último dia do mês.
    // (Uma janela móvel de "últimos 15 dias" dependia do dia da consulta e
    // deixava entregas de fora entre um acerto e o seguinte.)
    let idx = hoje.getUTCFullYear() * 24 + hoje.getUTCMonth() * 2 + (hoje.getUTCDate() > 15 ? 1 : 0);
    idx += offset;
    const ano = Math.floor(idx / 24);
    const resto = idx - ano * 24;
    const mes = Math.floor(resto / 2);
    const metade = resto % 2;
    const ini = new Date(Date.UTC(ano, mes, metade ? 16 : 1, 12));
    const fim = metade ? new Date(Date.UTC(ano, mes + 1, 0, 12)) : new Date(Date.UTC(ano, mes, 15, 12));
    return { ini: fmt(ini), fim: fmt(fim), label: `Quinzena ${dataBR(fmt(ini))} — ${dataBR(fmt(fim))}` };
  }

  // mensal
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth() + offset;
  const ini = new Date(Date.UTC(ano, mes, 1, 12));
  const fim = new Date(Date.UTC(ano, mes + 1, 0, 12));
  const nomesMeses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return { ini: fmt(ini), fim: fmt(fim), label: `${nomesMeses[ini.getUTCMonth()]} de ${ini.getUTCFullYear()}` };
}

// Filtra somente pedidos entregues do período (e do vendedor, se for o perfil dele)
function pedidosDoRelatorio(ini, fim, pedidos = todosOsPedidos) {
  return pedidos.filter(p => {
    if (p.status !== 'entregue') return false;
    const data = dataRealEntrega(p);
    if (!data) return false;
    if (data < ini || data > fim) return false;
    if (usuario.perfil === 'vendedor' && p.vendedor !== usuario.login) return false;
    return true;
  }).sort((a, b) => ordenarPedidosRelatorio(a, b, dataRealEntrega));
}

// Pedidos com entrega prevista até o fim do período que ainda NÃO foram
// marcados como entregues. Não entram no total, mas aparecem em destaque:
// uma entrega esquecida de marcar não pode sumir do acerto da comissão.
function pendentesDoRelatorio(fim, pedidos = todosOsPedidos) {
  return pedidos.filter(p => {
    if (p.status === 'entregue') return false;
    if (usuario.perfil === 'vendedor' && p.vendedor !== usuario.login) return false;
    return !p.data_entrega || p.data_entrega <= fim;
  }).sort((a, b) => ordenarPedidosRelatorio(a, b, p => p.data_entrega));
}

function ordenarPedidosRelatorio(a, b, data) {
  const da = data(a) || '', db = data(b) || '';
  if (da !== db) return da < db ? -1 : 1;
  return (Number(a.id) || 0) - (Number(b.id) || 0);
}

// Agrega os números do período. A comissão é paga por unidade de cada
// produto, então o centro do relatório é "quanto de cada produto foi
// entregue". Produtos saem dos próprios itens dos pedidos: um produto
// cadastrado hoje aparece sozinho assim que for entregue, sem lista fixa.
function calcularDadosRelatorio(pedidos, catalogo = []) {
  // Soma em centavos para o total bater exatamente com a soma das linhas.
  const centavos = v => Math.round((Number(v) || 0) * 100);
  const totalC    = pedidos.reduce((s, p) => s + centavos(p.valor), 0);
  const recebidoC = pedidos.filter(p => foiPago(p)).reduce((s, p) => s + centavos(p.valor), 0);

  // Nome atual do catálogo (produto renomeado continua somando junto).
  const nomeCatalogo = new Map(catalogo.map(p => [Number(p.id), p.nome]));
  const chaveProduto = i => (i.produto_id != null && i.produto_id !== '')
    ? `id:${i.produto_id}` : `nome:${i.nome || i.produto_nome || 'Produto'}`;
  const nomeProduto = i => nomeCatalogo.get(Number(i.produto_id)) || i.nome || i.produto_nome || 'Produto';
  const ordemNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true, sensitivity: 'base' });

  const porProduto = new Map();
  const clientesDistintos = new Set();
  const entregas = [];
  let unidadesC = 0;
  pedidos.forEach(p => {
    const cliente = p.cliente_nome || 'Cliente';
    const chaveCliente = p.cliente_id != null && p.cliente_id !== '' ? `id:${p.cliente_id}` : `nome:${cliente}`;
    clientesDistintos.add(chaveCliente);
    const itensEntrega = [];
    (p.itens || []).forEach(i => {
      const chave = chaveProduto(i);
      const nome = nomeProduto(i);
      const qtd = Number(i.qtd) || 0;
      const valorC = Math.round((Number(i.preco_unit) || 0) * qtd * 100);
      if (!porProduto.has(chave)) porProduto.set(chave, { nome, qtd: 0, valorC: 0, clientes: new Map() });
      const prod = porProduto.get(chave);
      prod.qtd += qtd; prod.valorC += valorC;
      if (qtd > 0) {
        if (!prod.clientes.has(chaveCliente)) prod.clientes.set(chaveCliente, { nome: cliente, qtd: 0 });
        prod.clientes.get(chaveCliente).qtd += qtd;
        unidadesC += Math.round(qtd * 100);
        // Entrega parcial: mostra quanto foi pedido, para o acerto não parecer erro.
        const pedida = Number(i.qtd_pedida);
        itensEntrega.push({ nome, qtd, pediu: Number.isFinite(pedida) && pedida > qtd ? pedida : null });
      }
    });
    entregas.push({ id: p.id, data: dataRealEntrega(p), cliente, vendedor: p.vendedor || '',
      valor: Number(p.valor) || 0, pago: foiPago(p), itens: itensEntrega });
  });

  const produtos = [...porProduto.values()]
    .map(p => ({ nome: p.nome, qtd: p.qtd, valor: p.valorC / 100,
      clientes: [...p.clientes.values()].sort(ordemNome) }))
    .sort(ordemNome);

  return { total: totalC / 100, recebido: recebidoC / 100, aReceber: (totalC - recebidoC) / 100,
    nPedidos: pedidos.length, nClientes: clientesDistintos.size, unidades: unidadesC / 100, produtos, entregas };
}

// "Ana (10), Bruno (5)": para quem cada produto foi entregue.
// No PDF, "&" vira "e": a fonte embutida não tem o símbolo e a linha ficaria em outra letra.
function textoClientesProduto(prod, paraPdf = false) {
  return prod.clientes.map(c => `${paraPdf ? c.nome.replace(/\s*&\s*/g, ' e ') : c.nome} (${qtdTexto(c.qtd)})`).join(', ');
}

// Produtos de uma entrega: um por linha ou, para economizar papel, em uma linha só.
function textoItensEntrega(entrega, emLinha = false) {
  const itens = entrega.itens.map(i => `${qtdTexto(i.qtd)}x ${i.nome}${i.pediu ? ` (pediu ${qtdTexto(i.pediu)})` : ''}`);
  return itens.join(emLinha ? ', ' : '\n') || 'Sem itens detalhados';
}

function dataRealEntregaCurta(d) {
  return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
}

function nomeVendedorRelatorio(v) {
  if (v === 'admin') return 'Admin (Kleber)';
  if (v === 'vendedor') return 'Vendedor';
  return v || 'Sem vendedor';
}

function qtdTexto(q) {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100).replace('.', ',');
}

function textoFonteRelatorio() {
  if (relFonte.carregando) return { classe: '', texto: 'Conferindo com o servidor…' };
  if (relFonte.erro) return { classe: 'erro', texto: 'Não foi possível conferir com o servidor. Os números abaixo são os salvos neste aparelho e podem estar incompletos. Não use para acertar comissão.' };
  if (relFonte.atualizadoEm) {
    const h = relFonte.atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return { classe: 'ok', texto: `Conferido com o servidor às ${h}` };
  }
  return { classe: '', texto: '' };
}

// Admin escolhe de qual vendedor é o relatório (o acerto é por vendedor).
function filtrarVendedorRelatorio(lista) {
  if (usuario.perfil !== 'admin' || !relVendedor) return lista;
  return lista.filter(p => (p.vendedor || '') === relVendedor);
}

// Vendedores do filtro: os do período mais o escolhido, que não pode sumir da lista
// só porque não entregou nada no período (senão o filtro fica ativo e invisível).
function vendedoresDoFiltro(vendedores, escolhido) {
  return [...new Set([...vendedores, escolhido].filter(Boolean))]
    .sort((a, b) => nomeVendedorRelatorio(a).localeCompare(nomeVendedorRelatorio(b), 'pt-BR'));
}

function mudarVendedorRelatorio(v) {
  relVendedor = v;
  renderizarRelatorio();
}

// ===== Acerto de comissão =====
// O administrador registra o acerto de um vendedor num período; o banco guarda,
// pedido a pedido, as unidades e o valor. Depois, o relatório compara com o que
// está no servidor e mostra o que mudou (devolução, correção, entrega lançada
// tarde), para acertar a diferença no próximo pagamento. Nada fica travado.

// Unidades de um pedido, como o relatório conta (soma das quantidades dos itens).
function unidadesDoPedido(p) {
  return (p.itens || []).reduce((s, i) => s + Math.round(Math.max(0, Number(i.qtd) || 0) * 100), 0) / 100;
}

// De quem é o acerto mostrado: o vendedor logado, o escolhido pelo admin ou,
// sem filtro, o único vendedor do período.
function vendedorDoAcerto(vendedores) {
  if (usuario.perfil === 'vendedor') return usuario.login || '';
  if (usuario.perfil !== 'admin') return '';
  if (relVendedor) return relVendedor;
  return vendedores.length === 1 ? vendedores[0] : '';
}

// Último acerto registrado exatamente para este vendedor e período.
function acertoDoPeriodo(acertos, vendedor, ini, fim) {
  if (!vendedor || !Array.isArray(acertos)) return null;
  return acertos.filter(a => a.vendedor === vendedor && a.ini === ini && a.fim === fim)
    .sort((a, b) => (Date.parse(b.registrado_em) || 0) - (Date.parse(a.registrado_em) || 0))[0] || null;
}

// O que mudou desde o acerto: pedidos que entraram, saíram ou mudaram de unidades/valor.
function diferencasDoAcerto(acerto, pedidos) {
  const c = v => Math.round((Number(v) || 0) * 100);
  const antes = new Map((acerto.pedidos || []).map(x => [Number(x.id), x]));
  const agora = new Map(pedidos.map(p => [Number(p.id), p]));
  const mudancas = [];
  agora.forEach((p, id) => {
    const a = antes.get(id);
    const m = { id, cliente: p.cliente_nome || a?.cliente || 'Cliente',
      antesUn: Number(a?.unidades) || 0, agoraUn: unidadesDoPedido(p),
      antesValor: Number(a?.valor) || 0, agoraValor: Number(p.valor) || 0 };
    if (!a) mudancas.push({ ...m, tipo: 'entrou' });
    else if (c(m.antesUn) !== c(m.agoraUn) || c(m.antesValor) !== c(m.agoraValor)) mudancas.push({ ...m, tipo: 'mudou' });
  });
  antes.forEach((a, id) => {
    if (!agora.has(id)) mudancas.push({ id, cliente: a.cliente || 'Cliente', tipo: 'saiu',
      antesUn: Number(a.unidades) || 0, agoraUn: 0, antesValor: Number(a.valor) || 0, agoraValor: 0 });
  });
  mudancas.sort((x, y) => x.id - y.id);
  return { mudancas,
    difUnidades: mudancas.reduce((s, m) => s + c(m.agoraUn) - c(m.antesUn), 0) / 100,
    difValor: mudancas.reduce((s, m) => s + c(m.agoraValor) - c(m.antesValor), 0) / 100 };
}

// Textos só com letras, números e pontuação simples: saem iguais na tela e no PDF.
function textoMudancaAcerto(m) {
  if (m.tipo === 'entrou') return `entrou depois do acerto (${qtdTexto(m.agoraUn)} un, ${moeda(m.agoraValor)})`;
  if (m.tipo === 'saiu') return `saiu do período (${qtdTexto(m.antesUn)} un, ${moeda(m.antesValor)})`;
  const partes = [];
  if (Math.round(m.antesUn * 100) !== Math.round(m.agoraUn * 100)) partes.push(`de ${qtdTexto(m.antesUn)} para ${qtdTexto(m.agoraUn)} un`);
  if (Math.round(m.antesValor * 100) !== Math.round(m.agoraValor * 100)) partes.push(`de ${moeda(m.antesValor)} para ${moeda(m.agoraValor)}`);
  return 'mudou: ' + partes.join(', ');
}

function textoDiferencaAcerto(dif) {
  const parte = (n, f) => n === 0 ? null : `${f(Math.abs(n))} a ${n > 0 ? 'mais' : 'menos'}`;
  return [parte(dif.difUnidades, v => qtdTexto(v) + ' un'), parte(dif.difValor, moeda)].filter(Boolean).join(', ')
    || 'mesmo total, pedidos diferentes';
}

function dataHoraAcerto(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const fuso = { timeZone: 'America/Sao_Paulo' };
  return `${d.toLocaleDateString('pt-BR', fuso)} às ${d.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' })}`;
}

// Bloco do acerto na tela: situação do acerto e, para o admin, o botão de registrar.
function htmlAcertoRelatorio(r) {
  const admin = usuario.perfil === 'admin';
  if (!admin && usuario.perfil !== 'vendedor') return '';
  if (!Array.isArray(relFonte.acertos)) {
    return relFonte.atualizadoEm ? '<div class="rel-status">Não foi possível consultar os acertos de comissão registrados.</div>' : '';
  }
  let html = '';
  const { acerto, difAcerto, vendedorAcerto } = r;
  if (acerto) {
    const quando = dataHoraAcerto(acerto.registrado_em);
    const base = `${qtdTexto(Number(acerto.unidades) || 0)} un · ${moeda(Number(acerto.total) || 0)}`;
    if (!difAcerto.mudancas.length) {
      html += `<div class="rel-acerto ok">✓ Acerto registrado em ${esc(quando)}: <b>${esc(base)}</b>. Nada mudou desde então.</div>`;
    } else {
      html += `
      <details class="rel-alerta rel-acerto-mudou" open>
        <summary><b>⚠ Mudou depois do acerto de ${esc(quando)}</b><span>${esc(textoDiferencaAcerto(difAcerto))}</span></summary>
        <div class="rel-alerta-texto">No acerto: <b>${esc(base)}</b>. Acerte a diferença no próximo pagamento${admin ? ' e registre o acerto de novo' : ''}.</div>
        ${difAcerto.mudancas.map(m => `
          <div class="rel-linha">
            <span class="rel-linha-nome">${esc(m.cliente)} <small>nº ${esc(m.id)}</small>
              <span class="rel-acerto-mudanca">${esc(textoMudancaAcerto(m))}</span></span>
          </div>`).join('')}
      </details>`;
    }
  }
  if (admin) {
    if (vendedorAcerto) {
      const pronto = !!relFonte.atualizadoEm && !relFonte.erro && !relFonte.carregando && !r.naFila.length;
      html += `<button type="button" class="btn-azul rel-btn-acerto"${pronto ? '' : ' disabled'} onclick="registrarAcertoRelatorio()">${acerto ? 'Registrar novo acerto' : 'Registrar acerto deste período'} · ${esc(nomeVendedorRelatorio(vendedorAcerto))}</button>`;
      if (!pronto) html += '<div class="rel-status">Para registrar o acerto, confira com o servidor e envie as entregas pendentes deste aparelho.</div>';
    } else if (r.vendedores.length > 1) {
      html += '<div class="rel-status">Para registrar o acerto da comissão, escolha o vendedor acima.</div>';
    }
  }
  return html ? `<div class="rel-acerto-bloco">${html}</div>` : '';
}

let _registrandoAcerto = false;
async function registrarAcertoRelatorio() {
  if (_registrandoAcerto || usuario.perfil !== 'admin') return;
  if (MODO_DEMO) { toast('No modo demonstração o acerto não é registrado.'); return; }
  const r = montarRelatorio();
  const vendedor = r.vendedorAcerto;
  if (!vendedor) { toast('Escolha o vendedor do acerto.'); return; }
  if (!relFonte.atualizadoEm || relFonte.erro || relFonte.carregando || r.naFila.length) {
    toast('Confira o relatório com o servidor (e envie as entregas deste aparelho) antes de registrar o acerto.');
    return;
  }
  const doVendedor = r.pedidos.filter(p => (p.vendedor || '') === vendedor);
  const unidades = doVendedor.reduce((s, p) => s + Math.round(unidadesDoPedido(p) * 100), 0) / 100;
  const total = doVendedor.reduce((s, p) => s + Math.round((Number(p.valor) || 0) * 100), 0) / 100;
  const emAndamento = r.fim >= fmt(new Date());
  const ok = await confirmar(
    `${nomeVendedorRelatorio(vendedor)} — ${r.label}\n\n` +
    `${doVendedor.length} pedido(s) · ${qtdTexto(unidades)} unidade(s) · ${moeda(total)}\n\n` +
    (emAndamento ? 'Atenção: este período ainda não terminou. O que for entregue depois vai aparecer como mudança.\n\n' : '') +
    'Depois de registrar, qualquer mudança neste período (devolução, correção, entrega lançada depois) aparece em destaque no relatório.',
    { titulo: r.acerto ? 'Registrar novo acerto?' : 'Registrar acerto da comissão?', okLabel: 'Registrar acerto' });
  if (!ok) return;
  _registrandoAcerto = true;
  try {
    const res = await apiSupabase('rpc/registrar_acerto', 'POST', { p_vendedor: vendedor, p_tipo: relTipo, p_ini: r.ini, p_fim: r.fim });
    const novo = Array.isArray(res.dados) ? res.dados[0] : res.dados;
    if (!res.ok || !novo || typeof novo !== 'object') {
      toast('O acerto não foi registrado.\n\nDetalhes: ' + (res.erro || 'resposta inválida do servidor'));
      return;
    }
    relFonte = { ...relFonte, acertos: [novo, ...(relFonte.acertos || [])] };
    const dif = diferencasDoAcerto(novo, doVendedor);
    toast(dif.mudancas.length
      ? 'Acerto registrado, mas o servidor tinha dados diferentes desta tela. Veja o aviso no relatório.'
      : '✓ Acerto registrado.');
    renderizarRelatorio();
  } catch (e) {
    toast('O acerto não foi registrado. ' + e.message);
  } finally {
    _registrandoAcerto = false;
  }
}

// Tudo que o relatório mostra, na tela e no PDF, sai daqui.
function montarRelatorio() {
  const { ini, fim, label } = calcularJanelaRelatorio(relTipo, relOffset);
  const base = pedidosBaseRelatorio();
  const entreguesTodos = pedidosDoRelatorio(ini, fim, base);
  const pedidos = filtrarVendedorRelatorio(entreguesTodos);
  // Entregues neste aparelho e ainda não enviados: fora do total, listados à parte
  // (e não repetidos entre os "sem baixa", pois a entrega já aconteceu).
  const fila = relFonte.filaPendente || [];
  const idsNaFila = new Set(fila.map(p => p.id));
  const naFila = filtrarVendedorRelatorio(fila.filter(p => {
    const data = p.data_entregue_em;
    if (usuario.perfil === 'vendedor' && p.vendedor !== usuario.login) return false;
    return !data || (data >= ini && data <= fim);
  }));
  const pendentes = filtrarVendedorRelatorio(pendentesDoRelatorio(fim, base)).filter(p => !idsNaFila.has(p.id));
  const d = calcularDadosRelatorio(pedidos, typeof todosOsProdutos !== 'undefined' ? todosOsProdutos : []);
  // Vendedores do período, para os botões de filtro do admin. Quem teve acerto
  // registrado no período também entra, mesmo que todos os pedidos tenham saído.
  const comAcerto = (relFonte.acertos || []).filter(a => a.ini === ini && a.fim === fim).map(a => a.vendedor);
  const vendedores = [...new Set([...entreguesTodos.map(p => p.vendedor), ...comAcerto].filter(Boolean))]
    .sort((a, b) => nomeVendedorRelatorio(a).localeCompare(nomeVendedorRelatorio(b), 'pt-BR'));
  const vendedorAcerto = vendedorDoAcerto(vendedores);
  const acerto = acertoDoPeriodo(relFonte.acertos, vendedorAcerto, ini, fim);
  const difAcerto = acerto ? diferencasDoAcerto(acerto, pedidos.filter(p => (p.vendedor || '') === vendedorAcerto)) : null;
  return { ini, fim, label, pedidos, pendentes, naFila, d, vendedores, vendedorAcerto, acerto, difAcerto };
}

function renderizarRelatorio() {
  const rel = montarRelatorio();
  const { fim, label, pedidos, pendentes, naFila, d, vendedores } = rel;
  document.getElementById('rel-periodo-label').textContent = label;

  // Desabilita seta "próximo" quando já está no período atual
  const btnProx = document.getElementById('rel-nav-proximo');
  if (btnProx) btnProx.disabled = (relOffset >= 0);

  const el = document.getElementById('relatorio-conteudo');
  const admin = usuario.perfil === 'admin';

  const fonte = textoFonteRelatorio();
  const htmlFonte = fonte.texto ? `
    <div class="rel-status ${fonte.classe}">${esc(fonte.texto)}${relFonte.erro
      ? ' <button type="button" class="btn-azul" onclick="atualizarFonteRelatorio()">Tentar novamente</button>' : ''}</div>` : '';

  const listaVendedores = vendedoresDoFiltro(vendedores, relVendedor);
  const opcoesVendedor = admin && (listaVendedores.length > 1 || relVendedor) ? `
    <div class="rel-filtro" role="group" aria-label="Vendedor">
      ${['', ...listaVendedores].map(v => `
        <button type="button" class="rel-chip${v === relVendedor ? ' ativa' : ''}"
          onclick="mudarVendedorRelatorio(${esc(JSON.stringify(v))})">${esc(v === '' ? 'Todos' : nomeVendedorRelatorio(v))}</button>`).join('')}
    </div>` : '';

  const htmlPendentes = pendentes.length ? `
    <details class="rel-alerta">
      <summary><b>⚠ ${pendentes.length} pedido(s) sem baixa de entrega</b><span>fora do total · ver</span></summary>
      <div class="rel-alerta-texto">Previstos até ${esc(dataBR(fim))}. Se já foram entregues, marque a entrega para entrarem no relatório.</div>
      ${pendentes.map(p => `
        <div class="rel-linha">
          <span class="rel-linha-nome">${esc(p.cliente_nome || 'Cliente')} <small>nº ${esc(p.id)} · ${esc(p.data_entrega ? dataRealEntregaCurta(p.data_entrega) : 'sem data')}</small></span>
          <span class="rel-linha-valor">${moeda(p.valor)}</span>
        </div>`).join('')}
    </details>` : '';

  const htmlFila = naFila.length ? `
    <details class="rel-alerta" open>
      <summary><b>⚠ ${naFila.length} entrega(s) ainda não enviada(s) ao servidor</b><span>fora do total</span></summary>
      <div class="rel-alerta-texto">Foram marcadas como entregues neste aparelho, sem internet. Conecte-se e toque em "Tentar novamente" antes de acertar a comissão.
        <button type="button" class="btn-azul" onclick="atualizarFonteRelatorio()">Tentar novamente</button></div>
      ${naFila.map(p => `
        <div class="rel-linha">
          <span class="rel-linha-nome">${esc(p.cliente_nome || 'Cliente')} <small>nº ${esc(p.id)} · ${esc(p.data_entregue_em ? dataRealEntregaCurta(p.data_entregue_em) : 'sem data')}</small></span>
          <span class="rel-linha-valor">${moeda(p.valor)}</span>
        </div>`).join('')}
    </details>` : '';

  const htmlResumo = `
    <div class="rel-resumo">
      <div><b>${moeda(d.total)}</b><span>Entregue</span></div>
      <div><b>${d.nPedidos}</b><span>Pedidos</span></div>
      <div class="${d.aReceber > 0 ? 'rel-laranja' : ''}"><b>${moeda(d.aReceber)}</b><span>A receber</span></div>
    </div>
    <div class="rel-resumo-sub">${d.nClientes} cliente(s) · ${qtdTexto(d.unidades)} unidade(s)</div>`;
  const htmlAcerto = htmlAcertoRelatorio(rel);

  if (!pedidos.length) {
    const deQuem = usuario.perfil === 'vendedor' ? ' (seus pedidos)' : (relVendedor ? ` de ${nomeVendedorRelatorio(relVendedor)}` : '');
    el.innerHTML = htmlFonte + opcoesVendedor + htmlResumo + htmlAcerto + htmlFila + htmlPendentes +
      `<div class="rel-vazio">Nenhum pedido entregue neste período${esc(deQuem)}.</div>`;
    return;
  }

  el.innerHTML = `
    ${htmlFonte}
    ${opcoesVendedor}
    ${htmlResumo}
    ${htmlAcerto}
    ${htmlFila}
    ${htmlPendentes}

    <div class="rel-secao">
      <div class="rel-secao-titulo">Produtos entregues <span>${d.produtos.length}</span></div>
      ${d.produtos.map(p => `
        <div class="rel-bloco">
          <div class="rel-linha">
            <span class="rel-linha-nome">${esc(p.nome)}</span>
            <span class="rel-linha-qtd">${qtdTexto(p.qtd)} un</span>
          </div>
          <div class="rel-linha-sub">${esc(textoClientesProduto(p))}</div>
        </div>`).join('') || '<div class="rel-vazio">Pedidos sem itens detalhados</div>'}
    </div>

    <div class="rel-secao">
      <div class="rel-secao-titulo">Entregas do período <span>${d.entregas.length}</span></div>
      ${d.entregas.map(e => `
        <div class="rel-bloco">
          <div class="rel-linha">
            <span class="rel-linha-nome">${esc(e.cliente)} <small>nº ${esc(e.id)} · ${esc(dataRealEntregaCurta(e.data))}</small></span>
            <span class="rel-linha-valor">${moeda(e.valor)}</span>
          </div>
          <div class="rel-linha-sub">${esc(textoItensEntrega(e, true))} · <b class="${e.pago ? 'rel-pago' : 'rel-a-receber'}">${e.pago ? 'Pago' : 'A receber'}</b></div>
        </div>`).join('')}
    </div>`;
}

// Gera o Blob do PDF do relatório. Retorna { blob, url, nomeArquivo }.
async function gerarPdfRelatorio(ini, fim, label) {
  await _carregarBibliotecasPdf();
  await _carregarAssetsVia();
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('Biblioteca jsPDF não está carregada.');
  }
  const { pendentes, naFila, d, acerto, difAcerto } = montarRelatorio();
  const escopo = usuario.perfil === 'vendedor'
    ? `Vendedor: ${usuario.nome || usuario.login}`
    : (relVendedor ? `Vendedor: ${nomeVendedorRelatorio(relVendedor)}` : 'Todos os vendedores');
  // Com todos os vendedores misturados, cada entrega mostra de quem é.
  const mostrarVendedor = usuario.perfil === 'admin' && !relVendedor && new Set(d.entregas.map(e => e.vendedor)).size > 1;
  // As fontes embutidas (recortadas) não têm vários símbolos: & ' + ! ? " % # · ª
  // e outros somem do PDF. Textos fixos trocam o símbolo; nas tabelas, a célula
  // com um desses símbolos usa a Helvetica, para o nome do cliente sair inteiro.
  const seguro = t => String(t ?? '').replace(/·/g, '—').replace(/–/g, '-').replace(/ª/g, 'a').replace(/#/g, 'Nº ');

  const { jsPDF } = window.jspdf;
  // Papel ofício (216 x 330 mm). O relatório deve caber em 2 folhas: se passar,
  // o texto é adensado (primeiro os produtos em uma linha, depois sem o detalhe
  // de clientes por produto, que já aparece na lista de entregas).
  const NIVEIS = [
    { fonte: 9,   folga: 1.8, emLinha: false, clientesNoProduto: true },
    { fonte: 8.5, folga: 1.3, emLinha: true,  clientesNoProduto: true },
    { fonte: 8,   folga: 1,   emLinha: true,  clientesNoProduto: false },
  ];
  const desenhar = (cfg) => {
  const doc = new jsPDF({ unit: 'mm', format: [216, 330] });
  const { FONT_CINZEL, FONT_NUNITO } = _registrarFontesPdf(doc);
  const fontesEmbutidas = FONT_NUNITO !== 'helvetica';
  const pageW = 216, pageH = 330;
  const mL = 14, mR = 14, mT = 14, mB = 18;
  const cW = pageW - mL - mR;
  const topoContinuacao = mT + 27; // abaixo do cabeçalho repetido nas páginas seguintes
  const VERDE = [25, 66, 42], CINZA = [110, 110, 110], LARANJA = [196, 105, 15];

  const drawCabecalho = (yRef) => {
    if (_viaAssets.logoPng) {
      try { doc.addImage(_viaAssets.logoPng, 'PNG', mL, yRef, 19, 19, undefined, 'FAST'); }
      catch (e) { /* relatório continua sem imagem se o PNG falhar */ }
    }
    doc.setFont(FONT_CINZEL, 'bold'); doc.setFontSize(16); doc.setTextColor(...VERDE);
    doc.text('KG AGROPET', mL + 23, yRef + 8);
    doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(7.5); doc.setTextColor(80, 80, 80);
    doc.text('Glória do Goitá — PE', mL + 23, yRef + 14);
    doc.setFont(FONT_CINZEL, 'bold'); doc.setFontSize(12); doc.setTextColor(...VERDE);
    doc.text('RELATÓRIO DE ENTREGAS', pageW - mR, yRef + 7, { align: 'right' });
    doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(8.5); doc.setTextColor(80, 80, 80);
    doc.text(seguro(label), pageW - mR, yRef + 13, { align: 'right' });
    doc.setDrawColor(212, 175, 55); doc.setLineWidth(0.45);
    doc.line(mL, yRef + 21, pageW - mR, yRef + 21);
  };
  const drawRodape = (pagina, totalPaginas) => {
    const y = pageH - mB + 4;
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
    doc.line(mL, y - 4, pageW - mR, y - 4);
    doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(7); doc.setTextColor(130, 130, 130);
    doc.text('Este documento não substitui documento fiscal.', mL, y);
    doc.text(`Página ${pagina} de ${totalPaginas}`, pageW - mR, y, { align: 'right' });
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageW / 2, y, { align: 'center' });
  };
  // Tabelas sem grade: só uma linha fina entre as linhas, visual limpo.
  const estiloTabela = {
    theme: 'plain',
    rowPageBreak: 'avoid',
    margin: { left: mL, right: mR, top: topoContinuacao, bottom: mB + 8 },
    styles: { font: FONT_NUNITO, fontSize: cfg.fonte, cellPadding: { top: cfg.folga, bottom: cfg.folga, left: 2, right: 2 }, textColor: [40, 40, 40], overflow: 'linebreak' },
    headStyles: { textColor: VERDE, font: FONT_CINZEL, fontStyle: 'bold', fontSize: 7.5, fillColor: false },
    footStyles: { textColor: VERDE, font: FONT_NUNITO, fontStyle: 'bold', fontSize: cfg.fonte + 0.5, fillColor: [240, 244, 240] },
  };
  let y = mT;
  const garantirEspaco = (altura) => {
    if (y + altura > pageH - mB - 8) { doc.addPage(); y = topoContinuacao; }
  };
  const tabela = (opcoes) => {
    garantirEspaco(20);
    const direita = Object.entries(opcoes.columnStyles || {}).filter(([, e]) => e.halign === 'right').map(([i]) => Number(i));
    const { aoParsear, ...resto } = opcoes;
    doc.autoTable({ ...estiloTabela, startY: y, showFoot: 'lastPage', ...resto,
      didParseCell: data => {
        // columnStyles não vale para cabeçalho/rodapé; alinha os valores à direita.
        if (data.section !== 'body' && direita.includes(data.column.index)) data.cell.styles.halign = 'right';
        if (fontesEmbutidas && pdfPrecisaFonteReserva(data.cell.text.join('\n'))) {
          data.cell.text = data.cell.text.map(pdfTextoSeguro);
          data.cell.styles.font = 'helvetica'; data.cell.styles.fontStyle = 'normal'; data.cell.styles.textColor = [95, 95, 95];
        }
        if (aoParsear) aoParsear(data);
      },
      // Linha fina sob cada linha (e mais forte sob o cabeçalho).
      didDrawCell: opcoes.didDrawCell || (data => {
        if (data.column.index !== 0) return;
        const forte = data.section === 'head';
        doc.setDrawColor(...(forte ? VERDE : [225, 225, 222])); doc.setLineWidth(forte ? 0.3 : 0.15);
        const yl = data.cell.y + data.cell.height;
        doc.line(mL, yl, pageW - mR, yl);
      }) });
    y = doc.lastAutoTable.finalY + 8;
  };
  const tituloSecao = (texto, cor = VERDE) => {
    garantirEspaco(26);
    doc.setFont(FONT_CINZEL, 'bold'); doc.setFontSize(10); doc.setTextColor(...cor);
    doc.text(seguro(texto), mL, y);
    y += 2.5;
  };

  drawCabecalho(y);
  y += 28;

  // Período e escopo em uma linha
  doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9); doc.setTextColor(60, 60, 60);
  doc.text(seguro(`${dataBR(ini)} a ${dataBR(fim)}  —  ${escopo}`), mL, y);
  doc.setFontSize(7.5); doc.setTextColor(...CINZA);
  doc.text('Considera a data em que a entrega foi concluída.', mL, y + 4.5);
  y += 11;

  // Avisos: sem conferência com o servidor, ou entregas deste aparelho não enviadas
  const avisos = [];
  if (relFonte.erro || !relFonte.atualizadoEm) {
    avisos.push('ATENÇÃO: este relatório foi gerado SEM conferir com o servidor e pode estar incompleto. Não use para acertar comissão; gere novamente com internet.');
  }
  if (naFila.length) {
    avisos.push(`ATENÇÃO: ${naFila.length} entrega(s) feita(s) neste aparelho ainda não chegaram ao servidor e estão FORA do total. Envie-as e gere novamente antes de acertar comissão.`);
  }
  avisos.forEach(texto => {
    const aviso = doc.splitTextToSize(texto, cW - 6);
    const h = aviso.length * 4 + 4;
    doc.setFillColor(253, 236, 234); doc.setDrawColor(192, 57, 43); doc.setLineWidth(0.4);
    doc.roundedRect(mL, y, cW, h, 1.5, 1.5, 'FD');
    doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(8.5); doc.setTextColor(150, 30, 20);
    doc.text(aviso, mL + 3, y + 5);
    y += h + 5;
  });

  // Resumo: cinco números
  const cards = [
    ['Total entregue', moeda(d.total)],
    ['Pedidos entregues', String(d.nPedidos)],
    ['Clientes', String(d.nClientes)],
    ['Unidades', qtdTexto(d.unidades)],
    ['A receber', moeda(d.aReceber)],
  ];
  const cardW = (cW - 4 * 3) / 5;
  cards.forEach((c, i) => {
    const cx = mL + i * (cardW + 3);
    doc.setFillColor(248, 249, 246); doc.setDrawColor(222, 224, 218); doc.setLineWidth(0.25);
    doc.roundedRect(cx, y, cardW, 15, 1.5, 1.5, 'FD');
    doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(11); doc.setTextColor(...(i === 4 && d.aReceber > 0 ? LARANJA : VERDE));
    doc.text(c[1], cx + cardW / 2, y + 7, { align: 'center' });
    doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(6.5); doc.setTextColor(...CINZA);
    doc.text(c[0].toUpperCase(), cx + cardW / 2, y + 11.5, { align: 'center' });
  });
  y += 23;

  // Acerto de comissão já registrado para este período: o que mudou depois.
  if (acerto) {
    const quando = dataHoraAcerto(acerto.registrado_em);
    const base = `${qtdTexto(Number(acerto.unidades) || 0)} un, ${moeda(Number(acerto.total) || 0)}`;
    if (!difAcerto.mudancas.length) {
      garantirEspaco(10);
      doc.setFont(FONT_NUNITO, 'bold'); doc.setFontSize(8.5); doc.setTextColor(...VERDE);
      doc.text(seguro(`Acerto registrado em ${quando}: ${base}. Nada mudou desde então.`), mL, y);
      y += 8;
    } else {
      tituloSecao(`Mudou depois do acerto de ${quando}: ${textoDiferencaAcerto(difAcerto)}`, LARANJA);
      tabela({
        head: [['Pedido', 'Cliente', 'O que mudou']],
        body: difAcerto.mudancas.map(m => [String(m.id), m.cliente, textoMudancaAcerto(m)]),
        foot: [[{ content: `No acerto: ${base}. Acerte a diferença no próximo pagamento.`, colSpan: 3 }]],
        headStyles: { ...estiloTabela.headStyles, textColor: LARANJA },
        columnStyles: { 0: { cellWidth: 18 }, 1: { cellWidth: 62 } },
      });
    }
  }

  // Pedidos sem baixa de entrega: alerta logo após o resumo
  if (pendentes.length) {
    tituloSecao(`Atenção: ${pendentes.length} pedido(s) sem baixa de entrega (fora do total)`, [170, 40, 30]);
    tabela({
      head: [['Cliente', 'Pedido', 'Previsto', 'Valor']],
      body: pendentes.map(p => [p.cliente_nome || 'Cliente', String(p.id),
        p.data_entrega ? dataBR(p.data_entrega) : 'sem data', moeda(p.valor)]),
      headStyles: { ...estiloTabela.headStyles, textColor: [150, 30, 20] },
      columnStyles: { 1: { cellWidth: 18 }, 2: { cellWidth: 24 }, 3: { halign: 'right', cellWidth: 30 } },
    });
  }

  if (naFila.length) {
    tituloSecao(`Entregas não enviadas ao servidor: ${naFila.length} (fora do total)`, [170, 40, 30]);
    tabela({
      head: [['Cliente', 'Pedido', 'Entregue', 'Valor']],
      body: naFila.map(p => [p.cliente_nome || 'Cliente', String(p.id),
        p.data_entregue_em ? dataBR(p.data_entregue_em) : 'sem data', moeda(p.valor)]),
      headStyles: { ...estiloTabela.headStyles, textColor: [150, 30, 20] },
      columnStyles: { 1: { cellWidth: 18 }, 2: { cellWidth: 24 }, 3: { halign: 'right', cellWidth: 30 } },
    });
  }

  if (!d.nPedidos) {
    garantirEspaco(10);
    doc.setFont(FONT_NUNITO, 'normal'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 80);
    doc.text('Nenhum pedido entregue neste período.', mL, y);
    y += 10;
  } else {
    // Total de cada produto no período (base da comissão por unidade), com os
    // clientes que receberam cada um.
    tituloSecao('Produtos entregues');
    const somaProdutos = d.produtos.reduce((s, p) => s + Math.round(p.valor * 100), 0) / 100;
    if (cfg.clientesNoProduto) {
      tabela({
        head: [['Produto', 'Quantidade', 'Valor', 'Entregue para (quantidade)']],
        body: d.produtos.map(p => [p.nome, `${qtdTexto(p.qtd)} un`, moeda(p.valor), textoClientesProduto(p, true)]),
        foot: [['Total', `${qtdTexto(d.unidades)} un`, moeda(somaProdutos), '']],
        columnStyles: { 0: { cellWidth: 46 }, 1: { halign: 'right', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 26 } },
      });
    } else {
      tabela({
        head: [['Produto', 'Quantidade', 'Valor']],
        body: d.produtos.map(p => [p.nome, `${qtdTexto(p.qtd)} un`, moeda(p.valor)]),
        foot: [['Total', `${qtdTexto(d.unidades)} un`, moeda(somaProdutos)]],
        columnStyles: { 1: { halign: 'right', cellWidth: 30 }, 2: { halign: 'right', cellWidth: 34 } },
      });
    }

    // Cada entrega, com o cliente, para conferir pedido a pedido.
    tituloSecao('Entregas do período');
    const cabecalho = ['Data', 'Pedido', 'Cliente', 'Produtos entregues', 'Valor', 'Pagamento'];
    if (mostrarVendedor) cabecalho.push('Vendedor');
    const colunaPagamento = 5;
    tabela({
      head: [cabecalho],
      body: d.entregas.map(e => {
        const linha = [dataRealEntregaCurta(e.data), String(e.id), e.cliente, textoItensEntrega(e, cfg.emLinha),
          moeda(e.valor), e.pago ? 'Pago' : 'A receber'];
        if (mostrarVendedor) linha.push(nomeVendedorRelatorio(e.vendedor));
        return linha;
      }),
      foot: [[{ content: `Total do período — ${d.nPedidos} pedido(s)`, colSpan: 4 }, moeda(d.total),
        ...Array(cabecalho.length - 5).fill('')]],
      columnStyles: { 0: { cellWidth: 13 }, 1: { cellWidth: 14 }, 2: { cellWidth: 44 }, 4: { halign: 'right', cellWidth: 24 },
        5: { cellWidth: 23 }, ...(mostrarVendedor ? { 6: { cellWidth: 25 } } : {}) },
      aoParsear: data => {
        if (data.section === 'body' && data.column.index === colunaPagamento && data.cell.text.join('') === 'A receber') {
          data.cell.styles.textColor = LARANJA; data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  // Cabeçalho e rodapé no fim, quando o total de páginas já é conhecido.
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    if (i > 1) drawCabecalho(mT);
    drawRodape(i, totalPaginas);
  }
  return doc;
  };

  // Usa o nível menos adensado que caiba em 2 folhas. Se nenhum couber, fica com
  // o que usa menos folhas (a letra nunca passa de 8 pt, para continuar legível).
  let doc = null;
  for (const cfg of NIVEIS) {
    const tentativa = desenhar(cfg);
    if (!doc || tentativa.internal.getNumberOfPages() < doc.internal.getNumberOfPages()) doc = tentativa;
    if (doc.internal.getNumberOfPages() <= 2) break;
  }

  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const sufixo = usuario.perfil === 'admin' && relVendedor ? `-${relVendedor}` : '';
  const nomeArquivo = `relatorio-${relTipo}${sufixo}-${label.replace(/[^\w]+/g, '-').toLowerCase()}.pdf`;
  return { blob, url, nomeArquivo };
}

// Gera PDF do relatório e mostra na overlay
async function imprimirRelatorio() {
  const flowToken = ++_viaFlowToken;
  const overlay = document.getElementById('via-overlay');
  const papel = document.getElementById('via-papel');
  if (overlay) overlay.style.display = 'flex';
  const loadingEl = document.createElement('div');
  loadingEl.className = 'via-loading';
  loadingEl.innerHTML = '<div class="via-spinner"></div><div class="via-loading-text">Gerando relatório...</div>';
  if (papel) { papel.innerHTML = ''; papel.appendChild(loadingEl); }
  window.__viaLoadingEl = loadingEl;
  try {
    // Confere de novo com o servidor: o PDF é o documento do acerto.
    await atualizarFonteRelatorio();
    if (flowToken !== _viaFlowToken) return;
    const { ini, fim, label } = calcularJanelaRelatorio(relTipo, relOffset);
    const { blob, url, nomeArquivo } = await gerarPdfRelatorio(ini, fim, label);
    if (flowToken !== _viaFlowToken) {
      try { URL.revokeObjectURL(url); } catch (_) {}
      return;
    }
    await showPdfViaOverlay(url, nomeArquivo, blob, null);
    fecharModal('modal-relatorio');
  } catch (e) {
    if (flowToken !== _viaFlowToken) return;
    console.error('Erro ao gerar PDF do relatório:', e);
    if (loadingEl) loadingEl.remove();
    window.__viaLoadingEl = null;
    if (papel) papel.innerHTML = `<div class="via-erro">❌ ${esc(e.message)}<br><br>Tente novamente ou atualize o aplicativo.</div>`;
    toast('Não foi possível gerar o PDF do relatório: ' + e.message, 'erro');
  }
}

// ============================================================
// INICIALIZAÇÃO — tenta restaurar sessão salva (PWA reaberto).
// Se houver sessão válida, entra direto no app; senão, mostra o login.
// ============================================================
restaurarSessao();
