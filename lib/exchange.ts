import type { Candle } from './market'
import { SECONDS, type Timeframe } from './timeframes'
export async function okx(path: string) {
  const response = await fetch('https://openapi.okx.com/api/v5/' + path, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`OKX HTTP ${response.status}`)
  const data = await response.json()
  if (data.code !== '0' || !Array.isArray(data.data) || !data.data.length) throw new Error('OKX data unavailable')
  return data.data
}
export async function loadCandles(timeframe: Timeframe): Promise<Candle[]> {
  const bar = timeframe === '3H' ? '1H' : timeframe
  const rows: string[][] = await okx(`market/candles?instId=XAU-USDT-SWAP&bar=${bar}&limit=300`)
  const candles = rows.map(x => ({ time: Number(x[0]) / 1000, open: Number(x[1]), high: Number(x[2]), low: Number(x[3]), close: Number(x[4]), volume: Number(x[6]), closed: x[8] === '1' })).reverse()
  if (candles.some((c, i) => ![c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.open <= 0 || c.close <= 0 || c.low <= 0 || c.volume < 0 || c.low > Math.min(c.open,c.close) || c.high < Math.max(c.open,c.close) || (i > 0 && c.time <= candles[i-1].time))) throw new Error('Invalid candle sequence')
  if (timeframe !== '3H') return candles
  const buckets = new Map<number, Candle[]>()
  for (const c of candles) { const time = Math.floor(c.time / SECONDS['3H']) * SECONDS['3H']; buckets.set(time, [...(buckets.get(time) ?? []), c]) }
  return Array.from(buckets, ([time, group]) => ({ time, open: group[0].open, high: Math.max(...group.map(c => c.high)), low: Math.min(...group.map(c => c.low)), close: group.at(-1)!.close, volume: group.reduce((sum,c) => sum+c.volume,0), closed: group.length === 3 && group.every((c,i) => c.closed && c.time === time+i*3600) })).filter((c) => buckets.get(c.time)![0].time === c.time)
}
