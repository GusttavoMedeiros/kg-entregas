const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const repo=__dirname;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer((req,res)=>{const f=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';try{res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png'})[path.extname(f)]||'application/octet-stream'});res.end(fs.readFileSync(path.join(repo,f)));}catch{res.writeHead(404);res.end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});const results=[];
 try{
 for(const [perfil,largura,movimento,economia] of [['admin',360,'no-preference',false],['vendedor',320,'no-preference',true],['entregador',390,'reduce',false],['admin',1280,'no-preference',false]]){
  const itens=[{id:1,produto_id:1,nome:'Ração + (Teste)',qtd:2,preco_unit:10,preco_catalogo:20},{id:2,produto_id:1,nome:'Ração + (Teste)',qtd:2,preco_unit:20,preco_catalogo:20}];
  const clientes=[{id:1,nome:'Cliente teste',whatsapp:'81999999999',cnpj_cpf:'11144477735',tipo_pessoa:'fisica',endereco:'Rua A, 1, Centro, Recife, PE'}];
  const produtos=[{id:1,nome:'Ração + (Teste)',preco:20,peso_kg:15,categoria:'Ração',produto_custos:{preco_custo:10}},{id:2,nome:'Milho',preco:30,categoria:'Agropecuário',produto_custos:{preco_custo:15}}];
  const pedidos=[{id:1,cliente_id:1,clientes:{nome:'Cliente teste'},itens_pedido:itens,valor:60,status:'pendente',data_entrega:'2026-09-01',data_vencimento:'2026-09-01',forma_pagamento:'avista',vendedor:'vendedor'},
   {id:2,cliente_id:1,clientes:{nome:'Cliente teste'},itens_pedido:[{...itens[0],qtd:1}],valor:10,status:'entregue',status_pagamento:'pago',data_entrega:'2026-08-01',data_entregue_em:'2026-09-13',data_pagamento:'2026-09-13',forma_pagamento:'avista',vendedor:'vendedor'}];
  const context=await browser.newContext({viewport:{width:largura,height:800},reducedMotion:movimento,serviceWorkers:'block'});
  const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({sub:'teste',app_metadata:{app_login:perfil,app_role:perfil,app_name:'Teste'}})).toString('base64url')+'.teste';
  await context.addInitScript(({token,perfil,economia})=>{
   if(perfil!=='vendedor') localStorage.setItem('kg-sessao',JSON.stringify({sessao:{access_token:token,refresh_token:'teste',expires_at:Date.now()+3600000},usuario:{login:perfil,perfil}}));
   if(economia){Object.defineProperty(navigator,'deviceMemory',{get:()=>2});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>2});}
  },{token,perfil,economia});
  let falharLista=perfil==='admin'&&largura===360,gravacoes=0;
  let respostaLogin = 200;
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.hostname.endsWith('supabase.co')){
    if(u.pathname==='/auth/v1/token' && u.searchParams.get('grant_type')==='password'){
     assert.equal(req.postDataJSON().email,'vendedor@kgagropet.local');
     if(respostaLogin===0) return route.abort('namenotresolved');
     return route.fulfill({status:respostaLogin,json:respostaLogin===200
      ? {access_token:token,refresh_token:'teste',expires_in:3600}
      : {error_code:respostaLogin===400?'invalid_credentials':'erro_simulado'}});
    }
    if(u.pathname.startsWith('/auth/'))return route.fulfill({json:{}});
    if(u.pathname.includes('historico_precos')){await pause(u.searchParams.get('produto_id')==='eq.1'?450:40);return route.fulfill({json:[]});}
    if(u.pathname.includes('historico_pedidos'))return route.fulfill({json:[]});
    if(u.pathname.includes('acertos_comissao'))return route.fulfill({json:[]});
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
  if(perfil==='vendedor'){
   await p.locator('[data-perfil="vendedor"]').click();
   await p.locator('#input-senha').fill('senha-ficticia');
   for(const [status,mensagem] of [[400,'Confira o perfil'],[429,'Muitas tentativas'],[503,'não conseguiu concluir'],[0,'Confira sua conexão']]){
    respostaLogin=status;
    await p.getByRole('button',{name:'Entrar',exact:true}).click();
    await p.locator('#erro-login:visible').filter({hasText:mensagem}).waitFor();
   }
   respostaLogin=200;
   await p.getByRole('button',{name:'Entrar',exact:true}).click();
  }
  if(perfil==='admin'&&largura===360){await p.getByRole('button',{name:'Tentar novamente',exact:true}).click();}
  await p.waitForFunction(()=>!carregandoDados&&todosOsPedidos.length===2);
  if(largura<900){
   await p.evaluate(() => document.documentElement.style.setProperty('--safe-top', '59px'));
   const cabecalho = await p.locator('#app-header').evaluate(header => {
    const estilo = getComputedStyle(header);
    return {
     filtro: estilo.backdropFilter,
     fundo: estilo.backgroundColor,
     topoLogo: header.querySelector('img').getBoundingClientRect().top,
    };
   });
   assert.equal(cabecalho.filtro, 'none', 'o cabeçalho móvel não deve aplicar vidro');
   assert.match(cabecalho.fundo, /^rgb\(/, 'o fundo do cabeçalho deve ser opaco');
   assert.ok(cabecalho.topoLogo >= 59, `a marca deve ficar abaixo da barra de status (topo: ${cabecalho.topoLogo})`);
   await p.evaluate(() => document.documentElement.style.removeProperty('--safe-top'));
  }
  const vidro = await p.locator('#nav-bottom').evaluate(e=>getComputedStyle(e).backdropFilter);
  if(economia) assert.equal(vidro,'none');
  else assert.match(vidro,/blur\(20px\)/);
  await p.screenshot({path:path.join(require('node:os').tmpdir(),`kg-vidro-${perfil}-${largura}.png`)});
  if(perfil==='admin') {
   await p.evaluate(()=>{
    todosOsProdutos.push({id:997,nome:'Farelo',preco:100,peso_kg:50}, {id:998,nome:'Farelo 50KG',preco:100,produto_principal_id:997}, {id:996,nome:'Mistura',preco:90,peso_kg:40});
    todosOsPedidos.push({id:999,cliente_id:1,status:'pendente',vendedor:'admin',data_entrega:'2026-09-01',itens:[
     {produto_id:998,nome:'Farelo 50KG',qtd:9,preco_unit:100},
     {produto_id:996,nome:'Mistura 50KG',qtd:2,preco_unit:90,peso_unitario_kg:20}
    ]});
    abrirModalNovoPedido(999);
   });
   assert.equal(await p.locator('#carrinho-peso').innerText(), 'Peso total: 490 kg (aproximado)');
   assert.match(await p.locator('#carrinho-lista').innerText(), /Peso total: 450 kg \(aproximado\)/);
   assert.match(await p.locator('#carrinho-lista').innerText(), /Peso total: 40 kg/);
   await p.evaluate(()=>{fecharModal('modal-pedido');todosOsPedidos=todosOsPedidos.filter(x=>x.id!==999);todosOsProdutos=todosOsProdutos.filter(x=>![996,997,998].includes(x.id));});
  }
  if(perfil!=='entregador') {
   assert.match(await p.evaluate(()=>montarCardProduto(todosOsProdutos.find(x=>x.id===1),false)), /15 kg\/un\./);
   await p.evaluate(()=>{todosOsProdutos.push({id:999,nome:'Duplicado de teste',produto_principal_id:1});});
   const medirFundo = () => p.evaluate(() => ({
    tela: document.querySelector('.tela.ativa').getBoundingClientRect().top,
    cabecalho: document.getElementById('app-header').getBoundingClientRect().top,
   }));
   await p.evaluate(largura => {
    document.querySelector('.tela.ativa').style.minHeight = '1800px';
    const rolagem = largura < 900 ? document.scrollingElement : document.querySelector('.conteudo');
    rolagem.scrollTop = 320;
   }, largura);
   await p.locator('.tela.ativa').evaluate(el => Promise.all(el.getAnimations().map(animacao => animacao.finished)));
   const fundoAntes = await medirFundo();
   assert.ok(fundoAntes.tela < 0);
   await p.evaluate(()=>abrirModalNovoPedido());
   assert.deepEqual(await medirFundo(), fundoAntes, 'abrir o pedido mantém o fundo na mesma posição');
   assert.equal(await p.locator('#app').getAttribute('inert'), '', 'o fundo deixa de receber interação');
   if(largura<900){
    await p.evaluate(() => window.scrollBy(0, 200));
    assert.deepEqual(await medirFundo(), fundoAntes, 'a página atrás do pedido fica travada');
   }
   const formulario = p.locator('#modal-pedido .modal-sheet');
   const areaRolavel = await formulario.evaluate(el => el.scrollHeight > el.clientHeight);
   if (largura <= 393) assert.ok(areaRolavel, 'o pedido é rolável em telas pequenas');
   if (areaRolavel) {
    await formulario.locator('.modal-titulo').hover();
    await p.mouse.wheel(0, 620);
    await p.waitForFunction(() => document.querySelector('#modal-pedido .modal-sheet').scrollTop > 0);
    assert.deepEqual(await medirFundo(), fundoAntes, 'rolar o formulário preserva a posição do fundo');
   }
   if(largura<900){
    const busca=p.locator('#busca-produto-modal');
    await busca.fill('Milho');
    assert.ok(await busca.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
    const lista=p.locator('#lista-produto-modal');
    await lista.locator('button').filter({hasText:'Adicionar'}).last().waitFor();
    await p.waitForFunction(()=>document.querySelectorAll('#lista-produto-modal button').length===1);
    await lista.getByRole('button',{name:'+ Adicionar',exact:true}).click();
    assert.match(await p.locator('#carrinho-lista').innerText(),/Milho/);
    await busca.fill('');
    await p.waitForFunction(()=>document.querySelectorAll('#lista-produto-modal button').length===2);
   }
   assert.match(await p.locator('#lista-produto-modal').innerText(), /15 kg\/un\./);
   assert.doesNotMatch(await p.locator('#lista-produto-modal').innerText(), /Duplicado de teste/);
   await p.evaluate(()=>{adicionarAoCarrinho(1);});
   assert.match(await p.locator('#carrinho-lista').innerText(), /15 kg\/un\./);
   await p.locator('#carrinho-lista .btn-ajustar-preco').first().click();
   await p.waitForFunction(() => document.activeElement?.id === 'ajustar-preco-input');
   await p.keyboard.press('Escape');
   assert.equal(await p.locator('#modal-ajustar-preco').isVisible(), false);
   assert.equal(await p.locator('#app').getAttribute('inert'), '', 'fechar o ajuste mantém o pedido isolado');
   await p.locator('#modal-pedido').getByRole('button', {name:'Cancelar', exact:true}).click();
   assert.deepEqual(await medirFundo(), fundoAntes, 'fechar o pedido restaura a posição da página');
   assert.equal(await p.locator('#app').getAttribute('inert'), null);
   await p.evaluate(largura => {
    const rolagem = largura < 900 ? document.scrollingElement : document.querySelector('.conteudo');
    rolagem.scrollTop = 0;
    document.querySelector('.tela.ativa').style.minHeight = '';
    todosOsProdutos = todosOsProdutos.filter(x => x.id !== 999);
   }, largura);
  }
  if(largura<900){
   const medirRolagem = () => p.evaluate(() => ({
    fim: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
    y: window.scrollY,
   }));
   await p.evaluate(() => {
    document.documentElement.style.setProperty('--safe-bot', '34px');
    document.querySelector('.tela.ativa').style.minHeight = '2000px';
    window.scrollTo(0, 0);
   });
   const barraVisivel = () => {
    const nav = document.getElementById('nav-bottom');
    return !nav.classList.contains('nav-recolhida') && Math.abs(innerHeight - nav.getBoundingClientRect().bottom - 42) < 1;
   };
   await p.waitForFunction(barraVisivel);
   const { fim } = await medirRolagem();
   assert.ok(fim > 500);
   await p.evaluate(y => window.scrollTo(0, y), fim);
   await p.waitForFunction(() => document.getElementById('nav-bottom').classList.contains('nav-recolhida'));
   await p.waitForFunction(() => document.getElementById('nav-bottom').getBoundingClientRect().top >= innerHeight);
   assert.deepEqual(await medirRolagem(), { fim, y: fim }, 'ocultar a barra não deve aumentar o fim da lista');
   await p.evaluate(() => window.scrollBy(0, -22));
   await p.waitForFunction(barraVisivel);
   assert.deepEqual(await medirRolagem(), { fim, y: fim - 22 }, 'mostrar a barra não deve encurtar a lista');
   assert.ok(await p.evaluate(() =>
    document.querySelector('.tela.ativa').getBoundingClientRect().bottom <= document.getElementById('nav-bottom').getBoundingClientRect().top
   ), 'o fim do conteúdo deve ficar acima da barra');
   await p.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.tela.ativa').style.minHeight = '';
    document.documentElement.style.removeProperty('--safe-bot');
   });
  }
  const ids=await p.locator('#nav-bottom button').evaluateAll(es=>es.map(e=>e.id));
  if(largura<900){
   assert.equal(await p.locator('#nav-bottom .nav-indicator').count(),1);
   if(ids.length>1){
    const x0=await p.locator('.nav-indicator').evaluate(e=>e.style.getPropertyValue('--nav-indicator-x'));
    await p.locator('#'+ids[1]).click();
    await p.waitForFunction(id=>document.querySelector('.nav-item.ativo')?.id===id,ids[1]);
    const x1=await p.locator('.nav-indicator').evaluate(e=>e.style.getPropertyValue('--nav-indicator-x'));
    assert.notEqual(x0,x1);
    assert.equal(await p.locator('.tela.ativa').evaluate(e=>e.style.getPropertyValue('--kg-screen-shift')),'12px');
    await p.locator('#'+ids[0]).click();
    await p.waitForFunction(id=>document.querySelector('.nav-item.ativo')?.id===id,ids[0]);
    assert.equal(await p.locator('.tela.ativa').evaluate(e=>e.style.getPropertyValue('--kg-screen-shift')),'-12px');
   }
  }else{
   assert.notEqual(await p.locator('#nav-bottom .nav-indicator').evaluate(e=>getComputedStyle(e).display),'none');
  }
  for(const id of ids){
   const item = p.locator('#'+id);
   await item.click();
   assert.equal(await item.getAttribute('aria-current'), 'page');
   assert.equal(await p.locator('#nav-bottom [aria-current="page"]').count(), 1);
   assert.match(await item.locator('.kg-icone').evaluate(ico=>getComputedStyle(ico).maskImage), /icones-kg-v1\.png/);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(id==='nav-clientes' || id==='nav-financeiro'){
    await p.locator('button.item-cliente-card:visible').first().press('Enter');
    const modal = id==='nav-clientes' ? '#modal-detalhe-cliente' : '#modal-fin-cliente';
    await p.locator(modal+'.aberto').waitFor();
    await p.keyboard.press('Escape');
   }
  }
  if(perfil!=='entregador'){
   await p.evaluate(()=>abrirModalNovoPedido(1));
   assert.equal(await p.locator('.carrinho-item').count(),2);assert.match(await p.locator('#carrinho-total').innerText(),/60,00/);assert.match(await p.locator('#carrinho-peso').innerText(),/60 kg/);
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
   // O relatório confere com o servidor: a entrega de hoje entra na base simulada do servidor.
   const hojeBr=await p.evaluate(()=>dataHojeBrasil());
   pedidos.push({id:999,cliente_id:1,clientes:{nome:'Cliente quinzena'},status:'entregue',status_pagamento:'pago',data_entrega:hojeBr,data_entregue_em:hojeBr,
     valor:1,vendedor:'vendedor',forma_pagamento:'avista',itens_pedido:[{id:99,produto_id:1,nome:'Teste',qtd:1,preco_unit:1,preco_catalogo:1}]});
   await p.evaluate(async()=>{await atualizarFonteRelatorio();mudarTipoRelatorio('quinzenal',document.querySelectorAll('#abas-relatorio .aba')[1]);});
   assert.match(await p.locator('#rel-periodo-label').innerText(),/Quinzena/);
   assert.match(await p.locator('#relatorio-conteudo').innerText(),/ENTREGAS DO PERÍODO/i);
   assert.doesNotMatch(await p.locator('#relatorio-conteudo').innerText(),/Não foi possível consultar os acertos/);
   await p.evaluate(()=>imprimirRelatorio());await p.waitForSelector('#via-pdf-canvas');
   const vidroPdf=await p.locator('.via-acoes').evaluate(e=>getComputedStyle(e).backdropFilter);
   if(economia) assert.equal(vidroPdf,'none'); else assert.match(vidroPdf,/blur\(20px\)/);
   const textoRelatorioPdf = await p.evaluate(async()=>{
    const r=montarRelatorio(), gerado=await gerarPdfRelatorio(r.ini,r.fim,r.label);
    const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await gerado.blob.arrayBuffer())}).promise;
    let texto=''; for(let n=1;n<=pdf.numPages;n++) texto+=(await (await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
    URL.revokeObjectURL(gerado.url);return texto;
   });
   assert.match(textoRelatorioPdf, /Peso total:.*kg/);assert.match(textoRelatorioPdf, /15 kg/);
   assert.doesNotMatch(textoRelatorioPdf, /estimad|estimativa/i);
   assert.equal(await p.locator('#via-overlay').evaluate(e=>getComputedStyle(e).display), 'flex');
   assert.ok(await p.locator('#via-pdf-canvas').evaluate(c=>c.width>0&&c.height>0));
   await p.screenshot({path:path.join(require("node:os").tmpdir(),`kg-print-report-${perfil}-${largura}.png`)});
   assert.equal(await p.locator('#via-btn-whatsapp').evaluate(e=>getComputedStyle(e).display), 'none');
   await p.evaluate(()=>{fecharViaPedido();gerarViaPedido(1);});await p.waitForSelector('#via-pdf-canvas');
   const textoPedidoPdf = await p.evaluate(async()=>{
    const gerado=await gerarPdfViaPedido(1),pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(await gerado.blob.arrayBuffer())}).promise;
    let texto=''; for(let n=1;n<=pdf.numPages;n++) texto+=(await (await pdf.getPage(n)).getTextContent()).items.map(i=>i.str).join(' ');
    URL.revokeObjectURL(gerado.url);return texto;
   });
   assert.match(textoPedidoPdf, /15 kg por unidade/);assert.match(textoPedidoPdf, /Peso total:.*kg/);
   assert.doesNotMatch(textoPedidoPdf, /estimad|estimativa/i);
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
    await p.locator('#produto-peso').fill('15');await p.locator('#produto-nome').fill('Produto novo teste');
    await p.locator('#produto-preco').fill('40');await p.locator('#produto-preco').press('Tab');assert.equal(await p.locator('#produto-preco').inputValue(),'40,00');
    await p.locator('#produto-custo').fill('25');await p.locator('#produto-custo').press('Tab');assert.equal(await p.locator('#produto-custo').inputValue(),'25,00');
    const opcaoCusto = await p.locator('.produto-sem-custo').evaluate(e => {
     const caixa = e.querySelector('input').getBoundingClientRect(), texto = e.querySelector('span').getBoundingClientRect(), area = e.getBoundingClientRect();
     return {largura: caixa.width, distancia: texto.left - caixa.right, cabe: texto.right <= area.right, altura: e.offsetHeight};
    });
    assert.ok(opcaoCusto.largura <= 24 && opcaoCusto.distancia >= 0 && opcaoCusto.distancia <= 16 && opcaoCusto.cabe && opcaoCusto.altura >= 44, JSON.stringify(opcaoCusto));
    await p.screenshot({path:path.join(require('node:os').tmpdir(),`kg-produto-${largura}.png`)});
    await p.locator('#produto-sem-custo').check();assert.equal(await p.locator('#produto-custo').isDisabled(),true);assert.equal(await p.locator('#produto-custo-aviso').isVisible(),true);
    await p.screenshot({path:path.join(require('node:os').tmpdir(),`kg-produto-sem-custo-${largura}.png`)});
    await p.locator('#produto-sem-custo').uncheck();assert.equal(await p.locator('#produto-custo').inputValue(),'25,00');
    await p.locator('button[onclick="salvarProduto()"]').click();await p.waitForFunction(()=>!salvando&&todosOsProdutos.length===3);
    assert.equal(produtos[2].preco,40);assert.equal(produtos[2].peso_kg,15);
   }
  }else{
   const checklist = p.locator('button.check-item');
   await checklist.first().press('Space');
   assert.deepEqual(await checklist.evaluateAll(items=>items.map(item=>item.getAttribute('aria-pressed'))), ['true','true']);
   assert.equal(await p.locator('.checklist-contador').first().textContent(), '2/2');
   await checklist.last().press('Enter');
   assert.deepEqual(await checklist.evaluateAll(items=>items.map(item=>item.getAttribute('aria-pressed'))), ['false','false']);
   assert.equal(await p.locator('.checklist-contador').first().textContent(), '0/2');
   await checklist.first().click();
   await p.evaluate(()=>abrirModalEntrega(1));
   await p.locator('.pagto-recebido[data-valor="pendente"]').click();
   await context.setOffline(true);
   await p.locator('button[onclick="confirmarEntrega()"]').click();await p.waitForFunction(()=>todosOsPedidos[0].status==='entregue');
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kg-fila-offline')).length),1);
   await p.evaluate(()=>{abrirModal('modal-fila-falhas');sair();});
   await p.locator('#input-senha:visible').waitFor();
   assert.equal(await p.locator('#tela-login').getAttribute('inert'), null, 'sair com modal aberto libera o login');
   assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kg-fila-offline')).length),1);
   await context.setOffline(false);
  }
  assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(require("node:os").tmpdir(),`kg-audit-${perfil}-${largura}.png`)});
  results.push({perfil,largura,movimento,economia,gravacoesSimuladas:gravacoes,erros:errors});await context.close();
 }
 console.log(JSON.stringify(results));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
