/** Utilidades de pantalla compartidas por la calculadora y la lista de contratos. */
(function () {
  'use strict';
  const C = window.Calc;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));

  const store = {
    get(k, d) { try { const v = localStorage.getItem('ca.' + k); return v == null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('ca.' + k, v); } catch (_) {} },
    remove(k) { try { localStorage.removeItem('ca.' + k); } catch (_) {} },
  };

  function hoyISO() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** Detalle de cómo se llegó a un aumento (índices usados). `d` es el `detalle` del cálculo. */
  function detailHtml(d, info) {
    if (!d) return '';
    const nom = esc(info.nombre);
    if (d.tipo === 'diario') {
      const txt = `${nom} al ${C.fmtFecha(d.desde.fecha)}: <b>${C.fmtIdx(d.desde.valor)}</b> &rarr; ${nom} al ${C.fmtFecha(d.hasta.fecha)}: <b>${C.fmtIdx(d.hasta.valor)}</b> &nbsp;(x ${C.fmtIdx(d.hasta.valor / d.desde.valor)})`;
      return `<p class="explain">${d.estimacion ? '<b>Estimación:</b> como aún no se publicó el índice para esta fecha, se repite la variación de los últimos meses publicados.<br>' : ''}${txt}</p>`;
    }
    const rows = d.meses
      .map((m) => `<tr><td>${esc(C.cap(C.fmtMes(m.mes)))}</td><td class="num">${C.fmtIdx(m.valor)}${m.repetido ? ' <span class="rep">*</span>' : ''}</td><td class="num">${C.fmtPct(m.variacion)}</td><td class="num">${C.fmtPct(m.acumulado)}</td></tr>`)
      .join('');
    const rep = d.meses.some((m) => m.repetido) ? '<p class="explain"><span class="rep">*</span> Mes aún no publicado: se repite la última variación mensual conocida.</p>' : '';
    return `<table><thead><tr><th>Mes</th><th class="num">Índice</th><th class="num">Variación mensual</th><th class="num">Acumulado</th></tr></thead><tbody>${rows}</tbody></table>${rep}`;
  }

  // ------------------------------------------------------------------ redondeo (compartido entre pantallas)
  const redondeoListeners = [];
  function redondeoModo() {
    const m = store.get('redondeo', 'exacto');
    return m === 'arriba' || m === 'abajo' ? m : 'exacto';
  }
  function setRedondeoModo(m) {
    if (m !== 'arriba' && m !== 'abajo') m = 'exacto';
    store.set('redondeo', m);
    redondeoListeners.forEach((cb) => { try { cb(m); } catch (_) {} });
  }
  /** Se llama cada vez que cambia el modo de redondeo (para que las pantallas se vuelvan a pintar). */
  function onRedondeoChange(cb) {
    redondeoListeners.push(cb);
  }

  /**
   * Aplica el redondeo elegido solo al PRÓXIMO importe de un resultado de Calc.calcular (el
   * historial queda exacto). El % de aumento NO se recalcula: sigue siendo el que da el índice.
   * Lo único que cambia es el importe a cobrar; `original` guarda el valor exacto para la nota
   * "antes $X" y para poder aclararlo al exportar.
   */
  function aplicarRedondeoAResultado(r, modo) {
    if (!r || !r.proximo || modo === 'exacto') return r;
    const nuevo = C.redondear(r.proximo.valor, modo);
    if (nuevo === r.proximo.valor) return r;
    const proximo = { ...r.proximo, valor: nuevo, original: r.proximo.valor, redondeado: modo };
    const rows = r.rows.map((row) => (row === r.proximo ? proximo : row));
    return { ...r, rows, proximo };
  }

  /**
   * Igual que arriba, pero para el resultado de Calc.calcularAjuste (un solo período, el que usa
   * "Contratos del mes"). El % de aumento también queda sin tocar.
   */
  function aplicarRedondeoAAjuste(a, modo) {
    if (!a || modo === 'exacto') return a;
    const nuevo = C.redondear(a.nuevo, modo);
    if (nuevo === a.nuevo) return a;
    return { ...a, nuevo, original: a.nuevo, redondeado: modo };
  }

  function redondeoControlHtml() {
    const modo = redondeoModo();
    const opt = (m, txt, tip) => `<button type="button" class="rbtn" data-redondeo="${m}" aria-pressed="${String(modo === m)}" title="${esc(tip)}">${esc(txt)}</button>`;
    return `<div class="redondeo" role="group" aria-label="Redondeo del próximo importe">
      <span class="rlbl">Redondeo del próximo importe</span>
      ${opt('exacto', 'Exacto', 'Sin redondear')}
      ${opt('arriba', '▲ $5.000', `Redondea el próximo importe hacia arriba, al múltiplo de ${C.fmtMoney(C.PASO_REDONDEO)} más cercano`)}
      ${opt('abajo', '▼ $5.000', `Redondea el próximo importe hacia abajo, al múltiplo de ${C.fmtMoney(C.PASO_REDONDEO)} más cercano`)}
    </div>`;
  }
  function wireRedondeoControls(root) {
    (root || document).querySelectorAll('[data-redondeo]').forEach((b) => {
      b.addEventListener('click', () => setRedondeoModo(b.dataset.redondeo));
    });
  }

  window.UI = {
    esc,
    store,
    hoyISO,
    detailHtml,
    redondeoModo,
    setRedondeoModo,
    onRedondeoChange,
    aplicarRedondeoAResultado,
    aplicarRedondeoAAjuste,
    redondeoControlHtml,
    wireRedondeoControls,
  };
})();
