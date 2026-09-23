'use strict';
// Descarga los índices desde las fuentes oficiales y guarda data/seed.json
// (snapshot inicial que se incluye dentro de la app).
const fs = require('fs');
const path = require('path');
const { fetchIndex, KEYS } = require('../src/data-service');

(async () => {
  const indices = {};
  for (const key of KEYS) {
    const points = await fetchIndex(fetch, key, []);
    indices[key] = { points };
    const last = points[points.length - 1];
    console.log(key.padEnd(5), String(points.length).padStart(5), 'puntos  desde', points[0][0], ' último', last[0], last[1]);
  }
  const out = path.join(__dirname, '..', 'data', 'seed.json');
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), indices }));
  console.log('OK ->', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
})().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
