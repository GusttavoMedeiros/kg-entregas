// Testa a função gerarPdfViaPedido() + showPdfViaOverlay() — arquitetura 2026-09-15
// que substitui o HTML+print() por PDF A4 vetorial (jsPDF) renderizado no
// canvas via PDF.js (funciona em qualquer browser/dispositivo, inclusive iOS PWA).

const assert = require('node:assert/strict');
const fs = require('node:fs');

// ===== 1) Vendor files presentes e íntegros =====
assert.ok(fs.existsSync('vendor/jspdf.umd.min.js'), 'jspdf.umd.min.js ausente');
assert.ok(fs.existsSync('vendor/jspdf-autotable.min.js'), 'jspdf-autotable.min.js ausente');
assert.ok(fs.existsSync('vendor/pdf.min.js'), 'pdf.min.js ausente');
assert.ok(fs.existsSync('vendor/pdf.worker.min.js'), 'pdf.worker.min.js ausente');
assert.ok(fs.existsSync('vendor/Cinzel.ttf'), 'Cinzel.ttf ausente');
assert.ok(fs.existsSync('vendor/Nunito.ttf'), 'Nunito.ttf ausente');
assert.ok(fs.existsSync('logo.png'), 'logo.png ausente');

const sizeMB = (path) => Math.round(fs.statSync(path).size / 1024);
const ttfSize = (p) => sizeMB(p);
console.log(`  Vendor: jspdf ${sizeMB('vendor/jspdf.umd.min.js')}KB | ` +
            `autotable ${sizeMB('vendor/jspdf-autotable.min.js')}KB | ` +
            `pdf.js ${sizeMB('vendor/pdf.min.js')}KB | ` +
            `pdf.worker ${sizeMB('vendor/pdf.worker.min.js')}KB | ` +
            `Cinzel ${ttfSize('vendor/Cinzel.ttf')}KB | ` +
            `Nunito ${ttfSize('vendor/Nunito.ttf')}KB`);

// Valida tamanho mínimo (TTFs válidos não são vazios)
assert.ok(ttfSize('vendor/Cinzel.ttf') > 5, 'Cinzel.ttf muito pequeno (corrompido?)');
assert.ok(ttfSize('vendor/Nunito.ttf') > 5, 'Nunito.ttf muito pequeno (corrompido?)');
// Valida que começa com magic number de fonte TrueType (0x00010000 ou OTTO)
const cinzelHead = fs.readFileSync('vendor/Cinzel.ttf').slice(0, 4);
const nunitoHead = fs.readFileSync('vendor/Nunito.ttf').slice(0, 4);
const isTrueType = (b) => b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00;
const isOpenType = (b) => b[0] === 0x4F && b[1] === 0x54 && b[2] === 0x54 && b[3] === 0x4F;
assert.ok(isTrueType(cinzelHead) || isOpenType(cinzelHead), 'Cinzel.ttf não é TTF/OTF válido');
assert.ok(isTrueType(nunitoHead) || isOpenType(nunitoHead), 'Nunito.ttf não é TTF/OTF válido');

// ===== 2) index.html mantém o primeiro carregamento leve =====
const html = fs.readFileSync('index.html', 'utf8');
assert.doesNotMatch(html, /<script[^>]+vendor\/(?:pdf|jspdf)/, 'PDF não deve bloquear o login');
assert.match(html, /app\.js\?v=72/, 'app.js?v=72 esperado (versão nova do cache)');
assert.match(html, /id="via-papel"/, 'container #via-papel presente');

// ===== 3) Service Worker registra novos arquivos =====
const sw = fs.readFileSync('sw.js', 'utf8');
assert.match(sw, /kg-v50/, 'sw.js deve estar na versão v50');
assert.match(sw, /vendor\/pdf\.min\.js/, 'sw.js não cacheia pdf.min.js');
assert.match(sw, /vendor\/pdf\.worker\.min\.js/, 'sw.js não cacheia pdf.worker.min.js');
assert.match(sw, /vendor\/Cinzel\.ttf/, 'sw.js não cacheia Cinzel.ttf');
assert.match(sw, /vendor\/Nunito\.ttf/, 'sw.js não cacheia Nunito.ttf');
assert.match(sw, /app\.js\?v=72/);

// ===== 4) app.js: estrutura das funções da via =====
const app = fs.readFileSync('app.js', 'utf8');

// gerarPdfViaPedido agora é async (carrega fontes via fetch)
assert.match(app, /async function gerarPdfViaPedido\(id\)/, 'gerarPdfViaPedido deve ser async');
// showPdfViaOverlay agora é async (renderiza canvas via PDF.js)
assert.match(app, /async function showPdfViaOverlay/, 'showPdfViaOverlay deve ser async (espera PDF.js render)');

// ===== 5) Carregamento de assets (fontes + logo) =====
assert.match(app, /_carregarAssetsVia/, 'cache de assets da via (_carregarAssetsVia) deve existir');
assert.match(app, /_carregarBibliotecasPdf/, 'bibliotecas PDF devem ser carregadas sob demanda');
assert.match(app, /_carregarScriptPdf\('vendor\/pdf\.min\.js'/, 'PDF.js deve ser lazy-loaded');
assert.match(app, /vendor\/Cinzel\.ttf/, 'app.js carrega Cinzel.ttf');
assert.match(app, /vendor\/Nunito\.ttf/, 'app.js carrega Nunito.ttf');
assert.match(app, /logo\.png/, 'app.js carrega logo.png');

// O relatório usa a mesma logo e fontes da via, sem uma segunda cópia de asset.
assert.match(app, /async function gerarPdfRelatorio\(ini, fim, label\)/);
assert.match(app, /async function gerarPdfRelatorio\(ini, fim, label\)[\s\S]{0,260}await _carregarAssetsVia\(\)/);
assert.match(app, /doc\.addImage\(_viaAssets\.logoPng, 'PNG'/, 'logo deve aparecer no cabeçalho');
assert.match(app, /roundedRect\(/, 'cartões do relatório devem ter acabamento leve');

// ===== 6) Registro das fontes no jsPDF =====
assert.match(app, /doc\.addFileToVFS\(\s*'Cinzel\.ttf'/, 'Cinzel.ttf deve ser registrada via addFileToVFS');
assert.match(app, /doc\.addFileToVFS\(\s*'Nunito\.ttf'/, 'Nunito.ttf deve ser registrada via addFileToVFS');
assert.match(app, /doc\.addFont\(\s*'Cinzel\.ttf',\s*'Cinzel',\s*'bold'\)/, 'Cinzel bold registrado');

// ===== 7) Identidade visual KG Agropet (cores) =====
assert.match(app, /verdeEscuro/, 'paleta verde escuro (KG) presente');
assert.match(app, /dourado/, 'paleta dourada (KG) presente');
assert.match(app, /KG AGROPET/, 'cabeçalho KG AGROPET presente');

// ===== 8) jsPDF: A4 vetorial =====
assert.match(app, /new jsPDF\(\s*\{\s*unit:\s*'mm',\s*format:\s*'a4'/);

// ===== 9) autoTable configurado =====
assert.match(app, /doc\.autoTable\(/);
assert.match(app, /head:\s*\[\['Qtd'/);
assert.match(app, /head:\s*\[\['Qtd', 'Produto', 'Unitário', 'Subtotal'\]\]/);
assert.match(app, /destaque apenas com contorno/, 'total da via não deve usar bloco de tinta');

// ===== 10) Layout defensivo: splitTextToSize em campos que podem ser longos =====
assert.match(app, /doc\.splitTextToSize\(c\.endereco, cW\)/);
assert.match(app, /doc\.splitTextToSize\(p\.observacao, cW\)/);

// ===== 11) Paginação: cabeçalho/rodapé em todas páginas =====
assert.match(app, /didDrawPage:/);
assert.match(app, /drawRodape/);

// ===== 12) PDF.js renderiza no canvas (a grande mudança) =====
assert.match(app, /window\.pdfjsLib/, 'app.js checa se PDF.js está disponível');
assert.match(app, /pdfjsLib\.GlobalWorkerOptions\.workerSrc/, 'worker do PDF.js configurado');
assert.match(app, /vendor\/pdf\.worker\.min\.js/, 'worker local referenciado');
assert.match(app, /via-pdf-canvas/, 'canvas do PDF renderizado no app');
assert.match(app, /page\.render\(\s*\{/, 'page.render() do PDF.js chamado');

// ===== 13) Paginação interna do PDF (◀ ▶) =====
assert.match(app, /via-pag-prev/, 'botão página anterior');
assert.match(app, /via-pag-next/, 'botão próxima página');
assert.match(app, /pdf\.numPages/, 'contagem de páginas do PDF');

// ===== 14) Fallback iframe se PDF.js não estiver disponível =====
assert.match(app, /iframe[\s\S]{0,200}src="\$\{url\}"/, 'fallback iframe presente');

// ===== 15) Botões Imprimir/Salvar/Compartilhar presentes =====
assert.match(html, /id="via-btn-imprimir"/);
assert.match(html, /id="via-btn-salvar"/);
assert.match(html, /id="via-btn-whatsapp"/);

// ===== 16) navigator.share pra iOS (compartilhar PDF nativamente) =====
assert.match(app, /navigator\.canShare\(\s*\{\s*files:\s*\[file\]\s*\}\)/);

// ===== 17) Não chama mais window.print() direto (causa raiz do clipping iOS) =====
assert.doesNotMatch(app, /<button[^>]*onclick="window\.print\(\)">/);

// ===== 18) Loading e erro dentro do overlay =====
assert.match(app, /via-loading/, 'estado de loading durante render');
assert.match(app, /via-erro/, 'estado de erro se falhar');
assert.match(html, /\.via-loading/, 'CSS de loading');
assert.match(html, /\.via-erro/, 'CSS de erro');
assert.match(html, /\.via-paginacao/, 'CSS de paginação');
assert.match(html, /\.via-spinner/, 'CSS de spinner');
assert.match(html, /@keyframes via-spin/, 'animação de spin');

console.log('PDF via jsPDF + PDF.js canvas: estrutura, fontes KG, paginação e fallback validados.');
