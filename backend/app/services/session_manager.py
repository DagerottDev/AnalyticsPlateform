"""Session Manager for Broker Services.

Holds at most one authenticated broker session at a time — logging in
replaces whatever session was previously active, closing it first. This
enables a stateless single-account flow without persisting credentials in
the DB.
"""


import asyncio

from app.services.broker_base import BrokerService


class SessionManager:
    def __init__(self) -> None:
        self._client_id: str | None = None
        self._service: BrokerService | None = None
        self._generation = 0
        self._change_event = asyncio.Event()
        self._mutation_lock = asyncio.Lock()

    async def set_session(self, client_id: str, service: BrokerService) -> None:
        """Replace the active broker session with a new one.

        Closes any previously active session first, since only one broker
        connection is supported at a time.
        """
        async with self._mutation_lock:
            previous = self._service
            if previous is service and self._client_id == client_id:
                return
            if previous is not None:
                await previous.close()
            self._client_id = client_id
            self._service = service
            self._signal_change()

    def get_session(self, client_id: str) -> BrokerService | None:
        """Retrieve the active broker service session, if it matches client_id."""
        if client_id is not None and client_id == self._client_id:
            return self._service
        return None

    def get_session_snapshot(
        self, client_id: str | None
    ) -> tuple[BrokerService | None, int, asyncio.Event]:
        """Return one consistent service/generation snapshot for a websocket.

        The event is set whenever the active broker service changes. Long-lived
        consumers must reconnect instead of retaining the closed service object.
        """
        service = self.get_session(client_id) if client_id else None
        return service, self._generation, self._change_event

    @property
    def generation(self) -> int:
        return self._generation

    def get_active_session(self) -> BrokerService | None:
        """Return the sole active session for trusted background jobs."""
        return self._service

    def get_active_client_id(self) -> str | None:
        """The owner of the sole active session, for background-job scoping."""
        return self._client_id

    async def clear(self) -> None:
        """Close and remove the active session, if any."""
        async with self._mutation_lock:
            if self._service is None and self._client_id is None:
                return
            if self._service is not None:
                await self._service.close()
            self._client_id = None
            self._service = None
            self._signal_change()

    async def remove_session(self, client_id: str) -> None:
        """Close and remove the active session if it belongs to client_id."""
        if client_id == self._client_id:
            await self.clear()

    def _signal_change(self) -> None:
        previous_event = self._change_event
        self._generation += 1
        self._change_event = asyncio.Event()
        previous_event.set()


session_manager = SessionManager()
