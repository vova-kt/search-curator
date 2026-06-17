"""Auth: deterministic principals per scheme, and ownership enforcement."""

from __future__ import annotations

import pytest

from events_curator.auth import (
    LocalAuthenticator,
    NotOwnerError,
    TelegramAuthenticator,
    ensure_owner,
)
from events_curator.enums import AuthScheme
from events_curator.models import Principal, SavedQuery, UserId


async def test_local_authenticator_fixed_identity() -> None:
    principal = await LocalAuthenticator().authenticate("ignored")
    assert principal.user_id == UserId("local")
    assert principal.scheme is AuthScheme.LOCAL


async def test_telegram_authenticator_namespaces_chat_id() -> None:
    principal = await TelegramAuthenticator().authenticate("12345")
    assert principal is not None
    assert principal.user_id == UserId("tg:12345")
    assert principal.scheme is AuthScheme.TELEGRAM


async def test_telegram_authenticator_rejects_blank() -> None:
    assert await TelegramAuthenticator().authenticate("   ") is None


def test_ensure_owner_allows_owner() -> None:
    query = SavedQuery(user_id=UserId("u1"), text="t")
    owner = Principal(user_id=UserId("u1"), scheme=AuthScheme.LOCAL)
    ensure_owner(owner, query)  # does not raise


def test_ensure_owner_rejects_other_user() -> None:
    query = SavedQuery(user_id=UserId("u1"), text="t")
    intruder = Principal(user_id=UserId("u2"), scheme=AuthScheme.LOCAL)
    with pytest.raises(NotOwnerError):
        ensure_owner(intruder, query)
