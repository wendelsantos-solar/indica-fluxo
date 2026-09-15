/**
 * A small closed-loop load generator for endpoints that have no financial or
 * data side effects. No dependency: Node's fetch.
 *
 *   pnpm perf:load [baseUrl] [target] [concurrency] [seconds]
 *
 * targets:
 *   health       GET /api/health                   (one `select 1`)
 *   track-reject POST /api/track, well-formed unknown publishable key
 *                → parse, rate limit, key lookup, 401. Writes nothing.
 *   landing      GET /pt-br                        (prerendered)
 *
 * Tracking a REAL click writes rows; do that only against a disposable
 * database with a test key, never production.
 */
const [baseUrl = "http://localhost:3100", target = "health", concurrency = "10", seconds = "15"] = process.argv.slice(2)

const targets = {
  health: () => fetch(`${baseUrl}/api/health`),
  landing: () => fetch(`${baseUrl}/pt-br`),
  "track-reject": (i) =>
    fetch(`${baseUrl}/api/track`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // A different address per request, so the per-IP bucket measures the path, not the limiter.
        "x-forwarded-for": `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`,
      },
      body: JSON.stringify({
        publicKey: "pk_test_loadtestunknownkey00",
        ref: "loadtest",
        visitorId: "v_loadtest0000000001",
        url: "https://example.com/?ref=loadtest",
      }),
    }),
}

const run = targets[target]
if (!run) throw new Error(`Unknown target "${target}". One of: ${Object.keys(targets).join(", ")}`)

const deadline = Date.now() + Number(seconds) * 1000
const latencies = []
const statuses = {}
let counter = 0

async function worker() {
  while (Date.now() < deadline) {
    const index = counter++
    const start = performance.now()
    try {
      const response = await run(index)
      await response.arrayBuffer()
      statuses[response.status] = (statuses[response.status] ?? 0) + 1
    } catch {
      statuses.error = (statuses.error ?? 0) + 1
    }
    latencies.push(performance.now() - start)
  }
}

const began = performance.now()
await Promise.all(Array.from({ length: Number(concurrency) }, worker))
const elapsed = (performance.now() - began) / 1000

latencies.sort((a, b) => a - b)
const at = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]?.toFixed(0)
console.log(
  JSON.stringify({
    target,
    concurrency: Number(concurrency),
    requests: latencies.length,
    rps: +(latencies.length / elapsed).toFixed(1),
    p50: +at(0.5),
    p95: +at(0.95),
    p99: +at(0.99),
    max: +at(1),
    statuses,
  }),
)
