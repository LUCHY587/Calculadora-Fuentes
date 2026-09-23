'use strict';
// Contratos que exporta el sistema de cobros ("Cambio de período"): lectura y cálculo del ajuste.
// Los datos de estas pruebas son inventados (mismo formato que el Excel real).
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../src/renderer/calc.js');
const K = require('../src/renderer/contracts.js');

const series = Calc.buildSeries(require('./fixture'));
const HDR = ['CARPETA', 'INICIO CONTRATO', 'FIN CONTRATO', 'INQUILINO', 'DIRECCIÓN', 'LOCALIDAD', 'PERÍODO ACTUAL', 'MONTO PER. ACTUAL', 'INDICE', 'CADA CUÁNTOS MESES'];
const fila = (carpeta, ini, fin, nom, dir, per, monto, idx, cada) => [carpeta, ini, fin, nom, dir, 'Haedo', per, monto, idx, cada];

test('parseFecha / parseMonto / mapIndice con los formatos del sistema', () => {
  assert.equal(K.parseFecha('07/02/2025'), '2025-02-07');
  assert.equal(K.parseFecha('31/02/2025'), null);
  assert.equal(K.parseFecha('2025-02-07'), '2025-02-07');
  assert.equal(K.parseFecha(45700), '2025-02-12'); // número de serie de Excel
  assert.equal(K.parseFecha(''), null);
  assert.equal(K.parseMonto('$ 1.050.000,00'), 1050000);
  assert.equal(K.parseMonto('$ 1,00'), 1);
  assert.equal(K.parseMonto(390000), 390000);
  assert.equal(K.mapIndice('IPC'), 'ipc');
  assert.equal(K.mapIndice('ICL (Banco Central)'), 'icl');
  assert.equal(K.mapIndice('Índice de Precios al Consumidor'), 'ipc');
  assert.equal(K.mapIndice('RIPTE'), null);
  assert.equal(K.mapIndice('CAC'), null);
});

test('leerFilas: encabezados, pie "TOTAL", filas repetidas y posibles duplicados', () => {
  const filas = [
    HDR,
    fila('10', '01/06/2026', '31/05/2028', 'Uno, Ana', 'Calle 1', '1', '$ 500.000,00', 'IPC', '4'),
    fila('11', '01/02/2025', '31/01/2027', 'Dos, Beto', 'Calle 2', '5', '$ 300.000,00', 'IPC', '4'),
    fila('11', '01/02/2025', '31/01/2027', 'Dos, Beto', 'Calle 2', '5', '$ 300.000,00', 'IPC', '4'), // idéntica
    fila('12', '01/06/2026', '31/05/2028', 'Uno, Ana', 'Calle 1 bis', '1', '$ 500.000,00', 'IPC', '4'), // mismo inquilino/fecha/monto
    ['TOTAL DE CONTRATOS:4', '', '', '', '', '', '', '', '', ''],
  ];
  const r = K.leerFilas(filas);
  assert.equal(r.error, undefined);
  assert.equal(r.contratos.length, 3);
  assert.equal(r.repetidas, 1);
  assert.equal(r.totalDeclarado, 4);
  assert.equal(r.leidas, 4);
  assert.equal(r.avisos.length, 1); // solo la fila repetida: el total coincide con las filas leídas
  const c10 = r.contratos.find((c) => c.carpeta === '10');
  assert.match(c10.problemas[0], /carpeta 12/);
  assert.equal(c10.monto, 500000);
  assert.equal(c10.inicio, '2026-06-01');
});

test('leerFilas: avisa si el total del archivo no coincide y rechaza archivos ajenos', () => {
  const r = K.leerFilas([HDR, fila('1', '01/06/2026', '', 'A', 'B', '1', '$ 1.000,00', 'IPC', '4'), ['TOTAL DE CONTRATOS:3']]);
  assert.match(r.avisos[0], /indica 3 contratos y se leyeron 1/);
  assert.ok(K.leerFilas([['a', 'b'], ['1', '2']]).error);
  const sinIndice = K.leerFilas([HDR.filter((h) => h !== 'INDICE'), ['1', '2', '3', '4', '5', '6', '7', '8', '9']]);
  assert.match(sinIndice.error, /INDICE/);
});

test('encabezados con otro orden, mayúsculas o sin tildes también se reconocen', () => {
  const filas = [
    ['Cada cuantos meses', 'indice', 'monto per. actual', 'periodo actual', 'inicio contrato', 'inquilino'],
    ['4', 'IPC', '$ 100.000,00', '1', '01/06/2026', 'X'],
  ];
  const r = K.leerFilas(filas);
  assert.equal(r.contratos.length, 1);
  assert.equal(r.contratos[0].cada, 4);
});

test('el ajuste cae en inicio + período x cada meses y coincide con la calculadora', () => {
  // Contrato del 07/02/2025, período 5, cada 4 meses: el período 5 empezó el 07/06/2026 y el próximo ajuste es el 07/10/2026.
  const filas = [HDR, fila('1', '07/02/2025', '06/02/2027', 'Uno', 'X', '5', '$ 390.000,00', 'IPC', '4')];
  const [r] = K.calcularTodos(K.leerFilas(filas).contratos, series);
  assert.equal(r.ajuste.fechaAnterior, '2026-06-07');
  assert.equal(r.ajuste.fecha, '2026-10-07');
  assert.equal(r.estado, 'estimado'); // el IPC de septiembre todavía no se publicó
  // mismo resultado que encadenar el cálculo completo desde el alquiler inicial
  // (contrato del 07/06/2025, cada 4 meses, en el período 4: ajuste del 07/10/2026)
  const [c2] = K.calcularTodos(K.leerFilas([HDR, fila('9', '07/06/2025', '', 'Z', 'z', '4', '$ 100.000,00', 'IPC', '4')]).contratos, series);
  const full = Calc.calcular({ indice: 'ipc', alquiler: 100000, fechaInicio: '2025-06-07', cadaMeses: 4, hoy: '2027-01-01', series });
  assert.equal(full.rows[4].fecha, '2026-10-07');
  assert.ok(Math.abs(c2.ajuste.factor - full.rows[4].valor / full.rows[3].valor) < 1e-12);
  // a mano: IPC sep-2026 (estimado repitiendo +1,66 %) / IPC may-2026
  const sep = 12276.766 * 1.0166;
  const esperado = Math.round(390000 * (sep / 11607.394));
  assert.equal(r.ajuste.nuevo, esperado);
});

test('ICL (índice diario ya publicado) da un monto oficial', () => {
  // Inicio 16/10/2025, cada 6 meses, período 2: ajuste del 16/10/2026 = ICL(16/10/2026) / ICL(16/04/2026)
  const filas = [HDR, fila('2', '16/10/2025', '15/10/2027', 'Dos', 'Y', '2', '$ 770.000,00', 'ICL (Banco Central)', '6')];
  const [r] = K.calcularTodos(K.leerFilas(filas).contratos, series);
  assert.equal(r.estado, 'oficial');
  assert.equal(r.ajuste.fecha, '2026-10-16');
  assert.equal(r.ajuste.nuevo, Math.round(770000 * (36.88 / 31.49)));
});

test('cuando se publica el índice, el mismo contrato pasa de estimado a oficial', () => {
  const filas = [HDR, fila('1', '01/06/2026', '31/05/2028', 'Uno', 'X', '1', '$ 850.000,00', 'IPC', '4')];
  const cs = K.leerFilas(filas).contratos;
  const [antes] = K.calcularTodos(cs, series);
  assert.equal(antes.estado, 'estimado');
  const conSep = JSON.parse(JSON.stringify(require('./fixture')));
  conSep.ipc.points.push(['2026-09-01', 12480.0]);
  const [despues] = K.calcularTodos(cs, Calc.buildSeries(conSep));
  assert.equal(despues.estado, 'oficial');
  assert.equal(despues.ajuste.nuevo, Math.round(850000 * (12480.0 / 11607.394)));
});

test('casos que no se pueden calcular o que hay que revisar', () => {
  const filas = [
    HDR,
    fila('1', '01/06/2026', '', 'A', 'a', '1', '$ 500.000,00', 'RIPTE', '4'),
    fila('2', '31/13/2026', '', 'B', 'b', '1', '$ 500.000,00', 'IPC', '4'),
    fila('3', '15/01/2025', '', 'C', 'c', '7', '$ 1,00', 'IPC', '3'),
    fila('4', '01/06/2026', '', 'D', 'd', '1', '$ 500.000,00', 'IPC', '0'),
  ];
  const res = K.calcularTodos(K.leerFilas(filas).contratos, series);
  assert.equal(res[0].estado, 'sincalculo');
  assert.match(res[0].error, /RIPTE/);
  assert.equal(res[1].estado, 'sincalculo');
  assert.match(res[1].error, /fecha de inicio/);
  assert.equal(res[2].estado, 'estimado');
  assert.equal(res[2].revisar, true);
  assert.match(res[2].problemas[0], /muy bajo/);
  assert.equal(res[3].estado, 'sincalculo');
  const s = K.resumen(res);
  assert.equal(s.total, 4);
  assert.equal(s.sinCalculo, 3);
  assert.equal(s.revisar, 3); // fila 2 y 4 por datos inválidos, fila 3 por monto
});

test('resumen, orden y CSV para Excel en español', () => {
  const filas = [
    HDR,
    fila('20', '07/02/2025', '', 'Tres; "Cuatro"', 'Calle;1', '5', '$ 390.000,00', 'IPC', '4'),
    fila('5', '01/06/2026', '', '=CMD()', 'Z', '1', '$ 850.000,00', 'IPC', '4'),
  ];
  const res = K.ordenar(K.calcularTodos(K.leerFilas(filas).contratos, series));
  assert.deepEqual(res.map((r) => r.carpeta), ['5', '20']); // primero la fecha más cercana
  const s = K.resumen(res);
  assert.equal(s.total, 2);
  assert.deepEqual(s.fechas, ['2026-10-01', '2026-10-07']);
  assert.equal(s.sumaActual, 1240000);
  const csv = K.aCSV(res);
  assert.ok(csv.startsWith('﻿Carpeta;Inquilino;'));
  const lineas = csv.trim().split('\r\n');
  assert.equal(lineas.length, 3);
  assert.match(lineas[1], /^5;'=CMD\(\);Z;IPC;01\/10\/2026;850000;7,52;/); // la fórmula queda neutralizada
  assert.match(lineas[2], /"Tres; ""Cuatro"""/); // comillas y ";" escapados
});

test('CSV con redondeo: el % de aumento no cambia, y la columna Redondeo aclara el importe real', () => {
  const filas = [HDR, fila('5', '01/06/2026', '', 'Ana', 'Z', '1', '$ 850.000,00', 'IPC', '4')];
  const res = K.calcularTodos(K.leerFilas(filas).contratos, series);
  const aumentoPctOriginal = res[0].ajuste.aumentoPct;
  const montoOriginal = res[0].ajuste.nuevo;
  // Simula lo que hace UI.aplicarRedondeoAAjuste en shared-ui.js: cambia el importe, no el %.
  const redondeado = {
    ...res[0],
    ajuste: { ...res[0].ajuste, nuevo: montoOriginal - 3941, original: montoOriginal, redondeado: 'abajo' },
  };
  assert.equal(redondeado.ajuste.aumentoPct, aumentoPctOriginal); // el % queda intacto
  const csv = K.aCSV([redondeado]);
  const linea = csv.trim().split('\r\n')[1];
  const cols = linea.split(';');
  assert.equal(Number(cols[6].replace(',', '.')), Math.round(aumentoPctOriginal * 100) / 100); // Aumento % (col 6, 0-based) intacto
  assert.equal(cols[7], String(montoOriginal - 3941)); // Nuevo monto = importe redondeado
  assert.match(cols[8], /^Redondeado para abajo: el cálculo exacto daba \$ .+, se cobra \$ .+\.$/);
});
