import { NextRequest, NextResponse } from 'next/server'
import { loadCandles } from '@/lib/exchange'
import { isTimeframe } from '@/lib/timeframes'

export const dynamic = 'force-dynamic'
const base = 'https://openapi.okx.com/api/v5/'
async function okx(path: string) {
  const r = await fetch(base + path, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`OKX HTTP ${r.status}`)
  const j = await r.json()
  if (j.code !== '0' || !Array.isArray(j.data) || !j.data.length) throw new Error(j.msg || 'OKX returned no data')
  return j.data
}
const num = (v: unknown) => { if (v === '' || v == null || !Number.isFinite(Number(v))) throw new Error('Invalid exchange value'); return Number(v) }
export async function GET(request: NextRequest) {
  const start = Date.now(), kind = request.nextUrl.searchParams.get('kind') || 'snapshot'
  try {
    if (kind === 'candles') {
      const bar = request.nextUrl.searchParams.get('bar') || '1m'
      if (!isTimeframe(bar)) return NextResponse.json({ error: 'Unsupported interval' }, { status: 400 })
      const candles = await loadCandles(bar)
      return NextResponse.json({ candles, receivedAt: Date.now() })
    }
    if (kind === 'instrument') {
      const [instruments, funding] = await Promise.all([okx('public/instruments?instType=SWAP&instId=XAU-USDT-SWAP'), okx('public/funding-rate?instId=XAU-USDT-SWAP').catch(() => null)])
      const i = instruments[0]
      if (i.instId !== 'XAU-USDT-SWAP' || i.settleCcy !== 'USDT' || i.ctValCcy !== 'XAU' || i.state !== 'live') throw new Error('Exact XAU contract is not live')
      return NextResponse.json({ tick: num(i.tickSz), contractSize: num(i.ctVal), funding: funding ? num(funding[0].fundingRate) : null, fundingTs: funding ? num(funding[0].ts) : null, id: i.instId })
    }
    if (kind !== 'snapshot') return NextResponse.json({ error: 'Unknown request' }, { status: 400 })
    const [ticker, books, trades] = await Promise.all([okx('market/ticker?instId=XAU-USDT-SWAP'), okx('market/books?instId=XAU-USDT-SWAP&sz=10'), okx('market/trades?instId=XAU-USDT-SWAP&limit=12')])
    const t = ticker[0], b = books[0]
    if (t.instId !== 'XAU-USDT-SWAP') throw new Error('Unexpected instrument')
    return NextResponse.json({ ticker: { last: num(t.last), bid: num(t.bidPx), ask: num(t.askPx), open: num(t.open24h), high: num(t.high24h), low: num(t.low24h), volume: num(t.volCcy24h), ts: num(t.ts) }, book: { bids: b.bids.map((x: string[]) => [num(x[0]),num(x[1])]), asks: b.asks.map((x: string[]) => [num(x[0]),num(x[1])]), ts: num(b.ts) }, trades: trades.map((x: Record<string,string>) => ({ id: x.tradeId, price: num(x.px), size: num(x.sz), side: x.side, ts: num(x.ts) })), latency: Date.now() - start, receivedAt: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Exchange unavailable', at: Date.now() }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '10' } })
  }
}
