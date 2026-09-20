'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import type { Market, Ticker, Book, Candle } from '@/lib/market'
export async function fetcher(url: string) { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Exchange unavailable'); return j }
export function useMarket(timeframe = '1m') {
  const snapshot = useSWR<Market>('/api/market', fetcher, { refreshInterval: 3000, errorRetryInterval: 10000, dedupingInterval: 2000, refreshWhenHidden: false })
  const candles = useSWR<{candles: Candle[]}>(`/api/market?kind=candles&bar=${timeframe}`, fetcher, { refreshInterval: 10000, errorRetryInterval: 15000 })
  const instrument = useSWR<{ tick: number; contractSize: number; funding: number | null; fundingTs: number | null; id: string }>('/api/market?kind=instrument', fetcher, { refreshInterval: 60000, errorRetryInterval: 15000 })
  const [stream, setStream] = useState<{ ticker?: Ticker; book?: Book }>({})
  const [connected, setConnected] = useState(false), [now, setNow] = useState(0)
  useEffect(() => {
    let socket: WebSocket, retry: ReturnType<typeof setTimeout>, heartbeat: ReturnType<typeof setInterval>, disposed = false, attempts = 0, lastMessage = Date.now()
    const connect = () => {
      if (disposed) return
      socket = new WebSocket('wss://ws.okx.com:8443/ws/v5/public')
      socket.onopen = () => { attempts = 0; lastMessage = Date.now(); socket.send(JSON.stringify({op:'subscribe',args:[{channel:'tickers',instId:'XAU-USDT-SWAP'},{channel:'books5',instId:'XAU-USDT-SWAP'}]})); heartbeat = setInterval(() => { if (Date.now()-lastMessage > 30000) socket.close(); else if (socket.readyState === WebSocket.OPEN) socket.send('ping') },10000) }
      socket.onmessage = e => {
        lastMessage = Date.now()
        if(e.data === 'pong') return
        try {
          const m = JSON.parse(e.data), d = m.data?.[0]
          if(!d || m.arg?.instId !== 'XAU-USDT-SWAP') return
          if(m.arg.channel === 'tickers') {
            const ticker = {last:+d.last,bid:+d.bidPx,ask:+d.askPx,open:+d.open24h,high:+d.high24h,low:+d.low24h,volume:+d.volCcy24h,ts:+d.ts}
            if(Object.values(ticker).every(Number.isFinite) && ticker.last>0) { setConnected(true); setStream(s => !s.ticker || ticker.ts>=s.ticker.ts ? {...s,ticker} : s) }
          }
          if(m.arg.channel === 'books5') {
            const book = { bids:d.bids.map((x:string[])=>[+x[0],+x[1]]),asks:d.asks.map((x:string[])=>[+x[0],+x[1]]),ts:+d.ts }
            if(book.bids.length && book.asks.length && [...book.bids,...book.asks].every(x=>x.every(Number.isFinite))) setStream(s=> !s.book || book.ts>=s.book.ts ? {...s,book}:s)
          }
        } catch { /* Discard malformed exchange messages; freshness checks block stale signals. */ }
      }
      socket.onerror = () => socket.close()
      socket.onclose = () => { setConnected(false); clearInterval(heartbeat); if(!disposed) retry = setTimeout(connect,Math.min(30000,1000*2**attempts++)) }
    }
    connect(); setNow(Date.now()); const clock = setInterval(()=>setNow(Date.now()),1000)
    return () => { disposed=true; clearInterval(clock); clearTimeout(retry); clearInterval(heartbeat); socket?.close() }
  }, [])
  const rest = snapshot.data
  const ticker = stream.ticker && (!rest || stream.ticker.ts > rest.ticker.ts) ? stream.ticker : rest?.ticker
  const book = stream.book && (!rest || stream.book.ts > rest.book.ts) ? stream.book : rest?.book
  const age = ticker && now ? Math.max(0, now-ticker.ts) : Infinity
  const fresh = age < 10000 && !!ticker && ticker.ts <= now + 2000 && ticker.bid > 0 && ticker.ask >= ticker.bid && !!book && now-book.ts < 10000 && book.ts <= now + 2000 && book.bids[0][0] > 0 && book.asks[0][0] >= book.bids[0][0] && !!instrument.data && !instrument.error
  return { snapshot, candles, instrument, ticker, book, age, fresh, connected, now, refresh: () => { void snapshot.mutate(); void candles.mutate(); void instrument.mutate() } }
}
