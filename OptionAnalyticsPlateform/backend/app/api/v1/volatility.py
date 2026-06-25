from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from datetime import datetime, timedelta
import random

router = APIRouter()

def generate_historical_volatility(symbol: str, days: int = 252) -> List[Dict[str, Any]]:
    """
    Generates realistic historical implied vs realized volatility data.
    """
    data = []
    end_date = datetime.now()
    
    # Base volatility changes slightly by symbol
    base_iv = 0.15 if symbol == "NIFTY" else 0.20
    
    current_iv = base_iv
    current_rv = base_iv * 0.9 # RV usually tracks slightly below IV (variance premium)
    
    for i in range(days, 0, -1):
        date = end_date - timedelta(days=i)
        # Skip weekends
        if date.weekday() > 4:
            continue
            
        # Random walk for vol
        iv_change = random.gauss(0, 0.01)
        current_iv = max(0.08, min(0.80, current_iv + iv_change))
        
        # RV follows IV with some lag/noise
        rv_change = random.gauss((current_iv - current_rv) * 0.1, 0.015)
        current_rv = max(0.05, min(0.80, current_rv + rv_change))
        
        data.append({
            "date": date.strftime("%Y-%m-%d"),
            "iv": current_iv,
            "rv": current_rv
        })
        
    return data

@router.get("/{symbol}/historical")
async def get_historical_volatility(symbol: str, days: int = 252):
    """
    Returns timeseries of Implied vs Realized Volatility.
    """
    return generate_historical_volatility(symbol, days)

@router.get("/{symbol}/metrics")
async def get_volatility_metrics(symbol: str):
    """
    Returns current IV Rank (IVR) and IV Percentile (IVP).
    """
    data = generate_historical_volatility(symbol, 252)
    if not data:
        raise HTTPException(status_code=404, detail="No historical data found")
        
    ivs = [d["iv"] for d in data]
    current_iv = ivs[-1]
    
    # IV Rank = (Current IV - Min IV) / (Max IV - Min IV) * 100
    min_iv = min(ivs)
    max_iv = max(ivs)
    ivr = ((current_iv - min_iv) / (max_iv - min_iv)) * 100 if max_iv > min_iv else 0
    
    # IV Percentile = Percentage of days where historical IV < Current IV
    days_below = sum(1 for iv in ivs if iv < current_iv)
    ivp = (days_below / len(ivs)) * 100
    
    return {
        "symbol": symbol,
        "current_iv": current_iv,
        "iv_rank": ivr,
        "iv_percentile": ivp,
        "min_iv": min_iv,
        "max_iv": max_iv,
        "data_points": len(ivs)
    }
