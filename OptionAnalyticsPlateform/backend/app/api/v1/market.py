from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.auth import get_current_user
from app.schemas.market import ExpiryList, Instrument, InstrumentResponse
from app.services.session_manager import session_manager

router = APIRouter(prefix="/market", tags=["Market Data"])


@router.get("/instruments/{symbol}", response_model=InstrumentResponse)
async def get_instruments(
    symbol: str, current_user: dict = Depends(get_current_user)
) -> InstrumentResponse:
    """Get active instruments (options) for a given symbol."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    
    # Wait, the JWT token currently doesn't store the API key. 
    # Let's adjust to pass API key from header or assume OpenAlgo is accessible without it 
    # for public data, or we just rely on the mock for now.
    
    try:
        raw_instruments = await service.get_instruments(symbol.upper())
        instruments = [Instrument(**instr) for instr in raw_instruments]
        return InstrumentResponse(instruments=instruments)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/expiries/{symbol}", response_model=ExpiryList)
async def get_expiries(
    symbol: str, current_user: dict = Depends(get_current_user)
) -> ExpiryList:
    """Get a list of available expiries for a given symbol."""
    service = session_manager.get_session(current_user["sub"])
    if not service:
        raise HTTPException(status_code=401, detail="Active broker session not found")
    try:
        raw_instruments = await service.get_instruments(symbol.upper())
        expiries = set()
        for instr in raw_instruments:
            if instr.get("expiry"):
                expiries.add(instr["expiry"])
        
        # Sort expiries by date (assuming DD-MMM-YYYY format)
        import datetime
        def parse_expiry(date_str: str) -> datetime.datetime:
            try:
                return datetime.datetime.strptime(date_str, "%d-%b-%Y")
            except ValueError:
                return datetime.datetime.max
                
        sorted_expiries = sorted(list(expiries), key=parse_expiry)
        return ExpiryList(expiries=sorted_expiries)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
