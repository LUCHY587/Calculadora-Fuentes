"""Captura la pantalla en modo claro y oscuro (datos simulados de ui-check.py)."""
import re, runpy, sys
src = open('scripts/ui-check.py').read()
# reutiliza state/stub del script existente hasta el bloque de Playwright
head = src.split("with sync_playwright() as p:")[0]
ns = {}
exec(head, ns)
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1180, "height": 900}, locale="es-AR")
    msgs = []
    pg.on("console", lambda m: msgs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)))
    pg.add_init_script(ns["stub"])
    pg.goto("file:///home/claude/calculadora-alquileres/src/renderer/index.html")
    pg.wait_for_timeout(300)
    print("tema inicial:", pg.get_attribute("html", "data-theme"), "| botón:", pg.inner_text("#btnTheme"))
    pg.fill("#monto", "350000"); pg.press("#monto", "Tab")
    pg.fill("#fecha", "2025-06-01")
    pg.click("#meses button:nth-child(12)")
    pg.click("#indices button[data-key=icl]")
    pg.click("#btnCalc")
    pg.wait_for_timeout(200)
    pg.screenshot(path="/tmp/theme-light.png", full_page=True)
    pg.click("#btnTheme")
    pg.wait_for_timeout(200)
    print("tema tras clic:", pg.get_attribute("html", "data-theme"), "| botón:", pg.inner_text("#btnTheme"), "| pressed:", pg.get_attribute("#btnTheme", "aria-pressed"))
    print("localStorage:", pg.evaluate("localStorage.getItem('ca.theme')"))
    pg.screenshot(path="/tmp/theme-dark.png", full_page=True)
    pg.click("#indices button[data-key=ipc]"); pg.click("#meses button:nth-child(6)"); pg.click("#btnCalc")
    pg.click("[data-det='2']"); pg.wait_for_timeout(200)
    pg.screenshot(path="/tmp/theme-dark-ipc.png", full_page=True)
    pg.reload(); pg.wait_for_timeout(300)
    print("tema tras recargar:", pg.get_attribute("html", "data-theme"))
    pg.emulate_media(media="print")
    b.close()
    print("\n".join(msgs) or "sin errores de consola")
