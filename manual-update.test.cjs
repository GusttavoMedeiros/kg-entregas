const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
const inicio = app.indexOf('let atualizandoAplicativo = false;');
const fim = app.indexOf('// REGISTRO AUTOMÁTICO DO SERVICE WORKER', inicio);
const codigo = app.slice(inicio, fim) + '\nthis.atualizarAplicativo=atualizarAplicativo;';

function contexto({ online=true, fetchImpl } = {}) {
  const botao = { disabled:false, textContent:'↻ Atualizar aplicativo' };
  const status = { textContent:'', className:'status-atualizar-login' };
  const registro = {
    waiting:{ postMessage:m => { registro.mensagem=m; } },
    update:async()=>{ registro.atualizou=true; },
  };
  const c = {
    geracaoAcesso:0, AbortController, clearTimeout(){},
    document:{ getElementById:id => id === 'btn-atualizar-app' ? botao : status },
    navigator:{
      onLine:online,
      serviceWorker:{
        getRegistration:async()=>registro,
        register:async()=>registro,
      },
    },
    fetch:fetchImpl || (async()=>({ok:true,status:200,text:async()=>''})),
    location:{ href:'https://kg-entregas.test/', replace:url=>{ c.destino=url; } },
    setTimeout:(fn,ms)=>{ if(ms===300) fn(); else c.abortar=fn; return 1; },
    URL, Date, console:{ warn(){} },
  };
  vm.runInNewContext(codigo,c);
  return { c, botao, status, registro };
}

test('botão força consulta sem cache, atualiza o SW e preserva dados locais', async () => {
  let liberar; let chamadas=0; let opcoes;
  const { c, botao, status, registro } = contexto({
    fetchImpl:(_url,o)=>{ chamadas++;opcoes=o;return new Promise(resolve=>{liberar=resolve;}); },
  });
  const primeira = c.atualizarAplicativo();
  const segunda = c.atualizarAplicativo();
  assert.equal(chamadas,1);
  assert.equal(botao.disabled,true);
  liberar({ok:true,status:200,text:async()=>''});
  await Promise.all([primeira,segunda]);
  assert.equal(opcoes.cache,'no-store');
  assert.equal(registro.atualizou,true);
  assert.equal(registro.mensagem.type,'SKIP_WAITING');
  assert.match(c.destino,/atualizado=\d+/);
  assert.match(status.className,/\bok\b/);
  assert.doesNotMatch(codigo,/caches\.delete|localStorage\.(?:clear|removeItem)/);
});

test('sem internet informa o usuário sem tentar atualizar', async () => {
  let chamou=false;
  const { c, botao, status } = contexto({online:false,fetchImpl:async()=>{chamou=true;}});
  await c.atualizarAplicativo();
  assert.equal(chamou,false);
  assert.equal(botao.disabled,false);
  assert.match(status.textContent,/Sem internet/);
  assert.match(status.className,/\berro\b/);
});

test('falha de rede libera o botão para uma nova tentativa', async () => {
  const { c, botao, status } = contexto({fetchImpl:async()=>{throw new Error('rede');}});
  await c.atualizarAplicativo();
  assert.equal(botao.disabled,false);
  assert.match(botao.textContent,/Atualizar aplicativo/);
  assert.match(status.textContent,/Não foi possível atualizar/);
});

test('atualização com Service Worker travado termina e libera nova tentativa',async()=>{
  const {c,botao,registro}=contexto();
  registro.update=()=>new Promise(()=>{});
  const p=c.atualizarAplicativo();await new Promise(setImmediate);c.abortar();await p;
  assert.equal(botao.disabled,false);assert.equal(c.destino,undefined);
});

test('login durante atualização impede recarga que apagaria o formulário aberto',async()=>{
  let liberar;const {c,botao}=contexto({fetchImpl:()=>new Promise(r=>liberar=r)});
  const p=c.atualizarAplicativo();c.geracaoAcesso++;
  liberar({ok:true,status:200,text:async()=>''});await p;
  assert.equal(c.destino,undefined);assert.equal(botao.disabled,false);
});
