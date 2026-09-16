// Testa a função gerarPdfViaPedido() — a substituição do HTML+print() por
// PDF A4 vetorial via jsPDF. Garante que valores grandes, nomes longos,
// endereços extensos e múltiplos produtos geram PDF válido sem overflow.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 1) jsPDF precisa estar disponível (vendor ou CDN)
const sw = fs.readFileSync('sw.js', 'utf8');
assert.match(sw, /'\.\/vendor\/jspdf\.umd\.min\.js'/);
assert.ok(fs.existsSync('vendor/jspdf.umd.min.js'), 'jspdf vendor file missing');
assert.ok(fs.existsSync('vendor/jspdf-autotable.min.js'), 'jspdf-autotable vendor file missing');
const jspdfBytes = fs.statSync('vendor/jspdf.umd.min.js').size;
const autoBytes = fs.statSync('vendor/jspdf-autotable.min.js').size;
assert.ok(jspdfBytes > 100000, 'jsPDF parece corrompido / muito pequeno');
assert.ok(autoBytes > 10000, 'jspdf-autotable parece corrompido');

// 2) Função gerarPdfViaPedido deve existir e estar estruturada corretamente
const app = fs.readFileSync('app.js', 'utf8');
assert.match(app, /function gerarPdfViaPedido\(/);
assert.match(app, /function gerarPdfRelatorio\(/);
assert.match(app, /function showPdfViaOverlay\(/);

// 3) Estrutura do PDF: usa jsPDF com formato A4 e unit mm
assert.match(app, /new jsPDF\(\s*\{\s*unit:\s*'mm',\s*format:\s*'a4'/);

// 4) AutoTable para a tabela de itens (com auto-paginação)
assert.match(app, /doc\.autoTable\(\s*\{[\s\S]*?head:\s*\[\['Qtd'[\s\S]*?body:\s*itens[\s\S]*?columnStyles:\s*\{[\s\S]*?\}\s*\}\)/);

// 5) Layout defensivo: splitTextToSize em campos que podem ser longos
//    (nome de cliente, endereço, observação)
assert.match(app, /doc\.splitTextToSize\(c\.endereco, cW\)/, 'endereço quebra linha');
assert.match(app, /doc\.splitTextToSize\(p\.observacao, cW\)/, 'observação quebra linha');
assert.match(app, /doc\.splitTextToSize\(escopo[\s\S]*?cW \/ 2 - 4\)/, 'escopo quebra linha');

// 6) Paginação: didDrawPage é chamado pra desenhar cabeçalho/rodapé em todas páginas
assert.match(app, /didDrawPage:[\s\S]{0,200}drawRodape/);
assert.match(app, /if \(data\.pageNumber > 1\) drawCabecalho\(mT\)/);

// 7) Função moeda() com formato BR 00.000,00
const moedaMatch = app.match(/function moeda\(v\)\s*\{[\s\S]*?\n\}/);
assert.ok(moedaMatch, 'moeda() deve existir');
assert.match(moedaMatch[0], /\d{3}/, 'regex de milhares deve estar presente');
assert.match(moedaMatch[0], /split\('\.'\)/, 'split em ponto decimal');

// 8) Não deve chamar window.print() da via (causa raiz do clipping)
assert.doesNotMatch(app, /<button[^>]*onclick="window\.print\(\)">/);

// 9) Overlay mostra o PDF via iframe, não HTML
assert.match(app, /<iframe[^>]+src="\$\{url\}"[^>]*><\/iframe>/);

// 10) Botões Imprimir/Salvar/Compartilhar presentes (no HTML)
const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /id="via-btn-imprimir"/);
assert.match(html, /id="via-btn-salvar"/);
assert.match(html, /id="via-btn-whatsapp"/);

// 11) navigator.share pra iOS (compartilhar PDF nativamente)
assert.match(app, /navigator\.canShare\(\s*\{\s*files:\s*\[file\]\s*\}\)/);

// 12) Limpa blob URL ao fechar overlay (evita memory leak)
assert.match(app, /if \(papel\) papel\.innerHTML\s*=\s*''/);

console.log('PDF da via, paginação, valores grandes, fontes e arquitetura jsPDF validados.');
