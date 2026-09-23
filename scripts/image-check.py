"""Genera la imagen 'Copiar como imagen' en Chromium y la guarda en /tmp para revisarla."""
import json, base64
from playwright.sync_api import sync_playwright

fx = json.load(open('/tmp/fixture.json'))
stub = """
window.__state = %s;
window.api = { getState: async () => window.__state, refresh: async () => window.__state, onChanged: () => () => {},
  openExternal: async () => {}, version: async () => '1.0.3',
  copyImage: async (bytes) => { window.__img = Array.from(bytes); return true; } };
""" % json.dumps({"indices": fx, "updatedAt": None, "checkedAt": None, "refreshing": False})

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1180, "height": 900}, locale="es-AR")
    msgs = []
    pg.on("console", lambda m: msgs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)))
    pg.add_init_script(stub)
    pg.goto("file:///home/claude/calculadora-alquileres/src/renderer/index.html")
    for name, idx, meses, fecha in [("icl12", "icl", 12, "2025-06-01"), ("ipim6", "ipim", 6, "2025-06-01")]:
        pg.fill("#monto", "350000"); pg.fill("#fecha", fecha)
        pg.click(f"#meses button:nth-child({meses})"); pg.click(f"#indices button[data-key={idx}]"); pg.click("#btnCalc")
        pg.evaluate("window.__img = null")
        pg.click("#btnImage")
        for _ in range(40):
            if pg.evaluate("window.__img") is not None: break
            pg.wait_for_timeout(200)
        data = bytes(pg.evaluate("window.__img"))
        open(f"/tmp/share-{name}.png", "wb").write(data)
        print(name, len(data), "bytes", data[:8] == b"\x89PNG\r\n\x1a\n", "| botón:", pg.inner_text("#btnImage"))
    print("\n".join(msgs) or "sin errores de consola")
    b.close()
