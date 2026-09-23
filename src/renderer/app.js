(function () {
  'use strict';
  const C = window.Calc;
  const $ = (s) => document.querySelector(s);
  const { esc, store, hoyISO, detailHtml: detalleHtml, redondeoModo, redondeoControlHtml, wireRedondeoControls, aplicarRedondeoAResultado, onRedondeoChange } = window.UI;

  // Tolera que la app corra sin el puente de Electron (p. ej. abriendo el HTML en un navegador para probar).
  const api = window.api || {
    getState: async () => ({ indices: {}, updatedAt: null, checkedAt: null, refreshing: false }),
    refresh: async () => ({}),
    onChanged: () => () => {},
    openExternal: async () => {},
    version: async () => '',
  };

  let state = null;
  let series = {};
  let sel = { meses: +store.get('meses', 12), indice: store.get('indice', 'icl') };
  let lastInputs = null;
  let lastResult = null; // resultado tal cual lo calculó Calc (sin redondear)
  let lastVista = null; // lo mismo, pero con el redondeo elegido aplicado al próximo importe (lo que se ve y se copia)

  // ---------------------------------------------------------------- formulario
  function buildChips() {
    const m = $('#meses');
    m.innerHTML = '';
    for (let i = 1; i <= 12; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = i;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === sel.meses));
      b.addEventListener('click', () => { sel.meses = i; store.set('meses', i); paintChips(); });
      m.appendChild(b);
    }
    const ix = $('#indices');
    ix.innerHTML = '';
    for (const k of C.ORDEN) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.key = k;
      b.textContent = C.INDICES[k].nombre;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { sel.indice = k; store.set('indice', k); paintChips(); });
      ix.appendChild(b);
    }
    paintChips();
  }

  function paintChips() {
    [...$('#meses').children].forEach((b, i) => b.setAttribute('aria-checked', String(i + 1 === sel.meses)));
    [...$('#indices').children].forEach((b) => {
      const k = b.dataset.key;
      b.setAttribute('aria-checked', String(k === sel.indice));
      b.title = C.INDICES[k].largo;
    });
    const info = C.INDICES[sel.indice];
    const S = series[sel.indice];
    const ult = S ? (S.tipo === 'diario' ? C.fmtFecha(S.lastDate) : C.cap(C.fmtMes(C.monthISO(S.lastMonth)))) : null;
    $('#indiceDesc').textContent = `${info.largo} · ${info.fuente} · ${ult ? 'último dato: ' + ult : 'sin datos todavía'}`;
  }

  function showError(msg) {
    const el = $('#error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function readInputs() {
    return {
      indice: sel.indice,
      alquiler: C.parseMonto($('#monto').value),
      fechaInicio: $('#fecha').value,
      cadaMeses: sel.meses,
    };
  }

  function calculate() {
    const inp = readInputs();
    try {
      const r = C.calcular({ ...inp, hoy: hoyISO(), series });
      showError('');
      lastInputs = inp;
      lastResult = r;
      store.set('monto', $('#monto').value);
      store.set('fecha', inp.fechaInicio);
      mostrarResultado();
    } catch (e) {
      showError(e.message);
    }
  }

  /** Vuelve a pintar el último resultado calculado, aplicando el redondeo elegido al próximo importe. */
  function mostrarResultado() {
    if (!lastResult) return;
    lastVista = aplicarRedondeoAResultado(lastResult, redondeoModo());
    renderResult(lastVista);
  }

  // ---------------------------------------------------------------- resultado
  function renderResult(r) {
    const e = r.entrada;
    const fechaStr = (iso) => C.fmtFecha(iso);
    const hasta = r.proximo ? C.cap(C.fmtMes(C.addMonths(r.proximo.fecha, -1))) : '';

    const vigenteHtml = r.vigente
      ? `<div class="big"><div class="lbl">Alquiler vigente hoy</div><div class="val">${C.fmtMoney(r.vigente.valor)}</div><div class="sub">desde el ${fechaStr(r.vigente.fecha)}${r.proximo ? ` hasta ${esc(hasta)}` : ''}</div></div>`
      : `<div class="big"><div class="lbl">Alquiler vigente hoy</div><div class="val">—</div><div class="sub">El contrato empieza el ${fechaStr(e.fechaInicio)}</div></div>`;
    const proxRedondeo = r.proximo && r.proximo.redondeado ? `<div class="rnote">Redondeado ${r.proximo.redondeado === 'arriba' ? 'para arriba' : 'para abajo'} · antes ${C.fmtMoney(r.proximo.original)}</div>` : '';
    const proxHtml = r.proximo
      ? `<div class="big next"><div class="lbl">Próximo ajuste · ${fechaStr(r.proximo.fecha)}</div><div class="val">${C.fmtMoney(r.proximo.valor)}</div><div class="sub">${r.proximo.n === 1 ? '' : C.fmtPct(r.proximo.aumentoPct) + ' de aumento'} ${r.proximo.estimado ? '<span class="badge">ESTIMADO</span>' : ''}</div>${proxRedondeo}</div>`
      : '';

    const notice = r.hayEstimado
      ? `<div class="notice"><b>Valores estimados.</b> Todavía no se publicó el ${esc(r.info.nombre)} para alguna de las fechas. ${
          r.info.tipo === 'diario'
            ? `Se asume la misma variación de los últimos ${e.cadaMeses} ${e.cadaMeses === 1 ? 'mes' : 'meses'} publicados.`
            : 'Para los meses que faltan se repite la última variación mensual publicada.'
        } La app los reemplaza sola por el valor real apenas se publique.</div>`
      : '';

    const rowsHtml = r.rows
      .map((x, i) => {
        const isCur = r.vigente && x === r.vigente;
        const aum = x.n === 1 ? '—' : C.fmtPct(x.aumentoPct);
        const det = x.detalle ? `<button class="linkbtn" data-det="${i}" type="button" aria-expanded="false">Ver detalle</button>` : '';
        return `<tr class="${isCur ? 'cur' : ''}">
          <td>${esc(C.etiquetaPeriodo(x.n, e.cadaMeses))}</td>
          <td>${fechaStr(x.fecha)}</td>
          <td class="num">${aum} ${x.estimado ? '<span class="badge">ESTIMADO</span>' : ''}</td>
          <td class="num">${C.fmtMoney(x.valor)}${x.redondeado ? `<div class="rnote">antes ${C.fmtMoney(x.original)}</div>` : ''}</td>
          <td class="num">${det}</td>
        </tr>
        <tr class="det" id="det-${i}" hidden><td colspan="5">${detailHtml(x, r)}</td></tr>`;
      })
      .join('');

    $('#resultBody').innerHTML = `
      <div class="summary">${vigenteHtml}${proxHtml}</div>
      ${redondeoControlHtml()}
      ${notice}
      <div class="inputs">
        <span>Índice: <b>${esc(r.info.nombre)}</b></span>
        <span>Alquiler inicial: <b>${C.fmtMoney(e.alquiler)}</b></span>
        <span>Inicio: <b>${fechaStr(e.fechaInicio)}</b></span>
        <span>Actualiza cada: <b>${e.cadaMeses} ${e.cadaMeses === 1 ? 'mes' : 'meses'}</b></span>
      </div>
      <table>
        <thead><tr><th>Período</th><th>Actualización</th><th class="num">Aumento</th><th class="num">Alquiler</th><th></th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="actions">
        <button class="sec" id="btnCopy" type="button">Copiar resumen</button>
        <button class="sec" id="btnImage" type="button">Copiar como imagen</button>
        <button class="sec" id="btnPrint" type="button">Imprimir / guardar PDF</button>
      </div>`;
    $('#empty').hidden = true;
    $('#resultBody').hidden = false;

    $('#resultBody').querySelectorAll('[data-det]').forEach((b) =>
      b.addEventListener('click', () => {
        const row = $('#det-' + b.dataset.det);
        row.hidden = !row.hidden;
        b.setAttribute('aria-expanded', String(!row.hidden));
        b.textContent = row.hidden ? 'Ver detalle' : 'Ocultar detalle';
      })
    );
    wireRedondeoControls($('#resultBody'));
    $('#btnCopy').addEventListener('click', copySummary);
    $('#btnImage').addEventListener('click', copyImage);
    $('#btnPrint').addEventListener('click', () => window.print());
  }

  const detailHtml = (x, r) => detalleHtml(x.detalle, r.info);

  async function copySummary() {
    if (!lastVista) return;
    const text = C.resumenTexto(lastVista);
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    const b = $('#btnCopy');
    if (b) {
      b.textContent = '¡Copiado!';
      b.classList.add('done');
      setTimeout(() => { b.textContent = 'Copiar resumen'; b.classList.remove('done'); }, 1600);
    }
  }

  async function copyImage() {
    if (!lastVista) return;
    const b = $('#btnImage');
    const original = 'Copiar como imagen';
    const flash = (txt, cls) => {
      b.textContent = txt;
      if (cls) b.classList.add(cls);
      setTimeout(() => { b.textContent = original; b.classList.remove('done', 'fail'); }, 2600);
    };
    try {
      b.disabled = true;
      const blob = await window.ShareImage.render(lastVista);
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } catch (_) {
        // plan B: que lo copie el proceso principal de la app
        if (!api.copyImage) throw _;
        await api.copyImage(new Uint8Array(await blob.arrayBuffer()));
      }
      flash('¡Imagen copiada! Pegala en WhatsApp', 'done');
    } catch (err) {
      flash('No se pudo copiar la imagen', 'fail');
    } finally {
      b.disabled = false;
    }
  }

  // ---------------------------------------------------------------- estado de los datos
  function ago(iso) {
    if (!iso) return null;
    const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (min < 1) return 'hace instantes';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
  }

  function renderStatus() {
    const dot = $('#statusDot');
    const txt = $('#statusText');
    const btn = $('#btnRefresh');
    dot.className = 'dot';
    const hasData = C.ORDEN.some((k) => series[k]);
    const errs = state ? C.ORDEN.filter((k) => state.indices[k] && state.indices[k].error) : [];
    btn.disabled = !!(state && state.refreshing);
    if (!state) { txt.textContent = 'Iniciando…'; return; }
    if (state.refreshing) {
      dot.classList.add('busy');
      txt.textContent = hasData ? 'Actualizando índices…' : 'Descargando índices oficiales…';
    } else if (!hasData) {
      dot.classList.add('err');
      txt.textContent = 'Sin datos: hace falta conexión a internet para descargar los índices';
    } else if (errs.length) {
      dot.classList.add('warn');
      txt.textContent = `No se pudo actualizar ${errs.map((k) => C.INDICES[k].nombre).join(', ')} · usando datos guardados`;
    } else if (state.checkedAt) {
      txt.textContent = `Índices actualizados ${ago(state.checkedAt)}`;
    } else {
      txt.textContent = 'Índices cargados';
    }
    $('#emptyHint').textContent = !hasData ? 'La primera vez la app descarga los índices oficiales del BCRA e INDEC; esto requiere internet.' : '';
  }

  function renderCards() {
    const el = $('#cards');
    el.innerHTML = C.ORDEN.map((k) => {
      const info = C.INDICES[k];
      const S = series[k];
      const err = state && state.indices[k] && state.indices[k].error;
      if (!S) {
        return `<div class="icard"><div class="h"><span class="n">${info.nombre}</span><span class="src">${info.fuente}</span></div><div class="l">${esc(info.largo)}</div><div class="w">Sin datos todavía.</div></div>`;
      }
      const v12 = C.variacion12m(k, S);
      const rows = S.tipo === 'diario'
        ? `<div class="row"><span>Último dato</span><b>${C.fmtFecha(S.lastDate)}</b></div><div class="row"><span>Valor</span><b>${C.fmtIdx(S.lastValue)}</b></div>`
        : `<div class="row"><span>Último dato</span><b>${esc(C.cap(C.fmtMes(C.monthISO(S.lastMonth))))}</b></div><div class="row"><span>Variación del mes</span><b>${C.fmtPct(S.lastVar * 100)}</b></div>`;
      return `<div class="icard"><div class="h"><span class="n">${info.nombre}</span><span class="src">${info.fuente}</span></div><div class="l">${esc(info.largo)}</div>${rows}<div class="row"><span>Últimos 12 meses</span><b>${v12 == null ? '—' : C.fmtPct(v12)}</b></div>${err ? `<div class="w">No se pudo actualizar (${esc(err)}). Se usa el último dato guardado.</div>` : ''}</div>`;
    }).join('');
  }

  function applyState(s, recalc) {
    state = s;
    series = C.buildSeries(s.indices);
    window.ContratosUI.setSeries(series);
    renderStatus();
    renderCards();
    // Si algún índice no tiene datos, no ofrecemos elegirlo.
    [...$('#indices').children].forEach((b) => { b.disabled = !series[b.dataset.key]; });
    paintChips();
    if (recalc && lastInputs) {
      // Volvemos a calcular con los datos nuevos (reemplaza estimaciones por valores reales).
      try {
        const r = C.calcular({ ...lastInputs, hoy: hoyISO(), series });
        lastResult = r;
        mostrarResultado();
      } catch (_) { /* se mantiene el último resultado */ }
    }
  }

  // ---------------------------------------------------------------- modo claro / oscuro
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function applyTheme(t, save) {
    document.documentElement.setAttribute('data-theme', t);
    if (save) store.set('theme', t);
    const dark = t === 'dark';
    $('#themeLabel').textContent = dark ? 'Modo claro' : 'Modo oscuro';
    $('#btnTheme').setAttribute('aria-pressed', String(dark));
  }

  // ---------------------------------------------------------------- arranque
  async function init() {
    buildChips();
    $('#monto').value = store.get('monto', '');
    $('#fecha').value = store.get('fecha', '');

    $('#monto').addEventListener('blur', () => {
      const n = C.parseMonto($('#monto').value);
      if (Number.isFinite(n)) $('#monto').value = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n);
    });
    $('#monto').addEventListener('focus', (ev) => ev.target.select());
    $('#btnCalc').addEventListener('click', () => calculate());
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.closest('.form')) calculate(); });
    $('#btnRefresh').addEventListener('click', () => api.refresh());
    applyTheme(currentTheme(), false);
    $('#btnTheme').addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark', true));
    // al imprimir / guardar PDF siempre se usa el modo claro (ahorra tinta y se lee mejor)
    let temaAntes = null;
    window.addEventListener('beforeprint', () => { temaAntes = currentTheme(); document.documentElement.setAttribute('data-theme', 'light'); });
    window.addEventListener('afterprint', () => { if (temaAntes) document.documentElement.setAttribute('data-theme', temaAntes); temaAntes = null; });
    onRedondeoChange(() => mostrarResultado());

    window.ContratosUI.init(api);
    applyState(await api.getState(), false);
    api.onChanged((s) => applyState(s, true));
    setInterval(renderStatus, 30000); // mantiene actualizado el "hace X min"
    try { $('#ver').textContent = 'Versión ' + (await api.version()); } catch (_) {}
  }

  init();
})();
