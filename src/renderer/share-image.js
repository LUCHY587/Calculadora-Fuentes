/**
 * Genera una imagen (PNG) con el resultado del cálculo, lista para pegar en WhatsApp.
 * Se dibuja en un <canvas>, así el tamaño y el diseño no dependen de cómo esté la ventana.
 */
(function () {
  'use strict';
  const C = window.Calc;
  const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
  const COL = {
    burdeos: '#7a1f2e', osc: '#5a1522', claro: '#f8eff0', claroBorde: '#e9d5d9', borde: '#e6dcdf',
    linea: '#f0e8ea', texto: '#2a2224', muted: '#6b6064', warn: '#a86400', warnBg: '#fff6e5',
  };

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function wrap(ctx, text, maxW) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function pill(ctx, text, xRight, yMid) {
    ctx.font = `700 11px ${FONT}`;
    const w = ctx.measureText(text).width + 16;
    rr(ctx, xRight - w, yMid - 10, w, 20, 10);
    ctx.fillStyle = COL.warnBg;
    ctx.fill();
    ctx.fillStyle = COL.warn;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, xRight - w / 2, yMid + 0.5);
    return w;
  }

  function fechaHoy() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  /** @returns {Promise<Blob>} PNG */
  async function render(r) {
    const W = 760;
    const PAD = 32;
    const SCALE = 2;
    const e = r.entrada;
    const rows = r.rows;
    const logo = await loadImage(window.LOGO_DATA);

    // ---- textos y medidas previas
    const scratch = document.createElement('canvas').getContext('2d');
    scratch.font = `13px ${FONT}`;
    const notas = [];
    const ultimo = r.info.tipo === 'diario' ? C.fmtFecha(r.ultimoDato) : C.cap(C.fmtMes(r.ultimoDato));
    notas.push(`Fuente: ${r.info.fuente} · ${r.info.largo}. Último dato publicado: ${ultimo}.`);
    if (r.hayEstimado) notas.push('Los valores marcados como estimados se recalculan cuando se publica el índice oficial.');
    const notaLines = notas.flatMap((n) => wrap(scratch, n, W - PAD * 2));
    const proxRedondeado = r.proximo && r.proximo.redondeado;

    const headerH = 96;
    const boxesH = proxRedondeado ? 118 + 22 : 118;
    const tableHeadH = 38;
    const rowH = 44;
    const rowHRedondeado = rowH + 18;
    const rowsH = rows.reduce((s, row) => s + (row.redondeado ? rowHRedondeado : rowH), 0);
    const H = headerH + 22 + 24 + 16 + boxesH + 22 + tableHeadH + rowsH + 18 + notaLines.length * 19 + 26 + 22;

    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // ---- fondo
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // ---- cabecera bordó
    const g = ctx.createLinearGradient(0, 0, W, headerH);
    g.addColorStop(0, COL.osc);
    g.addColorStop(1, COL.burdeos);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, headerH);
    // logo en recuadro blanco
    rr(ctx, PAD, 18, 72, 60, 13);
    ctx.fillStyle = '#fff';
    ctx.fill();
    if (logo) {
      const lw = 56;
      const lh = (lw * logo.height) / logo.width;
      ctx.drawImage(logo, PAD + (72 - lw) / 2, 18 + (60 - lh) / 2, lw, lh);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = `700 24px ${FONT}`;
    ctx.fillText('Actualización de alquiler', PAD + 72 + 16, 50);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.fillText('Inmobiliaria M.M. Fuentes', PAD + 72 + 16, 72);
    ctx.textAlign = 'right';
    ctx.font = `12.5px ${FONT}`;
    ctx.fillText(`Calculado el ${fechaHoy()}`, W - PAD, 72);

    // ---- datos del contrato
    let y = headerH + 22;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const datos = [
      ['Índice', r.info.nombre],
      ['Alquiler inicial', C.fmtMoney(e.alquiler)],
      ['Inicio', C.fmtFecha(e.fechaInicio)],
      ['Actualiza cada', `${e.cadaMeses} ${e.cadaMeses === 1 ? 'mes' : 'meses'}`],
    ];
    let x = PAD;
    for (const [k, v] of datos) {
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = COL.muted;
      ctx.fillText(k + ':', x, y + 12);
      x += ctx.measureText(k + ':').width + 6;
      ctx.font = `600 13px ${FONT}`;
      ctx.fillStyle = COL.texto;
      ctx.fillText(v, x, y + 12);
      x += ctx.measureText(v).width + 20;
    }
    y += 24 + 16;

    // ---- cuadros: vigente / próximo
    const bw = (W - PAD * 2 - 16) / 2;
    const box = (bx, fill, border, label, value, sub, estimado, nota) => {
      rr(ctx, bx, y, bw, boxesH, 12);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COL.muted;
      ctx.font = `700 11.5px ${FONT}`;
      ctx.fillText(label.toUpperCase(), bx + 18, y + 30);
      ctx.fillStyle = COL.burdeos;
      ctx.font = `700 32px ${FONT}`;
      ctx.fillText(value, bx + 18, y + 72);
      ctx.fillStyle = COL.muted;
      ctx.font = `13px ${FONT}`;
      ctx.fillText(sub, bx + 18, y + 98);
      if (nota) {
        ctx.fillStyle = COL.warn;
        ctx.font = `600 12px ${FONT}`;
        ctx.fillText(nota, bx + 18, y + 98 + 20);
      }
      if (estimado) {
        ctx.textBaseline = 'middle';
        pill(ctx, 'ESTIMADO', bx + bw - 14, y + 26);
      }
    };
    const vig = r.vigente;
    const prox = r.proximo;
    const hasta = prox ? C.cap(C.fmtMes(C.addMonths(prox.fecha, -1))) : '';
    box(
      PAD, '#fff', COL.borde, 'Alquiler vigente hoy',
      vig ? C.fmtMoney(vig.valor) : '—',
      vig ? `desde el ${C.fmtFecha(vig.fecha)}${prox ? ' hasta ' + hasta : ''}` : `El contrato empieza el ${C.fmtFecha(e.fechaInicio)}`,
      false
    );
    if (prox) {
      const nota = prox.redondeado
        ? `Redondeado ${prox.redondeado === 'arriba' ? 'arriba' : 'abajo'} · antes ${C.fmtMoney(prox.original)}`
        : '';
      box(
        PAD + bw + 16, COL.claro, COL.claroBorde, `Próximo ajuste · ${C.fmtFecha(prox.fecha)}`,
        C.fmtMoney(prox.valor), prox.n === 1 ? '' : `${C.fmtPct(prox.aumentoPct)} de aumento`, prox.estimado, nota
      );
    }
    y += boxesH + 22;

    // ---- tabla
    const colPeriodo = PAD + 16;
    const colFecha = PAD + 190;
    const colAumento = W - PAD - 190;
    const colValor = W - PAD - 16;
    ctx.textBaseline = 'middle';
    ctx.font = `700 11.5px ${FONT}`;
    ctx.fillStyle = COL.muted;
    ctx.textAlign = 'left';
    ctx.fillText('PERÍODO', colPeriodo, y + tableHeadH / 2);
    ctx.fillText('ACTUALIZACIÓN', colFecha, y + tableHeadH / 2);
    ctx.textAlign = 'right';
    ctx.fillText('AUMENTO', colAumento, y + tableHeadH / 2);
    ctx.fillText('ALQUILER', colValor, y + tableHeadH / 2);
    y += tableHeadH;
    ctx.fillStyle = COL.borde;
    ctx.fillRect(PAD, y - 1, W - PAD * 2, 1.5);

    for (const row of rows) {
      const cur = vig && row === vig;
      const hRow = row.redondeado ? rowHRedondeado : rowH;
      if (cur) {
        ctx.fillStyle = COL.claro;
        ctx.fillRect(PAD, y, W - PAD * 2, hRow);
        ctx.fillStyle = COL.burdeos;
        ctx.fillRect(PAD, y, 4, hRow);
      }
      const ym = y + rowH / 2;
      const w = cur ? 700 : 400;
      ctx.fillStyle = COL.texto;
      ctx.font = `${w} 15px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(C.etiquetaPeriodo(row.n, e.cadaMeses), colPeriodo, ym);
      ctx.fillText(C.fmtFecha(row.fecha), colFecha, ym);
      ctx.textAlign = 'right';
      const aum = row.n === 1 ? '—' : C.fmtPct(row.aumentoPct);
      ctx.fillText(aum, colAumento, ym);
      if (row.estimado) {
        const tw = ctx.measureText(aum).width;
        pill(ctx, 'ESTIMADO', colAumento - tw - 10, ym);
        ctx.textBaseline = 'middle';
      }
      ctx.fillStyle = COL.texto;
      ctx.font = `${cur ? 700 : 600} 15px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(C.fmtMoney(row.valor), colValor, ym);
      if (row.redondeado) {
        ctx.fillStyle = COL.warn;
        ctx.font = `600 11.5px ${FONT}`;
        ctx.fillText(`Redondeado ${row.redondeado === 'arriba' ? 'arriba' : 'abajo'} · antes ${C.fmtMoney(row.original)}`, colValor, ym + 20);
      }
      y += hRow;
      ctx.fillStyle = COL.linea;
      ctx.fillRect(PAD, y - 1, W - PAD * 2, 1);
    }

    // ---- notas al pie
    y += 18;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = COL.muted;
    for (const l of notaLines) {
      ctx.fillText(l, PAD, y + 13);
      y += 19;
    }

    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'));
  }

  /**
   * Imagen (PNG) del ajuste de UN contrato de "Contratos del mes" — lista para pegar en WhatsApp.
   * A diferencia de `render`, no arma toda la progresión: sólo el importe actual y el próximo ajuste
   * (que es lo único que se conoce con los datos que trae el Excel).
   * @param {object} r  fila de "Contratos del mes" (con `r.ajuste` ya calculado)
   * @returns {Promise<Blob>} PNG
   */
  async function renderContrato(r) {
    const a = r.ajuste;
    if (!a) throw new Error('Este contrato todavía no tiene un ajuste calculado.');
    const W = 680;
    const PAD = 28;
    const SCALE = 2;
    const logo = await loadImage(window.LOGO_DATA);

    const scratch = document.createElement('canvas').getContext('2d');
    scratch.font = `13px ${FONT}`;
    const nombre = r.inquilino || 'Inquilino';
    const direccionLines = r.direccion ? wrap(scratch, r.direccion, W - PAD * 2) : [];
    const notas = [];
    const ultimo = a.info.tipo === 'diario' ? C.fmtFecha(a.ultimoDato) : C.cap(C.fmtMes(a.ultimoDato));
    notas.push(`Fuente: ${a.info.fuente} · ${a.info.largo}. Último dato publicado: ${ultimo}.`);
    if (a.estimado) notas.push('Este valor es estimado: todavía no se publicó el índice del mes que falta. Se recalcula solo cuando salga el dato oficial.');
    const notaLines = notas.flatMap((n) => wrap(scratch, n, W - PAD * 2));

    const headerH = 90;
    const infoH = 26 + direccionLines.length * 19;
    const boxesH = a.redondeado ? 112 + 22 : 112;
    const H = headerH + 20 + infoH + 16 + boxesH + 22 + notaLines.length * 19 + 22 + 20;

    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    // ---- fondo
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);

    // ---- cabecera bordó
    const g = ctx.createLinearGradient(0, 0, W, headerH);
    g.addColorStop(0, COL.osc);
    g.addColorStop(1, COL.burdeos);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, headerH);
    rr(ctx, PAD, 16, 64, 56, 12);
    ctx.fillStyle = '#fff';
    ctx.fill();
    if (logo) {
      const lw = 48;
      const lh = (lw * logo.height) / logo.width;
      ctx.drawImage(logo, PAD + (64 - lw) / 2, 16 + (56 - lh) / 2, lw, lh);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.font = `700 21px ${FONT}`;
    ctx.fillText('Actualización de alquiler', PAD + 64 + 14, 42);
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.82)';
    ctx.fillText('Inmobiliaria M.M. Fuentes', PAD + 64 + 14, 62);
    ctx.textAlign = 'right';
    ctx.font = `12px ${FONT}`;
    ctx.fillText(`Calculado el ${fechaHoy()}`, W - PAD, 62);

    // ---- inquilino / dirección / índice
    let y = headerH + 20;
    ctx.textAlign = 'left';
    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = COL.texto;
    ctx.fillText(nombre, PAD, y + 14);
    y += 22;
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = COL.muted;
    for (const l of direccionLines) {
      ctx.fillText(l, PAD, y + 12);
      y += 19;
    }
    y += 4;
    ctx.font = `12.5px ${FONT}`;
    ctx.fillText(`Índice: ${a.info.nombre} · Se actualiza cada ${r.cada} ${r.cada === 1 ? 'mes' : 'meses'}`, PAD, y + 10);
    y += 26 + 16;

    // ---- cuadros: monto actual / nuevo importe
    const bw = (W - PAD * 2 - 16) / 2;
    const box = (bx, fill, border, label, value, sub, estimado, nota) => {
      rr(ctx, bx, y, bw, boxesH, 12);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = COL.muted;
      ctx.font = `700 11px ${FONT}`;
      ctx.fillText(label.toUpperCase(), bx + 16, y + 28);
      ctx.fillStyle = COL.burdeos;
      ctx.font = `700 28px ${FONT}`;
      ctx.fillText(value, bx + 16, y + 66);
      ctx.fillStyle = COL.muted;
      ctx.font = `12.5px ${FONT}`;
      ctx.fillText(sub, bx + 16, y + 92);
      if (nota) {
        ctx.fillStyle = COL.warn;
        ctx.font = `600 11.5px ${FONT}`;
        ctx.fillText(nota, bx + 16, y + 92 + 19);
      }
      if (estimado) {
        ctx.textBaseline = 'middle';
        pill(ctx, 'ESTIMADO', bx + bw - 12, y + 24);
      }
    };
    box(PAD, '#fff', COL.borde, 'Alquiler actual', C.fmtMoney(r.monto), `desde el ${C.fmtFecha(a.fechaAnterior)}`, false);
    const notaRedondeo = a.redondeado ? `Redondeado ${a.redondeado === 'arriba' ? 'arriba' : 'abajo'} · antes ${C.fmtMoney(a.original)}` : '';
    box(
      PAD + bw + 16, COL.claro, COL.claroBorde, `Próximo ajuste · ${C.fmtFecha(a.fecha)}`,
      C.fmtMoney(a.nuevo), `${C.fmtPct(a.aumentoPct)} de aumento`, a.estimado, notaRedondeo
    );
    y += boxesH + 22;

    // ---- notas al pie
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `12.5px ${FONT}`;
    ctx.fillStyle = COL.muted;
    for (const l of notaLines) {
      ctx.fillText(l, PAD, y + 12);
      y += 19;
    }

    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/png'));
  }

  window.ShareImage = { render, renderContrato };
})();
