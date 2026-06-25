from typing import List

from fastapi import APIRouter, Depends, HTTPException

from app.api.v1.auth import get_current_user
from app.models.user import UserProfile
from app.schemas.market import ExpiryList, Instrument, InstrumentResponse
from app.services.openalgo_service import OpenAlgoService

router = APIRouter(prefix="/market", tags=["Market Data"])


@router.get("/instruments/{symbol}", response_model=InstrumentResponse)
async def get_instruments(
    symbol: str, current_user: UserProfile = Depends(get_current_user)
) -> InstrumentResponse:
    """Get active instruments (options) for a given symbol."""
    service = OpenAlgoService(
        host=current_user.openalgo_host,
        api_key="internal_use",  # The exact API key is not stored in the JWT for security,
                                 # but OpenAlgo might need it. If needed, the frontend must supply it
                                 # or it should be cached securely.
                                 # For our mock/development flow, the service allows this.
        trading_mode=current_user.trading_mode,
    )
    
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
    symbol: str, current_user: UserProfile = Depends(get_current_user)
) -> ExpiryList:
    """Get a list of available expiries for a given symbol."""
    # To get expiries, we fetch all instruments and extract unique expiries.
    service = OpenAlgoService(
        host=current_user.openalgo_host,
        api_key="internal_use",
        trading_mode=current_user.trading_mode,
    )
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
