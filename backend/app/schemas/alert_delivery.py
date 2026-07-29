"""Safe API contracts for external alert delivery settings."""

from pydantic import BaseModel, ConfigDict, HttpUrl


def _camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.capitalize() for part in tail)


class AlertDeliverySettingsUpdate(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)
    email_enabled: bool = False
    email_recipient: str | None = None
    webhook_enabled: bool = False
    webhook_url: HttpUrl | None = None
    telegram_enabled: bool = False
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    slack_enabled: bool = False
    slack_webhook_url: HttpUrl | None = None


class AlertDeliverySettingsResponse(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)
    email_enabled: bool = False
    email_recipient: str | None = None
    webhook_enabled: bool = False
    webhook_url: str | None = None
    telegram_enabled: bool = False
    telegram_bot_token_configured: bool = False
    telegram_chat_id: str | None = None
    slack_enabled: bool = False
    slack_webhook_url: str | None = None
