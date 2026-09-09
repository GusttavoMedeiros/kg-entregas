const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto: crypto } = require('node:crypto');
const app = fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
const trecho = (inicio,fim) => app.slice(app.indexOf(inicio),app.indexOf(fim,app.indexOf(inicio)));

function fila() {
  const memoria = new Map();
  const contexto = {
    usuario:{login:'entregador',perfil:'entregador'}, MODO_DEMO:false,
    navigator:{onLine:true}, crypto, console, Date,
    localStorage:{getItem:k=>memoria.get(k)??null,setItem:(k,v)=>memoria.set(k,v)},
    document:{getElementById:()=>null}, agendarRender:()=>{}, toast:()=>{},
    todosOsPedidos:[{id:1,status:'pendente'},{id:2,status:'pendente'}],
    supabase:async(t,m,d)=>({ok:true,dados:{id:d.p_id,...d.p_dados}}),
  };
  vm.createContext(contexto);
  vm.runInContext(trecho("const FILA_OFFLINE_KEY =",'// Tenta processar a fila'),contexto);
  return contexto;
}
const acao = id => ({tipo:'marcar-entregue',pedidoId:id,payload:{status:'entregue',data_entregue_em:'2026-09-07'}});

test('Fila reaplica entrega offline sem substituir entrega já confirmada pelo servidor',async()=>{
  const c=fila(); await c.adicionarNaFilaOffline(acao(1));
  c.aplicarFilaOffline(c.todosOsPedidos);
  assert.equal(c.todosOsPedidos[0].status,'entregue');
  c.todosOsPedidos[0].data_entregue_em='2026-09-06';
  c.aplicarFilaOffline(c.todosOsPedidos);
  assert.equal(c.todosOsPedidos[0].data_entregue_em,'2026-09-06');
});
test('Falta de espaço rejeita gravação em vez de anunciar persistência',async()=>{
  const c=fila(); c.localStorage.setItem=()=>{throw Error('QuotaExceededError');};
  await assert.rejects(c.adicionarNaFilaOffline(acao(1)),/Não foi possível guardar/);
  assert.equal(c.lerFilaOffline().length,0);
});
test('Fila antiga não reverte pagamento mais recente recebido do servidor',async()=>{
  const c=fila();
  await c.adicionarNaFilaOffline({...acao(1),payload:{status:'entregue',status_pagamento:'pendente',forma_pagamento_real:null,data_pagamento:null}});
  Object.assign(c.todosOsPedidos[0],{status_pagamento:'pago',forma_pagamento_real:'pix',data_pagamento:'2026-09-01'});
  c.aplicarFilaOffline(c.todosOsPedidos);
  assert.equal(c.todosOsPedidos[0].status,'entregue');
  assert.equal(c.todosOsPedidos[0].status_pagamento,'pago');
  assert.equal(c.todosOsPedidos[0].forma_pagamento_real,'pix');
  assert.equal(c.todosOsPedidos[0].data_pagamento,'2026-09-01');
});
test('Fila corrompida não é sobrescrita com outra entrega',async()=>{
  const c=fila(); c.localStorage.setItem('kg-fila-offline','conteúdo inválido');
  await assert.rejects(c.adicionarNaFilaOffline(acao(1)));
  assert.equal(c.localStorage.getItem('kg-fila-offline'),'conteúdo inválido');
});
test('Entrega acrescentada durante envio não desaparece ao remover a anterior',async()=>{
  const c=fila(); await c.adicionarNaFilaOffline(acao(1));
  let liberar;
  c.supabase=()=>new Promise(resolve=>{liberar=()=>resolve({ok:true,dados:{status:'entregue'}});});
  const enviando=c.processarFilaOffline();
  await c.adicionarNaFilaOffline(acao(2));
  liberar(); await enviando;
  assert.equal(c.lerFilaOffline().length,1);
  assert.equal(c.lerFilaOffline()[0].pedidoId,2);
});
test('Falha mantém ação e libera processamento para próxima tentativa',async()=>{
  const c=fila(); await c.adicionarNaFilaOffline(acao(1));
  c.supabase=async()=>({ok:false,status:503}); await c.processarFilaOffline();
  assert.equal(c.lerFilaOffline().length,1);
  c.supabase=async()=>({ok:true,dados:{status:'entregue'}}); await c.processarFilaOffline();
  assert.equal(c.lerFilaOffline().length,0);
});
test('Trocar usuário não envia nem aplica entrega de outro login',async()=>{
  const c=fila(); await c.adicionarNaFilaOffline(acao(1));
  c.usuario={login:'admin',perfil:'admin'};
  c.supabase=async()=>assert.fail('Enviou ação de outro usuário');
  await c.processarFilaOffline();c.aplicarFilaOffline(c.todosOsPedidos);
  assert.equal(c.lerFilaOffline().length,1);
  assert.equal(c.todosOsPedidos[0].status,'pendente');
});
test('Paginação recupera tudo mesmo quando o servidor limita abaixo de 500',async()=>{
  const registros=[1,2,3,4,5].map(id=>({id}));let chamadas=0;
  const c={supabase:async(t,m,d,f)=>{
    chamadas++;const ultimo=Number(f.match(/id=gt\.(\d+)/)[1]);
    return {ok:true,dados:registros.filter(r=>r.id>ultimo).slice(0,2)};
  }};
  vm.runInNewContext(trecho('async function listarTodos(', 'async function carregarListas('),c);
  const res=await c.listarTodos('pedidos');
  assert.equal(res.dados.length,5);assert.equal(chamadas,4);
});
test('Falha em página posterior não devolve uma lista parcial como completa',async()=>{
  let chamadas=0;const c={supabase:async()=>++chamadas===1?{ok:true,dados:[{id:1}]}:{ok:false,status:503}};
  vm.runInNewContext(trecho('async function listarTodos(', 'async function carregarListas('),c);
  assert.equal((await c.listarTodos('pedidos')).ok,false);
});
test('Limites mensais usam Brasil e atravessam dezembro sem depender do fuso do aparelho',()=>{
  const c={};vm.runInNewContext(trecho('function dataHojeBrasil(', 'function dataBR('),c);
  const r=c.periodoMesBrasil(new Date('2027-01-01T01:00:00Z'));
  assert.equal(r.inicioMes,'2026-12-01');
  assert.equal(r.inicioMesPassado,'2026-11-01');
  assert.equal(r.inicioProximoMes,'2027-01-01');
});
test('Falha de rede durante renovação não é confundida com logout',async()=>{
  const c={
    MODO_DEMO:false,sessao:{access_token:'token-local'},navigator:{onLine:true},
    garantirTokenValido:async()=>false,SUPABASE_URL:'https://local.invalid',SUPABASE_KEY:'teste',
    fetch:async()=>{throw new TypeError('Failed to fetch');},
    AbortController,setTimeout,clearTimeout,console:{error:()=>{},warn:()=>{}},
  };
  vm.runInNewContext(trecho('async function supabase(', '// ============================================================\n// AUTENTICAÇÃO'),c);
  const res=await c.supabase('rpc/concluir_entrega','POST',{p_id:1});
  assert.equal(res.ok,false);assert.equal(res.rede,true);
});
