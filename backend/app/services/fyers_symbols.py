"""Symbol-mapping helpers shared by the Fyers broker adapter.

Fyers' REST and websocket APIs use exchange-qualified trading symbols
("NSE:NIFTY50-INDEX", "NSE:RELIANCE-EQ", ...) while the rest of the app works
with bare UI aliases ("NIFTY", "RELIANCE"). These are pure, stateless
translations — independent of any one broker session's client, caches, or
pacing locks — so they live here rather than on `FyersService` itself.
"""

# Fyers' option-chain endpoint expects exchange-qualified underlying symbols,
# not the plain index names the UI uses.
INDEX_SYMBOL_MAP = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "NIFTY 50": "NSE:NIFTY50-INDEX",
    "NIFTY50": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "BANK NIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
    "SENSEX": "BSE:SENSEX-INDEX",
    "BSE SENSEX": "BSE:SENSEX-INDEX",
}
_REVERSE_INDEX_SYMBOL_MAP = {
    "NSE:NIFTY50-INDEX": "NIFTY",
    "NSE:NIFTYBANK-INDEX": "BANKNIFTY",
    "NSE:FINNIFTY-INDEX": "FINNIFTY",
    "NSE:MIDCPNIFTY-INDEX": "MIDCPNIFTY",
    "BSE:SENSEX-INDEX": "SENSEX",
}
# NSE/Fyers renamed these cash and derivative underlyings. Keep accepting the
# legacy UI aliases while sending the current exchange symbols to every broker
# endpoint. The live Fyers NSE_FO master currently exposes TMPV and LTM.
_CURRENT_UNDERLYING_ALIASES = {
    "TATAMOTORS": "TMPV",
    "LTIM": "LTM",
    "ZOMATO": "ETERNAL",
}


def to_fyers_option_chain_symbol(symbol: str) -> str:
    """Map a UI symbol (NIFTY, RELIANCE, ...) to Fyers' option-chain
    underlying format — indices use their exchange INDEX symbol,
    everything else is treated as an NSE equity."""
    upper = symbol.upper()
    canonical = _CURRENT_UNDERLYING_ALIASES.get(upper, upper)
    return INDEX_SYMBOL_MAP.get(canonical, f"NSE:{canonical}-EQ")


def to_fyers_ws_symbol(symbol: str) -> str:
    """Map a UI symbol to what Fyers' websocket subscribe protocol expects.

    Option/equity trading symbols (e.g. "NSE:NIFTY2681823200PE") come from
    the REST instrument list already exchange-qualified and pass through
    unchanged; bare underlying symbols (NIFTY, RELIANCE, ...) — used for the
    underlying's own live price — get mapped the same way the option-chain
    REST calls do. Without this, Fyers rejects a bare "NIFTY" subscribe with
    "Please provide a valid symbol".
    """
    if ":" in symbol:
        return symbol
    return to_fyers_option_chain_symbol(symbol)


def from_fyers_ws_symbol(fyers_symbol: str) -> str:
    """Reverse of to_fyers_ws_symbol, for translating an incoming tick's
    symbol back to whatever bare alias the frontend subscribed with. Option
    contract trading symbols aren't bare aliases of anything, so they pass
    through unchanged.
    """
    if fyers_symbol in _REVERSE_INDEX_SYMBOL_MAP:
        return _REVERSE_INDEX_SYMBOL_MAP[fyers_symbol]
    if fyers_symbol.startswith("NSE:") and fyers_symbol.endswith("-EQ"):
        return fyers_symbol[len("NSE:") : -len("-EQ")]
    return fyers_symbol
