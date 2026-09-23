"""Prueba visual de la pantalla en Chromium (sin Electron), con datos SIMULADOS.
Uso: python3 scripts/ui-check.py  -> guarda capturas en /tmp/ui-*.png
"""
import json, math, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

# Series simuladas (solo para ver la pantalla): interpolación log-lineal entre puntos ancla.
def daily(anchors):
    pts = sorted((date.fromisoformat(d), v) for d, v in anchors)
    out = []
    for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
        n = (d1 - d0).days
        for i in range(n):
            out.append([(d0 + timedelta(i)).isoformat(), v0 * (v1 / v0) ** (i / n)])
    out.append([pts[-1][0].isoformat(), pts[-1][1]])
    return out

def monthly(start, vals):
    y, m = map(int, start.split('-'))
    out = []
    for v in vals:
        out.append([f"{y}-{m:02d}-01", v]); m += 1
        if m == 13: y, m = y + 1, 1
    return out

state = {
  "indices": {
    "icl": {"points": daily([("2020-06-30", 1.0), ("2024-06-01", 12.0), ("2025-06-01", 25.2), ("2025-10-16", 28.08), ("2025-12-01", 28.77), ("2026-04-16", 31.49), ("2026-06-01", 33.27), ("2026-10-16", 36.88)])},
    "cer": {"points": daily([("2020-01-01", 40.0), ("2025-06-01", 590.07), ("2025-12-01", 661.18), ("2026-04-15", 745.55), ("2026-06-01", 781.83), ("2026-10-15", 854.46)])},
    "uva": {"points": daily([("2020-01-01", 50.0), ("2026-09-21", 2125.3)])},
    "ipc": {"points": monthly("2024-05", [7000 + i * 0 for i in range(0)]) + monthly("2025-05", [8714.4, 8855.568, 9023.973, 9193.244, 9384.092, 9603.862, 9841.358, 10121.372, 10413.031, 10714.626, 11077.061, 11363.09, 11607.394, 11826.4103, 12076.3937, 12276.766])},
    "ipim": {"points": monthly("2025-05", [11848.9, 12044.4, 12387.32, 12771.69, 13243.43, 13387, 13599.28, 13925.56, 14157.71, 14296.33, 14780.13, 15542.54, 15931.97, 16104.174, 16233.715, 16580.328])},
    "is": {"points": monthly("2025-05", [6755.2, 6956.46, 7129.22, 7354.44, 7518.03, 7705.88, 7843.14, 7969.6, 8171.66, 8370.04, 8654.99, 8978.1, 9177.39, 9442.5])},
  },
  "updatedAt": None, "checkedAt": None, "refreshing": False,
}
import datetime
state["checkedAt"] = (datetime.datetime.utcnow() - datetime.timedelta(minutes=7)).isoformat() + "Z"

stub = """
window.__state = %s;
window.api = {
  getState: async () => window.__state,
  refresh: async () => window.__state,
  onChanged: (cb) => { window.__push = cb; return () => {}; },
  openExternal: async () => {},
  version: async () => '1.0.4',
};
""" % json.dumps(state)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1180, "height": 900}, locale="es-AR")
    msgs = []
    pg.on("console", lambda m: msgs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)))
    pg.add_init_script(stub)
    pg.goto("file:///home/claude/calculadora-alquileres/src/renderer/index.html")
    pg.wait_for_timeout(300)
    pg.screenshot(path="/tmp/ui-1-inicio.png", full_page=True)

    pg.fill("#monto", "350000")
    pg.press("#monto", "Tab")
    pg.fill("#fecha", "2025-06-01")
    pg.click("#meses button:nth-child(12)")
    pg.click("#indices button[data-key=icl]")
    pg.click("#btnCalc")
    pg.wait_for_timeout(200)
    pg.screenshot(path="/tmp/ui-2-icl.png", full_page=True)

    pg.click("#indices button[data-key=ipc]")
    pg.click("#meses button:nth-child(6)")
    pg.click("#btnCalc")
    pg.click("[data-det='2']")
    pg.wait_for_timeout(200)
    pg.screenshot(path="/tmp/ui-3-ipc.png", full_page=True)

    # error de validación
    pg.fill("#monto", "")
    pg.click("#btnCalc")
    print("error visible:", pg.inner_text("#error"))
    pg.fill("#monto", "350.000")
    pg.click("#btnCalc")

    # simula una actualización de datos en vivo
    pg.evaluate("""() => { const s = window.__state; s.indices.ipc.points.push(['2026-09-01', 12480.0]); s.checkedAt = new Date().toISOString(); window.__push(s); }""")
    pg.wait_for_timeout(200)
    print("status:", pg.inner_text("#statusText"))
    print("filas tras actualizar:", pg.locator("#resultBody tbody tr:not(.det)").count())

    # ventana angosta
    pg.set_viewport_size({"width": 760, "height": 900})
    pg.screenshot(path="/tmp/ui-4-angosto.png", full_page=True)
    print("\n".join(msgs) or "sin errores de consola")
    b.close()
