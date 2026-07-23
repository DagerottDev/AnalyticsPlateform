"""Tests for the token-at-rest encryption helper."""

from cryptography.fernet import Fernet

from app.core.crypto import decrypt_token, encrypt_token
from tests.conftest import get_test_settings


def test_encrypt_then_decrypt_roundtrips() -> None:
    settings = get_test_settings()
    ciphertext = encrypt_token("my-secret-token", settings)
    assert ciphertext != "my-secret-token"
    assert decrypt_token(ciphertext, settings) == "my-secret-token"


def test_without_a_key_encrypt_is_a_passthrough() -> None:
    settings = get_test_settings().model_copy(update={"broker_token_encryption_key": None})
    assert encrypt_token("my-secret-token", settings) == "my-secret-token"
    assert decrypt_token("my-secret-token", settings) == "my-secret-token"


def test_decrypt_falls_back_to_plaintext_on_invalid_ciphertext() -> None:
    """Rows written before encryption was turned on are plaintext — decrypt
    should hand them back unchanged instead of raising."""
    settings = get_test_settings()
    assert decrypt_token("a-legacy-plaintext-token", settings) == "a-legacy-plaintext-token"


def test_decrypt_with_the_wrong_key_falls_back_to_the_raw_value() -> None:
    settings = get_test_settings()
    other_key_settings = get_test_settings().model_copy(
        update={"broker_token_encryption_key": Fernet.generate_key().decode()}
    )
    ciphertext = encrypt_token("my-secret-token", other_key_settings)
    assert decrypt_token(ciphertext, settings) == ciphertext
