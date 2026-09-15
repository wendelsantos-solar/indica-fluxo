/**
 * Lab Web Vitals with the locally installed Chrome, over the DevTools protocol.
 * No dependency: Node's WebSocket and fetch.
 *
 *   pnpm perf:vitals <url> [runs]
 *
 * Each run is a fresh headless Chrome profile (cold cache), a 412×915 mobile
 * viewport, 4× CPU slowdown and a "slow 4G"-like network (150 ms RTT,
 * 1.6 Mbps down). Reports the median of FCP, LCP, CLS, TTFB and bytes.
 * Lab numbers compare builds; they are not field data.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const [url, runsArg = "5"] = process.argv.slice(2)
if (!url) throw new Error("usage: lab-vitals.mjs <url> [runs]")
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function once(port) {
  const profile = mkdtempSync(join(tmpdir(), "lab-vitals-"))
  const chrome = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "about:blank",
  ], { stdio: "ignore" })
  try {
    let target
    for (let i = 0; i < 50 && !target; i += 1) {
      await sleep(100)
      target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((list) => list.find((t) => t.type === "page")).catch(() => undefined)
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }))
    let id = 0
    const pending = new Map()
    const listeners = []
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data)
      if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result); pending.delete(message.id) }
      else for (const listener of listeners) listener(message)
    })
    const send = (method, params = {}) => new Promise((resolve) => { id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })) })

    let encodedBytes = 0
    listeners.push((m) => { if (m.method === "Network.loadingFinished") encodedBytes += m.params.encodedDataLength })

    await send("Page.enable")
    await send("Network.enable")
    await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true })
    await send("Emulation.setCPUThrottlingRate", { rate: 4 })
    await send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__lab={lcp:0,cls:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lab.lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__lab.cls+=e.value}).observe({type:'layout-shift',buffered:true});`,
    })

    const loaded = new Promise((resolve) => listeners.push((m) => m.method === "Page.loadEventFired" && resolve()))
    await send("Page.navigate", { url })
    await loaded
    await sleep(3000) // let late layout shifts and prefetches settle

    const { result } = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { ttfb: n.responseStart, fcp: fcp ? fcp.startTime : null, lcp: window.__lab.lcp, cls: window.__lab.cls, load: n.loadEventEnd, requests: performance.getEntriesByType('resource').length + 1 } })()`,
    })
    ws.close()
    return { ...result.value, transferKB: encodedBytes / 1024 }
  } finally {
    chrome.kill()
    await sleep(300)
    rmSync(profile, { recursive: true, force: true })
  }
}

const runs = []
for (let i = 0; i < Number(runsArg); i += 1) runs.push(await once(9300 + i))
const median = (key) => {
  const values = runs.map((run) => run[key]).filter((v) => v !== null).sort((a, b) => a - b)
  return values[Math.floor(values.length / 2)]
}
console.log(JSON.stringify({
  url, runs: runs.length,
  ttfb: Math.round(median("ttfb")), fcp: Math.round(median("fcp")), lcp: Math.round(median("lcp")),
  cls: +median("cls").toFixed(4), load: Math.round(median("load")), requests: median("requests"),
  transferKB: Math.round(median("transferKB")),
}))
