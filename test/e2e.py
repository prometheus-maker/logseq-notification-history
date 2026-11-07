#!/home/prometheus/work/venv-bench/bin/python
"""End-to-end test in real Logseq 2.0 (headless, CDP on :9334, this plugin in ~/.logseq/plugins; see mem
logseq-real-app-rig). Messages are shown through Logseq's own API (logseq.api.show_msg). Usage: e2e.py [SHOT_DIR]"""
import os, sys, time
from playwright.sync_api import sync_playwright

shots = sys.argv[1] if len(sys.argv) > 1 else "/tmp/lnh"
os.makedirs(shots, exist_ok=True)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name, detail, flush=True)

def close_toasts(pg):
    # close Logseq's toasts the way a user does (their x button); removing the nodes directly crashes Logseq's React tree
    for _ in range(3):
        n = pg.evaluate("""() => { const b = [...document.querySelectorAll('.ui__toast button')].filter(x => !x.textContent.trim()); b.forEach(x => x.click()); return b.length; }""")
        pg.wait_for_timeout(400)
        if not n: break

ROWS = "() => [...document.querySelectorAll('.nh-row')].map(r => [r.querySelector('.nh-text').textContent, (r.querySelector('.nh-count')||{}).textContent||'', r.classList.contains('nh-row--error')])"

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9334")
    pg = [x for c in b.contexts for x in c.pages if x.url.startswith("lsp://")][0]
    pg.set_default_timeout(15000)
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.evaluate("LSPluginCore.reload(['notification-history'])"); pg.wait_for_selector(".nh-toolbar", timeout=30000); pg.wait_for_timeout(1000)
    close_toasts(pg)
    check("no slow-load warning from Logseq", pg.locator(".ui__toast", has_text="takes too long").count() == 0)
    check("toolbar bell present", pg.locator(".nh-toolbar").count() == 1)
    pg.click(".nh-toolbar"); pg.wait_for_selector(".nh-panel"); pg.wait_for_timeout(500); pg.click('[data-a="clear"]'); pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    tag = str(int(time.time()))
    pg.evaluate(f"logseq.api.show_msg('Export finished {tag}', 'success')"); pg.wait_for_timeout(400)
    pg.evaluate(f"logseq.api.show_msg('Sync failed: network {tag}', 'error')"); pg.wait_for_timeout(400)
    for _ in range(2):
        pg.evaluate(f"logseq.api.show_msg('Same again {tag}')"); pg.wait_for_timeout(400)
    pg.wait_for_timeout(500)
    badge = pg.locator(".nh-toolbar-badge").text_content()
    check("badge counts notifications shown", badge == "4", f"badge={badge!r}")
    pg.screenshot(path=f"{shots}/toasts.png")
    pg.click(".nh-toolbar"); pg.wait_for_selector(".nh-row")
    r = [x for x in pg.evaluate(ROWS) if tag in x[0]]
    check("3 rows, newest first", [x[0].split(" " + tag)[0] for x in r] == ["Same again", "Sync failed: network", "Export finished"], str(r))
    check("repeat counted x2", r and r[0][1] == "×2", str(r[:1]))
    check("error row marked", len(r) > 1 and r[1][2] and not r[0][2], str(r))
    check("badge cleared after opening", pg.locator(".nh-toolbar-badge").text_content() == "")
    pg.fill(".nh-search", "sync"); pg.wait_for_timeout(200)
    check("filter", all("ync" in x[0] for x in pg.evaluate(ROWS)) and pg.evaluate(ROWS), str(pg.evaluate(ROWS)))
    pg.fill(".nh-search", ""); pg.check(".nh-errors input"); pg.wait_for_timeout(200)
    check("errors only", all(x[2] for x in pg.evaluate(ROWS)) and pg.evaluate(ROWS), str(pg.evaluate(ROWS)))
    pg.uncheck(".nh-errors input"); pg.wait_for_timeout(200)
    pg.screenshot(path=f"{shots}/history.png")
    n = len(pg.evaluate(ROWS))
    pg.evaluate("navigator.clipboard.writeText = () => Promise.resolve()")  # headless has no clipboard permission
    close_toasts(pg)
    pg.locator(".nh-copy").first.click(); pg.wait_for_timeout(800)
    check("copy does not log its own message", len(pg.evaluate(ROWS)) == n, f"{n}->{len(pg.evaluate(ROWS))}: {[x[0][:40] for x in pg.evaluate(ROWS)]}")
    pg.evaluate(f"logseq.api.show_msg('Live {tag}')"); pg.wait_for_timeout(600)
    check("list updates while open", pg.evaluate(ROWS)[0][0] == f"Live {tag}", str(pg.evaluate(ROWS)[:1]))
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    check("Escape closes the panel", pg.locator(".nh-panel").count() == 0, pg.evaluate("document.activeElement && (document.activeElement.tagName + '.' + document.activeElement.className)"))
    pg.wait_for_timeout(2500)  # debounced save
    pg.evaluate("LSPluginCore.reload(['notification-history'])"); pg.wait_for_selector(".nh-toolbar", timeout=30000); pg.wait_for_timeout(1000)
    pg.click(".nh-toolbar"); pg.wait_for_selector(".nh-row")
    r4 = [x for x in pg.evaluate(ROWS) if tag in x[0]]
    check("history survives a plugin reload", len(r4) == 4 and r4[2][2], str(r4))
    close_toasts(pg)
    pg.click('[data-a="clear"]'); pg.wait_for_timeout(200)
    check("clear empties list", pg.locator(".nh-row").count() == 0 and pg.locator(".nh-empty").count() == 1)
    pg.click(".nh-overlay", position={"x": 5, "y": 5}); pg.wait_for_timeout(200)
    check("click outside closes", pg.locator(".nh-panel").count() == 0)
    check("Logseq still healthy (no error screen)", pg.locator("text=Something went wrong").count() == 0)
    check("no page errors", not errs, str(errs[:3]))

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
