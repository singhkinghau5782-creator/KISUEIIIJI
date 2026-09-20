export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1H', '3H'] as const
export type Timeframe = typeof TIMEFRAMES[number]
export const SECONDS: Record<Timeframe, number> = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '3H': 10800 }
export function isTimeframe(value: string): value is Timeframe { return TIMEFRAMES.includes(value as Timeframe) }
