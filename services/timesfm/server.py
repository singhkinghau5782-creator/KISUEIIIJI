import asyncio
import hmac
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import numpy as np
import timesfm
import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, FiniteFloat

MODEL_ID = "google/timesfm-2.5-200m-pytorch"
model = None
inference_lock = asyncio.Lock()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    if len(os.environ.get("TIMESFM_SERVICE_TOKEN", "")) < 32:
        raise RuntimeError("Set TIMESFM_SERVICE_TOKEN to a random secret of at least 32 characters")
    torch.set_float32_matmul_precision("high")
    model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)
    model.compile(timesfm.ForecastConfig(max_context=512, max_horizon=32, normalize_inputs=True, use_continuous_quantile_head=True, force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=True, per_core_batch_size=1))
    yield

app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)

class ForecastRequest(BaseModel):
    timeframe: Literal['1m','3m','5m','15m','30m','1H','3H']
    candleTime: int = Field(gt=0)
    closes: list[Annotated[FiniteFloat, Field(gt=0)]] = Field(min_length=64, max_length=300)
    horizon: Literal[3] = 3

@app.get('/health')
def health():
    return {"ready": model is not None, "model": MODEL_ID}

@app.post('/forecast')
async def forecast(request: ForecastRequest, authorization: str = Header(default="")):
    expected = "Bearer " + os.environ["TIMESFM_SERVICE_TOKEN"]
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if inference_lock.locked():
        raise HTTPException(status_code=429, detail="Inference busy; retry later")
    async with inference_lock:
        def infer():
            with torch.inference_mode():
                point, quantiles = model.forecast(horizon=request.horizon, inputs=[np.asarray(request.closes, dtype=np.float32)])
            arrays = [point[0, :3], quantiles[0, :3, 1], quantiles[0, :3, 9]]
            if not all(np.all(np.isfinite(a)) and np.all(a > 0) for a in arrays):
                raise ValueError("Invalid model forecast")
            return {"model": MODEL_ID, "candleTime": request.candleTime, "point": arrays[0].tolist(), "lower": arrays[1].tolist(), "upper": arrays[2].tolist()}
        return await asyncio.to_thread(infer)
