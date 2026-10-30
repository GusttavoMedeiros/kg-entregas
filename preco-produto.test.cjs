const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('app.js','utf8');
const inicio=src.indexOf('function lerPrecoProduto(');
const fim=src.indexOf('// Re-renderiza o catálogo respeitando busca ativa.',inicio);
function ambiente() {
  const els = Object.fromEntries(['produto-nome','produto-categoria','produto-preco','produto-custo','produto-sem-custo','produto-custo-aviso','produto-peso','produto-id','margem-info'].map(k=>[k,{value:'',checked:false,disabled:false,hidden:true,innerHTML:'',classList:{add(){},remove(){}}}]));
  Object.assign(els['produto-nome'],{value:'Produto'});els['produto-categoria'].value='Ração';
  let gravado,avisos=[];
  const c={document:{getElementById:id=>els[id]},MODO_DEMO:false,salvando:false,todosOsProdutos:[],
    apiSupabase:async(p,m,d)=>{gravado=d.p_produto;return {ok:true,dados:{id:1,...gravado}}},
    toast:x=>avisos.push(x),botaoSalvando(){},fecharModal(){},registrarMudancaLocal(){},moeda:n=>String(n)};
  vm.createContext(c);vm.runInContext(src.slice(inicio,fim),c);
  return {c,els,resultado:()=>gravado,avisos};
}
test('preços são formatados em reais e números inválidos não são aceitos',()=>{
 const {c}=ambiente();
 for(const [original,esperado] of [['100','100,00'],['100,5','100,50'],['100.25','100,25'],['1000,5','1.000,50'],['1.000,50','1.000,50']]) {
  const campo={value:original};c.formatarPrecoProduto(campo);assert.equal(campo.value,esperado);
 }
 assert.equal(c.lerPrecoProduto('1.000,50'),1000.5);
 for(const valor of ['-1','1,234','0.001','abc','1.000,1x']) assert.ok(Number.isNaN(c.lerPrecoProduto(valor)));
});
test('desligar custo preserva valor no formulário e salva ausência, sem calcular margem',async()=>{
 const {c,els,resultado}=ambiente();els['produto-preco'].value='100,00';els['produto-custo'].value='50,00';
 els['produto-sem-custo'].checked=true;c.alternarCustoProduto();
 assert.equal(els['produto-custo'].disabled,true);assert.equal(els['produto-custo'].value,'50,00');assert.equal(els['produto-custo-aviso'].hidden,false);
 await c.salvarProduto();assert.equal(resultado().preco,100);assert.equal(resultado().preco_custo,null);
 els['produto-sem-custo'].checked=false;c.alternarCustoProduto();assert.equal(els['produto-custo'].disabled,false);assert.equal(els['produto-custo'].value,'50,00');
});
test('preços inválidos não são enviados e custo vazio é opcional',async()=>{
 const {c,els,resultado,avisos}=ambiente();els['produto-preco'].value='100,00';els['produto-custo'].value='1,234';
 await c.salvarProduto();assert.equal(resultado(),undefined);assert.ok(avisos.length);
 els['produto-custo'].value='';await c.salvarProduto();assert.equal(resultado().preco_custo,null);
});
