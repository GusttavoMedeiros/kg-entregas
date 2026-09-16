const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const repo=__dirname;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{const f=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';try{res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(f)]||'application/octet-stream'});res.end(fs.readFileSync(path.join(repo,f)));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
 try{
 for(const [perfil,largura,movimento,economia] of [['admin',360,'no-preference',false],['vendedor',320,'no-preference',true],['entregador',390,'reduce',false],['admin',1280,'no-preference',false]]){
  const itens=[{id:1,produto_id:1,nome:'Ração + (Teste)',qtd:2,preco_unit:10,preco_catalogo:20},{id:2,produto_id:1,nome:'Ração + (Teste)',qtd:2,preco_unit:20,preco_catalogo:20}];
  const clientes=[{id:1,nome:'Cliente teste',whatsapp:'81999999999',cnpj_cpf:'11144477735',tipo_pessoa:'fisica',endereco:'Rua A, 1, Centro, Recife, PE'}];
  const produtos=[{id:1,nome:'Ração + (Teste)',preco:20,categoria:'Ração',produto_custos:{preco_custo:10}},{id:2,nome:'Milho',preco:30,categoria:'Agropecuário',produto_custos:{preco_custo:15}}];
  const pedidos=[{id:1,cliente_id:1,clientes:{nome:'Cliente teste'},itens_pedido:itens,valor:60,status:'pendente',data_entrega:'2026-09-01',data_vencimento:'2026-09-01',forma_pagamento:'avista',vendedor:'vendedor'},
   {id:2,cliente_id:1,clientes:{nome:'Cliente teste'},itens_pedido:[{...itens[0],qtd:1}],valor:10,status:'entregue',status_pagamento:'pago',data_entrega:'2026-08-01',data_entregue_em:'2026-09-13',data_pagamento:'2026-09-13',forma_pagamento:'avista',vendedor:'vendedor'}];
  const context=await browser.newContext({viewport:{width:largura,height:800},reducedMotion:movimento,serviceWorkers:'block'});
  const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'teste',app_metadata:{app_login:perfil,app_role:perfil,app_name:'Teste'}})).toString('base64url')+'.teste';
  await context.addInitScript(({token,perfil,economia})=>{
   localStorage.setItem('kg-sessao',JSON.stringify({sessao:{access_token:token,refresh_token:'teste',expires_at:Date.now()+3600000},usuario:{login:perfil,perfil}}));
   if(economia){Object.defineProperty(navigator,'deviceMemory',{get:()=>2});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});}
  },{token,perfil,economia});
  let falharLista=perfil==='admin'&&largura===360,gravacoes=0;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname.endsWith('supabase.co')){
    if(u.pathname.startsWith('/auth/'))return route.fulfill({json:{}});
    if(u.pathname.includes('historico_precos')){await pause(u.searchParams.get('produto_id')==='eq.1'?450:40);return route.fulfill({json:[]});}
    if(u.pathname.includes('historico_pedidos'))return route.fulfill({json:[]});
    if(req.method()==='GET'){
     const table=u.pathname.split('/').pop();if(falharLista&&table==='pedidos'){falharLista=false;return route.fulfill({status:503,json:{erro:'Falha simulada'}});}
     let rows=({pedidos,clientes,produtos})[table];if(!rows)return route.fulfill({status:404,json:{erro:'Rota de teste não implementada'}});
     const ultimo=Number((u.searchParams.get('id')||'gt.0').split('.')[1]);rows=rows.filter(x=>x.id>ultimo);
     return route.fulfill({json:rows,headers:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':`${rows.length?'0-'+(rows.length-1):'*'}/${rows.length}`}});
    }
    gravacoes++;const data=req.postDataJSON();
    if(u.pathname.endsWith('/rpc/salvar_pedido')){
     const id=data.p_id||pedidos.length+1;
     const p={...data.p_pedido,id,status:'pendente',vendedor:perfil,valor:data.p_itens.reduce((s,i)=>s+i.qtd*i.preco_unit,0),itens:data.p_itens};
     const idx=pedidos.findIndex(x=>x.id===id);if(idx<0)pedidos.push({...p,itens_pedido:p.itens});else Object.assign(pedidos[idx],p,{itens_pedido:p.itens});
     return route.fulfill({json:p});
    }
    if(u.pathname.endsWith('/rpc/salvar_produto')){
     const salvo={id:data.p_id||produtos.length+1,...data.p_produto};produtos.push({...salvo,produto_custos:{preco_custo:salvo.preco_custo}});
     return route.fulfill({json:salvo});
    }
    if(u.pathname.endsWith('/clientes')){const id=Number((u.searchParams.get('id')||'eq.1').split('.')[1]);Object.assign(clientes.find(x=>x.id===id),data);return route.fulfill({json:[clientes.find(x=>x.id===id)],headers:{'Access-Control-Expose-Headers':'Content-Range','Content-Range':'0-0/1'}});}
    return route.fulfill({status:500,json:{erro:'Gravação não esperada no teste'}});
   }
   if(u.hostname!=='127.0.0.1')return route.abort();
   if(u.pathname==='/supabase.min.js')return route.fulfill({contentType:'application/javascript',body:''});
   return route.continue();
  });
  const p=await context.newPage(),errors=[];p.setDefaultTimeout(8000);console.log('Iniciando',perfil,largura);p.on('pageerror',e=>errors.push(e.message));
  await p.goto(`http://127.0.0.1:${server.address().port}`);
  if(perfil==='admin'&&largura===360){await p.getByRole('button',{name:'Tentar novamente',exact:true}).click();}
  await p.waitForFunction(()=>!carregandoDados&&todosOsPedidos.length===2);
  const ids=await p.locator('#nav-bottom button').evaluateAll(es=>es.map(e=>e.id));
  for(const id of ids){await p.locator('#'+id).click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  if(perfil!=='entregador'){
   await p.evaluate(()=>abrirModalNovoPedido(1));
   assert.equal(await p.locator('.carrinho-item').count(),2);assert.match(await p.locator('#carrinho-total').innerText(),/60,00/);
   await p.locator('.qtd-input').nth(1).fill('3');await p.locator('.qtd-input').nth(1).press('Tab');
   assert.match(await p.locator('#carrinho-total').innerText(),/80,00/);
   await p.locator('button[onclick="salvarPedido()"]').click();await p.waitForFunction(()=>!salvando&&!document.getElementById('modal-pedido').classList.contains('aberto'));
   assert.equal(pedidos[0].valor,80);
   await p.evaluate(()=>abrirModalNovoPedido());await p.locator('#pedido-cliente').selectOption('1');
   await p.locator('#lista-produto-modal .btn-azul').first().click();
   await p.locator('[data-valor="boleto"]').click();await p.locator('.qtd-parc[data-n="2"]').click();
   await p.locator('button[onclick="salvarPedido()"]').click();await p.waitForFunction(()=>todosOsPedidos.length===3&&!salvando);
   assert.equal(pedidos[2].prazos_boleto,'7,14');
   await p.evaluate(()=>{window.resultadoConfirmacao=null;confirmar('Teste seguro').then(v=>window.resultadoConfirmacao=v);});
   await p.locator('.bt-cancelar').focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>window.resultadoConfirmacao!==null);
   assert.equal(await p.evaluate(()=>window.resultadoConfirmacao),false);
   await p.evaluate(()=>{window.confirmacoes=[];confirmar('Primeira').then(v=>window.confirmacoes.push(v));confirmar('Segunda').then(v=>window.confirmacoes.push(v));});
   await p.locator('.bt-ok').click();await p.waitForFunction(()=>window.confirmacoes.length===2);
   assert.deepEqual(await p.evaluate(()=>window.confirmacoes),[false,true]);
   await p.evaluate(()=>{abrirModalRelatorio();});assert.ok((await p.locator('#relatorio-conteudo').innerText()).length>0);
   // A quinzena iniciada no dia 16 não pode aparentar estar quebrada por
   // cair numa metade do mês vazia. O período móvel de 15 dias deve mostrar
   // uma entrega recente e atualizar o rótulo da aba.
   await p.evaluate(()=>{
    todosOsPedidos.push({id:999,cliente_id:1,cliente_nome:'Cliente quinzena',status:'entregue',
      data_entregue_em:dataHojeBrasil(),valor:1,vendedor:'vendedor',itens:[{nome:'Teste',qtd:1,preco_unit:1}]});
    mudarTipoRelatorio('quinzenal',document.querySelectorAll('#abas-relatorio .aba')[1]);
   });
   assert.match(await p.locator('#rel-periodo-label').innerText(),/Quinzena/);
   assert.match(await p.locator('#relatorio-conteudo').innerText(),/PEDIDOS ENTREGUES/i);
   await p.evaluate(()=>imprimirRelatorio());await p.waitForSelector('#via-pdf-canvas');
   assert.equal(await p.locator('#via-overlay').evaluate(e=>getComputedStyle(e).display), 'flex');
   assert.ok(await p.locator('#via-pdf-canvas').evaluate(c=>c.width>0&&c.height>0));
   await p.screenshot({path:path.join(require("node:os").tmpdir(),`kg-print-report-${perfil}-${largura}.png`)});
   assert.equal(await p.locator('#via-btn-whatsapp').evaluate(e=>getComputedStyle(e).display), 'none');
   await p.evaluate(()=>{fecharViaPedido();gerarViaPedido(1);});await p.waitForSelector('#via-pdf-canvas');
   assert.ok(await p.locator('#via-pdf-canvas').evaluate(c=>c.width>0&&c.height>0));
   await p.screenshot({path:path.join(require("node:os").tmpdir(),`kg-print-order-${perfil}-${largura}.png`)});
   await p.waitForFunction(()=>getComputedStyle(document.getElementById('via-btn-whatsapp')).display !== 'none');
   assert.notEqual(await p.locator('#via-btn-whatsapp').evaluate(e=>getComputedStyle(e).display), 'none');
   await p.evaluate(()=>{fecharViaPedido();abrirModalNovoCliente(1);});
   await p.locator('#cliente-nome').fill('Cliente atualizado');await p.locator('button[onclick="salvarCliente()"]').click();
   await p.waitForFunction(()=>!salvando&&!document.getElementById('modal-cliente').classList.contains('aberto'));
   assert.equal(clientes[0].nome,'Cliente atualizado');
   if(perfil==='admin'){
    await p.evaluate(()=>{verDetalheProduto(1);verDetalheProduto(2);});await pause(550);
    assert.equal(await p.locator('#detalhe-produto-nome').innerText(),'Milho');
    assert.match(await p.locator('#detalhe-produto-conteudo').innerText(),/30,00/);
    await p.evaluate(()=>fecharModal('modal-detalhe-produto'));
    await p.evaluate(()=>abrirModalProduto());
    await p.locator('#produto-nome').fill('Produto novo teste');await p.locator('#produto-preco').fill('40');await p.locator('#produto-custo').fill('25');
    await p.locator('button[onclick="salvarProduto()"]').click();await p.waitForFunction(()=>!salvando&&todosOsProdutos.length===3);
    assert.equal(produtos[2].preco,40);
   }
  }else{
   await p.locator('.check-item').first().click();await p.evaluate(()=>abrirModalEntrega(1));
   await p.locator('.pagto-recebido[data-valor="pendente"]').click();
   await context.setOffline(true);
   await p.locator('button[onclick="confirmarEntrega()"]').click();await p.waitForFunction(()=>todosOsPedidos[0].status==='entregue');
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kg-fila-offline')).length),1);
   await p.evaluate(()=>sair());assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kg-fila-offline')).length),1);
   await context.setOffline(false);
  }
  assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(require("node:os").tmpdir(),`kg-audit-${perfil}-${largura}.png`)});
  results.push({perfil,largura,movimento,economia,gravacoesSimuladas:gravacoes,erros:errors});await context.close();
 }
 console.log(JSON.stringify(results));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
