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

// Perfil e nome exibido de cada usuário. Isto é apenas UI — a RLS trata todo
// usuário logado igual (acesso total). Se um dia quiser permissões reais no
// banco, dá pra migrar para roles + policies por role.
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
    if (/^❌|erro|falh|inválid|invalid|incorret|não pode|nao pode|obrigatóri/.test(t)) tipo = 'erro';
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
function confirmar(mensagem, opts = {}) {
  return new Promise(resolve => {
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
      overlay.classList.remove('aberto');
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') fechar(false);
      else if (e.key === 'Enter')  fechar(true);
    };
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
  const seguro = esc(textoOriginal || '');
  if (!termo || !termo.trim()) return seguro;
  const palavras = termo.trim().split(/\s+/).filter(Boolean);
  // Para cada palavra, gera regex que ignora acentos do texto original
  let resultado = seguro;
  palavras.forEach(palavra => {
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
      return variantes[c] || c;
    }).join('');
    try {
      const re = new RegExp('(' + padraoChars + ')', 'gi');
      resultado = resultado.replace(re, '<mark class="busca-match">$1</mark>');
    } catch(e) { /* regex inválida — ignora highlight */ }
  });
  return resultado;
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
        else if (t === 'clientes')    renderizarClientes(todosOsClientes);
        else if (t === 'financeiro')  renderizarFinanceiro(filtroFinanceiro);
        else if (t === 'meus-pedidos') renderizarMeusPedidos(filtroMeusPedidos);
        else if (t === 'inicio-vendedor') renderizarInicioVendedor();
        else if (t === 'carrinho')    renderizarCarrinho();
      } catch(e) { console.error('Erro ao renderizar', t, e); }
    });
  });
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
async function aplicarDadosReceita(dados) {
  if (!dados) return;

  // 1) Avisa se CNPJ inativo/suspenso/baixado ANTES de preencher
  const descSit = (dados.descricao_situacao_cadastral || '').toUpperCase();
  if (descSit && descSit !== 'ATIVA') {
    const continuar = await confirmar(
      `⚠ Atenção! Este CNPJ está com situação cadastral "${descSit}" na Receita Federal.\n\n` +
      `Pode indicar que a empresa está inativa, suspensa ou baixada.\n\n` +
      `Deseja preencher os dados mesmo assim?`
    );
    if (!continuar) return;
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

  const res = await consultarCNPJ(digitos);

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
  await aplicarDadosReceita(d);
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
async function supabase(tabela, metodo='GET', dados=null, filtros='', _retry=true) {
  if (MODO_DEMO) return { ok:true, dados:null };
  // Sem sessão logada, a RLS bloqueia tudo — nem tenta a chamada.
  if (!sessao) return { ok:false, erro:'Sessão expirada. Faça login novamente.', status:401 };

  // Renova o token proativamente se estiver perto de expirar
  await garantirTokenValido();

  try {
    const headers = {
      'apikey': SUPABASE_KEY,                          // anon key: só identifica o projeto
      'Authorization': `Bearer ${sessao.access_token}`, // token do usuário: é o que a RLS valida
      'Content-Type': 'application/json',
    };
    if (metodo==='POST' || metodo==='PATCH') headers['Prefer'] = 'return=representation';
    const opts = { method:metodo, headers };
    if (dados) opts.body = JSON.stringify(dados);

    // Timeout de 15s — se a rede do entregador estiver ruim, aborta
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 15000);
    opts.signal = ctrl.signal;

    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}${filtros}`, opts);
    } finally {
      clearTimeout(timeoutId);
    }

    // Token expirou/ficou inválido no meio do uso: renova UMA vez e refaz.
    if (res.status === 401 && _retry) {
      const renovou = await authRefresh();
      if (renovou) return supabase(tabela, metodo, dados, filtros, false);
      forcarRelogin();
      return { ok:false, erro:'Sessão expirada. Faça login novamente.', status:401 };
    }

    if (!res.ok) {
      const txt = await res.text();
      console.error(`[Supabase ${metodo} ${tabela}] HTTP ${res.status}:`, txt);
      return { ok:false, erro: `HTTP ${res.status}: ${txt}`, status: res.status };
    }
    if (metodo==='DELETE') return { ok:true, dados:true };
    return { ok:true, dados: await res.json() };
  } catch(e) {
    if (e.name === 'AbortError') {
      console.warn(`[Supabase ${metodo} ${tabela}] Timeout (15s) — verifique a internet`);
      return { ok:false, erro: 'Tempo esgotado. Verifique sua conexão de internet e tente novamente.' };
    }
    console.error(`[Supabase ${metodo} ${tabela}] Erro de rede:`, e);
    return { ok:false, erro: e.message };
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
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:'POST',
      headers:{ 'apikey':SUPABASE_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    if (!res.ok) return { ok:false };
    return { ok:true, sessao: montarSessao(await res.json()) };
  } catch(e) {
    // Erro de rede ≠ senha errada — quem chama mostra mensagem apropriada
    return { ok:false, rede:true, erro:e.message };
  }
}

// Renova o access_token usando o refresh_token
async function authRefresh() {
  if (!sessao?.refresh_token) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method:'POST',
      headers:{ 'apikey':SUPABASE_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ refresh_token: sessao.refresh_token }),
    });
    if (!res.ok) return false;
    sessao = montarSessao(await res.json());
    persistirSessao();
    return true;
  } catch(e) {
    return false;
  }
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
  usuario = salvo.usuario;

  // Começa com um token fresco. Se o refresh falhar E o access já expirou,
  // descarta e cai na tela de login normalmente.
  // EXCEÇÃO: sem internet o refresh sempre falha — nesse caso MANTÉM a sessão
  // e entra mesmo assim (offline-first: os dados vêm do cache do Service Worker
  // e a fila offline segura as ações até a conexão voltar).
  const renovou = await authRefresh();
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
function mostrarErroLogin() {
  document.getElementById('erro-login').style.display = 'block';
}

async function fazerLogin() {
  const u = document.getElementById('input-usuario').value.trim().toLowerCase();
  const s = document.getElementById('input-senha').value;   // senha é case-sensitive — NÃO alterar
  const email  = LOGIN_EMAILS[u];
  const perfil = PERFIS[u];
  if (!email || !perfil) { mostrarErroLogin(); return; }

  // Feedback: evita duplo-clique e mostra que está acontecendo algo
  const btn = document.querySelector('#tela-login .btn-primario');
  if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }

  const r = await authLogin(email, s);

  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }

  if (!r.ok) {
    if (r.rede) {
      toast('📡 Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'erro');
    } else {
      mostrarErroLogin();
    }
    return;
  }

  sessao  = r.sessao;
  usuario = { login:u, ...perfil };
  persistirSessao();
  document.getElementById('erro-login').style.display = 'none';
  entrarNoApp();
}

// Configura a UI e carrega os dados depois que já há sessão + usuario.
// Usado tanto no login manual quanto na restauração de sessão.
function entrarNoApp() {
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
  pararAutoRefresh();

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
  // Restaura telas que podem ter sido escondidas por outro perfil
  ['tela-dashboard','tela-clientes','tela-financeiro','tela-catalogo','tela-meus-pedidos','tela-entregas','tela-inicio-vendedor']
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
    { id:'inicio-vendedor', icone:'🏠', label:'Início',       tela:'tela-inicio-vendedor' },
    { id:'meus-pedidos',    icone:'📋', label:'Meus pedidos', tela:'tela-meus-pedidos'    },
    { id:'catalogo',        icone:'🛒', label:'Catálogo',     tela:'tela-catalogo'        },
    { id:'clientes',        icone:'🏪', label:'Clientes',     tela:'tela-clientes'        },
  ],
  entregador: [
    { id:'entregas', icone:'🚚', label:'Entregas do dia', tela:'tela-entregas' },
  ],
};

const TITULOS = {
  dashboard:'Início', entregas:'Entregas', clientes:'Clientes',
  financeiro:'Financeiro', catalogo:'Catálogo',
  'meus-pedidos':'Meus Pedidos', 'inicio-vendedor':'Início',
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
}

function navegarPara(id) {
  const p = usuario.perfil;
  const itens = NAV[p] || NAV.entregador;
  const item = itens.find(i => i.id===id);
  if (!item) return;

  // Reset completo ao trocar de aba: limpa buscas + filtros + scroll
  resetarBuscasEFiltros();

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
  if (id==='inicio-vendedor') renderizarInicioVendedor();
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
      toast('Erro ao carregar dados. Verifique sua conexão e recarregue a página.');
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
  if (usuario.perfil==='vendedor') {
    renderizarInicioVendedor();
    renderizarMeusPedidos(filtroMeusPedidos);
  }
  popularSelectClientes();

  // Limpa checklists antigos (>30 dias) e órfãos (pedidos deletados)
  if (usuario.perfil === 'entregador') limpezaChecklistAntigos();

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

    // Detecta se algo mudou (comparando hash completo dos pedidos)
    const novosPedidos = (resPed.dados || []).map(p => ({
      ...p,
      cliente_nome: p.clientes?.nome || '–',
      itens: p.itens_pedido || [],
      descricao: (p.itens_pedido || []).map(i => `${i.qtd}x ${i.nome}`).join(', ') || p.descricao || '',
    }));

    // Hash incluindo TODOS os campos que importam para a UI
    const hashPedido = (p) => {
      const itensHash = (p.itens || []).map(i => `${i.produto_id}:${i.qtd}:${i.preco_unit||0}`).sort().join(',');
      return `${p.id}|${p.status}|${p.status_pagamento||''}|${p.data_pagamento||''}|${p.valor}|${p.cliente_id}|${p.data_entrega}|${p.data_vencimento}|${p.observacao||''}|${p.forma_pagamento||''}|${p.prazos_boleto||''}|${itensHash}`;
    };
    // Hash de produtos e clientes: detecta EDIÇÕES, não só adições/remoções.
    // (Antes comparava por length — preço editado pelo admin não aparecia
    //  na tela do vendedor até a quantidade de itens mudar.)
    const hashProduto = (p) => `${p.id}|${p.nome}|${p.preco}|${p.preco_custo||''}|${p.categoria||''}`;
    const hashCliente = (c) => `${c.id}|${c.nome}|${c.whatsapp||''}|${c.endereco||''}|${c.email||''}|${c.observacao||''}`;
    const mudou =
      novosPedidos.map(hashPedido).join('\n') !== todosOsPedidos.map(hashPedido).join('\n') ||
      (resCli.dados || []).map(hashCliente).join('\n') !== todosOsClientes.map(hashCliente).join('\n') ||
      (resProd.dados || []).map(hashProduto).join('\n') !== todosOsProdutos.map(hashProduto).join('\n');

    todosOsPedidos  = novosPedidos;
    todosOsClientes = resCli.dados || [];
    todosOsProdutos = resProd.dados || [];

    // Re-renderiza só se algo mudou (para não causar flicker)
    if (mudou) {
      renderizarDashboard();
      renderizarEntregas(filtroEntregas);
      // Catálogo: preserva a busca que o usuário estiver digitando
      rerenderizarCatalogoMantendoBusca();
      // Clientes: idem — não apaga a busca ativa
      const buscaCli = document.getElementById('busca-clientes');
      if (buscaCli && buscaCli.value.trim()) {
        _buscarClienteImpl(buscaCli.value);
      } else {
        renderizarClientes(todosOsClientes);
      }
      if (usuario.perfil==='vendedor') {
        renderizarInicioVendedor();
        renderizarMeusPedidos(filtroMeusPedidos);
      }
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
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesPassado = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
  const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);

  // Pedidos do mês (FATURAMENTO REAL = entregues E PAGOS)
  const pedidosMes = todosOsPedidos.filter(p =>
    p.status === 'entregue' &&
    foiPago(p) &&
    p.data_entrega &&
    new Date(p.data_entrega+'T12:00:00') >= inicioMes
  );
  const pedidosMesPassado = todosOsPedidos.filter(p =>
    p.status === 'entregue' &&
    foiPago(p) &&
    p.data_entrega &&
    new Date(p.data_entrega+'T12:00:00') >= inicioMesPassado &&
    new Date(p.data_entrega+'T12:00:00') <= fimMesPassado
  );

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

  // Card 3: Atrasados
  const atras = todosOsPedidos.filter(p => isAtrasado(p));
  const valorAtras = atras.reduce((s,p)=>s+(Number(p.valor)||0),0);
  document.getElementById('num-atrasados').textContent = atras.length;
  document.getElementById('info-atrasados').textContent = atras.length ? moeda(valorAtras) : 'Tudo em dia ✓';

  // Card 4: Clientes ativos (com pelo menos 1 pedido)
  const clientesAtivos = new Set(todosOsPedidos.map(p => p.cliente_id)).size;
  document.getElementById('num-clientes').textContent = clientesAtivos;
  document.getElementById('info-clientes').textContent = `${todosOsClientes.length} cadastrados`;

  // ATALHOS — badges
  document.getElementById('badge-cobrar').textContent = atras.length || '';

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
  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const inicioMesPassado = new Date(hoje.getFullYear(), hoje.getMonth()-1, 1);
  const fimMesPassado = new Date(hoje.getFullYear(), hoje.getMonth(), 0);

  const meusPedidos = todosOsPedidos.filter(p => p.vendedor === usuario.login);
  const meusPedidosMes = meusPedidos.filter(p =>
    p.status === 'entregue' && foiPago(p) && p.data_entrega &&
    new Date(p.data_entrega+'T12:00:00') >= inicioMes
  );
  const meusPedidosMesAnt = meusPedidos.filter(p =>
    p.status === 'entregue' && foiPago(p) && p.data_entrega &&
    new Date(p.data_entrega+'T12:00:00') >= inicioMesPassado &&
    new Date(p.data_entrega+'T12:00:00') <= fimMesPassado
  );
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
  const porCli = {};
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
  const mapa = {};
  for (let i = dias-1; i >= 0; i--) {
    const d = new Date(agora);
    d.setDate(d.getDate() - i);
    mapa[fmt(d)] = 0;
  }
  let total = 0;
  todosOsPedidos.forEach(p => {
    if (p.status !== 'entregue' || !foiPago(p) || !p.data_entrega) return;
    if (vendedorLogin && p.vendedor !== vendedorLogin) return;
    if (mapa[p.data_entrega] !== undefined) {
      const v = Number(p.valor) || 0;
      mapa[p.data_entrega] += v;
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
  const totalPorCliente = {};
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
  const totalPorProduto = {};
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
  const porVendedor = {};
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
  const atras = todosOsPedidos.filter(p => isAtrasado(p));
  if (!atras.length) {
    toast('🎉 Nenhum pagamento atrasado no momento!');
    return;
  }
  // Agrupa por cliente
  const porCliente = {};
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
    <div class="modal-titulo">📲 Cobrar Atrasados (${lista.length} cliente${lista.length>1?'s':''})</div>
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
    <button class="btn-secundario mt-12" onclick="fecharModal('modal-detalhe-pedido')">Fechar</button>
  `;
  document.getElementById('detalhe-pedido-titulo').textContent = '';
  document.getElementById('detalhe-pedido-conteudo').innerHTML = html;
  abrirModal('modal-detalhe-pedido');
}

// ============================================================
// RESET HISTÓRICO DE PEDIDOS (admin only, dupla confirmação)
// ============================================================
function abrirModalReset() {
  if (usuario?.perfil !== 'admin') {
    toast('Apenas o admin pode executar essa ação.');
    return;
  }
  // Mostra quantidade no modal
  const qtd = todosOsPedidos.length;
  document.getElementById('reset-qtd-pedidos').textContent = qtd;
  document.getElementById('confirma-reset').value = '';
  abrirModal('modal-reset');
}

async function executarResetPedidos() {
  if (salvando) return;
  if (usuario?.perfil !== 'admin') {
    toast('Apenas o admin pode executar essa ação.');
    return;
  }

  // CONFIRMAÇÃO 1: precisa digitar LIMPAR
  const confirma = document.getElementById('confirma-reset').value.trim().toUpperCase();
  if (confirma !== 'LIMPAR') {
    toast('Você precisa digitar exatamente a palavra "LIMPAR" para confirmar.');
    return;
  }

  // CONFIRMAÇÃO 2: prompt nativo do navegador
  const qtd = todosOsPedidos.length;
  if (qtd === 0) {
    toast('Não há pedidos para apagar.');
    fecharModal('modal-reset');
    return;
  }
  const ok = await confirmar(
    `⚠️ ÚLTIMA CONFIRMAÇÃO\n\n` +
    `Você vai apagar ${qtd} pedido(s) PERMANENTEMENTE.\n\n` +
    `Esta ação não pode ser desfeita.\n\n` +
    `Tem certeza absoluta?`
  );
  if (!ok) return;

  salvando = true;
  const btn = document.getElementById('btn-confirmar-reset');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Apagando, aguarde...'; }

  try {
    if (!MODO_DEMO) {
      // 1º apaga TODOS os itens_pedido
      const resItens = await supabase('itens_pedido','DELETE',null,'?id=gt.0');
      if (!resItens.ok) {
        toast('Erro ao apagar itens dos pedidos.\n\nDetalhes: ' + (resItens.erro || 'desconhecido'));
        return;
      }
      // 2º apaga TODOS os pedidos
      const resPed = await supabase('pedidos','DELETE',null,'?id=gt.0');
      if (!resPed.ok) {
        toast('Erro ao apagar pedidos.\n\nDetalhes: ' + (resPed.erro || 'desconhecido'));
        return;
      }
    }

    // Limpa estado local
    todosOsPedidos = [];

    fecharModal('modal-reset');

    // Atualiza tudo
    agendarRender('dashboard');
    agendarRender('entregas');
    agendarRender('financeiro');

    toast(`✓ Histórico de ${qtd} pedido(s) foi apagado com sucesso.\n\nClientes e produtos foram mantidos.`);
  } catch (e) {
    console.error('Erro ao resetar:', e);
    toast('Erro inesperado ao resetar: ' + e.message);
  } finally {
    salvando = false;
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Sim, apagar tudo definitivamente'; }
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

  // Ordena
  lista.sort((a,b) => (a.data_entrega||'').localeCompare(b.data_entrega||''));
  const el = document.getElementById('lista-entregas');
  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📭</div><p>Nenhuma entrega aqui</p></div>`;
    return;
  }

  // Modo rota: agrupa por bairro
  if (modoEntregas === 'rota' && usuario.perfil === 'entregador') {
    el.innerHTML = renderizarRotaPorBairro(lista);
  } else {
    el.innerHTML = lista.map(p => cardEntrega(p, true)).join('');
  }
}

// Extrai bairro do endereço (último item após vírgula ou hífen)
function extrairBairro(endereco) {
  if (!endereco) return 'Sem endereço';
  const partes = endereco.split(/[,\-]/).map(s => s.trim()).filter(Boolean);
  return partes[partes.length - 1] || 'Sem endereço';
}

// Renderiza entregas agrupadas por bairro
function renderizarRotaPorBairro(lista) {
  const porBairro = {};
  lista.forEach(p => {
    const cliente = todosOsClientes.find(c => c.id === p.cliente_id);
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
  const atrasado = isAtrasado(p);
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
  const isAdmin = usuario.perfil==='admin';

  // Mostra o toggle só pro admin
  const toggle = document.getElementById('toggle-margem-catalogo');
  if (toggle) toggle.style.display = isAdmin ? '' : 'none';

  if (!lista.length) {
    el.innerHTML=`<div class="vazio"><div class="vazio-icone">📦</div><p>Nenhum produto aqui</p></div>`;
    return;
  }
  el.innerHTML = lista.map(p => montarCardProduto(p, isAdmin)).join('');
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
          <span class="${cls}">+${pct.toFixed(0)}% (${moeda(lucro)})</span>
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
            <button class="btn-qtd" onclick="alterarQtdCarrinho(${c.produto.id},-1)" aria-label="Diminuir 1">−</button>
            <input type="number" class="qtd-input" value="${c.qtd}" min="1" step="1"
                   inputmode="numeric"
                   onchange="definirQtdCarrinho(${c.produto.id}, this.value)"
                   onfocus="this.select()">
            <button class="btn-qtd" onclick="alterarQtdCarrinho(${c.produto.id},1)" aria-label="Aumentar 1">+</button>
          </div>
          <div class="carrinho-acoes">
            <div class="carrinho-subtotal">${moeda(subtotal)}</div>
            <button class="btn-remover" onclick="removerDoCarrinho(${c.produto.id})" aria-label="Remover produto">🗑️</button>
          </div>
        </div>
      </div>`;
  }).join('');
  totalEl.textContent = moeda(total);
}

// Permite definir quantidade exata digitando
function definirQtdCarrinho(produtoId, valorStr) {
  const idx = carrinho.findIndex(c => c.produto.id === produtoId);
  if (idx < 0) return;
  const qtd = Math.max(1, Math.floor(Number(valorStr) || 1));
  carrinho[idx].qtd = qtd;
  renderizarCarrinho();
  const termo = document.getElementById('busca-produto-modal').value;
  buscarProdutoModal(termo);
}

// Remove totalmente o produto do carrinho
function removerDoCarrinho(produtoId) {
  carrinho = carrinho.filter(c => c.produto.id !== produtoId);
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
  const novo = parseFloat(novoStr);
  if (isNaN(novo) || novo < 0) {
    toast('Informe um preço válido (maior ou igual a zero).');
    return;
  }
  c.preco_unit = novo;
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
  el.innerHTML = lista.map(c => {
    const pedidosCli = todosOsPedidos.filter(p => p.cliente_id===c.id);
    // "Em aberto" = tudo que ainda não foi PAGO (inclui entregue sem pagar),
    // mesma régua do Financeiro — antes usava só o status de entrega e divergia.
    const devendo = pedidosCli.filter(p => !foiPago(p)).reduce((s,p)=>s+(Number(p.valor)||0),0);
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
  const porCliente = {};
  todosOsClientes.forEach(c => { porCliente[c.id]={ cliente:c, pedidos:[] }; });
  todosOsPedidos.forEach(p => { if (porCliente[p.cliente_id]) porCliente[p.cliente_id].pedidos.push(p); });

  let totalDev=0, totalRec=0;
  const mes = new Date().toISOString().slice(0,7);
  Object.values(porCliente).forEach(({pedidos}) => {
    pedidos.forEach(p => {
      // DEVE: ainda não foi pago de verdade (pendente OU entregue sem pagar)
      if (!foiPago(p)) totalDev += Number(p.valor)||0;
      // RECEBIDO: foi pago de fato, no mês atual (usa data_pagamento se houver, senão data_entrega)
      else {
        const dataRef = p.data_pagamento || p.data_entrega;
        if (dataRef?.startsWith(mes)) totalRec += Number(p.valor)||0;
      }
    });
  });
  document.getElementById('fin-total-devendo').textContent  = moeda(totalDev);
  document.getElementById('fin-total-recebido').textContent = moeda(totalRec);

  const lista = Object.values(porCliente).filter(({pedidos}) => {
    const dev  = pedidos.filter(p => !foiPago(p));
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
    const dev  = pedidos.filter(p => !foiPago(p));
    const atras= dev.filter(p => isAtrasado(p));
    const totalD = dev.reduce((s,p)=>s+(Number(p.valor)||0),0);
    const badge = atras.length>0
      ? `<span class="badge badge-atrasado">⚠ Atrasado</span>`
      : totalD>0 ? `<span class="badge badge-devendo">Em aberto</span>`
      : `<span class="badge badge-em-dia">Em dia</span>`;
    const info = atras.length ? `${atras.length} entrega(s) atrasada(s)`
               : dev.length  ? `${dev.length} entrega(s) em aberto` : 'Sem pendências';
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

function verFinanceiroCliente(id) {
  const c = todosOsClientes.find(x => x.id===id);
  if (!c) return;
  clienteSelecionado = c;
  // Cobrança = tudo que ainda não foi PAGO (inclui entregue sem pagar —
  // que é justamente quem mais precisa ser cobrado)
  const pedidos = todosOsPedidos.filter(p => p.cliente_id===id && !foiPago(p));
  const total = pedidos.reduce((s,p)=>s+(Number(p.valor)||0),0);
  const wa = (c.whatsapp||'').replace(/\D/g,'');

  // Monta mensagem de cobrança pronta e inteligente
  const msgCobranca = montarMensagemCobranca(c, pedidos, total);
  const linkWa = wa ? `https://wa.me/55${wa}?text=${encodeURIComponent(msgCobranca)}` : '';

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
    ${linkWa?`<a href="${linkWa}" target="_blank" rel="noopener"
      style="display:block;margin-top:12px;background:var(--gnb);color:var(--gn);border:1px solid rgba(39,174,96,.3);
             border-radius:var(--r);padding:12px;text-align:center;text-decoration:none;font-weight:700;font-size:14px">
      📲 Enviar cobrança no WhatsApp</a>`:''}`;
  abrirModal('modal-fin-cliente');
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
    const atrasado = isAtrasado(p);
    // NÃO usar esc() aqui: mensagem de WhatsApp é texto puro, não HTML —
    // esc() faria "Ração & Cia" virar "Ração &amp; Cia" na conversa.
    corpo = atrasado
      ? `Consta em nosso sistema um pagamento *em atraso* referente ao pedido de ${p.descricao}, no valor de *${moeda(p.valor)}*, com vencimento em ${dataBR(p.data_vencimento)}.`
      : `Passando para lembrar do pagamento referente ao pedido de ${p.descricao}, no valor de *${moeda(p.valor)}*, com vencimento em ${dataBR(p.data_vencimento)}.`;
  } else {
    const linhas = pedidos.map(p => {
      const flag = isAtrasado(p) ? ' ⚠ (em atraso)' : '';
      return `• ${p.descricao} — ${moeda(p.valor)} (venc. ${dataBR(p.data_vencimento)})${flag}`;
    }).join('\n');
    const temAtraso = pedidos.some(p => isAtrasado(p));
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
  // Pega TODOS que ainda não estão pagos: pendentes de entrega OU entregues sem pagamento
  const paraPagar = todosOsPedidos.filter(p =>
    p.cliente_id === clienteSelecionado.id && !foiPago(p)
  );
  if (!paraPagar.length) { fecharModal('modal-fin-cliente'); return; }
  salvando = true;
  try {
    const hojeStr = fmt(new Date());
    // IMPORTANTE: baixa manual só mexe no PAGAMENTO. O status de ENTREGA não
    // muda — pedido pago adiantado continua aparecendo para o entregador.
    const payload = {
      status_pagamento: 'pago',
      forma_pagamento_real: 'dinheiro',  // padrão para baixa manual
      data_pagamento: hojeStr,
    };
    if (!MODO_DEMO) {
      const res = await Promise.all(paraPagar.map(p =>
        supabase('pedidos','PATCH', payload, `?id=eq.${p.id}`)
      ));
      if (res.some(r=>!r.ok)) { toast('Erro ao atualizar. Tente novamente.'); return; }
    }
    paraPagar.forEach(p => { Object.assign(p, payload); });
    fecharModal('modal-fin-cliente');
    agendarRender('financeiro');
    agendarRender('dashboard');
    agendarRender('entregas');
  } finally {
    salvando = false;
  }
}

// ============================================================
// MODAL NOVO PEDIDO
// ============================================================
function abrirModalNovoPedido(idEdit) {
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
      const existente = carrinho.find(c => c.produto.id === produto.id);
      // Compat: itens antigos não têm preco_catalogo — usa o do catálogo atual ou o próprio preco_unit
      const precoUnit = Number(it.preco_unit) || Number(produto.preco) || 0;
      const precoCat  = (it.preco_catalogo != null)
        ? Number(it.preco_catalogo)
        : (prod ? Number(prod.preco) : precoUnit);
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
    const d = new Date(data_entrega + 'T12:00:00');
    d.setDate(d.getDate() + Number(prazo));
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
  sel.innerHTML = '<option value="">Selecionar cliente...</option>' +
    todosOsClientes.map(c=>`<option value="${c.id}">${esc(c.nome)}</option>`).join('');
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

  // === EDIÇÃO ===
  if (pedidoEmEdicao) {
    if (pedidoEmEdicao.status === 'entregue') {
      toast('Pedido já entregue não pode ser editado.');
      return;
    }
    if (!podeEditarPedido(pedidoEmEdicao)) {
      toast('Você não tem permissão para editar este pedido.');
      return;
    }
    const pedido_id = pedidoEmEdicao.id;

    if (!MODO_DEMO) {
      // Atualiza o pedido
      const resPed = await supabase('pedidos','PATCH',{
        cliente_id, descricao, valor,
        data_entrega, data_vencimento: data_vencimento||null,
        observacao: obs,
        forma_pagamento,
        prazo_dias: prazo_dias || null,
        prazos_boleto: prazos_boleto || null,
      }, `?id=eq.${pedido_id}`);
      if (!resPed.ok) {
        toast('Erro ao atualizar pedido.\n\nDetalhes: ' + (resPed.erro || 'desconhecido'));
        return;
      }
      // Apaga itens antigos
      const resDel = await supabase('itens_pedido','DELETE',null,`?pedido_id=eq.${pedido_id}`);
      if (!resDel.ok) {
        toast('Erro ao limpar itens antigos.\n\nDetalhes: ' + (resDel.erro || 'desconhecido'));
        return;
      }
      // Insere itens novos (preco_catalogo permite auditar ajustes de preço depois)
      const resItens = await Promise.all(itens.map(it => supabase('itens_pedido','POST',{
        pedido_id, produto_id:it.produto_id, nome:it.nome, qtd:it.qtd,
        preco_unit:it.preco_unit, preco_catalogo:it.preco_catalogo
      })));
      if (resItens.some(r => !r.ok)) {
        toast('Erro ao salvar itens atualizados. Verifique no banco.');
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
        forma_pagamento,
        prazo_dias: prazo_dias || null,
        prazos_boleto: prazos_boleto || null,
        itens,
      });
    }

    pedidoEmEdicao = null;
    fecharModal('modal-pedido');
    agendarRender('dashboard');
    agendarRender('entregas');
    if (usuario.perfil === 'vendedor') agendarRender('meus-pedidos');
    if (usuario.perfil === 'admin')    agendarRender('financeiro');
    return;
  }

  // === NOVO PEDIDO ===
  const novoPedido = {
    id: Date.now(), cliente_id, cliente_nome: cliente?.nome||'–',
    descricao, valor, status:'pendente', data_entrega,
    data_vencimento: data_vencimento||null, observacao:obs,
    forma_pagamento, prazo_dias: prazo_dias || null,
    prazos_boleto: prazos_boleto || null,
    itens, vendedor: usuario.login,
  };

  if (!MODO_DEMO) {
    const resPed = await supabase('pedidos','POST',{
      cliente_id, descricao, valor, status:'pendente',
      data_entrega, data_vencimento:data_vencimento||null,
      observacao:obs, vendedor:usuario.login,
      forma_pagamento, prazo_dias: prazo_dias || null,
      prazos_boleto: prazos_boleto || null,
    });
    if (!resPed.ok||!resPed.dados?.[0]) {
      toast('Erro ao salvar pedido.\n\nDetalhes: ' + (resPed.erro || 'sem resposta'));
      return;
    }
    const pedido_id = resPed.dados[0].id;
    novoPedido.id = pedido_id;
    // Salvar itens do pedido e VERIFICAR cada um (preco_catalogo = auditoria de ajustes)
    const resItens = await Promise.all(itens.map(it => supabase('itens_pedido','POST',{
      pedido_id, produto_id:it.produto_id, nome:it.nome, qtd:it.qtd,
      preco_unit:it.preco_unit, preco_catalogo:it.preco_catalogo
    })));
    const falhouItens = resItens.some(r => !r.ok);
    if (falhouItens) {
      // Rollback: deleta o pedido criado (best-effort, loga se falhar)
      const rollback = await supabase('pedidos','DELETE',null,`?id=eq.${pedido_id}`);
      if (!rollback.ok) {
        console.warn(`Rollback do pedido ${pedido_id} falhou. Verifique manualmente no banco.`);
      }
      toast('Erro ao salvar itens do pedido. Tente novamente.');
      return;
    }
  }

  todosOsPedidos.push(novoPedido);
  fecharModal('modal-pedido');
  agendarRender('dashboard');
  agendarRender('entregas');
  if (usuario.perfil==='vendedor') agendarRender('meus-pedidos');
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
        const res = await supabase('clientes','PATCH', payload, `?id=eq.${id}`);
        if (!res.ok) { toast('Erro ao atualizar cliente.\n\nDetalhes: ' + (res.erro || 'desconhecido')); return; }
      }
      const idx = todosOsClientes.findIndex(c => c.id === id);
      if (idx >= 0) Object.assign(todosOsClientes[idx], payload);

      // Atualiza cliente_nome nos pedidos relacionados (para refletir mudança de nome)
      todosOsPedidos.forEach(p => { if (p.cliente_id === id) p.cliente_nome = nome; });

      clienteSelecionado = null;
      fecharModal('modal-cliente');
      fecharModal('modal-detalhe-cliente');
      agendarRender('clientes');
      agendarRender('entregas');
      agendarRender('dashboard');
      popularSelectClientes();
      return;
    }

    // ==== NOVO ====
    const novo = {
      id: Date.now(),
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
      const res = await supabase('clientes','POST', novo);
      if (!res.ok || !res.dados?.[0]) {
        toast('Erro ao salvar.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
        return;
      }
      novo.id = res.dados[0].id;
    }
    todosOsClientes.push(novo);
    fecharModal('modal-cliente');
    agendarRender('clientes');
    popularSelectClientes();
    const numCli = document.getElementById('num-clientes');
    if (numCli) numCli.textContent = todosOsClientes.length;
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
      const res = await supabase('clientes','DELETE',null,`?id=eq.${id}`);
      if (!res.ok) { toast('Erro ao excluir. Tente novamente.'); return; }
    }
    todosOsClientes = todosOsClientes.filter(c=>c.id!==id);
    fecharModal('modal-detalhe-cliente');
    renderizarClientes(todosOsClientes);
    popularSelectClientes();
    const numCli = document.getElementById('num-clientes');
    if (numCli) numCli.textContent = todosOsClientes.length;
  } finally {
    salvando = false;
  }
}

// ============================================================
// MODAL CONFIRMAR ENTREGA
// ============================================================
function abrirModalEntrega(id) {
  const p = todosOsPedidos.find(x=>x.id===id);
  if (!p) return;
  pedidoSelecionado = p;

  // Verifica se este pedido precisa de confirmação de pagamento
  // Só para À VISTA e CHEQUE (boleto tem prazo, paga depois)
  const precisaPagamento = (p.forma_pagamento === 'avista' || p.forma_pagamento === 'cheque');
  const modalSheet = document.querySelector('#modal-entrega .modal-sheet');
  if (modalSheet) {
    modalSheet.dataset.precisaPagamento = precisaPagamento ? '1' : '0';
    modalSheet.dataset.pagamentoEscolhido = ''; // reseta a escolha
  }
  // Limpa estado visual dos botões
  document.querySelectorAll('#modal-entrega .pagto-recebido').forEach(b => b.classList.remove('ativo'));

  // Texto adicional sobre a forma de pagamento
  let pagtoInfo = '';
  if (p.forma_pagamento === 'avista')  pagtoInfo = '<div style="margin-top:6px;font-size:12px;color:var(--o1)">💵 Pagamento à vista — confirme se recebeu</div>';
  else if (p.forma_pagamento === 'cheque') pagtoInfo = '<div style="margin-top:6px;font-size:12px;color:var(--o1)">📝 Pagamento em cheque — confirme se recebeu</div>';
  else if (p.forma_pagamento === 'boleto') {
    const prazos = p.prazos_boleto ? ` (${p.prazos_boleto.split(',').join('+')} dias)` : (p.prazo_dias ? ` (${p.prazo_dias} dias)` : '');
    pagtoInfo = `<div style="margin-top:6px;font-size:12px;color:var(--c3)">📄 Boleto${prazos} — pagamento por boleto</div>`;
  }

  document.getElementById('modal-entrega-info').innerHTML = `
    <strong style="color:var(--o1)">${esc(p.cliente_nome)}</strong>
    <div style="margin-top:5px;color:var(--c2)">${esc(p.descricao)}</div>
    <div style="margin-top:5px;color:var(--o1);font-weight:700">${moeda(p.valor)}</div>
    <div style="margin-top:3px;font-size:12px;color:var(--c3)">Data: ${dataBR(p.data_entrega)}</div>
    ${pagtoInfo}`;
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
  const obs = document.getElementById('entrega-obs').value.trim();
  const id  = pedidoSelecionado.id;

  // ====== VALIDAÇÃO DE PAGAMENTO (à vista ou cheque) ======
  const modalSheet = document.querySelector('#modal-entrega .modal-sheet');
  const precisaPagamento = modalSheet?.dataset.precisaPagamento === '1';
  const pagtoEscolhido = modalSheet?.dataset.pagamentoEscolhido || '';

  if (precisaPagamento && !pagtoEscolhido) {
    toast(
      '⚠ Você precisa informar como o cliente pagou.\n\n' +
      'Escolha uma das 4 opções:\n' +
      '• 💵 Pagou em dinheiro\n' +
      '• 💳 PIX / Cartão\n' +
      '• ⏰ Vai pagar depois\n' +
      '• ✗ Não quis pagar'
    );
    return;
  }

  // Define os campos de pagamento que vão pro banco
  let status_pagamento = null;
  let forma_pagamento_real = null;
  let data_pagamento = null;

  if (precisaPagamento) {
    if (pagtoEscolhido === 'dinheiro' || pagtoEscolhido === 'pix') {
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
    const total = pedidoSelecionado.itens.length;
    const qtdMarcados = pedidoSelecionado.itens.filter(i => marcados.has(Number(i.produto_id))).length;
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

  salvando = true;
  try {
    const payload = {
      status: 'entregue',
      observacao: obs,
      status_pagamento,
      forma_pagamento_real,
      data_pagamento,
    };

    if (!MODO_DEMO) {
      // Se está offline, enfileira em vez de tentar enviar (e falhar)
      if (!navigator.onLine) {
        adicionarNaFilaOffline({
          tipo: 'marcar-entregue',
          pedidoId: id,
          payload,
        });
        toast(
          '📡 Sem internet no momento.\n\n' +
          'O pedido foi marcado localmente como ENTREGUE e será sincronizado ' +
          'automaticamente quando a conexão voltar.\n\n' +
          'Continue suas entregas normalmente.'
        );
      } else {
        const res = await supabase('pedidos','PATCH', payload, `?id=eq.${id}`);
        if (!res.ok) {
          // Se falhou por timeout (rede ruim), também enfileira
          if (res.erro && /tempo esgotado|timeout|offline/i.test(res.erro)) {
            adicionarNaFilaOffline({
              tipo: 'marcar-entregue',
              pedidoId: id,
              payload,
            });
            toast(
              '⚠ Conexão lenta — pedido marcado localmente.\n\n' +
              'Vai sincronizar automaticamente quando a internet melhorar.'
            );
          } else {
            toast('Erro ao confirmar entrega.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
            return;
          }
        }
      }
    }
    // Atualiza estado local em ambos os casos (sucesso ou offline)
    const idx = todosOsPedidos.findIndex(p=>p.id===id);
    if (idx>=0) {
      Object.assign(todosOsPedidos[idx], payload);
    }
    // Pedido entregue: limpa o checklist (não precisa mais)
    limparChecklist(id);
    fecharModal('modal-entrega');
    agendarRender('dashboard');
    agendarRender('entregas');
    if (usuario.perfil==='admin') agendarRender('financeiro');
  } finally {
    salvando = false;
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
      // Apaga os itens primeiro (com on delete cascade já apagaria, mas garantimos)
      const resItens = await supabase('itens_pedido','DELETE',null,`?pedido_id=eq.${id}`);
      if (!resItens.ok) {
        console.warn(`Falha ao deletar itens do pedido ${id} antes de deletar o pedido.`);
      }
      // Apaga o pedido
      const res = await supabase('pedidos','DELETE',null,`?id=eq.${id}`);
      if (!res.ok) {
        toast('Erro ao excluir pedido.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
        return;
      }
    }

    todosOsPedidos = todosOsPedidos.filter(x => x.id !== id);
    limparChecklist(id);

    agendarRender('dashboard');
    agendarRender('entregas');
    if (usuario.perfil === 'vendedor') agendarRender('meus-pedidos');
    if (usuario.perfil === 'admin')    agendarRender('financeiro');
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
  if (!preco) { toast('Informe o preço de venda.'); return; }

  salvando = true;
  botaoSalvando('salvarProduto', true, 'Salvar Produto');
  try {
    if (idEdit) {
      // === EDITAR ===
      const id = Number(idEdit);
      if (!id) { toast('ID inválido.'); return; }
      const produtoAntigo = todosOsProdutos.find(p => p.id === id);
      const precoMudou = produtoAntigo && (Number(produtoAntigo.preco) !== preco);
      const custoMudou = produtoAntigo && (Number(produtoAntigo.preco_custo || 0) !== Number(preco_custo || 0));

      if (!MODO_DEMO) {
        const res = await supabase('produtos','PATCH', { nome, categoria, preco, preco_custo }, `?id=eq.${id}`);
        if (!res.ok) {
          toast('Erro ao editar produto.\n\nDetalhes: ' + (res.erro || 'desconhecido'));
          return;
        }
        // Registra histórico SÓ se algum preço mudou
        if (precoMudou || custoMudou) {
          await supabase('historico_precos','POST', {
            produto_id: id,
            preco_venda: preco,
            preco_custo,
            alterado_por: usuario.login,
          });
        }
      }
      const idx = todosOsProdutos.findIndex(p=>p.id===id);
      if (idx >= 0) Object.assign(todosOsProdutos[idx], { nome, categoria, preco, preco_custo });
    } else {
      // === NOVO ===
      const novo = { id: Date.now(), nome, categoria, preco, preco_custo };
      if (!MODO_DEMO) {
        const res = await supabase('produtos','POST', { nome, categoria, preco, preco_custo });
        if (!res.ok || !res.dados?.[0]) {
          toast('Erro ao salvar produto.\n\nDetalhes: ' + (res.erro || 'sem resposta'));
          return;
        }
        novo.id = res.dados[0].id;
        // Primeiro registro do histórico
        await supabase('historico_precos','POST', {
          produto_id: novo.id,
          preco_venda: preco,
          preco_custo,
          alterado_por: usuario.login,
        });
      }
      todosOsProdutos.push(novo);
    }
    fecharModal('modal-produto');
    rerenderizarCatalogoMantendoBusca();
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
    renderizarCatalogo(filtroCatalogo);
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
      const res = await supabase('produtos','DELETE',null,`?id=eq.${id}`);
      if (!res.ok) { toast('Erro ao excluir. Tente novamente.'); return; }
    }
    todosOsProdutos = todosOsProdutos.filter(p=>p.id!==id);
    rerenderizarCatalogoMantendoBusca();
  } finally {
    salvando = false;
  }
}

// Mostra modal com detalhes do produto + histórico de preços
async function verDetalheProduto(id) {
  const p = todosOsProdutos.find(x => x.id === id);
  if (!p) return;

  // Mostra modal com loading enquanto busca histórico
  document.getElementById('detalhe-produto-nome').textContent = p.nome;
  document.getElementById('detalhe-produto-conteudo').innerHTML = `
    <div class="loading"><div class="spinner"></div> Carregando histórico...</div>`;
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
  let modoDemoSemHistorico = false;
  if (!MODO_DEMO) {
    const res = await supabase('historico_precos', 'GET', null,
      `?produto_id=eq.${id}&order=criado_em.desc&limit=20`);
    if (res.ok && Array.isArray(res.dados)) historico = res.dados;
  } else {
    modoDemoSemHistorico = true;
  }

  // Resumo
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

// ============================================================
// VIA DE PEDIDO — imprimir / salvar PDF / enviar no WhatsApp
// Disponível para admin e vendedor.
// ============================================================
function gerarViaPedido(id) {
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p) return;
  const c = todosOsClientes.find(x => x.id === p.cliente_id);

  // Linhas de itens (usa preco_unit real, que considera ajustes de preço)
  const itensRows = (p.itens?.length)
    ? p.itens.map(i => `
        <tr>
          <td>${i.qtd}</td>
          <td>${esc(i.nome || i.produto_nome || '')}</td>
          <td>${moeda(i.preco_unit)}</td>
          <td>${moeda(i.preco_unit * i.qtd)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4">${esc(p.descricao || '')}</td></tr>`;

  // Dados do cliente (só o que existe)
  const cliLinhas = [];
  if (c?.responsavel) cliLinhas.push(`<div class="via-linha">Responsável: ${esc(c.responsavel)}</div>`);
  if (c?.whatsapp)    cliLinhas.push(`<div class="via-linha">WhatsApp: ${esc(mascaraTelefone(c.whatsapp))}</div>`);
  if (c?.endereco)    cliLinhas.push(`<div class="via-linha">Endereço: ${esc(c.endereco)}</div>`);
  if (c?.cnpj_cpf) {
    const docFmt = (c.tipo_pessoa === 'fisica') ? mascaraCPF(c.cnpj_cpf) : mascaraCNPJ(c.cnpj_cpf);
    cliLinhas.push(`<div class="via-linha">${c.tipo_pessoa === 'fisica' ? 'CPF' : 'CNPJ'}: ${docFmt}</div>`);
  }

  // Forma de pagamento sem emoji (documento impresso fica mais sóbrio)
  const pagto = formatarPagamento(p).replace(/^[^\w]*\s*/, '');

  const agora = new Date();
  const emissao = `${String(agora.getDate()).padStart(2,'0')}/${String(agora.getMonth()+1).padStart(2,'0')}/${agora.getFullYear()} às ${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`;

  document.getElementById('via-papel').innerHTML = `
    <div class="via-cab">
      <img src="logo.png" alt="KG Agropet">
      <div>
        <div class="via-cab-nome">KG AGROPET</div>
        <div class="via-cab-sub">Glória do Goitá — PE</div>
      </div>
      <div class="via-doc-titulo">
        <b>Via do Pedido</b>
        <span>Nº ${p.id}</span>
      </div>
    </div>

    <div class="via-bloco">
      <div class="via-bloco-titulo">Cliente</div>
      <div class="via-linha" style="font-weight:700;font-size:14px">${esc(p.cliente_nome || c?.nome || '')}</div>
      ${cliLinhas.join('')}
    </div>

    <div class="via-bloco">
      <div class="via-bloco-titulo">Itens do pedido</div>
      <table class="via-tabela">
        <thead><tr><th>Qtd</th><th>Produto</th><th>Unit.</th><th>Subtotal</th></tr></thead>
        <tbody>${itensRows}</tbody>
      </table>
      <div class="via-total">
        <span class="via-total-label">Total</span>
        <span class="via-total-valor">${moeda(p.valor)}</span>
      </div>
    </div>

    <div class="via-bloco">
      <div class="via-bloco-titulo">Pagamento e prazos</div>
      <div class="via-linha">Forma de pagamento: <b>${esc(pagto)}</b></div>
      <div class="via-linha">Data de entrega: ${dataBR(p.data_entrega)}</div>
      ${p.data_vencimento ? `<div class="via-linha">Vencimento: ${dataBR(p.data_vencimento)}</div>` : ''}
    </div>

    ${p.observacao ? `
    <div class="via-bloco">
      <div class="via-bloco-titulo">Observações</div>
      <div class="via-linha">${esc(p.observacao)}</div>
    </div>` : ''}

    <div class="via-rodape">Documento emitido em ${emissao} · KG Agropet · Este documento não substitui nota fiscal</div>`;

  // Botão de WhatsApp: só aparece se o cliente tem número
  const btnZap = document.getElementById('via-btn-whatsapp');
  const waNum = (c?.whatsapp || '').replace(/\D/g, '');
  if (waNum) {
    btnZap.style.display = '';
    btnZap.onclick = () => enviarPedidoWhatsApp(p.id);
  } else {
    btnZap.style.display = 'none';
  }

  document.getElementById('via-overlay').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function fecharViaPedido() {
  document.getElementById('via-overlay').style.display = 'none';
}

// Envia o resumo do pedido (texto formatado) direto no WhatsApp do cliente
function enviarPedidoWhatsApp(id) {
  const p = todosOsPedidos.find(x => x.id === id);
  if (!p) return;
  const c = todosOsClientes.find(x => x.id === p.cliente_id);
  const waNum = (c?.whatsapp || '').replace(/\D/g, '');
  if (!waNum) { toast('Este cliente não tem WhatsApp cadastrado.'); return; }

  const itensTxt = (p.itens?.length)
    ? p.itens.map(i => `• ${i.qtd}x ${i.nome || i.produto_nome || ''} — ${moeda(i.preco_unit * i.qtd)}`).join('\n')
    : `• ${p.descricao || ''}`;
  const pagto = formatarPagamento(p).replace(/^[^\w]*\s*/, '');

  const msg = `${obterSaudacao()}, ${c?.responsavel || c?.nome || ''}! 🌿\n\n` +
    `Segue o resumo do seu pedido na *KG Agropet*:\n\n${itensTxt}\n\n` +
    `*Total: ${moeda(p.valor)}*\n` +
    `Pagamento: ${pagto}\n` +
    `Entrega: ${dataBR(p.data_entrega)}` +
    (p.data_vencimento ? `\nVencimento: ${dataBR(p.data_vencimento)}` : '') +
    `\n\nQualquer dúvida estou à disposição. Obrigado pela preferência! 🙏`;

  window.open(`https://wa.me/55${waNum}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

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

  const pagtoTxt = formatarPagamento(p);

  // Status de pagamento (se entregue)
  let statusPagtoLinha = '';
  if (p.status === 'entregue') {
    if (foiPago(p)) {
      const formaReal = p.forma_pagamento_real === 'dinheiro' ? 'Dinheiro' :
                        p.forma_pagamento_real === 'pix' ? 'PIX/Cartão' : '';
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
      <div style="font-size:12px;color:var(--c3);margin-bottom:4px">📅 Entrega: ${dataBR(p.data_entrega)} · Venc.: ${dataBR(p.data_vencimento)}</div>
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
    ${p.observacao?`<div style="font-size:12px;color:var(--c3);margin-top:4px">📝 ${esc(p.observacao)}</div>`:''}`;

  // Botão de via do pedido: admin e vendedor (entregador não emite documento)
  const acoesVia = document.getElementById('detalhe-pedido-acoes-via');
  if (acoesVia) {
    acoesVia.innerHTML = (usuario.perfil === 'admin' || usuario.perfil === 'vendedor')
      ? `<button class="btn-primario mt-12" onclick="fecharModal('modal-detalhe-pedido'); gerarViaPedido(${p.id})">📄 Via do pedido (PDF / Imprimir)</button>`
      : '';
  }
  abrirModal('modal-detalhe-pedido');
}

// ============================================================
// HELPERS DE LÓGICA
// ============================================================
function isAtrasado(p) {
  // Já foi pago de fato? Não está atrasado.
  if (foiPago(p)) return false;
  if (!p.data_vencimento) return false;
  return p.data_vencimento < fmt(new Date());
}

let _scrollSalvo = 0;
function abrirModal(id) {
  const m = document.getElementById(id);
  if (m) {
    // Salva a posição de scroll da área que rola (desktop = .conteudo)
    const sc = document.querySelector('.conteudo');
    _scrollSalvo = sc ? sc.scrollTop : window.scrollY;
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
    const aberto = document.querySelector('.modal-overlay.aberto');
    if (aberto) {
      fecharModal(aberto.id);
    }
  }
});

// ============================================================
// SERVICE WORKER + DETECÇÃO OFFLINE + INSTALAR PWA
// ============================================================

// Registra o Service Worker (silencioso em caso de erro)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      // Quando uma nova versão do SW estiver instalada, ativa imediatamente
      reg.addEventListener('updatefound', () => {
        const novo = reg.installing;
        if (!novo) return;
        novo.addEventListener('statechange', () => {
          if (novo.state === 'installed' && navigator.serviceWorker.controller) {
            // Nova versão disponível — ativa silenciosamente
            novo.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch(err => console.warn('SW falhou ao registrar:', err));

    // Recarrega quando o SW novo assumir controle (atualização suave)
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recarregando) return;
      recarregando = true;
      window.location.reload();
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
  if (!offline && usuario) processarFilaOffline();
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
  try {
    const raw = localStorage.getItem(FILA_OFFLINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function gravarFilaOffline(fila) {
  try {
    localStorage.setItem(FILA_OFFLINE_KEY, JSON.stringify(fila));
  } catch(e) { console.warn('Falha ao gravar fila offline:', e); }
}

function adicionarNaFilaOffline(acao) {
  const fila = lerFilaOffline();
  fila.push({ ...acao, ts: Date.now() });
  gravarFilaOffline(fila);
}

let _processandoFila = false;
async function processarFilaOffline() {
  if (_processandoFila) return;
  if (MODO_DEMO) return;
  if (!navigator.onLine) return;
  const fila = lerFilaOffline();
  if (!fila.length) return;

  _processandoFila = true;
  const sucesso = [], falha = [];
  for (const acao of fila) {
    try {
      if (acao.tipo === 'marcar-entregue') {
        const res = await supabase('pedidos', 'PATCH', acao.payload, `?id=eq.${acao.pedidoId}`);
        if (res.ok) {
          sucesso.push(acao);
          // Atualiza no estado local
          const idx = todosOsPedidos.findIndex(p => p.id === acao.pedidoId);
          if (idx >= 0) Object.assign(todosOsPedidos[idx], acao.payload);
        } else {
          falha.push(acao);
        }
      }
    } catch(e) {
      falha.push(acao);
    }
  }

  // Mantém só os que falharam na fila (vai tentar de novo depois)
  gravarFilaOffline(falha);
  _processandoFila = false;

  if (sucesso.length) {
    // Re-renderiza telas afetadas após sincronizar
    if (typeof agendarRender === 'function') {
      agendarRender('dashboard');
      agendarRender('entregas');
    }
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
    const viaAberta = document.getElementById('via-overlay')?.style.display === 'block';
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

  window.addEventListener('scroll', checar, { passive: true });
  // Captura o scroll da .conteudo (desktop) — usa fase de captura pois
  // o evento scroll não borbulha
  document.addEventListener('scroll', checar, { passive: true, capture: true });

  // Ação do botão: rola o container certo de volta ao topo
  btn.onclick = () => {
    const sc = getScroller();
    if (sc === window) window.scrollTo({ top: 0, behavior: 'smooth' });
    else sc.scrollTo({ top: 0, behavior: 'smooth' });
  };
})();

// ============================================================
// RELATÓRIOS — semanal, quinzenal e mensal (admin e vendedor)
// Admin vê todos os pedidos; vendedor vê apenas os dele.
// Base do período: data_entrega do pedido.
// ============================================================
let relTipo = 'semanal';   // 'semanal' | 'quinzenal' | 'mensal'
let relOffset = 0;         // 0 = período atual, -1 = anterior...

function abrirModalRelatorio() {
  relTipo = 'semanal';
  relOffset = 0;
  // Reseta abas visuais para a primeira
  document.querySelectorAll('#abas-relatorio .aba').forEach((b, i) => {
    b.classList.toggle('ativa', i === 0);
  });
  renderizarRelatorio();
  abrirModal('modal-relatorio');
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

// Calcula a janela [ini, fim] (strings YYYY-MM-DD) + label legível
function calcularJanelaRelatorio(tipo, offset) {
  const hoje = new Date();

  if (tipo === 'semanal') {
    // Semana de segunda a domingo
    const base = new Date(hoje);
    base.setDate(base.getDate() + offset * 7);
    const diaSemana = (base.getDay() + 6) % 7; // 0 = segunda
    const ini = new Date(base); ini.setDate(base.getDate() - diaSemana);
    const fim = new Date(ini);  fim.setDate(ini.getDate() + 6);
    return { ini: fmt(ini), fim: fmt(fim), label: `Semana ${dataBR(fmt(ini))} — ${dataBR(fmt(fim))}` };
  }

  if (tipo === 'quinzenal') {
    // Índice absoluto de quinzena: cada mês tem Q1 (1–15) e Q2 (16–fim)
    let idx = hoje.getFullYear() * 24 + hoje.getMonth() * 2 + (hoje.getDate() > 15 ? 1 : 0);
    idx += offset;
    const ano = Math.floor(idx / 24);
    const resto = idx % 24;
    const mes = Math.floor(resto / 2);
    const metade = resto % 2;
    const ini = new Date(ano, mes, metade ? 16 : 1);
    const fim = metade ? new Date(ano, mes + 1, 0) : new Date(ano, mes, 15);
    return { ini: fmt(ini), fim: fmt(fim), label: `${metade ? '2ª' : '1ª'} quinzena · ${dataBR(fmt(ini))} — ${dataBR(fmt(fim))}` };
  }

  // mensal
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + offset;
  const ini = new Date(ano, mes, 1);
  const fim = new Date(ano, mes + 1, 0);
  const nomesMeses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                      'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return { ini: fmt(ini), fim: fmt(fim), label: `${nomesMeses[ini.getMonth()]} de ${ini.getFullYear()}` };
}

// Filtra pedidos do período (e do vendedor, se for o perfil dele)
function pedidosDoRelatorio(ini, fim) {
  return todosOsPedidos.filter(p => {
    if (!p.data_entrega) return false;
    if (p.data_entrega < ini || p.data_entrega > fim) return false;
    if (usuario.perfil === 'vendedor' && p.vendedor !== usuario.login) return false;
    return true;
  });
}

// Agrega os números e tops do período
function calcularDadosRelatorio(pedidos) {
  const total     = pedidos.reduce((s,p) => s + (Number(p.valor)||0), 0);
  const recebido  = pedidos.filter(p => foiPago(p)).reduce((s,p) => s + (Number(p.valor)||0), 0);
  const aReceber  = total - recebido;

  // Top produtos (por valor) a partir dos itens
  const porProduto = {};
  pedidos.forEach(p => (p.itens||[]).forEach(i => {
    const nome = i.nome || i.produto_nome || 'Produto';
    if (!porProduto[nome]) porProduto[nome] = { valor: 0, qtd: 0 };
    porProduto[nome].valor += (Number(i.preco_unit)||0) * (Number(i.qtd)||0);
    porProduto[nome].qtd   += Number(i.qtd)||0;
  }));
  const topProdutos = Object.entries(porProduto)
    .map(([nome, d]) => ({ nome, ...d }))
    .sort((a,b) => b.valor - a.valor).slice(0, 5);

  // Top clientes (por valor)
  const porCliente = {};
  pedidos.forEach(p => {
    const nome = p.cliente_nome || 'Cliente';
    if (!porCliente[nome]) porCliente[nome] = { valor: 0, pedidos: 0 };
    porCliente[nome].valor   += Number(p.valor)||0;
    porCliente[nome].pedidos += 1;
  });
  const topClientes = Object.entries(porCliente)
    .map(([nome, d]) => ({ nome, ...d }))
    .sort((a,b) => b.valor - a.valor).slice(0, 5);

  return { total, recebido, aReceber, nPedidos: pedidos.length, topProdutos, topClientes };
}

function renderizarRelatorio() {
  const { ini, fim, label } = calcularJanelaRelatorio(relTipo, relOffset);
  document.getElementById('rel-periodo-label').textContent = label;

  // Desabilita seta "próximo" quando já está no período atual
  const btnProx = document.getElementById('rel-nav-proximo');
  if (btnProx) btnProx.disabled = (relOffset >= 0);

  const pedidos = pedidosDoRelatorio(ini, fim);
  const d = calcularDadosRelatorio(pedidos);
  const el = document.getElementById('relatorio-conteudo');

  if (!pedidos.length) {
    el.innerHTML = `<div class="rel-vazio">Nenhum pedido com entrega neste período${usuario.perfil==='vendedor' ? ' (seus pedidos)' : ''}.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="rel-cards">
      <div class="rel-card">
        <div class="rel-card-valor">${moeda(d.total)}</div>
        <div class="rel-card-label">Total vendido</div>
      </div>
      <div class="rel-card">
        <div class="rel-card-valor">${d.nPedidos}</div>
        <div class="rel-card-label">Pedidos</div>
      </div>
      <div class="rel-card rel-verde">
        <div class="rel-card-valor">${moeda(d.recebido)}</div>
        <div class="rel-card-label">Recebido</div>
      </div>
      <div class="rel-card rel-laranja">
        <div class="rel-card-valor">${moeda(d.aReceber)}</div>
        <div class="rel-card-label">A receber</div>
      </div>
    </div>

    <div class="rel-lista-titulo">🏆 Top produtos</div>
    ${d.topProdutos.map(t => `
      <div class="rel-item">
        <span class="rel-item-nome">${esc(t.nome)}</span>
        <span class="rel-item-extra">${t.qtd}un</span>
        <span class="rel-item-valor">${moeda(t.valor)}</span>
      </div>`).join('') || '<div class="rel-vazio">Sem itens detalhados</div>'}

    <div class="rel-lista-titulo">🏪 Top clientes</div>
    ${d.topClientes.map(t => `
      <div class="rel-item">
        <span class="rel-item-nome">${esc(t.nome)}</span>
        <span class="rel-item-extra">${t.pedidos} ped.</span>
        <span class="rel-item-valor">${moeda(t.valor)}</span>
      </div>`).join('')}`;
}

// Monta o relatório no "papel" da via e abre para imprimir/salvar PDF
function imprimirRelatorio() {
  const { ini, fim, label } = calcularJanelaRelatorio(relTipo, relOffset);
  const pedidos = pedidosDoRelatorio(ini, fim);
  const d = calcularDadosRelatorio(pedidos);

  const agora = new Date();
  const emissao = `${String(agora.getDate()).padStart(2,'0')}/${String(agora.getMonth()+1).padStart(2,'0')}/${agora.getFullYear()} às ${String(agora.getHours()).padStart(2,'0')}:${String(agora.getMinutes()).padStart(2,'0')}`;
  const escopo = usuario.perfil === 'vendedor' ? `Vendedor: ${usuario.nome || usuario.login}` : 'Todos os pedidos';

  document.getElementById('via-papel').innerHTML = `
    <div class="via-cab">
      <img src="logo.png" alt="KG Agropet">
      <div>
        <div class="via-cab-nome">KG AGROPET</div>
        <div class="via-cab-sub">Glória do Goitá — PE</div>
      </div>
      <div class="via-doc-titulo">
        <b>Relatório de Vendas</b>
        <span>${esc(label)}</span>
      </div>
    </div>

    <div class="via-bloco">
      <div class="via-bloco-titulo">Resumo do período</div>
      <table class="via-tabela">
        <tbody>
          <tr><td>Total vendido</td><td style="text-align:right;font-weight:700">${moeda(d.total)}</td></tr>
          <tr><td>Pedidos no período</td><td style="text-align:right;font-weight:700">${d.nPedidos}</td></tr>
          <tr><td>Recebido</td><td style="text-align:right;font-weight:700">${moeda(d.recebido)}</td></tr>
          <tr><td>A receber</td><td style="text-align:right;font-weight:700">${moeda(d.aReceber)}</td></tr>
        </tbody>
      </table>
    </div>

    ${d.topProdutos.length ? `
    <div class="via-bloco">
      <div class="via-bloco-titulo">Top produtos</div>
      <table class="via-tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Valor</th></tr></thead>
        <tbody>${d.topProdutos.map(t => `
          <tr><td>${esc(t.nome)}</td><td style="text-align:right">${t.qtd}</td><td style="text-align:right">${moeda(t.valor)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${d.topClientes.length ? `
    <div class="via-bloco">
      <div class="via-bloco-titulo">Top clientes</div>
      <table class="via-tabela">
        <thead><tr><th>Cliente</th><th>Pedidos</th><th>Valor</th></tr></thead>
        <tbody>${d.topClientes.map(t => `
          <tr><td>${esc(t.nome)}</td><td style="text-align:right">${t.pedidos}</td><td style="text-align:right">${moeda(t.valor)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    <div class="via-rodape">${esc(escopo)} · Emitido em ${emissao} · KG Agropet</div>`;

  // Esconde o botão de WhatsApp (só faz sentido na via de pedido)
  const btnZap = document.getElementById('via-btn-whatsapp');
  if (btnZap) btnZap.style.display = 'none';

  fecharModal('modal-relatorio');
  document.getElementById('via-overlay').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ============================================================
// INICIALIZAÇÃO — tenta restaurar sessão salva (PWA reaberto).
// Se houver sessão válida, entra direto no app; senão, mostra o login.
// ============================================================
restaurarSessao();
