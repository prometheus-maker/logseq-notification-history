#!/home/prometheus/work/venv-bench/bin/python
"""README image: real Logseq 2.0 (CDP :9334, plugin loaded), realistic messages via logseq.api.show_msg. Usage: shot.py OUT.png"""
import sys
from playwright.sync_api import sync_playwright
MSGS = [("Exported 14 pages to Markdown", "success"), ("Graph re-index finished", "success"),
        ("Sync failed: could not reach the server", "error"), ("Copied block reference", "success"),
        ("Plugin \"Agenda\" was updated to 3.9.1", "success"), ("Plugin \"Agenda\" was updated to 3.9.1", "success"),
        ("Image is larger than 10 MB and was not uploaded", "warning")]
with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9334")
    pg = [x for c in b.contexts for x in c.pages if x.url.startswith("lsp://")][0]
    pg.click(".nh-toolbar"); pg.wait_for_selector(".nh-panel"); pg.wait_for_timeout(400); pg.click('[data-a="clear"]'); pg.keyboard.press("Escape")
    for m, k in MSGS:
        pg.evaluate("([m, k]) => logseq.api.show_msg(m, k)", [m, k]); pg.wait_for_timeout(700)
    for _ in range(4):
        pg.evaluate("() => [...document.querySelectorAll('.ui__toast button')].filter(x => !x.textContent.trim()).forEach(x => x.click())"); pg.wait_for_timeout(500)
    pg.wait_for_timeout(800)
    pg.click(".nh-toolbar"); pg.wait_for_selector(".nh-row"); pg.wait_for_timeout(600); pg.mouse.move(5, 650)
    pg.screenshot(path=sys.argv[1])
