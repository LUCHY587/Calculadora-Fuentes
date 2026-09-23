"""Prueba visual y funcional de la pantalla "Contratos del mes" con un Excel real.
Uso: python3 scripts/contratos-check.py <archivo.xlsx>   -> capturas en /tmp/contratos-*.png
"""
import sys
from playwright.sync_api import sync_playwright

xlsx = sys.argv[1]
ns = {}
exec(open('scripts/ui-check.py').read().split("with sync_playwright() as p:")[0], ns)
extra = "window.api.saveFile = async (o) => { window.__saved = o; return { guardado: true }; };"

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1180, "height": 900}, locale="es-AR")
    msgs = []
    pg.on("console", lambda m: msgs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)))
    pg.add_init_script(ns["stub"])
    pg.add_init_script(extra)
    pg.goto("file:///home/claude/calculadora-alquileres/src/renderer/index.html")
    pg.wait_for_timeout(300)

    pg.click("#tabContratos")
    pg.screenshot(path="/tmp/contratos-0-vacio.png", full_page=True)

    # archivo equivocado
    pg.set_input_files("#fileXlsx", {"name": "notas.txt", "mimeType": "text/plain", "buffer": b"hola"})
    pg.wait_for_timeout(200)
    print("error extensión:", pg.inner_text("#cerror"))
    pg.set_input_files("#fileXlsx", {"name": "roto.xlsx", "mimeType": "application/octet-stream", "buffer": b"no soy un excel"})
    pg.wait_for_timeout(300)
    print("error archivo roto:", pg.inner_text("#cerror"))

    pg.set_input_files("#fileXlsx", xlsx)
    pg.wait_for_selector(".ctable")
    print("error tras importar:", repr(pg.inner_text("#cerror")))
    print("contador pestaña:", pg.inner_text("#tabCount"))
    print("filas:", pg.locator(".crow").count(), "|", pg.inner_text("#ccount"))
    print("resumen:", " || ".join(t.replace("\n", " / ") for t in pg.locator(".csummary .big").all_inner_texts()))
    print("avisos:", pg.locator(".contratos .notice").all_inner_texts())
    pg.screenshot(path="/tmp/contratos-1-light.png", full_page=True)

    # filtro y detalle
    pg.fill("#cfiltro", "av")
    print("filtro av:", pg.inner_text("#ccount"))
    pg.fill("#cfiltro", "")
    pg.click("[data-det='0']")
    pg.screenshot(path="/tmp/contratos-2-detalle.png", full_page=False)

    # exportar
    pg.click("#btnCsv")
    pg.wait_for_timeout(200)
    saved = pg.evaluate("window.__saved")
    print("CSV nombre:", saved["nombre"])
    print("\n".join(saved["datos"].split("\r\n")[:4]))

    # modo oscuro
    pg.click("#btnTheme")
    pg.wait_for_timeout(150)
    pg.screenshot(path="/tmp/contratos-3-dark.png", full_page=True)
    pg.click("#btnTheme")

    # los índices se actualizan en vivo: IPC de septiembre publicado -> pasa a oficial
    pg.evaluate("""() => { const s = window.__state; s.indices.ipc.points.push(['2026-09-01', 12480.0]); s.checkedAt = new Date().toISOString(); window.__push(s); }""")
    pg.wait_for_timeout(300)
    print("resumen tras publicar IPC sept:", pg.locator(".csummary .big").nth(3).inner_text().replace("\n", " / "))

    # persistencia
    pg.reload()
    pg.wait_for_timeout(400)
    print("tras recargar, contador:", pg.inner_text("#tabCount"))
    pg.click("#tabContratos")
    print("tras recargar, filas:", pg.locator(".crow").count())

    # Enter en el buscador no debe disparar el cálculo de la otra pestaña
    pg.fill("#cfiltro", "haedo"); pg.press("#cfiltro", "Enter")
    print("error calculadora tras Enter:", repr(pg.inner_text("#error")))

    # borrar lista (2 clics)
    pg.click("#btnBorrar"); pg.click("#btnBorrar")
    pg.wait_for_timeout(150)
    print("tras borrar:", pg.locator(".cempty").count(), "vacío | contador oculto:", pg.locator("#tabCount").is_hidden())

    # estrecho
    pg.set_input_files("#fileXlsx", xlsx); pg.wait_for_selector(".ctable")
    pg.set_viewport_size({"width": 940, "height": 800})
    pg.screenshot(path="/tmp/contratos-4-angosto.png", full_page=False)

    pg.click("#tabCalc")
    print("vista calculadora visible:", pg.locator("#viewCalc").is_visible())
    print("\n".join(msgs) or "sin errores de consola")
    b.close()
