const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');
const trecho = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));

function restauracao({ expira = Date.now() + 3600000, online = true, identidade = true } = {}) {
  let entradas = 0, renovacoes = 0;
  const c = {
    SESSAO_KEY:'sessao', sessao:null, usuario:null, navigator:{onLine:online},
    localStorage:{getItem:() => JSON.stringify({
      sessao:{access_token:'token', refresh_token:'refresh', expires_at:expira},
      usuario:{login:'perfil-adulterado', perfil:'admin'},
    })},
    usuarioDoToken:() => identidade ? {login:'entregador', perfil:'entregador'} : null,
    authRefresh:async() => { renovacoes++; return false; },
    entrarNoApp:() => entradas++, persistirSessao(){},
  };
  vm.runInNewContext(trecho('async function restaurarSessao()', '// LOGIN / SAIR'), c);
  return {c, resultado:() => ({entradas, renovacoes})};
}

test('reabertura com token válido dispensa rede de autenticação e usa perfil do token', async () => {
  const {c, resultado} = restauracao();
  await c.restaurarSessao();
  assert.deepEqual(resultado(), {entradas:1, renovacoes:0});
  assert.equal(c.usuario.perfil, 'entregador');
});

test('offline abre dados locais sem esperar refresh; online renova token vencido', async () => {
  for (const online of [true, false]) {
    const {c, resultado} = restauracao({expira:0, online});
    await c.restaurarSessao();
    assert.deepEqual(resultado(), {entradas:online ? 0 : 1, renovacoes:online ? 1 : 0});
  }
});

test('token sem identidade válida não restaura perfil salvo', async () => {
  const {c, resultado} = restauracao({identidade:false});
  await c.restaurarSessao();
  assert.deepEqual(resultado(), {entradas:0, renovacoes:0});
  assert.equal(c.sessao, null);
});

test('listas pequenas terminam em uma requisição por tabela em todos os perfis', async () => {
  for (const perfil of ['admin', 'vendedor', 'entregador']) {
    let chamadas = 0;
    const c = {usuario:{perfil}, apiSupabase:async (t,m,d,f,retry,opcoes) => {
      chamadas++;
      assert.equal(opcoes.contar, true);
      return {ok:true, total:1, dados:[{id:1,nome:'Teste'}]};
    }};
    vm.runInNewContext(trecho('async function listarTodos(', 'async function carregarTudo('), c);
    const listas = await c.carregarListas();
    assert.equal(chamadas, perfil === 'entregador' ? 2 : 3);
    assert.equal(listas[0].dados.length, 1);
  }
});

test('total por página respeita limite menor do servidor e não corta pedidos', async () => {
  const registros = Array.from({length:7}, (_,i) => ({id:i+1}));
  let chamadas = 0;
  const c = {apiSupabase:async(t,m,d,f) => {
    chamadas++;
    const ultimo = Number(f.match(/id=gt\.(\d+)/)[1]);
    const restantes = registros.filter(r => r.id > ultimo);
    return {ok:true, total:restantes.length, dados:restantes.slice(0,2)};
  }};
  vm.runInNewContext(trecho('async function listarTodos(', 'async function carregarListas('), c);
  const res = await c.listarTodos('pedidos');
  assert.deepEqual(Array.from(res.dados, p => p.id), registros.map(p => p.id));
  assert.equal(chamadas, 4);
});

test('GET solicita total exato e não confunde tamanho da página com total ausente', async () => {
  let total = '0-1/5';
  const c = {
    geracaoAcesso:0, MODO_DEMO:false, sessao:{access_token:'token'}, navigator:{onLine:true},
    garantirTokenValido:async()=>true, SUPABASE_URL:'https://teste.invalid', SUPABASE_KEY:'publica',
    AbortController, setTimeout, clearTimeout, console,
    fetch:async(u,o) => {
      assert.equal(o.headers.Prefer,'count=exact');
      return new Response('[{"id":1},{"id":2}]', {headers:{'Content-Range':total}});
    },
  };
  vm.runInNewContext(trecho('async function apiSupabase(', '// AUTENTICAÇÃO'), c);
  assert.equal((await c.apiSupabase('pedidos','GET',null,'',true,{contar:true})).total,5);
  total='0-1/*';
  const r=await c.apiSupabase('pedidos','GET',null,'',true,{contar:true});
  assert.equal(r.total,null);
  assert.equal(r.count,2);
});
