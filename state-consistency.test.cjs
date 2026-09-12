const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
const migration = fs.readFileSync(
  'supabase/migrations/20260912140943_realtime_and_safe_order_reset.sql','utf8'
);
const trecho = (inicio,fim) => app.slice(app.indexOf(inicio),app.indexOf(fim,app.indexOf(inicio)));

test('uma mudança de pedido cobre todas as interfaces e só renderiza a tela visível', () => {
  const renders = [];
  const c = {
    document:{getElementById:id=>({
      dataset:{},
      classList:{contains:classe=>classe === 'ativa' && id === 'tela-dashboard'},
    })},
    agendarRender:t=>renders.push(t), popularSelectClientes(){}, atualizarDetalhesAbertos(){},
    verDetalhePedido(){}, verDetalheCliente(){}, verFinanceiroCliente(){}, verDetalheProduto(){},
  };
  vm.runInNewContext(
    'let revisaoEstado=0;\n' + trecho('function invalidarInterfaces(', '// Wrappers públicos') +
    '\nthis.registrar=registrarMudancaLocal;this.revisao=()=>revisaoEstado;', c
  );
  c.registrar('pedidos');
  assert.equal(c.revisao(),1);
  assert.deepEqual(renders,['dashboard']);
  assert.match(app,/\['dashboard','entregas','clientes','financeiro','meus-pedidos','inicio-vendedor'\]/);
});

test('sincronização antiga não reverte uma entrega recém-confirmada', async () => {
  let liberar; let formulario = false;
  const c = {
    MODO_DEMO:false, usuario:{login:'admin'}, navigator:{onLine:true},
    document:{hidden:false}, formularioDeDadosAberto:()=>formulario,
    carregarListas:()=>new Promise(resolve=>{liberar=resolve;}),
    aplicarFilaOffline(){}, invalidarInterfaces(){}, console, queueMicrotask,
  };
  vm.runInNewContext(
    `let revisaoEstado=0,sincronizacaoPendente=false;
     let todosOsPedidos=[{id:1,status:'pendente'}],todosOsClientes=[],todosOsProdutos=[];
     ${trecho('let sincronizandoDados = false;', 'function iniciarAutoRefresh()')}
     this.sincronizar=sincronizarDados;
     this.entregar=()=>{todosOsPedidos[0].status='entregue';revisaoEstado++;formulario=true;};
     this.status=()=>todosOsPedidos[0].status;`, c
  );
  const emAndamento = c.sincronizar();
  c.entregar();
  liberar([
    {ok:true,dados:[{id:1,status:'pendente',itens_pedido:[]}]},
    {ok:true,dados:[]}, {ok:true,dados:[]},
  ]);
  await emAndamento;
  assert.equal(c.status(),'entregue');
});

test('PATCH exige representação e informa quantas linhas o servidor alterou', async () => {
  let prefer;
  const c = {
    MODO_DEMO:false, sessao:{access_token:'token'}, navigator:{onLine:true},
    garantirTokenValido:async()=>true, SUPABASE_URL:'https://teste.invalid', SUPABASE_KEY:'publica',
    authRefresh:async()=>false, forcarRelogin(){}, AbortController, setTimeout, clearTimeout,
    fetch:async(_url,opcoes)=>{
      prefer=opcoes.headers.Prefer;
      return new Response('[{"id":7,"status":"entregue"}]',{
        status:200,headers:{'Content-Type':'application/json','Content-Range':'0-0/1'}
      });
    }, console,
  };
  vm.runInNewContext(trecho('async function apiSupabase(', '// AUTENTICAÇÃO'),c);
  const res = await c.apiSupabase('pedidos','PATCH',{status:'entregue'},'?id=eq.7');
  assert.equal(prefer,'return=representation,count=exact');
  assert.equal(res.count,1);
  assert.equal(res.dados[0].status,'entregue');
});

test('Realtime e reset seguro estão configurados sem alterar pedidos existentes', () => {
  assert.match(app,/script\.src = 'supabase\.min\.js\?v=2\.116\.0'/);
  assert.match(app,/\.on\('postgres_changes'.*table:'pedidos'/);
  assert.match(app,/revisaoEstado !== revisaoInicial/);
  assert.match(migration,/alter publication supabase_realtime add table/);
  assert.match(migration,/delete from public\.pedidos where id = any\(p_ids\)/);
  assert.doesNotMatch(migration,/update public\.pedidos|truncate/i);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.doesNotMatch(migration,/update public\.clientes|delete from public\.clientes/i);
});

test('feedback de processamento fica restrito à ação correta', () => {
  const baixa = trecho('async function marcarPagoCliente()', '// MODAL NOVO PEDIDO');
  const entrega = trecho('async function confirmarEntrega()', '// EXCLUIR PEDIDO');
  const excluir = trecho('async function excluirPedido(id)', '// MODAL PRODUTO');

  assert.match(baixa,/botaoSalvando\('marcarPagoCliente', true/);
  assert.match(baixa,/botaoSalvando\('marcarPagoCliente', false/);
  assert.doesNotMatch(baixa,/botaoSalvando\('confirmarEntrega'/);

  assert.match(entrega,/botaoSalvando\('confirmarEntrega', true/);
  assert.match(entrega,/botaoSalvando\('confirmarEntrega', false/);
  assert.doesNotMatch(entrega,/botaoSalvando\('marcarPagoCliente'/);

  assert.doesNotMatch(excluir,/botaoSalvando\('confirmarEntrega'/);
});
