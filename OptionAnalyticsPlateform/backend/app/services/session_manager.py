"""Session Manager for Broker Services.

Maintains in-memory dictionary of authenticated broker sessions keyed by client_id.
This enables a stateless single-account flow without persisting credentials in the DB.
"""


from app.services.broker_base import BrokerService


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, BrokerService] = {}

    def set_session(self, client_id: str, service: BrokerService) -> None:
        """Store an active broker service session."""
        self._sessions[client_id] = service

    def get_session(self, client_id: str) -> BrokerService | None:
        """Retrieve an active broker service session."""
        return self._sessions.get(client_id)

    async def remove_session(self, client_id: str) -> None:
        """Close and remove a broker service session."""
        service = self._sessions.pop(client_id, None)
        if service:
            await service.close()

session_manager = SessionManager()
