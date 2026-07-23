"""Symmetric encryption for secrets persisted to the database.

Used to encrypt the broker access token before it's written to the
broker_sessions table, so a database dump/leak doesn't hand over a live
credential in plaintext.
"""

import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings

logger = logging.getLogger(__name__)

_warned_no_key = False


def _get_fernet(settings: Settings) -> Fernet | None:
    global _warned_no_key
    if not settings.broker_token_encryption_key:
        if not _warned_no_key:
            logger.warning(
                "BROKER_TOKEN_ENCRYPTION_KEY is not set - persisted broker "
                "access tokens are stored in plaintext. See backend/.env.example."
            )
            _warned_no_key = True
        return None
    return Fernet(settings.broker_token_encryption_key.encode())


def encrypt_token(plain: str, settings: Settings) -> str:
    """Encrypt for storage. Returns the input unchanged if no key is configured."""
    fernet = _get_fernet(settings)
    if fernet is None:
        return plain
    return fernet.encrypt(plain.encode()).decode()


def decrypt_token(value: str, settings: Settings) -> str:
    """Reverse of encrypt_token. Falls back to treating `value` as plaintext
    if it can't be decrypted — either no key is configured, the key changed,
    or the row predates encryption being turned on."""
    fernet = _get_fernet(settings)
    if fernet is None:
        return value
    try:
        return fernet.decrypt(value.encode()).decode()
    except InvalidToken:
        logger.warning("Could not decrypt persisted broker access token; treating as plaintext.")
        return value
