export type FetchOutcome =
  | { ok: true; status: number; finalUrl: string; etag?: string; text: string }
  | { ok: false; kind: 'http' | 'timeout' | 'network' | 'queue-aborted'; status?: number }

export type FetchQueue = ReturnType<typeof createFetchQueue>

type QueueItem = {
  url: string
  method: 'GET' | 'HEAD'
  resolve: (outcome: FetchOutcome) => void
}

const RETRYABLE = new Set([429, 503])

/**
 * The polite pipe every crawler request flows through (spec §5): bounded
 * concurrency, a shared minimum interval between request starts, one backoff
 * retry for 429/503, and a circuit breaker — too many consecutive failures
 * means the site (or the network) wants us gone, so the whole queue stands down.
 */
export function createFetchQueue(opts: {
  fetchFn?: typeof fetch
  concurrency?: number
  minIntervalMs?: number
  timeoutMs?: number
  maxConsecutiveErrors?: number
  userAgent: string
}) {
  const fetchFn = opts.fetchFn ?? fetch
  const concurrency = opts.concurrency ?? 2
  const minIntervalMs = opts.minIntervalMs ?? 1000
  const timeoutMs = opts.timeoutMs ?? 15_000
  const maxConsecutiveErrors = opts.maxConsecutiveErrors ?? 10

  const pending: QueueItem[] = []
  let running = 0
  let consecutiveErrors = 0
  let nextSlotAt = 0

  const queue = {
    aborted: false,
    get(url: string): Promise<FetchOutcome> {
      return enqueue(url, 'GET')
    },
    head(url: string): Promise<FetchOutcome> {
      return enqueue(url, 'HEAD')
    }
  }

  function enqueue(url: string, method: 'GET' | 'HEAD'): Promise<FetchOutcome> {
    return new Promise<FetchOutcome>((resolve) => {
      if (queue.aborted) {
        resolve({ ok: false, kind: 'queue-aborted' })
        return
      }
      pending.push({ url, method, resolve })
      pump()
    })
  }

  function pump(): void {
    while (running < concurrency && pending.length > 0) {
      const item = pending.shift()!
      running++
      void run(item).finally(() => {
        running--
        pump()
      })
    }
  }

  async function run(item: QueueItem): Promise<void> {
    if (queue.aborted) {
      item.resolve({ ok: false, kind: 'queue-aborted' })
      return
    }
    await pace()
    let outcome = await attempt(item)
    if (!outcome.ok && outcome.kind === 'http' && RETRYABLE.has(outcome.status ?? 0)) {
      await delay(outcome.retryAfterMs ?? 2000)
      outcome = await attempt(item)
    }
    if (outcome.ok) {
      consecutiveErrors = 0
    } else {
      consecutiveErrors++
      if (consecutiveErrors >= maxConsecutiveErrors) {
        queue.aborted = true
        for (const rest of pending.splice(0)) rest.resolve({ ok: false, kind: 'queue-aborted' })
      }
    }
    item.resolve(outcome.ok ? outcome : { ok: false, kind: outcome.kind, status: outcome.status })
  }

  type Attempt = FetchOutcome & { retryAfterMs?: number }

  async function attempt(item: QueueItem): Promise<Attempt> {
    try {
      const response = await fetchFn(item.url, {
        method: item.method,
        redirect: 'follow',
        headers: { 'user-agent': opts.userAgent, accept: 'text/html,application/xml,application/json,*/*' },
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!response.ok) {
        const retryAfter = Number(response.headers.get('retry-after'))
        return {
          ok: false,
          kind: 'http',
          status: response.status,
          retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined
        }
      }
      return {
        ok: true,
        status: response.status,
        finalUrl: response.url || item.url,
        etag: response.headers.get('etag') ?? undefined,
        text: item.method === 'HEAD' ? '' : await response.text()
      }
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError'
      return { ok: false, kind: timedOut ? 'timeout' : 'network' }
    }
  }

  /** Shared pacing: request starts are spaced `minIntervalMs` apart across all workers. */
  async function pace(): Promise<void> {
    const now = Date.now()
    const startAt = Math.max(now, nextSlotAt)
    nextSlotAt = startAt + minIntervalMs
    if (startAt > now) await delay(startAt - now)
  }

  function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  return queue
}
