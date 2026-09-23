# Calculadora de Alquileres — Inmobiliaria M.M. Fuentes

App de escritorio (Electron) para calcular la actualización de alquileres con ICL, IPC, CER, IS, IPIM y UVA.
Los índices se descargan solos de las fuentes oficiales (BCRA e INDEC vía datos.gob.ar), se guardan en la PC y se
verifican al abrir la app, cada 2 horas y al volver a la ventana. Si no hay internet, usa los últimos datos guardados.

## Desarrollo

```
npm install
npm test          # pruebas de cálculo (comparadas con arquiler.com) y del servicio de datos
npm start         # abre la app
```

## Generar el instalador de Windows

`npm run dist` (usa electron-builder; funciona igual en Windows o desde Linux/Mac). Genera en `dist/`:
- `Calculadora-de-Alquileres-Instalador-X.X.X.exe` — instalador normal, para una PC nueva.
- `latest.yml` + `*.nsis.7z.blockmap` — lo que necesita el auto-updater para detectar y bajar la versión nueva. **Sin estos dos archivos junto al `.exe`, ninguna PC va a detectar la actualización.**

### Publicar una versión nueva (para que el auto-update la encuentre)

La app busca sola actualizaciones en un repositorio de GitHub (`build.publish` en `package.json`). Para publicar la versión X.X.X:
1. Subí el número de versión en `package.json` (`"version"`).
2. `npm run dist`.
3. En GitHub, creá un **Release** nuevo con el tag `vX.X.X` (por ejemplo `v1.4.0`) en el repositorio configurado, y subí como adjuntos los 3 archivos de `dist/`: el `.exe` del instalador, el `.yml` y el `.blockmap`. No hace falta ningún otro paso — apenas el Release queda publicado, todas las PCs con la app abierta lo detectan solas (chequean cada 4 horas y al abrir) y la instalan al cerrar la app, sin avisos ni clics.

`build/instalador-completo.nsi` + `build/actualizar.nsi` son los scripts NSIS a medida de versiones anteriores (armaban un instalador partido en 4 partes para mandarlo por chat, y un actualizador liviano manual). Con el auto-update ya no hace falta usarlos para las actualizaciones del día a día — quedan solo como respaldo manual, o para armar el instalador completo de una PC nueva sin pasar por GitHub. **No renombrar ninguno de los dos a `build/installer.nsi` o `build/installer.nsh`**: son los nombres que electron-builder usa por convención para su propio script del target `nsis`, y lo pisarían.

## Cómo está armado

- `src/renderer/calc.js` — reglas de cálculo (diarios: ICL/CER/UVA; mensuales: IPC/IS/IPIM; estimaciones).
- `src/renderer/contracts.js` + `xlsx-reader.js` + `contratos-ui.js` — pestaña «Contratos del mes»: lee el Excel «Cambio de período» del sistema de cobros (Arcomercial), calcula el próximo ajuste de cada contrato y permite exportar/imprimir/copiar como imagen. Los datos importados quedan solo en la PC.
- `src/data-service.js` — descarga, caché e incremental de los índices.
- `src/main.js` — ventana, actualización automática (electron-updater, vía GitHub Releases), seguridad (aislamiento de contexto, CSP).
- Casa Propia y CAC no están incluidos: no tienen una fuente abierta consultable por la app.
