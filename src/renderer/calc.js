/**
 * Lógica de cálculo de actualización de alquileres (sin dependencias, funciona en
 * el navegador y en Node para poder probarla).
 *
 * Reglas (verificadas contra la calculadora de arquiler.com):
 *  - Índices DIARIOS (ICL, CER, UVA): nuevo = anterior x (índice a la fecha de
 *    actualización / índice a la fecha de la actualización previa).
 *  - Índices MENSUALES (IPC, IS, IPIM): se acumulan las variaciones mensuales desde
 *    el mes de la actualización previa hasta el mes anterior a la nueva
 *    (o sea: índice(mes anterior a la nueva fecha) / índice(mes anterior a la fecha previa)).
 *  - Si el índice todavía no se publicó para esa fecha, el valor es ESTIMADO:
 *      · diarios: se repite la variación de los últimos N meses publicados;
 *      · mensuales: se repite la última variación mensual publicada.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INDICES = {
    icl: { key: 'icl', nombre: 'ICL', largo: 'Índice para Contratos de Locación', tipo: 'diario', fuente: 'BCRA' },
    ipc: { key: 'ipc', nombre: 'IPC', largo: 'Índice de Precios al Consumidor', tipo: 'mensual', fuente: 'INDEC' },
    cer: { key: 'cer', nombre: 'CER', largo: 'Coeficiente de Estabilización de Referencia', tipo: 'diario', fuente: 'BCRA' },
    is: { key: 'is', nombre: 'IS', largo: 'Índice de Salarios', tipo: 'mensual', fuente: 'INDEC' },
    ipim: { key: 'ipim', nombre: 'IPIM', largo: 'Índice de Precios Internos al por Mayor', tipo: 'mensual', fuente: 'INDEC' },
    uva: { key: 'uva', nombre: 'UVA', largo: 'Unidad de Valor Adquisitivo', tipo: 'diario', fuente: 'BCRA' },
  };
  const ORDEN = ['icl', 'ipc', 'cer', 'is', 'ipim', 'uva'];

  // ------------------------------------------------------------------ fechas
  const pad = (n) => String(n).padStart(2, '0');

  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) throw new Error('Fecha inválida: ' + s);
    return { y: +m[1], m: +m[2], d: +m[3] };
  }
  const toISO = ({ y, m, d }) => `${y}-${pad(m)}-${pad(d)}`;
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  function addMonths(iso, n) {
    const { y, m, d } = parseISO(iso);
    const t = y * 12 + (m - 1) + n;
    const ny = Math.floor(t / 12);
    const nm = ((t % 12) + 12) % 12 + 1;
    return toISO({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
  }
  function monthNum(iso) {
    const { y, m } = parseISO(iso);
    return y * 12 + (m - 1);
  }
  function monthISO(mn) {
    return `${Math.floor(mn / 12)}-${pad((mn % 12) + 1)}-01`;
  }

  // ------------------------------------------------------------------ series
  function dailySeries(points) {
    const p = points.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    if (!p.length) return null;
    const dates = p.map((x) => x[0]);
    const vals = p.map((x) => x[1]);
    const lastIdx = dates.length - 1;
    return {
      tipo: 'diario',
      firstDate: dates[0],
      lastDate: dates[lastIdx],
      lastValue: vals[lastIdx],
      // último dato publicado a una fecha <= iso (cubre fines de semana o huecos)
      at(iso) {
        let lo = 0;
        let hi = lastIdx;
        let res = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (dates[mid] <= iso) {
            res = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return res < 0 ? null : { fecha: dates[res], valor: vals[res] };
      },
    };
  }

  function monthlySeries(points) {
    const map = new Map();
    for (const [d, v] of points) map.set(monthNum(d), v);
    if (!map.size) return null;
    const months = [...map.keys()].sort((a, b) => a - b);
    const first = months[0];
    const last = months[months.length - 1];
    const lastValue = map.get(last);
    const prev = map.get(last - 1);
    // Última variación mensual publicada, redondeada a 2 decimales (es la que se ve y se repite).
    const pct = prev ? Math.round((lastValue / prev - 1) * 10000) / 100 : 0;
    const ratio = 1 + pct / 100;
    return {
      tipo: 'mensual',
      firstMonth: first,
      lastMonth: last,
      lastValue,
      lastVar: ratio - 1,
      at(mn) {
        if (mn < first) return null;
        if (map.has(mn)) return { valor: map.get(mn), estimado: false };
        if (mn > last) return { valor: lastValue * Math.pow(ratio, mn - last), estimado: true };
        let k = mn;
        while (k > first && !map.has(k)) k--;
        return { valor: map.get(k), estimado: false };
      },
    };
  }

  function buildSeries(indices) {
    const out = {};
    for (const key of ORDEN) {
      const pts = indices && indices[key] && indices[key].points;
      if (!pts || !pts.length) continue;
      out[key] = INDICES[key].tipo === 'diario' ? dailySeries(pts) : monthlySeries(pts);
    }
    return out;
  }

  // ------------------------------------------------------------------ formato (es-AR)
  const nfMoney = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const nfPct = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nfIdx = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const fmtMoney = (n) => '$ ' + nfMoney.format(Math.round(n));
  const fmtPct = (n) => nfPct.format(n) + ' %';
  const fmtIdx = (n) => nfIdx.format(n);
  function fmtFecha(iso) {
    const { y, m, d } = parseISO(iso);
    return `${pad(d)}/${pad(m)}/${y}`;
  }
  function fmtMes(iso) {
    const { y, m } = parseISO(iso);
    return `${MESES[m - 1]} ${y}`;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Acepta "1.250.000", "1250000", "1.250.000,50", "$ 1.250.000" */
  function parseMonto(str) {
    let s = String(str == null ? '' : str).replace(/[^\d.,]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    return Number(s);
  }

  // ------------------------------------------------------------------ cálculo
  function pasoDiario(info, S, dPrev, dCur, n) {
    if (dCur > S.lastDate) {
      const base = S.at(addMonths(S.lastDate, -n));
      if (!base) throw new Error(`No hay datos suficientes del ${info.nombre} para estimar el próximo ajuste.`);
      return {
        factor: S.lastValue / base.valor,
        estimado: true,
        detalle: {
          tipo: 'diario',
          estimacion: true,
          desde: base,
          hasta: { fecha: S.lastDate, valor: S.lastValue },
        },
      };
    }
    const a = S.at(dPrev);
    const b = S.at(dCur);
    if (!a) {
      throw new Error(`El ${info.nombre} no tiene datos para el ${fmtFecha(dPrev)} (la serie empieza el ${fmtFecha(S.firstDate)}). Elegí otro índice o una fecha posterior.`);
    }
    return { factor: b.valor / a.valor, estimado: false, detalle: { tipo: 'diario', estimacion: false, desde: a, hasta: b } };
  }

  function pasoMensual(info, S, dPrev, dCur) {
    const m0 = monthNum(dPrev);
    const m1 = monthNum(dCur) - 1;
    const base = S.at(m0 - 1);
    const fin = S.at(m1);
    if (!base) {
      throw new Error(`El ${info.nombre} no tiene datos para ${fmtMes(monthISO(m0 - 1))} (la serie empieza en ${fmtMes(monthISO(S.firstMonth))}). Elegí otro índice o una fecha posterior.`);
    }
    const meses = [];
    let acum = 1;
    for (let m = m0; m <= m1; m++) {
      const cur = S.at(m);
      const ant = S.at(m - 1);
      const variacion = cur.valor / ant.valor;
      acum *= variacion;
      meses.push({ mes: monthISO(m), valor: cur.valor, variacion: (variacion - 1) * 100, acumulado: (acum - 1) * 100, repetido: cur.estimado });
    }
    return { factor: fin.valor / base.valor, estimado: fin.estimado, detalle: { tipo: 'mensual', meses } };
  }

  /**
   * @param {{indice:string, alquiler:number, fechaInicio:string, cadaMeses:number, hoy:string, series:object}} p
   */
  function calcular(p) {
    const info = INDICES[p.indice];
    if (!info) throw new Error('Índice desconocido');
    if (!Number.isFinite(p.alquiler) || p.alquiler <= 0) throw new Error('Ingresá el valor inicial del alquiler.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fechaInicio || '')) throw new Error('Ingresá la fecha de inicio del contrato.');
    const n = Math.round(p.cadaMeses);
    if (!(n >= 1 && n <= 60)) throw new Error('Elegí cada cuántos meses se actualiza.');
    const S = p.series && p.series[p.indice];
    if (!S) throw new Error(`Todavía no hay datos del ${info.nombre}. Tocá “Actualizar índices” cuando tengas conexión.`);

    const start = p.fechaInicio;
    const rows = [];
    const first = { n: 1, fecha: start, aumentoPct: 0, valor: p.alquiler, estimado: false, detalle: null };
    if (info.tipo === 'diario') {
      const v = S.at(start);
      if (v) first.indice = v.valor;
    }
    rows.push(first);

    let valor = p.alquiler;
    for (let k = 1; k < 600; k++) {
      const dPrev = addMonths(start, (k - 1) * n);
      if (k > 1 && dPrev > p.hoy) break;
      const dCur = addMonths(start, k * n);
      const step = info.tipo === 'diario' ? pasoDiario(info, S, dPrev, dCur, n) : pasoMensual(info, S, dPrev, dCur);
      valor *= step.factor;
      const row = { n: k + 1, fecha: dCur, aumentoPct: (step.factor - 1) * 100, valor, estimado: step.estimado, detalle: step.detalle };
      if (info.tipo === 'diario') row.indice = step.detalle.hasta.valor;
      rows.push(row);
    }

    let vig = -1;
    rows.forEach((r, i) => {
      if (r.fecha <= p.hoy) vig = i;
    });
    return {
      indice: p.indice,
      info,
      entrada: { alquiler: p.alquiler, fechaInicio: start, cadaMeses: n },
      hoy: p.hoy,
      rows,
      vigente: vig >= 0 ? rows[vig] : null,
      proximo: rows[vig + 1] || null,
      hayEstimado: rows.some((r) => r.estimado),
      ultimoDato: info.tipo === 'diario' ? S.lastDate : monthISO(S.lastMonth),
    };
  }

  /**
   * Ajuste de UN solo período a partir del monto vigente (el caso de los contratos que
   * exporta el sistema de cobros: se conoce el monto actual y en qué período está).
   * El período `periodoActual` empezó en inicio + (periodoActual-1) x cada meses; el ajuste
   * pedido es el del período siguiente, que arranca en inicio + periodoActual x cada meses.
   * @param {{indice:string, base:number, fechaInicio:string, cadaMeses:number, periodoActual:number, series:object}} p
   */
  function calcularAjuste(p) {
    const info = INDICES[p.indice];
    if (!info) throw new Error('Índice desconocido');
    const n = Math.round(p.cadaMeses);
    const k = Math.round(p.periodoActual);
    if (!Number.isFinite(p.base) || p.base <= 0) throw new Error('Monto inválido.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fechaInicio || '')) throw new Error('Fecha de inicio inválida.');
    if (!(n >= 1 && n <= 60)) throw new Error('Periodicidad inválida.');
    if (!(k >= 1 && k <= 600)) throw new Error('Período actual inválido.');
    const S = p.series && p.series[p.indice];
    if (!S) throw new Error(`Todavía no hay datos del ${info.nombre}.`);
    const dPrev = addMonths(p.fechaInicio, (k - 1) * n);
    const dCur = addMonths(p.fechaInicio, k * n);
    const step = info.tipo === 'diario' ? pasoDiario(info, S, dPrev, dCur, n) : pasoMensual(info, S, dPrev, dCur);
    const nuevo = Math.round(p.base * step.factor);
    return {
      indice: p.indice,
      info,
      fechaAnterior: dPrev,
      fecha: dCur,
      base: p.base,
      factor: step.factor,
      aumentoPct: (nuevo / p.base - 1) * 100,
      nuevo,
      estimado: step.estimado,
      detalle: step.detalle,
      ultimoDato: info.tipo === 'diario' ? S.lastDate : monthISO(S.lastMonth),
    };
  }

  function etiquetaPeriodo(n, meses) {
    if (meses === 12) return 'Año ' + n;
    if (meses === 6) return 'Semestre ' + n;
    if (meses === 3) return 'Trimestre ' + n;
    if (meses === 1) return 'Mes ' + n;
    return 'Período ' + n;
  }

  /** Variación de los últimos 12 meses publicados (para el panel de índices). */
  function variacion12m(key, S) {
    if (!S) return null;
    if (S.tipo === 'diario') {
      const b = S.at(addMonths(S.lastDate, -12));
      return b ? (S.lastValue / b.valor - 1) * 100 : null;
    }
    const b = S.at(S.lastMonth - 12);
    return b ? (S.lastValue / b.valor - 1) * 100 : null;
  }

  function resumenTexto(r) {
    const e = r.entrada;
    const l = [];
    l.push(`Actualización de alquiler — ${r.info.nombre} (${r.info.largo})`);
    l.push(`Alquiler inicial: ${fmtMoney(e.alquiler)} | Inicio del contrato: ${fmtFecha(e.fechaInicio)} | Se actualiza cada ${e.cadaMeses} ${e.cadaMeses === 1 ? 'mes' : 'meses'}`);
    l.push('');
    if (r.vigente) l.push(`Alquiler vigente desde el ${fmtFecha(r.vigente.fecha)}: ${fmtMoney(r.vigente.valor)}`);
    else l.push('El contrato todavía no comenzó.');
    if (r.proximo) {
      l.push(`Próximo ajuste el ${fmtFecha(r.proximo.fecha)}: ${fmtMoney(r.proximo.valor)} (${fmtPct(r.proximo.aumentoPct)})${r.proximo.estimado ? ' — ESTIMADO, el índice aún no fue publicado' : ''}`);
    }
    l.push('');
    r.rows.forEach((x) => {
      l.push(`${etiquetaPeriodo(x.n, e.cadaMeses)} · ${fmtFecha(x.fecha)} · ${x.n === 1 ? 'valor inicial' : fmtPct(x.aumentoPct)} · ${fmtMoney(x.valor)}${x.estimado ? ' (estimado)' : ''}`);
    });
    l.push('');
    l.push(`Fuente: ${r.info.fuente}. Último dato publicado: ${r.info.tipo === 'diario' ? fmtFecha(r.ultimoDato) : fmtMes(r.ultimoDato)}.`);
    return l.join('\n');
  }

  // ------------------------------------------------------------------ redondeo
  const PASO_REDONDEO = 5000;
  /** Redondea al múltiplo de $5.000 más cercano. modo: 'arriba' | 'abajo' | (cualquier otra cosa = sin cambios). */
  function redondear(valor, modo) {
    if (modo === 'arriba') return Math.ceil(valor / PASO_REDONDEO) * PASO_REDONDEO;
    if (modo === 'abajo') return Math.floor(valor / PASO_REDONDEO) * PASO_REDONDEO;
    return valor;
  }

  return {
    INDICES,
    ORDEN,
    addMonths,
    monthNum,
    monthISO,
    buildSeries,
    dailySeries,
    monthlySeries,
    calcular,
    calcularAjuste,
    variacion12m,
    resumenTexto,
    etiquetaPeriodo,
    parseMonto,
    fmtMoney,
    fmtPct,
    fmtIdx,
    fmtFecha,
    fmtMes,
    cap,
    redondear,
    PASO_REDONDEO,
  };
});
