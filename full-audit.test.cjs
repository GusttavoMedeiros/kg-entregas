const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('app.js','utf8').replace(/\r\n/g,'\n');
const trecho=(a,b)=>app.slice(app.indexOf(a),app.indexOf(b,app.indexOf(a)));

test('destaque da busca trata regex como texto e escapa HTML sem remarcar tags',()=>{
 const c={};vm.runInNewContext(trecho('function esc(', 'function badgeCategoria(')+trecho('function normalizar(', '// Debounce'),c);
 assert.equal(c.highlightBusca('Ração + (teste)','+ (teste)'), 'Ração <mark class="busca-match">+</mark> <mark class="busca-match">(teste)</mark>');
 assert.equal(c.highlightBusca('Ração & Cia','racao &'),'<mark class="busca-match">Ração</mark> <mark class="busca-match">&amp;</mark> Cia');
 assert.equal(c.highlightBusca('<img src=x> mark','mark'), '&lt;img src=x&gt; <mark class="busca-match">mark</mark>');
 assert.equal(c.highlightBusca('a'.repeat(10000)+'!','(a+)+$'),'a'.repeat(10000)+'!');
});

test('edição conserva linhas do mesmo produto com preços diferentes e controles independentes',()=>{
 const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{value:'',innerHTML:'',textContent:''});return els.get(id);};
 const p={id:7,status:'pendente',itens:[
  {produto_id:1,nome:'Teste',qtd:1,preco_unit:10,preco_catalogo:20},
  {produto_id:1,nome:'Teste',qtd:2,preco_unit:20,preco_catalogo:20},
  {produto_id:1,nome:'Teste',qtd:1,preco_unit:10,preco_catalogo:20},
 ]};
 const c={carregandoDados:false,carrinho:[],todosOsPedidos:[p],todosOsProdutos:[{id:1,nome:'Teste',preco:20}],
  document:{getElementById:el},fmt:()=> '2026-09-13',popularSelectClientes(){},podeEditarPedido:()=>true,
  selecionarPagamento(){},buscarProdutoModal(){},abrirModal(){},toast(){},renderizarCarrinho(){}};
 vm.runInNewContext(trecho('let chaveNovoPedido =', '// FORMA DE PAGAMENTO +'),c);
 c.abrirModalNovoPedido(7);
 assert.equal(c.carrinho.length,2);
 assert.equal(c.carrinho.reduce((s,i)=>s+i.qtd*i.preco_unit,0),60);
 vm.runInNewContext(trecho('function alterarQtdCarrinho(', 'function renderizarCarrinho(')+trecho('function definirQtdCarrinho(', '// AJUSTE DE PREÇO'),c);
 c.alterarQtdCarrinho(1,1);assert.equal(c.carrinho[1].qtd,3);assert.equal(c.carrinho[0].qtd,2);
 c.definirQtdCarrinho(1,'Infinity');assert.equal(c.carrinho[1].qtd,3);
 c.removerDoCarrinho(0);assert.equal(c.carrinho.length,1);assert.equal(c.carrinho[0].preco_unit,20);
});

test('ajuste de preço arredonda centavos e rejeita infinito sem alterar pedido',()=>{
 let value='10.129';let aviso=0;
 const c={ajusteCarrinhoIdx:0,carrinho:[{preco_unit:5}],document:{getElementById:()=>({value})},
  fecharModal(){},renderizarCarrinho(){},toast:()=>aviso++};
 vm.runInNewContext(trecho('function confirmarAjustePreco()', 'function resetarPrecoCatalogo()'),c);
 c.confirmarAjustePreco();assert.equal(c.carrinho[0].preco_unit,10.13);
 c.ajusteCarrinhoIdx=0;value='Infinity';c.confirmarAjustePreco();assert.equal(aviso,1);assert.equal(c.carrinho[0].preco_unit,10.13);
});

test('atualização de clientes preserva seleção do pedido em edição',()=>{
 const select={value:'7',innerHTML:''};const c={document:{getElementById:()=>select},todosOsClientes:[{id:7,nome:'Cliente'}],esc:s=>s};
 vm.runInNewContext(trecho('function popularSelectClientes()', 'async function salvarPedido()'),c);
 c.popularSelectClientes();assert.equal(select.value,'7');
});

function apiContext(){
 const c={geracaoAcesso:0,MODO_DEMO:false,sessao:{access_token:'teste'},navigator:{onLine:true},
  garantirTokenValido:async()=>true,SUPABASE_URL:'https://teste.invalid',SUPABASE_KEY:'publica',AbortController,setTimeout,clearTimeout,console};
 vm.runInNewContext(trecho('async function apiSupabase(', '// AUTENTICAÇÃO'),c);return c;
}
test('resposta de gravação da sessão anterior não entra no estado da nova conta',async()=>{
 const c=apiContext();let liberar;
 c.fetch=async()=>new Response(await new Promise(r=>liberar=r));
 const pendente=c.apiSupabase('pedidos','PATCH',{observacao:'teste'});
 await new Promise(setImmediate);c.geracaoAcesso++;liberar('[{"id":1}]');
 const r=await pendente;assert.equal(r.ok,false);assert.equal(r.status,499);
});
test('timeout cobre corpo da resposta que trava depois dos cabeçalhos',async()=>{
 const c=apiContext();let abortar;
 c.setTimeout=fn=>{abortar=fn;return 1;};c.clearTimeout=()=>{};
 c.fetch=async(u,o)=>({status:200,ok:true,text:()=>new Promise((r,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError'))))});
 const pendente=c.apiSupabase('pedidos');await new Promise(setImmediate);abortar();
 assert.equal((await pendente).rede,true);
});

test('Enter repetido faz uma autenticação; login cancelado não restaura sessão',async()=>{
 let chamadas=0,liberar,entradas=0;const btn={};
 const c={geracaoAcesso:0,LOGIN_EMAILS:{admin:'teste'},PERFIS:{admin:{}},document:{
  getElementById:id=>({value:id==='input-usuario'?'admin':'teste',style:{}}),querySelector:()=>btn},
  authLogin:()=>{chamadas++;return new Promise(r=>liberar=r);},mostrarErroLogin(){},toast(){},
  usuarioDoToken:()=>({login:'admin'}),persistirSessao(){},entrarNoApp:()=>entradas++};
 vm.runInNewContext(trecho('let loginEmAndamento =', '// Configura a UI'),c);
 const p=c.fazerLogin();await c.fazerLogin();assert.equal(chamadas,1);
 c.geracaoAcesso++;liberar({ok:true,sessao:{access_token:'teste'}});await p;
 assert.equal(entradas,0);assert.equal(btn.disabled,false);
});

test('falha inicial mantém dados e permite repetir sem recarregar a página',async()=>{
 const aviso={hidden:true};let falhar=true,renderizados=0;
 const c={usuario:{login:'admin',perfil:'admin'},NAV:{admin:[{tela:'tela-dashboard'}]},geracaoAcesso:0,revisaoEstado:0,MODO_DEMO:false,
  todosOsPedidos:[{id:99}],todosOsClientes:[],todosOsProdutos:[],navigator:{onLine:true},
  document:{getElementById:()=>aviso,querySelector:()=>null},
  carregarListas:async()=>falhar?[{ok:false},{ok:true},{ok:true}]:[{ok:true,dados:[{id:1}]},{ok:true,dados:[]},{ok:true,dados:[]}],
  formularioDeDadosAberto:()=>false,aplicarFilaOffline(){},renderizarDashboard:()=>renderizados++,
  popularSelectClientes(){},processarFilaOffline(){},iniciarRealtime(){},iniciarAutoRefresh(){},console};
 vm.runInNewContext(trecho('let carregandoDados =', '// SINCRONIZAÇÃO AUTOMÁTICA'),c);
 await c.carregarTudo();assert.equal(c.todosOsPedidos[0].id,99);assert.match(aviso.innerHTML,/Tentar novamente/);
 falhar=false;await c.carregarTudo();assert.equal(c.todosOsPedidos[0].id,1);assert.equal(aviso.hidden,true);assert.equal(renderizados,1);
});

test('consulta CNPJ antiga não preenche documento trocado durante a rede',async()=>{
 let liberar,aplicacoes=0;const input={value:'12345678901234'},status={style:{}},modal={dataset:{tipoPessoa:'juridica'}};
 const form={dataset:{abertura:'1'},classList:{contains:()=>true}};
 const c={document:{getElementById:id=>id==='cliente-cnpj-cpf'?input:id==='cnpj-status'?status:form,querySelector:()=>modal},
  soDigitos:s=>s,validarCNPJ:()=>true,consultarCNPJ:()=>new Promise(r=>liberar=r),aplicarDadosReceita:()=>aplicacoes++};
 vm.runInNewContext(trecho('async function tentarConsultarCNPJ()', '// Aplica máscaras'),c);
 const p=c.tentarConsultarCNPJ();input.value='98765432109876';liberar({ok:true,dados:{}});await p;
 assert.equal(aplicacoes,0);
});

test('nomes iguais a propriedades de Object não quebram totais dos relatórios',()=>{
 const c={foiPago:()=>false};
 vm.runInNewContext(trecho('function calcularDadosRelatorio(', 'function renderizarRelatorio('),c);
 const dados=c.calcularDadosRelatorio([{valor:20,cliente_nome:'constructor',itens:[{nome:'__proto__',qtd:2,preco_unit:10}]}]);
 assert.equal(dados.topProdutos[0].nome,'__proto__');assert.equal(dados.topProdutos[0].valor,20);
 assert.equal(dados.topClientes[0].valor,20);
});

test('janelas de relatório e vencimento são iguais em fusos distintos do aparelho',()=>{
 const {execFileSync}=require('node:child_process');
 const codigo=`const vm=require('node:vm');const assert=require('node:assert/strict');
 const D=Date;class Hoje extends D{constructor(...args){super(...(args.length?args:['2027-01-01T01:00:00Z']));}}
 const c={Date:Hoje};vm.runInNewContext(${JSON.stringify(
   trecho('const fmt =', 'function dataBR(')+trecho('function dataBR(', 'function moeda(')+
   trecho('function calcularJanelaRelatorio(', '// Filtra somente pedidos')+
   trecho('function calcularDataVencimento(', '// Regra: admin'))},c);
 const m=c.calcularJanelaRelatorio('mensal',0);assert.equal(m.ini,'2026-12-01');assert.equal(m.fim,'2026-12-31');
 const q=c.calcularJanelaRelatorio('quinzenal',0);assert.equal(q.ini,'2026-12-17');assert.equal(q.fim,'2026-12-31');
 assert.equal(c.calcularDataVencimento('2026-12-31','boleto',7),'2027-01-07');`;
 for(const TZ of ['UTC','Pacific/Kiritimati','America/Los_Angeles']) execFileSync(process.execPath,['-e',codigo],{env:{...process.env,TZ}});
});

test('lista de clientes calcula débitos com uma passagem pelos pedidos',()=>{
 let leituras=0;const el={innerHTML:''};
 const c={document:{getElementById:()=>el},todosOsPedidos:[{cliente_id:1,valor:10},{cliente_id:2,valor:20}],
 foiPago:()=>{leituras++;return false;},moeda:n=>String(n),esc:s=>s};
 vm.runInNewContext(trecho('function renderizarClientes(', 'function _buscarClienteImpl('),c);
 c.renderizarClientes([{id:1,nome:'A'},{id:2,nome:'B'},{id:3,nome:'C'}]);
 assert.equal(leituras,2);assert.match(el.innerHTML,/10 em aberto/);assert.match(el.innerHTML,/20 em aberto/);
});

test('financeiro usa entrega real quando pagamento legado não tem data própria',()=>{
 const els={};const c={todosOsClientes:[{id:1,nome:'Teste'}],todosOsPedidos:[{
  id:1,cliente_id:1,valor:10,status:'entregue',data_entrega:'2026-08-31',data_entregue_em:'2026-09-13'}],
  document:{getElementById:id=>els[id]??=( {textContent:'',innerHTML:''} )},
  foiPago:()=>true,fmt:()=> '2026-09-13',dataRealEntrega:p=>p.data_entregue_em||p.data_entrega,
  moeda:n=>String(n),esc:s=>s,isPagamentoAtrasado:()=>false};
 vm.runInNewContext(trecho('function renderizarFinanceiro(', 'function filtrarFinanceiro('),c);
 c.renderizarFinanceiro('todos');assert.equal(els['fin-total-recebido'].textContent,'10');
});
