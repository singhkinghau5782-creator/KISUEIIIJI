'use client'
import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, ColorType, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import type { Candle, Setup } from '@/lib/market'
export function PriceChart({ candles, setup, interval }: { candles: Candle[]; setup: Setup | null; interval: string }) {
  const host = useRef<HTMLDivElement>(null), chart = useRef<IChartApi | null>(null), series = useRef<ISeriesApi<'Candlestick'> | null>(null), volume = useRef<ISeriesApi<'Histogram'> | null>(null), average = useRef<ISeriesApi<'Line'> | null>(null), initialized = useRef(false)
  useEffect(() => {
    if (!host.current) return
    const c = createChart(host.current, { autoSize:true, layout: { background:{type:ColorType.Solid,color:'#101316'},textColor:'#77818b',fontFamily:'monospace',fontSize:10 }, grid:{vertLines:{color:'#1c2025'},horzLines:{color:'#1c2025'}}, rightPriceScale:{borderColor:'#252b31',scaleMargins:{top:.12,bottom:.25}},timeScale:{borderColor:'#252b31',timeVisible:true,secondsVisible:false}, crosshair:{vertLine:{color:'#69717b'},horzLine:{color:'#69717b'}} })
    series.current=c.addSeries(CandlestickSeries,{upColor:'#39c995',downColor:'#f16e7b',wickUpColor:'#39c995',wickDownColor:'#f16e7b',borderVisible:false})
    volume.current=c.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:'volume'})
    c.priceScale('volume').applyOptions({scaleMargins:{top:.82,bottom:0},visible:false})
    average.current=c.addSeries(LineSeries,{color:'#d8b56b',lineWidth:1,priceLineVisible:false,lastValueVisible:false})
    chart.current=c; initialized.current=false
    return ()=>{c.remove();chart.current=null}
  },[])
  useEffect(()=>{ initialized.current=false },[interval])
  useEffect(()=>{
    if(!series.current || !candles.length) return
    series.current.setData(candles.map(c=>({...c,time:c.time as UTCTimestamp})))
    volume.current?.setData(candles.map(c=>({time:c.time as UTCTimestamp,value:c.volume,color:c.close>=c.open?'#224b40':'#4c2c33'})))
    average.current?.setData(candles.slice(20).map((c,i)=>({time:c.time as UTCTimestamp,value:candles.slice(i,i+21).reduce((s,x)=>s+x.close,0)/21})))
    if(!initialized.current){chart.current?.timeScale().setVisibleLogicalRange({from:Math.max(0,candles.length-85),to:candles.length+4}); initialized.current=true}
  },[candles])
  useEffect(()=>{
    const s=series.current
    if(!s || !setup) return
    const lines=[s.createPriceLine({price:setup.entry,color:'#d8b56b',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'ENTRY'}),s.createPriceLine({price:setup.stop,color:'#f16e7b',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'SL'}),s.createPriceLine({price:setup.target,color:'#39c995',lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'TP'})]
    return ()=>{if(chart.current) lines.forEach(l=>s.removePriceLine(l))}
  },[setup])
  return <div ref={host} className="price-chart" aria-label="Live OKX XAU USDT candlestick chart" />
}
