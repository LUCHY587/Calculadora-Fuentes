'use strict';
/**
 * Servicio de datos: descarga los índices desde fuentes oficiales, los guarda en
 * un caché local y los mantiene actualizados.
 *
 *  - BCRA  (API Estadísticas v4): ICL, CER, UVA  -> series diarias
 *  - INDEC (vía datos.gob.ar)   : IPC, IPIM, IS   -> series mensuales
 *
 * No depende de Electron: recibe la función `fetch` por parámetro, así se puede
 * probar desde Node y en la app se usa `net.fetch` de Electron (que usa los
 * certificados de Windows).
 */
const fs = require('fs');
const path = require('path');

const BCRA_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias';
const DATOS_SERIES = 'https://apis.datos.gob.ar/series/api/series';
const HISTORY_FROM = '2020-01-01';

const SOURCES = {
  icl: { kind: 'bcra', id: 40, nombre: 'ICL' },
  cer: { kind: 'bcra', id: 30, nombre: 'CER' },
  uva: { kind: 'bcra', id: 31, nombre: 'UVA' },
  ipc: { kind: 'datos', id: '148.3_INIVELNAL_DICI_M_26', nombre: 'IPC' },
  ipim: { kind: 'datos', id: '448.1_NIVEL_GENERAL_0_0_13_46', nombre: 'IPIM' },
  is: {
    kind: 'csv',
    url: 'https://infra.datos.gob.ar/catalog/sspm/dataset/149/distribution/149.1/download/indice-salarios-periodicidad-mensual-base-octubre-2016.csv',
    column: 'indice_salarios',
    nombre: 'IS',
  },
};

const KEYS = Object.keys(SOURCES);

// ---------------------------------------------------------------- utilidades

function todayISO(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function shiftDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET con timeout y hasta 3 intentos (los servicios públicos a veces responden lento o con 5xx).
async function request(fetchFn, url, { timeoutMs = 45000, attempts = 3, retryDelayMs = 1500 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { signal: ctrl.signal, headers: { Accept: 'application/json, text/csv;q=0.9' } });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} en ${new URL(url).host}`);
      if (res.status < 500 && res.status !== 429) throw lastErr; // error del pedido: no tiene sentido reintentar
    } catch (e) {
      lastErr = e && e.name === 'AbortError' ? new Error(`Tiempo de espera agotado en ${new URL(url).host}`) : e;
      if (lastErr.message.startsWith('HTTP 4') && !lastErr.message.startsWith('HTTP 429')) throw lastErr;
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts) await sleep(retryDelayMs * i);
  }
  throw lastErr;
}

function cleanPoints(points) {
  const map = new Map();
  for (const [d, v] of points) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(v) && v > 0) {
      map.set(d.slice(0, 10), v);
    }
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ---------------------------------------------------------------- descargas

async function fetchBcra(fetchFn, id, desde) {
  const out = [];
  const limit = 1000;
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const url = `${BCRA_BASE}/${id}?desde=${desde}&limit=${limit}&offset=${offset}`;
    const json = await (await request(fetchFn, url)).json();
    const detalle = json && json.results && json.results[0] && json.results[0].detalle;
    if (!Array.isArray(detalle) || detalle.length === 0) break;
    for (const it of detalle) out.push([String(it.fecha).slice(0, 10), Number(it.valor)]);
    offset += detalle.length;
    const count = json.metadata && json.metadata.resultset && json.metadata.resultset.count;
    if (typeof count === 'number' && offset >= count) break;
  }
  return out;
}

async function fetchDatos(fetchFn, id) {
  const url = `${DATOS_SERIES}?ids=${encodeURIComponent(id)}&start_date=${HISTORY_FROM}&limit=1000&format=json`;
  const json = await (await request(fetchFn, url)).json();
  if (!json || !Array.isArray(json.data)) throw new Error('Respuesta inesperada de datos.gob.ar');
  return json.data.map((row) => [String(row[0]), Number(row[1])]);
}

async function fetchCsv(fetchFn, src) {
  const text = await (await request(fetchFn, src.url)).text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map((s) => s.trim());
  const iDate = header.indexOf('indice_tiempo');
  const iVal = header.indexOf(src.column);
  if (iDate < 0 || iVal < 0) throw new Error('El CSV del INDEC cambió de formato');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    return [c[iDate], Number(c[iVal])];
  });
}

async function fetchIndex(fetchFn, key, existingPoints, hoy = todayISO()) {
  const src = SOURCES[key];
  if (src.kind === 'bcra') {
    // Incremental: sólo pedimos desde unos días antes del último dato guardado.
    // OJO: el BCRA publica ICL/CER/UVA con ~25 días de anticipación, así que el último dato guardado puede
    // ser una fecha FUTURA, y la API responde HTTP 400 si "desde" es posterior a hoy. Por eso "desde"
    // nunca puede pasar de hoy - 30 días.
    const last = existingPoints && existingPoints.length ? existingPoints[existingPoints.length - 1][0] : null;
    let desde = last ? shiftDays(last, -20) : HISTORY_FROM;
    const tope = shiftDays(hoy, -30);
    if (desde > tope) desde = tope;
    let nuevos;
    try {
      nuevos = await fetchBcra(fetchFn, src.id, desde);
    } catch (e) {
      // Si igual la API rechaza el pedido incremental, reintenta bajando todo el historial.
      if (desde !== HISTORY_FROM && /HTTP 400/.test(e.message)) nuevos = await fetchBcra(fetchFn, src.id, HISTORY_FROM);
      else throw e;
    }
    return cleanPoints([...(existingPoints || []), ...nuevos]);
  }
  const rows = src.kind === 'datos' ? await fetchDatos(fetchFn, src.id) : await fetchCsv(fetchFn, src);
  return cleanPoints(rows);
}

// ---------------------------------------------------------------- servicio

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function lastDate(entry) {
  return entry && entry.points && entry.points.length ? entry.points[entry.points.length - 1][0] : '';
}

function createService({ fetch: fetchFn, cachePath, seedPath, now = () => new Date() }) {
  let state = null;
  let running = null;
  const listeners = new Set();

  function load() {
    const seed = readJSON(seedPath) || { indices: {} };
    const cache = readJSON(cachePath);
    const indices = {};
    let usedSeed = false;
    for (const key of KEYS) {
      const s = seed.indices && seed.indices[key];
      const c = cache && cache.indices && cache.indices[key];
      // Nos quedamos con la fuente que tenga el dato más reciente (p. ej. tras instalar una versión nueva).
      let chosen = c;
      if (!c || lastDate(s) > lastDate(c)) chosen = s;
      if (chosen === s && s) usedSeed = true;
      indices[key] = { points: (chosen && chosen.points) || [], error: null };
    }
    state = {
      indices,
      updatedAt: (cache && cache.updatedAt) || null, // última actualización exitosa completa
      checkedAt: (cache && cache.checkedAt) || null, // último intento de verificación
      seedGeneratedAt: seed.generatedAt || null,
      usedSeed: !cache && usedSeed,
      refreshing: false,
    };
    return state;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      const payload = {
        version: 1,
        updatedAt: state.updatedAt,
        checkedAt: state.checkedAt,
        indices: Object.fromEntries(KEYS.map((k) => [k, { points: state.indices[k].points }])),
      };
      const tmp = cachePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, cachePath);
    } catch (e) {
      /* el caché es opcional: si falla la escritura la app sigue funcionando */
    }
  }

  function emit() {
    for (const cb of listeners) {
      try {
        cb(state);
      } catch (_) {}
    }
  }

  async function refresh() {
    if (running) return running;
    if (!state) load();
    running = (async () => {
      state.refreshing = true;
      emit();
      let okCount = 0;
      const results = await Promise.all(
        KEYS.map(async (key) => {
          try {
            const points = await fetchIndex(fetchFn, key, state.indices[key].points, todayISO(now()));
            if (!points.length) throw new Error('La fuente no devolvió datos');
            return { key, points };
          } catch (e) {
            return { key, error: e && e.message ? e.message : String(e) };
          }
        })
      );
      for (const r of results) {
        if (r.points) {
          state.indices[r.key] = { points: r.points, error: null };
          okCount++;
        } else {
          state.indices[r.key].error = r.error;
        }
      }
      state.checkedAt = now().toISOString();
      if (okCount === KEYS.length) {
        state.updatedAt = state.checkedAt;
        state.usedSeed = false;
      }
      state.refreshing = false;
      save();
      emit();
      return state;
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    load,
    refresh,
    getState: () => state || load(),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

module.exports = { createService, fetchIndex, SOURCES, KEYS, todayISO };
