"""Shared retry-loop mechanics: exponential backoff with jitter.

The two Fyers HTTP retry call sites — fyers_service.py's option-chain fetch
(async, retries on Fyers' own JSON error codes) and fyers_headless.py's
Cloudflare-guarded POST (synchronous, runs inside a thread-pool worker,
retries on HTTP 429 / non-JSON challenge pages) — have genuinely different
retry-worthy-failure predicates and execution models, so only the backoff
arithmetic itself is shared here, not the retry loop control flow.
"""

import random


def compute_backoff_delay(
    attempt: int, base_delay: float, factor: float = 2.0, jitter: float = 0.5
) -> float:
    """Exponential backoff with jitter for retry attempt `attempt` (0-indexed)."""
    return base_delay * (factor**attempt) + random.uniform(0, jitter)
