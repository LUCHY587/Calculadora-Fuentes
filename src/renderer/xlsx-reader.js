/**
 * Lector mínimo de archivos .xlsx (la primera hoja) para el navegador de la app.
 * Un .xlsx es un zip con XML adentro: se descomprime con fflate y se leen las celdas.
 * Devuelve las filas como arreglos; textos como string, números como number y las
 * celdas con formato de fecha como "aaaa-mm-dd".
 */
(function (root) {
  'use strict';

  const NS = '*';
  const kids = (el, name) => Array.from(el.getElementsByTagNameNS(NS, name));
  const text = (bytes) => new TextDecoder('utf-8').decode(bytes);
  const xml = (bytes) => {
    const doc = new DOMParser().parseFromString(text(bytes), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo Excel está dañado.');
    return doc;
  };

  /** "C12" → índice de columna 2 */
  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // formatos de fecha incorporados de Excel
  const FECHA_INTEGRADOS = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

  function estilosFecha(files) {
    const f = files['xl/styles.xml'];
    if (!f) return [];
    const doc = xml(f);
    const custom = new Map();
    for (const nf of kids(doc, 'numFmt')) custom.set(+nf.getAttribute('numFmtId'), nf.getAttribute('formatCode') || '');
    const esFecha = (id) => {
      if (FECHA_INTEGRADOS.has(id)) return true;
      const code = custom.get(id);
      if (!code) return false;
      const c = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, ''); // sin textos, escapes ni [colores]
      return /[dmy]/i.test(c) && !/0|#/.test(c.replace(/[dmyhs.:/ -]/gi, ''));
    };
    const cellXfs = kids(doc, 'cellXfs')[0];
    if (!cellXfs) return [];
    return kids(cellXfs, 'xf').map((xf) => esFecha(+xf.getAttribute('numFmtId')));
  }

  function textoDe(si) {
    // <si><t>..</t></si> o texto con formato <si><r><t>..</t></r>…</si> (se ignora el fonético <rPh>)
    let out = '';
    for (const t of kids(si, 't')) {
      let p = t.parentNode;
      let fonetico = false;
      while (p && p !== si) {
        if (p.localName === 'rPh') fonetico = true;
        p = p.parentNode;
      }
      if (!fonetico) out += t.textContent;
    }
    return out;
  }

  function serialAISO(n) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  /** @param {ArrayBuffer} buf  @returns {string[][]} filas de la primera hoja */
  function leer(buf) {
    const fflate = root.fflate;
    if (!fflate) throw new Error('Falta el componente para leer archivos Excel.');
    let files;
    try {
      files = fflate.unzipSync(new Uint8Array(buf));
    } catch (_) {
      throw new Error('No pude abrir el archivo. Tiene que ser un Excel (.xlsx).');
    }
    if (!files['xl/workbook.xml']) throw new Error('No pude abrir el archivo. Tiene que ser un Excel (.xlsx).');

    // primera hoja del libro → su archivo
    let sheetPath = 'xl/worksheets/sheet1.xml';
    try {
      const wb = xml(files['xl/workbook.xml']);
      const sheet = kids(wb, 'sheet')[0];
      const rid = sheet && (sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id'));
      const relsFile = files['xl/_rels/workbook.xml.rels'];
      if (rid && relsFile) {
        const rel = kids(xml(relsFile), 'Relationship').find((r) => r.getAttribute('Id') === rid);
        if (rel) {
          const t = rel.getAttribute('Target') || '';
          sheetPath = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
        }
      }
    } catch (_) { /* se usa la ruta por defecto */ }
    const sheetBytes = files[sheetPath] || files['xl/worksheets/sheet1.xml'];
    if (!sheetBytes) throw new Error('El archivo Excel no tiene datos.');

    const shared = files['xl/sharedStrings.xml'] ? kids(xml(files['xl/sharedStrings.xml']), 'si').map(textoDe) : [];
    const fechas = estilosFecha(files);

    const filas = [];
    let auto = 0;
    for (const row of kids(xml(sheetBytes), 'row')) {
      const rn = row.getAttribute('r') ? +row.getAttribute('r') - 1 : auto;
      auto = rn + 1;
      const cells = [];
      for (const c of kids(row, 'c')) {
        const j = colIndex(c.getAttribute('r'));
        if (j < 0) continue;
        const t = c.getAttribute('t');
        const vEl = kids(c, 'v')[0];
        const raw = vEl ? vEl.textContent : '';
        let val = '';
        if (t === 's') val = shared[+raw] != null ? shared[+raw] : '';
        else if (t === 'inlineStr') val = textoDe(c);
        else if (t === 'str') val = raw;
        else if (t === 'b') val = raw === '1' ? 'VERDADERO' : 'FALSO';
        else if (t === 'e') val = '';
        else if (raw !== '') {
          const n = Number(raw);
          const s = +c.getAttribute('s');
          val = Number.isFinite(n) ? (fechas[s] && n > 0 ? serialAISO(n) : n) : raw;
        }
        cells[j] = val;
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
      filas[rn] = cells;
    }
    for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
    return filas;
  }

  root.XlsxReader = { leer };
})(typeof self !== 'undefined' ? self : this);
