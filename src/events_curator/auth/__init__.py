"""Deliberately simple auth: map an opaque credential to a `Principal`.

The DB is multi-user, so every request carries a principal and every saved
query is owned by exactly one user. Auth here is *identification* only — there
are no roles. The user id is derived deterministically from the credential, so
no storage lookup is needed; the app layer upserts the `User` row on first sight.
"""

from __future__ import annotations

import logging
from typing import Protocol

from events_curator.enums import AuthScheme
from events_curator.models import Principal, SavedQuery, UserId

logger = logging.getLogger("authenticator")


class Authenticator(Protocol):
    async def authenticate(self, credential: str) -> Principal | None: ...


class LocalAuthenticator(Authenticator):
    """LOCAL scheme: a single operator. Every credential is the same person."""

    def __init__(self, user_id: UserId | None = None) -> None:
        self._user_id = user_id or UserId("local")

    async def authenticate(self, credential: str) -> Principal:
        del credential
        logger.debug("local: authenticating")
        return Principal(user_id=self._user_id, scheme=AuthScheme.LOCAL, display_name="local")


class TelegramAuthenticator(Authenticator):
    """TELEGRAM scheme: the credential is the chat id; user id is namespaced."""

    async def authenticate(self, credential: str) -> Principal | None:
        chat_id = credential.strip()
        logger.debug(f"telegram: authenticating chat_id='{chat_id}'")
        if not chat_id:
            return None
        return Principal(user_id=UserId(f"tg:{chat_id}"), scheme=AuthScheme.TELEGRAM)


class NotOwnerError(PermissionError):
    """Raised when a principal touches a saved query it does not own."""


def ensure_owner(principal: Principal, query: SavedQuery) -> None:
    if principal.user_id != query.user_id:
        raise NotOwnerError(f"{principal.user_id} does not own saved query {query.id}")


__all__ = [
    "Authenticator",
    "LocalAuthenticator",
    "NotOwnerError",
    "TelegramAuthenticator",
    "ensure_owner",
]
