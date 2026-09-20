export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number; closed: boolean }
export type Ticker = { last: number; bid: number; ask: number; open: number; high: number; low: number; volume: number; ts: number }
export type Book = { bids: number[][]; asks: number[][]; ts: number }
export type Trade = { id: string; price: number; size: number; side: string; ts: number }
export type Market = { ticker: Ticker; book: Book; trades: Trade[]; latency: number; receivedAt: number }
export type Setup = { id: number; direction: 'LONG' | 'SHORT'; entry: number; stop: number; target: number; score: number; status: 'WATCHING' | 'INVALIDATED' | 'TARGET TOUCHED' | 'EXPIRED'; ended?: number }
export const fmt = (n?: number | null, digits = 2) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
export function indicators(c: Candle[]) {
  if (c.length < 50) return null
  const closes = c.map(x => x.close), last = c.at(-1)!, tail = c.slice(-20)
  const fast = mean(closes.slice(-9)), slow = mean(closes.slice(-21)), trend = mean(closes.slice(-50))
  const trs = c.slice(-14).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - c[c.length - 15 + i].close), Math.abs(x.low - c[c.length - 15 + i].close)))
  const atr = mean(trs), delta = closes.slice(-14).map((v, i) => v - closes[closes.length - 15 + i])
  const gain = mean(delta.map(v => Math.max(0, v))), loss = mean(delta.map(v => Math.max(0, -v)))
  const rsi = loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss)
  const volume = tail.reduce((s, x) => s + x.volume, 0)
  if (!volume || !atr) return null
  const vwap = tail.reduce((s, x) => s + (x.high + x.low + x.close) / 3 * x.volume, 0) / volume
  const factors = [
    { name: 'Trend alignment', detail: 'SMA 9 / 21', long: fast > slow, short: fast < slow, weight: 30 },
    { name: 'Market structure', detail: 'Close / SMA 50', long: last.close > trend, short: last.close < trend, weight: 25 },
    { name: 'Momentum', detail: 'RSI 14 · simple', long: rsi > 52 && rsi < 75, short: rsi < 48 && rsi > 25, weight: 20 },
    { name: 'Volume positioning', detail: 'Rolling VWAP 20', long: last.close > vwap, short: last.close < vwap, weight: 25 },
  ]
  const long = factors.reduce((s, x) => s + (x.long ? x.weight : 0), 0), short = factors.reduce((s, x) => s + (x.short ? x.weight : 0), 0)
  return { fast, slow, trend, atr, rsi, vwap, factors, long, short }
}
export function analyze(raw: Candle[], tick = 0.1) {
  const c = raw.filter(x => x.closed), current = indicators(c)
  const history: Setup[] = []
  let active: Setup | null = null, previous = 0, cooldown = 0
  const round = (x: number) => Math.round(x / tick) * tick
  for (let i = 50; i < c.length; i++) {
    const bar = c[i], ind = indicators(c.slice(i - 50, i + 1))!
    if (!ind) continue
    // UTC boundaries anchor replay independently of a sliding REST history window.
    if (Math.floor(bar.time / 900) !== Math.floor(c[i - 1].time / 900)) {
      if (active) { active.status = 'EXPIRED'; active.ended = bar.time; active = null }
      previous = 0; cooldown = 0
    }
    if (active) {
      const long = active.direction === 'LONG'
      const stopped = long ? bar.low <= active.stop : bar.high >= active.stop
      const reached = long ? bar.high >= active.target : bar.low <= active.target
      if (stopped || reached || bar.time - active.id >= 12 * 60) {
        active.status = stopped ? 'INVALIDATED' : reached ? 'TARGET TOUCHED' : 'EXPIRED'
        active.ended = bar.time; active = null; cooldown = 3
      }
    }
    const direction = ind.long >= 75 ? 1 : ind.short >= 75 ? -1 : 0
    const contiguous = bar.time - c[i - 1].time === 60
    if (!active && cooldown === 0 && contiguous && direction !== 0 && direction === previous) {
      const entry = round(bar.close), long = direction === 1
      const structure = c.slice(i - 4, i + 1)
      const stop = long ? Math.floor(Math.min(entry - 1.2 * ind.atr, ...structure.map(x => x.low)) / tick) * tick : Math.ceil(Math.max(entry + 1.2 * ind.atr, ...structure.map(x => x.high)) / tick) * tick
      const risk = Math.abs(entry - stop)
      active = { id: bar.time, direction: long ? 'LONG' : 'SHORT', entry, stop, target: round(entry + direction * 2 * risk), score: long ? ind.long : ind.short, status: 'WATCHING' }
      history.push(active)
    }
    previous = contiguous ? direction : 0
    if (cooldown > 0) cooldown--
  }
  return { current, active, history: history.slice(-8).reverse(), lastClosed: c.at(-1)?.time }
}
