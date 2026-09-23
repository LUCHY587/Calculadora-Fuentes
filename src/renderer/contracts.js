/**
 * Contratos que exporta el sistema de cobros (Arcomercial → "Cambio de período"):
 * lectura de las filas del Excel, validaciones y cálculo del próximo ajuste de cada uno.
 * Sin dependencias: funciona en el navegador y en Node (para poder probarlo).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.Contracts = factory(root.Calc);
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  /** "Período actual" → "periodoactual": sin tildes, mayúsculas ni signos. */
  const norm = (s) =>
    String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  // Nombre de cada dato → encabezados que aceptamos para esa columna (ya normalizados).
  const COLUMNAS = {
    carpeta: ['carpeta', 'nrocarpeta', 'ncarpeta', 'contrato'],
    inicio: ['iniciocontrato', 'fechainicio', 'inicio', 'desde'],
    fin: ['fincontrato', 'fechafin', 'fin', 'hasta'],
    inquilino: ['inquilino', 'locatario'],
    direccion: ['direccion', 'propiedad', 'domicilio'],
    periodo: ['periodoactual', 'periodo', 'nroperiodo'],
    monto: ['montoperactual', 'montoperiodoactual', 'montoactual', 'monto', 'importe', 'alquiler'],
    indice: ['indice', 'indicedeactualizacion', 'tipodeindice'],
    cada: ['cadacuantosmeses', 'cadameses', 'periodicidad', 'meses'],
  };
  const OBLIGATORIAS = ['inicio', 'periodo', 'monto', 'indice', 'cada'];
  const NOMBRES = {
    inicio: 'INICIO CONTRATO',
    periodo: 'PERÍODO ACTUAL',
    monto: 'MONTO PER. ACTUAL',
    indice: 'INDICE',
    cada: 'CADA CUÁNTOS MESES',
  };

  // ------------------------------------------------------------------ valores
  /** "07/02/2025", "2025-02-07", Date o número de serie de Excel → "2025-02-07" (o null). */
  function parseFecha(v) {
    if (v == null || v === '') return null;
    let y;
    let m;
    let d;
    if (v instanceof Date) {
      y = v.getFullYear();
      m = v.getMonth() + 1;
      d = v.getDate();
    } else if (typeof v === 'number') {
      if (!(v > 20000 && v < 80000)) return null; // fuera de un rango razonable de fechas
      const dt = new Date(Math.round((v - 25569) * 86400000));
      y = dt.getUTCFullYear();
      m = dt.getUTCMonth() + 1;
      d = dt.getUTCDate();
    } else {
      const s = String(v).trim();
      let mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
      if (mt) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
      else if ((mt = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
      else return null;
    }
    const ok = new Date(Date.UTC(y, m - 1, d));
    if (ok.getUTCFullYear() !== y || ok.getUTCMonth() !== m - 1 || ok.getUTCDate() !== d) return null;
    if (y < 1990 || y > 2100) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function parseMonto(v) {
    if (typeof v === 'number') return v;
    return Calc.parseMonto(v);
  }

  function parseEntero(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
    const s = String(v == null ? '' : v).trim();
    return /^\d+$/.test(s) ? Number(s) : NaN;
  }

  /** Texto del índice del sistema → clave de la app (o null si la app no lo tiene). */
  function mapIndice(texto) {
    const t = ' ' + String(texto == null ? '' : texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    if (/ icl /.test(t) || t.includes('contratos de locacion')) return 'icl';
    if (/ ipc /.test(t) || t.includes('precios al consumidor')) return 'ipc';
    if (/ cer /.test(t)) return 'cer';
    if (/ uva /.test(t)) return 'uva';
    if (/ ipim /.test(t) || t.includes('precios internos')) return 'ipim';
    if (/ is /.test(t) || t.includes('indice de salarios')) return 'is';
    return null;
  }

  const limpiar = (v) => {
    const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    return s;
  };

  // ------------------------------------------------------------------ lectura de filas
  /**
   * @param {Array<Array<any>>} filas  filas de la hoja (celdas ya leídas)
   * @returns {{contratos:object[], avisos:string[], error?:string, totalDeclarado:number|null, leidas:number, repetidas:number}}
   */
  function leerFilas(filas) {
    // 1) fila de encabezados: la primera que reconozca varias columnas
    let hdrRow = -1;
    let cols = null;
    for (let i = 0; i < Math.min(filas.length, 15); i++) {
      const map = {};
      (filas[i] || []).forEach((c, j) => {
        const h = norm(c);
        if (!h) return;
        for (const k of Object.keys(COLUMNAS)) if (!(k in map) && COLUMNAS[k].includes(h)) map[k] = j;
      });
      if (Object.keys(map).length >= 4 && OBLIGATORIAS.filter((k) => k in map).length >= 3) {
        hdrRow = i;
        cols = map;
        break;
      }
    }
    if (hdrRow < 0) {
      return { contratos: [], avisos: [], error: 'No reconozco este archivo. Tiene que ser el Excel «Cambio de período» del sistema de cobros, con los encabezados originales en la primera fila.', totalDeclarado: null, leidas: 0, repetidas: 0 };
    }
    const faltan = OBLIGATORIAS.filter((k) => !(k in cols));
    if (faltan.length) {
      return { contratos: [], avisos: [], error: `Al archivo le falta la columna: ${faltan.map((k) => NOMBRES[k]).join(', ')}.`, totalDeclarado: null, leidas: 0, repetidas: 0 };
    }

    const get = (fila, k) => (k in cols ? fila[cols[k]] : undefined);
    const avisos = [];
    const contratos = [];
    const vistos = new Map();
    let totalDeclarado = null;
    let leidas = 0;
    let repetidas = 0;

    for (let i = hdrRow + 1; i < filas.length; i++) {
      const f = filas[i] || [];
      if (!f.some((c) => limpiar(c) !== '')) continue;
      const primera = limpiar(f[0]);
      // pie de la planilla: "TOTAL DE CONTRATOS:44"
      const tot = /^total.*?(\d+)\s*$/i.exec(primera);
      if (tot && f.slice(1).every((c) => limpiar(c) === '')) {
        totalDeclarado = +tot[1];
        continue;
      }
      leidas++;
      const c = {
        fila: i + 1,
        carpeta: limpiar(get(f, 'carpeta')),
        inquilino: limpiar(get(f, 'inquilino')),
        direccion: limpiar(get(f, 'direccion')),
        inicioTexto: limpiar(get(f, 'inicio')),
        inicio: parseFecha(get(f, 'inicio')),
        fin: parseFecha(get(f, 'fin')),
        periodo: parseEntero(get(f, 'periodo')),
        monto: parseMonto(get(f, 'monto')),
        cada: parseEntero(get(f, 'cada')),
        indiceTexto: limpiar(get(f, 'indice')),
        indice: mapIndice(get(f, 'indice')),
        problemas: [],
      };
      const clave = [c.carpeta, c.inquilino, c.direccion, c.inicio, c.periodo, c.monto, c.cada, c.indiceTexto].join('|');
      if (vistos.has(clave)) {
        repetidas++;
        continue; // fila idéntica repetida: se cuenta una sola vez
      }
      vistos.set(clave, c);
      contratos.push(c);
    }

    // 2) "parece el mismo contrato" cargado con dos carpetas distintas
    const grupos = new Map();
    for (const c of contratos) {
      if (!c.inquilino || !c.inicio) continue;
      const k = [norm(c.inquilino), c.inicio, c.monto].join('|');
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(c);
    }
    for (const g of grupos.values()) {
      if (g.length < 2) continue;
      for (const c of g) {
        const otras = g.filter((x) => x !== c).map((x) => x.carpeta || 's/n').join(', ');
        c.problemas.push(`Parece repetido con la carpeta ${otras} (mismo inquilino, fecha y monto)`);
      }
    }

    if (repetidas) avisos.push(`Se ignoraron ${repetidas} ${repetidas === 1 ? 'fila idéntica repetida' : 'filas idénticas repetidas'}.`);
    if (totalDeclarado != null && totalDeclarado !== leidas) {
      avisos.push(`El archivo indica ${totalDeclarado} contratos y se leyeron ${leidas} filas. Revisá que no falte ninguno.`);
    }
    return { contratos, avisos, totalDeclarado, leidas, repetidas };
  }

  // ------------------------------------------------------------------ cálculo
  /**
   * Agrega a cada contrato el resultado del ajuste. `estado`:
   *  oficial | estimado  → calculado (estimado = el índice todavía no se publicó)
   *  sincalculo          → no se puede calcular (índice que la app no tiene, dato inválido)
   * `revisar` (true) se suma cuando hay algo raro en el dato aunque se haya calculado.
   */
  function calcularTodos(contratos, series) {
    return contratos.map((c) => {
      const r = { ...c, problemas: c.problemas.slice(), ajuste: null, error: null, estado: 'sincalculo', revisar: false };
      const falta = [];
      if (!c.inicio) falta.push(c.inicioTexto ? `fecha de inicio «${c.inicioTexto}» inválida` : 'falta la fecha de inicio');
      if (!(c.periodo >= 1)) falta.push('período actual inválido');
      if (!(c.monto > 0)) falta.push('monto inválido');
      if (!(c.cada >= 1 && c.cada <= 60)) falta.push('periodicidad inválida');
      if (falta.length) {
        r.error = 'Datos incompletos: ' + falta.join(', ') + '.';
        r.revisar = true;
        return r;
      }
      if (!c.indice) {
        r.error = `La app no tiene el índice «${c.indiceTexto || 'sin índice'}»: calculalo con el sistema o a mano.`;
        return r;
      }
      if (c.monto < 1000) {
        r.problemas.push(`Monto actual muy bajo (${Calc.fmtMoney(c.monto)}): revisá que esté bien cargado en el sistema`);
      }
      try {
        r.ajuste = Calc.calcularAjuste({ indice: c.indice, base: c.monto, fechaInicio: c.inicio, cadaMeses: c.cada, periodoActual: c.periodo, series });
        r.estado = r.ajuste.estimado ? 'estimado' : 'oficial';
      } catch (e) {
        r.error = e.message;
        r.estado = 'sincalculo';
      }
      if (r.problemas.length) r.revisar = true;
      return r;
    });
  }

  function ordenar(res) {
    const num = (s) => (/^\d+$/.test(s) ? Number(s) : Infinity);
    return res.slice().sort((a, b) => {
      const fa = a.ajuste ? a.ajuste.fecha : '9999';
      const fb = b.ajuste ? b.ajuste.fecha : '9999';
      if (fa !== fb) return fa < fb ? -1 : 1;
      const d = num(a.carpeta) - num(b.carpeta);
      if (d && Number.isFinite(d)) return d;
      return a.inquilino.localeCompare(b.inquilino, 'es');
    });
  }

  function resumen(res) {
    const calc = res.filter((r) => r.ajuste);
    const fechas = [...new Set(calc.map((r) => r.ajuste.fecha))].sort();
    const porIndice = {};
    for (const r of res) {
      const k = r.indice ? Calc.INDICES[r.indice].nombre : r.indiceTexto || 'Sin índice';
      porIndice[k] = (porIndice[k] || 0) + 1;
    }
    const sumaActual = calc.reduce((a, r) => a + r.monto, 0);
    const sumaNueva = calc.reduce((a, r) => a + r.ajuste.nuevo, 0);
    return {
      total: res.length,
      calculados: calc.length,
      estimados: res.filter((r) => r.estado === 'estimado').length,
      oficiales: res.filter((r) => r.estado === 'oficial').length,
      sinCalculo: res.filter((r) => r.estado === 'sincalculo').length,
      revisar: res.filter((r) => r.revisar).length,
      fechas,
      porIndice,
      sumaActual,
      sumaNueva,
      aumentoTotalPct: sumaActual ? (sumaNueva / sumaActual - 1) * 100 : 0,
    };
  }

  // ------------------------------------------------------------------ exportación
  const ESTADO_TXT = { oficial: 'Oficial', estimado: 'Estimado', sincalculo: 'Sin cálculo' };

  /** CSV para Excel en español (separador ";", coma decimal, con BOM para las tildes). */
  function aCSV(res) {
    const q = (v) => {
      const s = String(v == null ? '' : v);
      return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const dec = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
    // Si un texto empieza con = + - @ Excel lo tomaría como fórmula: se antepone un apóstrofo.
    const t = (v) => (/^[=+\-@\t\r]/.test(String(v == null ? '' : v)) ? "'" + v : v);
    const head = ['Carpeta', 'Inquilino', 'Dirección', 'Índice', 'Fecha del ajuste', 'Monto actual', 'Aumento %', 'Nuevo monto', 'Redondeo', 'Estado', 'Observaciones'];
    const lines = [head.map(q).join(';')];
    for (const r of res) {
      const a = r.ajuste;
      // El % de aumento es siempre el que da el índice, sin tocar; si se redondeó, el importe
      // real a cobrar queda en "Nuevo monto" y esta columna aclara cuál era el cálculo exacto.
      const redondeo = a && a.redondeado
        ? `Redondeado ${a.redondeado === 'arriba' ? 'para arriba' : 'para abajo'}: el cálculo exacto daba ${Calc.fmtMoney(a.original)}, se cobra ${Calc.fmtMoney(a.nuevo)}.`
        : '';
      const obs = [r.error, ...r.problemas].filter(Boolean).join(' | ');
      lines.push(
        [
          t(r.carpeta),
          t(r.inquilino),
          t(r.direccion),
          r.indice ? Calc.INDICES[r.indice].nombre : t(r.indiceTexto),
          a ? Calc.fmtFecha(a.fecha) : '',
          Number.isFinite(r.monto) ? String(r.monto).replace('.', ',') : '',
          a ? dec(a.aumentoPct) : '',
          a ? a.nuevo : '',
          t(redondeo),
          ESTADO_TXT[r.estado] + (r.revisar ? ' (revisar)' : ''),
          t(obs),
        ]
          .map(q)
          .join(';')
      );
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  return { norm, parseFecha, parseMonto, mapIndice, leerFilas, calcularTodos, ordenar, resumen, aCSV, COLUMNAS };
});
