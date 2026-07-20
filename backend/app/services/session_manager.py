"""Session Manager for Broker Services.

Holds at most one authenticated broker session at a time — logging in
replaces whatever session was previously active, closing it first. This
enables a stateless single-account flow without persisting credentials in
the DB.
"""


from app.services.broker_base import BrokerService


class SessionManager:
    def __init__(self) -> None:
        self._client_id: str | None = None
        self._service: BrokerService | None = None

    async def set_session(self, client_id: str, service: BrokerService) -> None:
        """Replace the active broker session with a new one.

        Closes any previously active session first, since only one broker
        connection is supported at a time.
        """
        await self.clear()
        self._client_id = client_id
        self._service = service

    def get_session(self, client_id: str) -> BrokerService | None:
        """Retrieve the active broker service session, if it matches client_id."""
        if client_id is not None and client_id == self._client_id:
            return self._service
        return None

    async def clear(self) -> None:
        """Close and remove the active session, if any."""
        if self._service is not None:
            await self._service.close()
        self._client_id = None
        self._service = None

    async def remove_session(self, client_id: str) -> None:
        """Close and remove the active session if it belongs to client_id."""
        if client_id == self._client_id:
            await self.clear()


session_manager = SessionManager()
