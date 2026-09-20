import { NextRequest, NextResponse } from 'next/server'
import { loadCandles, okx } from '@/lib/exchange'
import { indicators } from '@/lib/market'
import { isTimeframe, SECONDS, type Timeframe } from '@/lib/timeframes'
import type { BrainResult, Forecast } from '@/lib/brain'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const model = 'google/timesfm-2.5-200m-pytorch'
const forecasts = new Map<Timeframe, { key: string; promise: Promise<Forecast> }>()

function predict(tf: Timeframe, candleTime: number, closes: number[]): Promise<Forecast> {
  const key = `${candleTime}:${closes.join(',')}`
  const cached = forecasts.get(tf)
  if (cached?.key === key) return cached.promise
  const promise = (async () => {
    const url = new URL('/forecast', process.env.TIMESFM_SERVICE_URL!)
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV === 'development' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('TimesFM requires an HTTPS service URL')
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TIMESFM_SERVICE_TOKEN}` }, body: JSON.stringify({ timeframe: tf, candleTime, closes, horizon: 3 }), cache: 'no-store', signal: AbortSignal.timeout(45000) })
    if (!response.ok) throw new Error('TimesFM inference unavailable')
    const forecast = await response.json() as Forecast
    if (forecast.model !== model || forecast.candleTime !== candleTime || ![forecast.point,forecast.lower,forecast.upper].every(a => Array.isArray(a) && a.length === 3 && a.every(x => typeof x === 'number' && Number.isFinite(x) && x > 0)) || forecast.lower.some((x,i) => x > forecast.upper[i])) throw new Error('TimesFM returned an invalid forecast')
    return forecast
  })()
  forecasts.set(tf, { key, promise })
  void promise.catch(() => { if (forecasts.get(tf)?.promise === promise) forecasts.delete(tf) })
  return promise
}

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get('bar') ?? '1m'
  if (!isTimeframe(value)) return NextResponse.json({ error: 'Unsupported timeframe' }, { status: 400 })
  const timeframe = value
  const send = (data: Omit<BrainResult,'timeframe'|'generatedAt'>) => NextResponse.json({ ...data, timeframe, generatedAt: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
  if (!process.env.TIMESFM_SERVICE_URL || !process.env.TIMESFM_SERVICE_TOKEN) return send({ status: 'OFFLINE', reason: 'Connect the TimesFM Python service to enable signals. No fallback decisions.', setup: null })
  try {
    const candles = (await loadCandles(timeframe)).filter(c => c.closed)
    const last = candles.at(-1), seconds = SECONDS[timeframe]
    if (!last || candles.length < 64 || candles.some((c,i) => i > 0 && c.time-candles[i-1].time !== seconds)) return send({ status: 'WAIT', reason: 'Waiting for at least 64 continuous closed candles.', setup: null })
    const candleTime = last.time, expiresAt = (candleTime+2*seconds)*1000
    if (Date.now() < (candleTime+seconds)*1000 || Date.now() >= expiresAt) return send({ status: 'WAIT', reason: 'Closed-candle data is stale.', setup: null })
    const forecast = await predict(timeframe, candleTime, candles.map(c => c.close))
    const context = { forecast, candleTime, expiresAt }
    if (Date.now() >= expiresAt) return send({ ...context, status: 'WAIT', reason: 'Candle rolled over during inference. Refreshing forecast.', setup: null })
    const [instruments, tickers] = await Promise.all([okx('public/instruments?instType=SWAP&instId=XAU-USDT-SWAP'), okx('market/ticker?instId=XAU-USDT-SWAP')])
    const instrument = instruments[0], ticker = tickers[0], tick = Number(instrument.tickSz)
    const ind = indicators(candles), previous = indicators(candles.slice(0,-1))
    if (!ind || !previous || instrument.instId !== 'XAU-USDT-SWAP' || instrument.ctValCcy !== 'XAU' || instrument.settleCcy !== 'USDT' || instrument.state !== 'live' || !Number.isFinite(tick) || tick <= 0) return send({ ...context, status: 'WAIT', reason: 'Instrument or indicator safety gate failed.', setup: null })
    const bid = Number(ticker.bidPx), ask = Number(ticker.askPx), ts = Number(ticker.ts)
    if (ticker.instId !== 'XAU-USDT-SWAP' || ![bid,ask,ts].every(Number.isFinite) || bid <= 0 || ask < bid || Date.now()-ts > 10000 || ts > Date.now()+2000) return send({ ...context, status: 'WAIT', reason: 'Executable quote is stale or invalid.', setup: null })
    const projection = forecast.point[2], long = projection > last.close
    const direction = long ? 'LONG' : 'SHORT'
    const supported = long ? forecast.lower[2] > last.close && ind.long >= 75 && previous.long >= 75 : forecast.upper[2] < last.close && ind.short >= 75 && previous.short >= 75
    if (!supported || Math.abs(projection-last.close) < ind.atr*.35) return send({ ...context, status: 'WAIT', reason: 'TimesFM forecast and two-candle rule confirmation do not align.', setup: null })
    const entry = Math.round(last.close/tick)*tick
    const structure = candles.slice(-5)
    const stop = long ? Math.floor(Math.min(entry-1.2*ind.atr,...structure.map(c=>c.low))/tick)*tick : Math.ceil(Math.max(entry+1.2*ind.atr,...structure.map(c=>c.high))/tick)*tick
    const risk = Math.abs(entry-stop), target = Math.round((entry+(long?1:-1)*2*risk)/tick)*tick
    if (ask-bid > ind.atr*.2 || Math.abs((long?ask:bid)-entry) > ind.atr*.35 || risk <= 0 || stop <= 0 || target <= 0 || (long ? bid <= stop || bid >= target : ask >= stop || ask <= target)) return send({ ...context, status: 'WAIT', reason: 'TimesFM direction passes; spread, entry distance or risk bounds block the setup.', setup: null })
    return send({ ...context, status: 'READY', reason: 'TimesFM approved; closed-candle confirmation and quote safeguards passed.', setup: { id: candleTime, direction, entry, stop, target, score: long?ind.long:ind.short, status:'WATCHING' } })
  } catch {
    return send({ status: 'OFFLINE', reason: 'Forecast or exchange service unavailable. All signals are blocked.', setup: null })
  }
}
