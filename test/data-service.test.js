'use strict';
// Prueba del servicio de datos con un "servidor" simulado que responde con el mismo
// formato que las APIs reales (BCRA v4, datos.gob.ar y CSV del INDEC).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createService, KEYS } = require('../src/data-service');

function makeFetch({ failHosts = [], log = [], hoy = '2026-09-21' } = {}) {
  return async (url) => {
    const u = new URL(url);
    log.push(url);
    if (failHosts.includes(u.host)) return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    if (u.host === 'api.bcra.gob.ar') {
      // 2.500 días hacia atrás desde 2026-10-16, orden descendente como la API real
      const all = [];
      const base = Date.UTC(2026, 9, 16);
      for (let i = 0; i < 2500; i++) all.push({ fecha: new Date(base - i * 86400000).toISOString().slice(0, 10), valor: 40 - i * 0.001 });
      const desde = u.searchParams.get('desde');
      // Regla real de la API del BCRA: si "desde" es posterior a hoy responde HTTP 400.
      if (desde > hoy) return { ok: false, status: 400, json: async () => ({}), text: async () => '' };
      const filtered = all.filter((x) => x.fecha >= desde);
      const offset = +u.searchParams.get('offset');
      const limit = +u.searchParams.get('limit');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          metadata: { resultset: { count: filtered.length, offset, limit } },
          results: [{ idVariable: 40, detalle: filtered.slice(offset, offset + limit) }],
        }),
      };
    }
    if (u.host === 'apis.datos.gob.ar') {
      return { ok: true, status: 200, json: async () => ({ data: [['2026-07-01', 100], ['2026-08-01', 102], ['2026-06-01', 98], ['2026-05-01', null]], count: 4 }) };
    }
    if (u.host === 'infra.datos.gob.ar') {
      const csv = 'indice_tiempo,indice_salarios,indice_salarios_registrado\n2026-05-01,9177.4,8787.6\n2026-06-01,9442.5,9000.1\n';
      return { ok: true, status: 200, text: async () => csv };
    }
    throw new Error('host inesperado ' + u.host);
  };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'calc-alq-'));

test('descarga todo, pagina el BCRA y guarda el caché', async () => {
  const dir = tmp();
  const log = [];
  const svc = createService({ fetch: makeFetch({ log }), cachePath: path.join(dir, 'cache.json'), seedPath: path.join(dir, 'no-existe.json') });
  svc.load();
  const st = await svc.refresh();
  assert.equal(st.updatedAt, st.checkedAt);
  for (const k of KEYS) assert.equal(st.indices[k].error, null, k);
  const icl = st.indices.icl.points;
  assert.ok(icl.length > 2000, 'ICL paginado completo');
  assert.equal(icl[icl.length - 1][0], '2026-10-16');
  assert.ok(icl[0][0] < icl[1][0], 'ordenado ascendente');
  assert.deepEqual(st.indices.ipc.points, [['2026-06-01', 98], ['2026-07-01', 100], ['2026-08-01', 102]]);
  assert.deepEqual(st.indices.is.points.at(-1), ['2026-06-01', 9442.5]);
  assert.ok(log.some((u) => u.includes('offset=1000')), 'pidió la segunda página');
  assert.ok(fs.existsSync(path.join(dir, 'cache.json')));
});

test('la segunda actualización es incremental y conserva el historial', async () => {
  const dir = tmp();
  const cachePath = path.join(dir, 'cache.json');
  const first = createService({ fetch: makeFetch(), cachePath, seedPath: 'x' });
  first.load();
  await first.refresh();
  const log = [];
  const second = createService({ fetch: makeFetch({ log }), cachePath, seedPath: 'x', now: () => new Date('2026-09-21T12:00:00') });
  const st0 = second.load();
  assert.ok(st0.indices.icl.points.length > 2000, 'cargó el caché al iniciar');
  await second.refresh();
  const bcraCalls = log.filter((u) => u.includes('api.bcra.gob.ar') && u.includes('/40?'));
  assert.equal(bcraCalls.length, 1, 'una sola página (pocos días nuevos), sin errores 400');
  assert.match(bcraCalls[0], /desde=2026-08-22/, 'pide desde hoy-30 días (el último dato guardado es una fecha futura)');
  assert.ok(second.getState().indices.icl.points.length > 2000);
});

test('si falla una fuente, se conservan los datos guardados y se informa el error', async () => {
  const dir = tmp();
  const cachePath = path.join(dir, 'cache.json');
  const ok = createService({ fetch: makeFetch(), cachePath, seedPath: 'x' });
  ok.load();
  await ok.refresh();
  const svc = createService({ fetch: makeFetch({ failHosts: ['api.bcra.gob.ar'] }), cachePath, seedPath: 'x' });
  svc.load();
  const originalUpdated = svc.getState().updatedAt;
  const st = await svc.refresh();
  assert.match(st.indices.icl.error, /HTTP 503/);
  assert.ok(st.indices.icl.points.length > 2000, 'datos viejos intactos');
  assert.equal(st.indices.ipc.error, null);
  assert.equal(st.updatedAt, originalUpdated, 'no marca "actualizado" si no fue completo');
  assert.ok(st.checkedAt >= originalUpdated);
});

test('sin conexión ni caché ni snapshot: arranca vacío sin romper', async () => {
  const dir = tmp();
  const svc = createService({ fetch: async () => { throw new Error('offline'); }, cachePath: path.join(dir, 'c.json'), seedPath: 'x' });
  const st = svc.load();
  assert.equal(st.indices.icl.points.length, 0);
});
