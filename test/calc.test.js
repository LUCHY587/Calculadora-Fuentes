'use strict';
// Pruebas: comparan el cálculo con los resultados que dio arquiler.com el 21/09/2026
// (mismos datos de entrada, alquiler inicial $100.000).
const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../src/renderer/calc.js');

const HOY = '2026-09-21';

const fixture = require('./fixture');
const series = Calc.buildSeries(fixture);

function run(indice, fechaInicio, cadaMeses) {
  return Calc.calcular({ indice, alquiler: 100000, fechaInicio, cadaMeses, hoy: HOY, series });
}
function assertRows(r, esperado, tolPct) {
  assert.equal(r.rows.length, esperado.length, 'cantidad de períodos');
  esperado.forEach((e, i) => {
    const got = r.rows[i].valor;
    const err = (Math.abs(got - e.valor) / e.valor) * 100;
    assert.ok(err <= tolPct, `período ${i + 1}: esperado ${e.valor}, obtenido ${got.toFixed(1)} (error ${err.toFixed(4)} %)`);
    assert.equal(r.rows[i].estimado, !!e.est, `período ${i + 1}: flag estimado`);
  });
}

test('ICL, contrato 01/06/2026, cada 12 meses (valor aproximado)', () => {
  const r = run('icl', '2026-06-01', 12);
  assertRows(r, [{ valor: 100000 }, { valor: 131339, est: true }], 0.001);
  assert.equal(r.rows[0].indice, 33.27);
});

test('ICL, contrato 01/06/2025, cada 12 meses', () => {
  const r = run('icl', '2025-06-01', 12);
  assertRows(r, [{ valor: 100000 }, { valor: 132024 }, { valor: 173399, est: true }], 0.001);
  assert.equal(Calc.fmtMoney(r.vigente.valor), '$ 132.024');
  assert.equal(r.proximo.fecha, '2027-06-01');
});

test('ICL, contrato 01/06/2025, cada 6 meses', () => {
  const r = run('icl', '2025-06-01', 6);
  assertRows(r, [{ valor: 100000 }, { valor: 114167 }, { valor: 132024 }, { valor: 154622, est: true }], 0.001);
});

test('CER, cada 6 meses', () => {
  const r = run('cer', '2025-06-01', 6);
  assertRows(r, [{ valor: 100000 }, { valor: 112051 }, { valor: 132498 }, { valor: 151853, est: true }], 0.02);
});

test('IPC, cada 12 meses (acumula junio-2025 a mayo-2026)', () => {
  const r = run('ipc', '2025-06-01', 12);
  assertRows(r, [{ valor: 100000 }, { valor: 133197 }, { valor: 163378, est: true }], 0.03);
  const meses = r.rows[1].detalle.meses;
  assert.equal(meses.length, 12);
  assert.equal(meses[0].mes, '2025-06-01');
  assert.equal(meses[11].mes, '2026-05-01');
  assert.ok(meses.slice(0, 12).every((m) => !m.repetido));
  // el último período repite la variación de agosto (1,66 %) desde septiembre
  const m3 = r.rows[2].detalle.meses;
  assert.equal(m3.filter((m) => m.repetido).length, 9);
});

test('IPIM, cada 6 meses (repite la última variación mensual: 2,14 %)', () => {
  const r = run('ipim', '2025-06-01', 6);
  assertRows(r, [{ valor: 100000 }, { valor: 114768 }, { valor: 134454 }, { valor: 149103, est: true }], 0.03);
});

test('IS, cada 6 meses (repite 2,89 %)', () => {
  const r = run('is', '2025-06-01', 6);
  assertRows(r, [{ valor: 100000 }, { valor: 116105 }, { valor: 135856 }, { valor: 161181, est: true }], 0.03);
});

test('fechas: fin de mes no se desplaza', () => {
  assert.equal(Calc.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(Calc.addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(Calc.addMonths('2026-03-15', -6), '2025-09-15');
  assert.equal(Calc.addMonths('2024-02-29', 12), '2025-02-28');
});

test('validaciones y mensajes', () => {
  assert.throws(() => Calc.calcular({ indice: 'icl', alquiler: 0, fechaInicio: '2025-06-01', cadaMeses: 12, hoy: HOY, series }), /valor inicial/);
  assert.throws(() => Calc.calcular({ indice: 'icl', alquiler: 1, fechaInicio: '', cadaMeses: 12, hoy: HOY, series }), /fecha de inicio/);
  assert.throws(() => Calc.calcular({ indice: 'uva', alquiler: 1, fechaInicio: '2025-06-01', cadaMeses: 12, hoy: HOY, series }), /Todavía no hay datos/);
  assert.throws(() => run('icl', '2019-01-01', 12), /no tiene datos/);
});

test('parseMonto entiende formato argentino', () => {
  assert.equal(Calc.parseMonto('1.250.000'), 1250000);
  assert.equal(Calc.parseMonto('$ 350.000'), 350000);
  assert.equal(Calc.parseMonto('1.250.000,50'), 1250000.5);
  assert.equal(Calc.parseMonto('350000'), 350000);
  assert.ok(Number.isNaN(Calc.parseMonto('')));
});

test('resumen para copiar/pegar', () => {
  const t = Calc.resumenTexto(run('icl', '2025-06-01', 12));
  assert.match(t, /Alquiler vigente desde el 01\/06\/2026: \$ 132\.024/);
  assert.match(t, /Próximo ajuste el 01\/06\/2027: \$ 173\.399/);
  assert.match(t, /ESTIMADO/);
});

test('redondear: al múltiplo de $5.000 más cercano, para arriba y para abajo', () => {
  assert.equal(Calc.redondear(913941, 'arriba'), 915000);
  assert.equal(Calc.redondear(913941, 'abajo'), 910000);
  assert.equal(Calc.redondear(915000, 'arriba'), 915000); // ya es múltiplo: no cambia
  assert.equal(Calc.redondear(915000, 'abajo'), 915000);
  assert.equal(Calc.redondear(913941, 'exacto'), 913941); // cualquier modo que no sea arriba/abajo: sin cambios
  assert.equal(Calc.redondear(1, 'arriba'), 5000);
  assert.equal(Calc.redondear(1, 'abajo'), 0);
  assert.equal(Calc.PASO_REDONDEO, 5000);
});
