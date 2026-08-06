"""Symbol-reference helpers shared by the Dhan broker adapter.

Pure, stateless parsing of Dhan's ``EXCHANGE_SEGMENT:SECURITY_ID`` symbol
convention — independent of any one broker session's HTTP client.
"""

from app.core.exceptions import BrokerConnectionError


def parse_dhan_security_ref(value: str) -> tuple[str, str]:
    """Split Dhan's explicit ``EXCHANGE_SEGMENT:SECURITY_ID`` reference."""
    segment, separator, security_id = value.partition(":")
    if not separator or not segment or not security_id:
        raise BrokerConnectionError(
            "Dhan symbols must use EXCHANGE_SEGMENT:SECURITY_ID, for example NSE_EQ:11536."
        )
    return segment.upper(), security_id
