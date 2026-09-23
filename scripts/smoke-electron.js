'use strict';
// Prueba de humo: arranca la app real de Electron (con un caché de datos de prueba), usa la
// pantalla como lo haría una persona y guarda una captura.
//   xvfb-run -a npx electron scripts/smoke-electron.js --no-sandbox
const { app, BrowserWindow, clipboard, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-smoke-'));
app.setPath('userData', userData);
const fixture = require('../test/fixture');
fs.writeFileSync(
  path.join(userData, 'indices-cache.json'),
  JSON.stringify({ version: 1, updatedAt: '2026-09-21T12:00:00Z', checkedAt: '2026-09-21T12:00:00Z', indices: fixture })
);

require('../src/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(5000); // deja que corra la primera verificación (falla sin red: debe usar los datos guardados)
  const w = BrowserWindow.getAllWindows()[0];
  const js = (code) => w.webContents.executeJavaScript(code);
  console.log('api expuesta:', await js('typeof window.api.getState'));
  console.log('estado:', await js("document.querySelector('#statusText').textContent"));
  await js(`document.querySelector('#monto').value='350000';
            document.querySelector('#fecha').value='2025-06-01';
            document.querySelector('#meses button:nth-child(12)').click();
            document.querySelector('#indices button[data-key=icl]').click();
            document.querySelector('#btnCalc').click();`);
  await wait(300);
  console.log('vigente:', await js("document.querySelector('.big .val').textContent"));
  console.log('próximo:', await js("document.querySelector('.big.next .val').textContent"));
  // botón "Copiar como imagen": debe dejar un PNG en el portapapeles
  clipboard.clear();
  await js("document.querySelector('#btnImage').click()");
  await wait(2500);
  const items = await clipboard.read();
  const types = items.flatMap((i) => i.types);
  console.log('portapapeles tipos:', JSON.stringify(types), '| botón:', await js("document.querySelector('#btnImage').textContent"));
  if (types.includes('image/png')) {
    const blob = await items.find((i) => i.types.includes('image/png')).getType('image/png');
    fs.writeFileSync('/tmp/share-image.png', Buffer.from(await blob.arrayBuffer()));
    console.log('png del portapapeles:', fs.statSync('/tmp/share-image.png').size, 'bytes');
  }
  // plan B (IPC al proceso principal)
  clipboard.clear();
  const ok = await js("(async () => { const b = await ShareImage.render(document.__r || (window.__lastForTest)); return 1; })().catch(e => String(e))");
  await js(`(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const b = await new Promise(r => c.toBlob(r, 'image/png')); await window.api.copyImage(new Uint8Array(await b.arrayBuffer())); })()`);
  await wait(500);
  console.log('plan B tipos:', JSON.stringify((await clipboard.read()).flatMap((i) => i.types).filter((t) => t.startsWith('image'))));
  // pantalla "Contratos del mes": importa un Excel (si se pasa la ruta con XLSX=...) y exporta el CSV
  if (process.env.XLSX) {
    await js("document.querySelector('#tabContratos').click()");
    const dbg = w.webContents.debugger;
    dbg.attach('1.3');
    const { root } = await dbg.sendCommand('DOM.getDocument');
    const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileXlsx' });
    await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: [process.env.XLSX] });
    await wait(1500);
    console.log('contratos importados:', await js("document.querySelectorAll('.crow').length"), '| error:', JSON.stringify(await js("document.querySelector('#cerror').textContent")));
    console.log('resumen:', (await js("[...document.querySelectorAll('.csummary .big')].map(e => e.innerText.replace(/\\n/g, ' / ')).join(' || ')")));
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: '/tmp/ajustes-smoke.csv' });
    await js("document.querySelector('#btnCsv').click()");
    await wait(800);
    console.log('botón exportar:', await js("document.querySelector('#btnCsv').textContent"), '| CSV:', fs.existsSync('/tmp/ajustes-smoke.csv') ? fs.statSync('/tmp/ajustes-smoke.csv').size + ' bytes' : 'NO se creó');
    // "Copiar como imagen" de un contrato individual (para WhatsApp): abre el detalle de la primera
    // fila y verifica que deje un PNG en el portapapeles, igual que en la calculadora.
    await js("document.querySelector('.crow [data-det]').click()");
    await wait(150);
    clipboard.clear();
    await js("document.querySelector('[data-cimg]').click()");
    await wait(1500);
    const cItems = await clipboard.read();
    const cTypes = cItems.flatMap((i) => i.types);
    console.log('imagen de contrato, portapapeles:', JSON.stringify(cTypes), '| botón:', await js("document.querySelector('[data-cimg]').textContent"));
    if (cTypes.includes('image/png')) {
      const blob = await cItems.find((i) => i.types.includes('image/png')).getType('image/png');
      fs.writeFileSync('/tmp/share-image-contrato.png', Buffer.from(await blob.arrayBuffer()));
      console.log('png de contrato:', fs.statSync('/tmp/share-image-contrato.png').size, 'bytes');
    }
    fs.writeFileSync('/tmp/electron-contratos.png', (await w.webContents.capturePage()).toPNG());
  }
  const img = await w.webContents.capturePage();
  fs.writeFileSync('/tmp/electron-smoke.png', img.toPNG());
  console.log('captura guardada; caché en', userData, fs.readdirSync(userData).filter((f) => f.startsWith('indices')));
  app.exit(0);
});
