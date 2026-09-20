'use client'
import { BrainCircuit, ExternalLink, ShieldCheck } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TIMEFRAMES, type Timeframe } from '@/lib/timeframes'
import { fmt } from '@/lib/market'
import type { BrainResult } from '@/lib/brain'
export function SignalBrain({ timeframe, onChange, result, pending, error }: { timeframe: Timeframe; onChange: (tf: Timeframe) => void; result?: BrainResult; pending: boolean; error: boolean }) {
  const state = error ? 'OFFLINE' : pending && !result ? 'CONNECTING' : result?.status ?? 'CONNECTING'
  return <section className="brain-panel" aria-label="TimesFM signal brain">
    <div className="brain-heading"><div className="brain-identity"><BrainCircuit size={20}/><div><h2>TimesFM <span>SIGNAL BRAIN</span></h2><p>Google Research · 2.5 / 200M · mandatory decision gate</p></div></div><div className="brain-state"><span className={`status-dot ${state==='READY'?'live':''}`}/>{state === 'OFFLINE' ? 'SERVICE NOT CONNECTED' : state === 'WAIT' ? 'MODEL CONNECTED · WAIT' : state}</div></div>
    <div className="brain-controls"><div><span className="stat-label">SIGNAL + CHART TIMEFRAME</span><ToggleGroup value={[timeframe]} onValueChange={values=>{if(values.length)onChange(values[0] as Timeframe)}} size="sm" spacing={1} aria-label="Signal timeframe">{TIMEFRAMES.map(tf=><ToggleGroupItem key={tf} value={tf} aria-label={`${tf.toUpperCase()} signal timeframe`}>{tf.toUpperCase()}</ToggleGroupItem>)}</ToggleGroup></div><div className="brain-flow"><span>OKX closed candles</span><span>→</span><strong>TimesFM forecast</strong><span>→</span><span>Safety gates</span><span>→</span><span>Signal</span></div><div className="brain-horizon"><span className="stat-label">FORECAST HORIZON</span><strong>3 × {timeframe.toUpperCase()} candles</strong></div></div>
    <div className="brain-message" role="status"><ShieldCheck size={14}/><span>{error ? 'Signal endpoint unavailable. All decisions are blocked.' : result?.reason ?? 'Checking forecast service. Signals remain blocked until verified.'}</span><a href="https://github.com/google-research/timesfm" target="_blank" rel="noreferrer">Model source <ExternalLink size={11}/></a></div>
    {result?.forecast && <div className="forecast-summary"><span>3-bar forecast <b>{fmt(result.forecast.point[2])} USDT</b></span><span>Model P10–P90 <b>{fmt(result.forecast.lower[2])} — {fmt(result.forecast.upper[2])}</b></span><span>Uncalibrated forecast range · not a win probability</span></div>}
  </section>
}
