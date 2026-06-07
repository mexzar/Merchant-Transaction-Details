"""Application configuration and on-disk paths.

We persist only non-sensitive settings (where to write exports). Amazon
credentials and MFA codes are entered per-run in the UI and held in memory only
for the duration of a scrape — they are never written to disk.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from platformdirs import user_config_dir, user_documents_dir
from pydantic import BaseModel

APP_NAME = "MerchantTransactionDetails"


class SavedAccount(BaseModel):
    """Non-secret record of an account whose secrets are in the OS keychain.

    The actual password / TOTP secret live in the keychain (see credentials.py);
    these flags only tell the UI what was remembered so it can offer the account.
    """

    email: str
    store_password: bool = False
    store_otp_secret: bool = False


class AppConfig(BaseModel):
    """Top-level persisted settings."""

    # Where exported JSON files are written. Defaults to ~/Documents/<APP_NAME>.
    export_dir: Optional[str] = None
    # Accounts with secrets remembered in the OS keychain.
    saved_accounts: list[SavedAccount] = []

    def find_account(self, email: str) -> Optional[SavedAccount]:
        for acct in self.saved_accounts:
            if acct.email == email:
                return acct
        return None

    def upsert_account(self, email: str, *, store_password: bool, store_otp_secret: bool) -> None:
        acct = self.find_account(email)
        if acct is None:
            self.saved_accounts.append(
                SavedAccount(
                    email=email,
                    store_password=store_password,
                    store_otp_secret=store_otp_secret,
                )
            )
        else:
            acct.store_password = store_password
            acct.store_otp_secret = store_otp_secret
        # Drop accounts that no longer remember anything.
        self.saved_accounts = [
            a for a in self.saved_accounts if a.store_password or a.store_otp_secret
        ]

    def remove_account(self, email: str) -> None:
        self.saved_accounts = [a for a in self.saved_accounts if a.email != email]


def config_dir() -> Path:
    path = Path(user_config_dir(APP_NAME, appauthor=False))
    path.mkdir(parents=True, exist_ok=True)
    return path


def config_path() -> Path:
    return config_dir() / "config.json"


def default_export_dir() -> Path:
    return Path(user_documents_dir()) / APP_NAME


def export_dir(config: AppConfig) -> Path:
    path = Path(config.export_dir) if config.export_dir else default_export_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_config() -> AppConfig:
    path = config_path()
    if path.exists():
        try:
            return AppConfig.model_validate_json(path.read_text(encoding="utf-8"))
        except (ValueError, json.JSONDecodeError):
            # Corrupt config — fall back to defaults rather than crashing the app.
            return AppConfig()
    return AppConfig()


def save_config(config: AppConfig) -> None:
    config_path().write_text(
        config.model_dump_json(indent=2),
        encoding="utf-8",
    )
