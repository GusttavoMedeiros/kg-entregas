const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('app.js', 'utf8').replace(/\r\n/g, '\n');

test('bibliotecas de PDF são carregadas sob demanda e em ordem', async () => {
  const scripts = [];
  const c = {
    window: { jspdf: null, pdfjsLib: null },
    document: {
      createElement: () => {
        const s = { dataset: {}, set src(v) { this._src = v; }, get src() { return this._src; } };
        return s;
      },
      head: { appendChild: s => {
        scripts.push(s.src);
        if (s.src.includes('jspdf.umd')) c.window.jspdf = { jsPDF: function JsPDF() {} };
        if (s.src.includes('autotable')) c.window.jspdf.jsPDF.API = { autoTable() {} };
        if (s.src.includes('pdf.min')) c.window.pdfjsLib = {};
        s.onload();
      } },
    },
  };
  const trecho = app.slice(app.indexOf('const _pdfScriptPromises'), app.indexOf('function _liberarViaOverlayState'));
  vm.runInNewContext(`${trecho}\nthis.carregar = _carregarBibliotecasPdf;`, c);
  await c.carregar();
  assert.deepEqual(scripts, [
    'vendor/jspdf.umd.min.js',
    'vendor/jspdf-autotable.min.js',
    'vendor/pdf.min.js',
  ]);
  await c.carregar();
  assert.equal(scripts.length, 3, 'segunda abertura deve reutilizar as bibliotecas');
});

test('falha transitória dos assets da via permite nova tentativa', async () => {
  let tentativa = 0;
  const c = {
    fetch: async () => {
      tentativa++;
      if (tentativa === 1) throw new Error('rede indisponível');
      return { ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
    },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    console,
  };
  const trecho = app.slice(app.indexOf('const _viaAssets'), app.indexOf('// Gera o Blob do PDF'));
  vm.runInNewContext(`${trecho}\nthis.carregar = _carregarAssetsVia; this.assets = _viaAssets;`, c);
  await c.carregar();
  assert.equal(c.assets.promise, null);
  await c.carregar();
  assert.equal(tentativa, 4, 'a segunda chamada deve reconsultar fonte e logo');
  assert.ok(c.assets.cinzel && c.assets.nunito && c.assets.logoPng);
});

test('limpeza da via revoga a URL e destrói o documento PDF', () => {
  const revogadas = [];
  const contador = { destruicoes: 0 };
  const elements = {
    'via-overlay': { style: { display: 'flex' } },
    'via-papel': { innerHTML: 'canvas' },
  };
  const c = {
    document: { getElementById: id => elements[id] },
    window: { __viaLoadingEl: {} },
    URL: { revokeObjectURL: url => revogadas.push(url) },
    contador,
  };
  const trecho = app.slice(app.indexOf('let _viaOverlaySeq'), app.indexOf('// Envia o resumo do pedido'));
  vm.runInNewContext(`${trecho}\n_viaOverlayState = { url: 'blob:test', pdf: { destroy: () => contador.destruicoes++ }, active: true }; fecharViaPedido();`, c);
  assert.deepEqual(revogadas, ['blob:test']);
  assert.equal(contador.destruicoes, 1);
  assert.equal(elements['via-overlay'].style.display, 'none');
});
