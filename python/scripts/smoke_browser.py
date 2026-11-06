"""Verificação opcional com navegador real.

Requer Playwright: python -m pip install playwright
Use Chromium do sistema ou: python -m playwright install chromium
Com o app em execução: python scripts/smoke_browser.py
"""
import argparse
from pathlib import Path
import shutil
import tempfile
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8000")
parser.add_argument("--screenshot", default=str(Path(tempfile.gettempdir()) / "auto_ecu_lab_preview.png"))
args = parser.parse_args()

with sync_playwright() as playwright:
    options = {"headless": True, "args": ["--no-sandbox"]}
    chromium = shutil.which("chromium") or shutil.which("google-chrome")
    if chromium:
        options["executable_path"] = chromium
    browser = playwright.chromium.launch(**options)
    page = browser.new_page(viewport={"width": 1440, "height": 1080}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until="networkidle")
    has_recording = page.locator("#signal-chart").count() > 0
    if has_recording:
        assert page.locator("#signal-chart .series-line").count() == 3
        before = page.locator("#chart-window").inner_text()
        page.locator("#zoom-start").fill("10")
        assert page.locator("#chart-window").inner_text() != before
        page.locator("[data-reset-chart]").click()
        page.locator('[data-series="rpm"]').click()
        assert page.locator("#signal-chart .series-line").count() == 2
        page.locator('[data-series="rpm"]').click()
    else:
        assert "base está vazia" in page.locator("main").inner_text()
    page.screenshot(path=args.screenshot, full_page=True)
    for route in ["/veiculos", "/importar", "/estatisticas", "/relatorios"]:
        assert page.goto(args.url + route, wait_until="networkidle").status == 200
    if has_recording:
        with page.expect_download() as download:
            page.get_by_role("link", name="HTML", exact=True).first.click()
        assert download.value.suggested_filename.endswith(".html")
    page.goto(args.url + "/simulador", wait_until="networkidle")
    if has_recording:
        page.wait_for_function("document.querySelectorAll('#signal-chart .series-line').length === 3")
        page.locator("#simulation-preset").select_option("rapido")
        page.wait_for_function("document.querySelector('#simulation-status').textContent.startsWith('Curva atualizada')")
        assert page.locator("#delay_s").input_value() == "0.05"
        with page.expect_download() as download:
            page.get_by_role("button", name="Baixar simulação CSV").click()
        assert download.value.suggested_filename.endswith(".csv")
    page.set_viewport_size({"width": 390, "height": 844})
    for route in ["/", "/veiculos", "/importar", "/simulador", "/relatorios", "/estatisticas"]:
        page.goto(args.url + route, wait_until="networkidle")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), f"Overflow em {route}"
    assert not errors, errors
    browser.close()
print(f"Navegador: páginas e celular OK; ensaio disponível: {has_recording}. Captura: {Path(args.screenshot).resolve()}")
