"""Tests for keychain-backed credential storage and account bookkeeping.

Uses an in-memory keyring backend so the real OS keychain is never touched.
"""

from __future__ import annotations

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

from merchant import credentials
from merchant.config import AppConfig


class InMemoryKeyring(KeyringBackend):
    priority = 1

    def __init__(self) -> None:
        super().__init__()
        self._store: dict[tuple[str, str], str] = {}

    def set_password(self, service: str, username: str, password: str) -> None:
        self._store[(service, username)] = password

    def get_password(self, service: str, username: str):
        return self._store.get((service, username))

    def delete_password(self, service: str, username: str) -> None:
        if (service, username) not in self._store:
            raise PasswordDeleteError("not found")
        del self._store[(service, username)]


@pytest.fixture
def memory_keyring():
    previous = keyring.get_keyring()
    keyring.set_keyring(InMemoryKeyring())
    try:
        yield
    finally:
        keyring.set_keyring(previous)


def test_is_available_with_real_backend(memory_keyring):
    assert credentials.is_available() is True


def test_password_roundtrip(memory_keyring):
    assert credentials.get_password("a@b.com") is None
    credentials.set_password("a@b.com", "hunter2")
    assert credentials.get_password("a@b.com") == "hunter2"
    credentials.delete_password("a@b.com")
    assert credentials.get_password("a@b.com") is None
    # Deleting again is a no-op, not an error.
    credentials.delete_password("a@b.com")


def test_otp_secret_is_independent_of_password(memory_keyring):
    credentials.set_password("a@b.com", "pw")
    credentials.set_otp_secret("a@b.com", "SEED123")
    assert credentials.get_otp_secret("a@b.com") == "SEED123"
    # Forgetting the OTP seed must leave the password intact.
    credentials.delete_otp_secret("a@b.com")
    assert credentials.get_otp_secret("a@b.com") is None
    assert credentials.get_password("a@b.com") == "pw"


def test_forget_removes_everything(memory_keyring):
    credentials.set_password("a@b.com", "pw")
    credentials.set_otp_secret("a@b.com", "SEED")
    credentials.forget("a@b.com")
    assert credentials.get_password("a@b.com") is None
    assert credentials.get_otp_secret("a@b.com") is None


def test_config_upsert_and_remove_account():
    cfg = AppConfig()
    cfg.upsert_account("a@b.com", store_password=True, store_otp_secret=False)
    acct = cfg.find_account("a@b.com")
    assert acct is not None and acct.store_password and not acct.store_otp_secret

    # Updating flips flags in place (no duplicate).
    cfg.upsert_account("a@b.com", store_password=True, store_otp_secret=True)
    assert len(cfg.saved_accounts) == 1
    assert cfg.find_account("a@b.com").store_otp_secret is True

    # Remembering nothing drops the account entirely.
    cfg.upsert_account("a@b.com", store_password=False, store_otp_secret=False)
    assert cfg.find_account("a@b.com") is None

    cfg.upsert_account("c@d.com", store_password=True, store_otp_secret=False)
    cfg.remove_account("c@d.com")
    assert cfg.saved_accounts == []
