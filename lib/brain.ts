import type { Setup } from './market'
import type { Timeframe } from './timeframes'
export type Forecast = { model: 'google/timesfm-2.5-200m-pytorch'; candleTime: number; point: number[]; lower: number[]; upper: number[] }
export type BrainResult = {
  timeframe: Timeframe; status: 'READY' | 'WAIT' | 'OFFLINE'; reason: string;
  forecast?: Forecast; setup: Setup | null; candleTime?: number; expiresAt?: number; generatedAt: number;
}
