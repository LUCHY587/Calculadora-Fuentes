/**
 * Pantalla "Contratos del mes": se importa el Excel «Cambio de período» del sistema de cobros y
 * la app calcula el nuevo alquiler de cada contrato con los índices oficiales.
 *
 * El Excel trae el monto del PERÍODO ACTUAL, no el monto inicial del contrato, así que el ajuste
 * "de un paso" se calcula sobre ese monto actual. Para ver la progresión completa (todos los
 * cuatrimestres/trimestres desde el alquiler inicial) hay que cargar, una sola vez por contrato,
 * la fecha de inicio (ya viene del Excel, pero se puede corregir) y el monto inicial: la app
 * recuerda esos datos y recalcula la progresión sola cada vez que se vuelve a abrir el contrato.
 */
(function () {
  'use strict';
  const C = window.Calc;
  const K = window.Contracts;
  const { esc, store, hoyISO, detailHtml, redondeoModo, redondeoControlHtml, wireRedondeoControls, aplicarRedondeoAAjuste, aplicarRedondeoAResultado } = window.UI;
  const $ = (s) => document.querySelector(s);

  let api = {};
  let series = {};
  let data = null; // { archivo, importadoEn, contratos, avisos }
  let results = []; // contratos con el ajuste calculado (exacto, sin redondear)
  let mostrados = []; // = results, con el redondeo elegido ya aplicado al ajuste (lo que se ve/exporta)
  let filtro = '';
  let borrarArmado = null;
  let iniciales = {}; // { clave: { fechaInicio, montoInicial } } — datos cargados a mano por contrato

  const ESTADO = {
    oficial: { txt: 'Oficial', cls: 'ok', tip: 'El índice ya fue publicado: el monto es definitivo.' },
    estimado: { txt: 'Estimado', cls: '', tip: 'El índice todavía no se publicó: el monto se recalcula solo cuando salga.' },
    sincalculo: { txt: 'Sin cálculo', cls: 'gris', tip: 'La app no pudo calcular este contrato.' },
  };

  // ---------------------------------------------------------------- datos
  function cargar() {
    try {
      const j = JSON.parse(store.get('contratos', 'null'));
      if (j && Array.isArray(j.contratos)) return j;
    } catch (_) { /* lista guardada ilegible: se ignora */ }
    return null;
  }
  const guardar = () => store.set('contratos', JSON.stringify(data));

  function cargarIniciales() {
    try {
      const j = JSON.parse(store.get('contratosInicial', '{}'));
      return j && typeof j === 'object' ? j : {};
    } catch (_) {
      return {};
    }
  }
  const guardarIniciales = () => store.set('contratosInicial', JSON.stringify(iniciales));

  /** Identidad de un contrato para recordar sus datos iniciales entre importaciones (carpeta + inquilino + dirección). */
  function clave(c) {
    return [c.carpeta, K.norm(c.inquilino), K.norm(c.direccion)].join('|');
  }

  function recalcular() {
    results = data ? K.ordenar(K.calcularTodos(data.contratos, series)) : [];
    actualizarMostrados();
  }
  function actualizarMostrados() {
    const modo = redondeoModo();
    mostrados = results.map((r) => (r.ajuste ? { ...r, ajuste: aplicarRedondeoAAjuste(r.ajuste, modo) } : r));
  }

  // ---------------------------------------------------------------- pestañas
  function mostrar(cual) {
    const esC = cual === 'contratos';
    $('#viewCalc').hidden = esC;
    $('#viewContratos').hidden = !esC;
    const tabs = { calc: $('#tabCalc'), contratos: $('#tabContratos') };
    for (const [k, el] of Object.entries(tabs)) {
      const on = (k === 'contratos') === esC;
      el.setAttribute('aria-selected', String(on));
      el.tabIndex = on ? 0 : -1;
    }
    if (esC) render();
  }

  function pintarContador() {
    const el = $('#tabCount');
    el.textContent = data ? String(results.length) : '';
    el.hidden = !data;
  }

  // ---------------------------------------------------------------- importar
  function showError(msg) {
    const el = $('#cerror');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  async function importar(file) {
    showError('');
    if (!file) return;
    if (!/\.xls[xm]$/i.test(file.name)) {
      showError('Elegí el archivo Excel (.xlsx) que exporta el sistema de cobros.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showError('El archivo es demasiado grande para ser el listado de contratos.');
      return;
    }
    try {
      const filas = window.XlsxReader.leer(await file.arrayBuffer());
      const r = K.leerFilas(filas);
      if (r.error) throw new Error(r.error);
      if (!r.contratos.length) throw new Error('El archivo no tiene contratos.');
      data = { archivo: file.name, importadoEn: new Date().toISOString(), contratos: r.contratos, avisos: r.avisos };
      guardar();
      filtro = '';
      recalcular();
      pintarContador();
      mostrar('contratos');
    } catch (e) {
      showError(e.message || 'No se pudo leer el archivo.');
      mostrar('contratos');
    }
  }

  // ---------------------------------------------------------------- pantalla
  function fmtCuando(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function renderVacio() {
    return `<div class="card cempty">
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="8" width="44" height="48" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M20 22h24M20 32h24M20 42h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
      <h2>Contratos que ajustan el próximo mes</h2>
      <p>En el sistema de cobros exportá a Excel el listado <b>«Cambio de período»</b> y elegilo acá. La app lee cada contrato, calcula el nuevo alquiler con los índices oficiales y te muestra todo junto.</p>
      <p><button class="primary cbtn" id="btnImport" type="button">Elegir archivo Excel</button></p>
      <p class="hint">También podés arrastrar el archivo y soltarlo en cualquier parte de la ventana. La lista queda guardada solo en esta PC.</p>
    </div>`;
  }

  function renderResumen(s) {
    const fechas = s.fechas.length ? (s.fechas.length === 1 ? C.fmtFecha(s.fechas[0]) : `${C.fmtFecha(s.fechas[0])} al ${C.fmtFecha(s.fechas[s.fechas.length - 1])}`) : '—';
    const idx = Object.entries(s.porIndice).map(([k, n]) => `${esc(k)} ${n}`).join(' · ');
    const partes = [];
    if (s.estimados) partes.push(`${s.estimados} ${s.estimados === 1 ? 'estimado' : 'estimados'}`);
    if (s.oficiales) partes.push(`${s.oficiales} ${s.oficiales === 1 ? 'oficial' : 'oficiales'}`);
    if (s.sinCalculo) partes.push(`${s.sinCalculo} sin cálculo`);
    return `<div class="csummary">
      <div class="big"><div class="lbl">Contratos</div><div class="val">${s.total}</div><div class="sub">${idx}</div></div>
      <div class="big"><div class="lbl">Fecha del ajuste</div><div class="val">${fechas}</div><div class="sub">${s.fechas.length > 1 ? s.fechas.length + ' fechas distintas' : 'una sola fecha'}</div></div>
      <div class="big next"><div class="lbl">Suma de alquileres</div><div class="val">${s.calculados ? '+' + C.fmtPct(s.aumentoTotalPct) : '—'}</div><div class="sub">${C.fmtMoney(s.sumaActual)} &rarr; ${C.fmtMoney(s.sumaNueva)}</div></div>
      <div class="big"><div class="lbl">Estado</div><div class="val">${partes[0] || '—'}</div><div class="sub">${partes.slice(1).join(' · ')}${s.revisar ? `${partes.length > 1 ? ' · ' : ''}${s.revisar} para revisar` : ''}</div></div>
    </div>`;
  }

  function renderNotas(s) {
    const notas = [];
    if (s.estimados) {
      notas.push(`<div class="notice"><b>Montos estimados.</b> Todavía no se publicó el índice de algún mes que entra en el cálculo. Para los meses que faltan se repite la última variación publicada. Cuando el índice oficial salga, la app lo toma sola (se verifica cada 2 horas) y los montos pasan a <b>Oficial</b>.</div>`);
    }
    for (const a of (data && data.avisos) || []) notas.push(`<div class="notice">${esc(a)}</div>`);
    if (s.revisar) notas.push(`<div class="notice">Hay <b>${s.revisar}</b> ${s.revisar === 1 ? 'contrato marcado' : 'contratos marcados'} con <b>Revisar</b>: se calcularon igual, pero conviene mirar el dato en el sistema.</div>`);
    return notas.join('');
  }

  // -------------------------------------------------------- progresión completa (por contrato)
  /** Corre Calc.calcular con los datos que se cargaron a mano y arma la tabla de todos los períodos. */
  function progCalcularHtml(row, fechaInicio, montoInicial) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaInicio || '')) return { html: '', error: 'Ingresá la fecha de inicio del contrato.' };
    if (!Number.isFinite(montoInicial) || montoInicial <= 0) return { html: '', error: 'Ingresá el monto inicial del alquiler.' };
    if (!row.indice) return { html: '', error: `La app no tiene el índice «${row.indiceTexto || 'sin índice'}».` };
    try {
      const full = C.calcular({ indice: row.indice, alquiler: montoInicial, fechaInicio, cadaMeses: row.cada, hoy: hoyISO(), series });
      return { html: progTablaHtml(full), error: null };
    } catch (e) {
      return { html: '', error: e.message };
    }
  }

  function progTablaHtml(rFull) {
    const vista = aplicarRedondeoAResultado(rFull, redondeoModo());
    const rows = vista.rows
      .map((x) => {
        const cur = vista.vigente && x === vista.vigente;
        const prox = vista.proximo && x === vista.proximo;
        const aum = x.n === 1 ? '—' : C.fmtPct(x.aumentoPct);
        return `<tr class="${cur ? 'cur' : ''}${prox ? ' next' : ''}">
          <td>${esc(C.etiquetaPeriodo(x.n, vista.entrada.cadaMeses))}</td>
          <td>${C.fmtFecha(x.fecha)}</td>
          <td class="num">${aum} ${x.estimado ? '<span class="badge">ESTIMADO</span>' : ''}</td>
          <td class="num">${C.fmtMoney(x.valor)}${x.redondeado ? `<div class="cwarn">antes ${C.fmtMoney(x.original)}</div>` : ''}</td>
        </tr>`;
      })
      .join('');
    return `<table class="progtable"><thead><tr><th>Período</th><th>Actualización</th><th class="num">Aumento</th><th class="num">Alquiler</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function nombrePeriodos(cada) {
    if (cada === 12) return 'años';
    if (cada === 6) return 'semestres';
    if (cada === 4) return 'cuatrimestres';
    if (cada === 3) return 'trimestres';
    if (cada === 1) return 'meses';
    return 'períodos';
  }

  function progresionHtml(r, i) {
    const key = clave(r);
    const guardado = iniciales[key];
    const fechaPrefill = guardado ? guardado.fechaInicio : r.inicio || '';
    const montoPrefill = guardado ? guardado.montoInicial : r.periodo === 1 && Number.isFinite(r.monto) ? Math.round(r.monto) : '';
    let tabla = '';
    let errInicial = '';
    if (guardado) {
      const res = progCalcularHtml(r, guardado.fechaInicio, guardado.montoInicial);
      tabla = res.html;
      errInicial = res.error || '';
    }
    return `<div class="progwrap">
      <p class="prognote"><b>Progresión completa del contrato.</b> Cargá la fecha de inicio y el monto inicial (una sola vez): la app calcula todos los ${nombrePeriodos(r.cada)} desde ese valor y lo recuerda para la próxima vez.</p>
      <div class="progform">
        <label>Fecha de inicio <input type="date" class="pfecha" data-pidx="${i}" value="${esc(fechaPrefill)}"></label>
        <label>Monto inicial <input type="text" class="pmonto" data-pidx="${i}" inputmode="numeric" placeholder="100.000" value="${esc(montoPrefill)}"></label>
        <button type="button" class="sec small" data-pcalc="${i}">${guardado ? 'Volver a calcular' : 'Calcular progresión'}</button>
      </div>
      <p class="error progerr" id="progerr-${i}" ${errInicial ? '' : 'hidden'}>${esc(errInicial)}</p>
      <div id="progtabla-${i}">${tabla}</div>
    </div>`;
  }

  function filaHtml(r, i) {
    const a = r.ajuste;
    const est = ESTADO[r.estado];
    const nota = [r.error, ...r.problemas].filter(Boolean);
    const rev = r.revisar ? ' <span class="badge rev" title="Hay algo para revisar en este contrato">REVISAR</span>' : '';
    const idxTxt = r.indice ? C.INDICES[r.indice].nombre : r.indiceTexto || '—';
    const redondeoNota = a && a.redondeado ? `<div class="cwarn">antes ${C.fmtMoney(a.original)}</div>` : '';
    return `<tr class="crow">
      <td class="carp">${esc(r.carpeta || '—')}</td>
      <td><div class="cname">${esc(r.inquilino || 'Sin nombre')}</div><div class="caddr">${esc(r.direccion)}</div>${nota.map((n) => `<div class="cwarn">${esc(n)}</div>`).join('')}</td>
      <td>${esc(idxTxt)}</td>
      <td>${a ? C.fmtFecha(a.fecha) : '—'}</td>
      <td class="num">${Number.isFinite(r.monto) ? C.fmtMoney(r.monto) : '—'}</td>
      <td class="num">${a ? C.fmtPct(a.aumentoPct) : '—'}</td>
      <td class="num cnew">${a ? C.fmtMoney(a.nuevo) : '—'}${redondeoNota}</td>
      <td><span class="badge ${est.cls}" title="${esc(est.tip)}">${est.txt.toUpperCase()}</span>${rev}</td>
      <td class="num">${a ? `<button class="linkbtn" data-det="${i}" type="button" aria-expanded="false">Ver detalle</button>` : ''}</td>
    </tr>${a ? `<tr class="det" id="cdet-${i}" hidden><td colspan="9"><p class="explain">Período ${r.periodo} &rarr; ${r.periodo + 1}: del ${C.fmtFecha(a.fechaAnterior)} al ${C.fmtFecha(a.fecha)}. ${C.fmtMoney(r.monto)} &times; ${C.fmtIdx(a.factor)} = <b>${C.fmtMoney(a.nuevo)}</b></p>${detailHtml(a.detalle, a.info)}<div class="cimgwrap"><button type="button" class="sec small" data-cimg="${i}">Copiar como imagen (para WhatsApp)</button></div>${progresionHtml(r, i)}</td></tr>` : ''}`;
  }

  function renderTabla() {
    const q = K.norm(filtro);
    const visibles = mostrados.map((r, i) => ({ r, i })).filter(({ r }) => !q || K.norm(r.inquilino + r.direccion + r.carpeta).includes(q));
    $('#ccount').textContent = q ? `${visibles.length} de ${mostrados.length} contratos` : `${mostrados.length} contratos`;
    $('#ctabla').innerHTML = visibles.length
      ? `<table class="ctable">
          <thead><tr><th>Carpeta</th><th>Inquilino y dirección</th><th>Índice</th><th>Ajuste el</th><th class="num">Monto actual</th><th class="num">Aumento</th><th class="num">Nuevo monto</th><th>Estado</th><th></th></tr></thead>
          <tbody>${visibles.map(({ r, i }) => filaHtml(r, i)).join('')}</tbody>
        </table>`
      : '<p class="hint cnone">Ningún contrato coincide con la búsqueda.</p>';
    $('#ctabla').querySelectorAll('[data-det]').forEach((b) =>
      b.addEventListener('click', () => {
        const row = $('#cdet-' + b.dataset.det);
        row.hidden = !row.hidden;
        b.setAttribute('aria-expanded', String(!row.hidden));
        b.textContent = row.hidden ? 'Ver detalle' : 'Ocultar detalle';
      })
    );
    $('#ctabla').querySelectorAll('[data-pcalc]').forEach((b) => b.addEventListener('click', () => calcularProgresion(b.dataset.pcalc)));
    $('#ctabla').querySelectorAll('[data-cimg]').forEach((b) => b.addEventListener('click', () => copiarImagen(b.dataset.cimg)));
  }

  /** Genera la imagen del ajuste de un contrato y la copia al portapapeles (para pegar en WhatsApp). */
  async function copiarImagen(idx) {
    const row = mostrados[idx];
    const btn = document.querySelector(`[data-cimg="${idx}"]`);
    if (!row || !btn) return;
    const original = btn.dataset.orig || btn.textContent;
    btn.dataset.orig = original;
    const flash = (txt, cls) => {
      btn.textContent = txt;
      if (cls) btn.classList.add(cls);
      setTimeout(() => {
        if (btn.isConnected) { btn.textContent = original; btn.classList.remove('done', 'fail'); }
      }, 2600);
    };
    try {
      btn.disabled = true;
      const blob = await window.ShareImage.renderContrato(row);
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
      btn.disabled = false;
    }
  }

  function calcularProgresion(idx) {
    const row = mostrados[idx];
    if (!row) return;
    const fechaEl = document.querySelector(`.pfecha[data-pidx="${idx}"]`);
    const montoEl = document.querySelector(`.pmonto[data-pidx="${idx}"]`);
    const errEl = document.getElementById('progerr-' + idx);
    const tablaEl = document.getElementById('progtabla-' + idx);
    const fecha = fechaEl.value;
    const monto = K.parseMonto(montoEl.value);
    const res = progCalcularHtml(row, fecha, monto);
    if (res.error) {
      errEl.textContent = res.error;
      errEl.hidden = false;
      tablaEl.innerHTML = '';
      return;
    }
    errEl.hidden = true;
    errEl.textContent = '';
    tablaEl.innerHTML = res.html;
    iniciales[clave(row)] = { fechaInicio: fecha, montoInicial: monto };
    guardarIniciales();
    const btn = document.querySelector(`[data-pcalc="${idx}"]`);
    if (btn) btn.textContent = 'Volver a calcular';
  }

  function render() {
    const root = $('#contratosRoot');
    if (!data) {
      root.innerHTML = renderVacio();
      $('#btnImport').addEventListener('click', () => $('#fileXlsx').click());
      return;
    }
    const s = K.resumen(mostrados);
    root.innerHTML = `<div class="card contratos">
      <div class="chead">
        <div><h2>Contratos que ajustan el próximo mes</h2><p class="hint">Archivo «${esc(data.archivo)}» · importado el ${fmtCuando(data.importadoEn)}</p></div>
        <div class="actions cactions">
          <button class="sec" id="btnImport" type="button">Importar otro archivo</button>
          <button class="sec" id="btnCsv" type="button">Exportar a Excel</button>
          <button class="sec" id="btnCPrint" type="button">Imprimir / guardar PDF</button>
          <button class="sec danger" id="btnBorrar" type="button">Borrar lista</button>
        </div>
      </div>
      ${redondeoControlHtml()}
      ${renderResumen(s)}
      ${renderNotas(s)}
      <div class="cfilter"><input id="cfiltro" type="text" placeholder="Buscar por inquilino, dirección o carpeta" autocomplete="off" aria-label="Buscar contrato" value="${esc(filtro)}"><span class="hint" id="ccount"></span></div>
      <div class="tablewrap" id="ctabla"></div>
    </div>`;
    renderTabla();
    wireRedondeoControls(root);
    $('#btnImport').addEventListener('click', () => $('#fileXlsx').click());
    $('#btnCsv').addEventListener('click', exportar);
    $('#btnCPrint').addEventListener('click', () => window.print());
    $('#btnBorrar').addEventListener('click', borrar);
    $('#cfiltro').addEventListener('input', (ev) => { filtro = ev.target.value; renderTabla(); });
  }

  // ---------------------------------------------------------------- acciones
  function aviso(btn, txt, cls) {
    const original = btn.dataset.orig || btn.textContent;
    btn.dataset.orig = original;
    btn.textContent = txt;
    if (cls) btn.classList.add(cls);
    setTimeout(() => { btn.textContent = original; btn.classList.remove('done', 'fail'); }, 2600);
  }

  async function exportar() {
    const b = $('#btnCsv');
    const primera = mostrados.find((r) => r.ajuste);
    const mes = primera ? primera.ajuste.fecha.slice(0, 7) : 'contratos';
    const nombre = `Ajustes-alquileres-${mes}.csv`;
    const csv = K.aCSV(mostrados);
    try {
      if (api.saveFile) {
        const r = await api.saveFile({ nombre, datos: csv });
        if (r && r.guardado) aviso(b, '¡Archivo guardado!', 'done');
        return;
      }
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (_) {
      aviso(b, 'No se pudo guardar', 'fail');
    }
  }

  function borrar() {
    const b = $('#btnBorrar');
    if (!borrarArmado) {
      b.textContent = '¿Seguro? Tocá de nuevo';
      borrarArmado = setTimeout(() => { borrarArmado = null; if (b.isConnected) b.textContent = 'Borrar lista'; }, 3500);
      return;
    }
    clearTimeout(borrarArmado);
    borrarArmado = null;
    data = null;
    results = [];
    mostrados = [];
    filtro = '';
    store.remove('contratos');
    pintarContador();
    render();
  }

  // ---------------------------------------------------------------- arranque
  function init(apiRef) {
    api = apiRef || {};
    data = cargar();
    iniciales = cargarIniciales();
    recalcular();
    pintarContador();

    $('#tabCalc').addEventListener('click', () => mostrar('calc'));
    $('#tabContratos').addEventListener('click', () => mostrar('contratos'));
    $('#fileXlsx').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = ''; // permite volver a elegir el mismo archivo
      importar(f);
    });

    // Arrastrar y soltar el Excel en cualquier parte. Sin esto, soltar un archivo lo abriría en la ventana.
    let depth = 0;
    const conArchivos = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => { if (conArchivos(e)) { depth++; $('#dropOverlay').hidden = false; } });
    window.addEventListener('dragleave', (e) => { if (conArchivos(e) && --depth <= 0) { depth = 0; $('#dropOverlay').hidden = true; } });
    window.addEventListener('dragover', (e) => { if (conArchivos(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!conArchivos(e)) return;
      e.preventDefault();
      depth = 0;
      $('#dropOverlay').hidden = true;
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importar(f);
    });

    window.UI.onRedondeoChange(() => {
      actualizarMostrados();
      if (data && !$('#viewContratos').hidden) render();
    });
  }

  function setSeries(s) {
    series = s || {};
    if (!data) return;
    recalcular(); // con índices nuevos, los estimados pasan a oficiales
    pintarContador();
    if (!$('#viewContratos').hidden) {
      const foco = document.activeElement && document.activeElement.id === 'cfiltro';
      const abiertos = [...document.querySelectorAll('#ctabla tr.det:not([hidden])')].map((r) => r.id);
      const pos = foco ? $('#cfiltro').selectionStart : 0;
      render();
      abiertos.forEach((id) => {
        const row = document.getElementById(id);
        const btn = row && document.querySelector(`[data-det="${id.replace('cdet-', '')}"]`);
        if (row && btn) btn.click();
      });
      if (foco) { const f = $('#cfiltro'); f.focus(); f.setSelectionRange(pos, pos); }
    }
  }

  window.ContratosUI = { init, setSeries, mostrar };
})();
