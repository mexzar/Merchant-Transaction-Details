"""Secure credential storage via the OS-native keychain (`keyring`).

Secrets (Amazon password and TOTP secret key) are stored in the operating
system's encrypted credential store — macOS Keychain, Windows Credential
Manager, or Linux Secret Service — never in any file we manage. The list of
*which* accounts have saved secrets is tracked separately in the non-sensitive
config.json (see config.py); only the secrets themselves live in the keychain.

The password and the TOTP secret are stored under distinct keychain entries so
they can be remembered (and forgotten) independently.
"""

from __future__ import annotations

from typing import Optional

SERVICE = "MarchantTransactionDetails"
_PASSWORD_SUFFIX = ":password"
_OTP_SUFFIX = ":otp_secret"


def is_available() -> bool:
    """Return True if a real OS keychain backend is usable.

    Returns False on systems with no Secret Service / keychain (e.g. some
    headless Linux boxes), so the UI can disable the "remember" options rather
    than failing mid-scrape.
    """
    try:
        import keyring
        from keyring.backends.fail import Keyring as FailKeyring

        return not isinstance(keyring.get_keyring(), FailKeyring)
    except Exception:  # noqa: BLE001 - any keyring import/backend issue means unavailable
        return False


def _set(account_suffix: str, email: str, secret: str) -> None:
    import keyring

    keyring.set_password(SERVICE, f"{email}{account_suffix}", secret)


def _get(account_suffix: str, email: str) -> Optional[str]:
    try:
        import keyring

        return keyring.get_password(SERVICE, f"{email}{account_suffix}")
    except Exception:  # noqa: BLE001
        return None


def _delete(account_suffix: str, email: str) -> None:
    try:
        import keyring
        from keyring.errors import PasswordDeleteError

        try:
            keyring.delete_password(SERVICE, f"{email}{account_suffix}")
        except PasswordDeleteError:
            pass  # Nothing stored — nothing to delete.
    except Exception:  # noqa: BLE001
        pass


# --- Password ---------------------------------------------------------------

def set_password(email: str, password: str) -> None:
    _set(_PASSWORD_SUFFIX, email, password)


def get_password(email: str) -> Optional[str]:
    return _get(_PASSWORD_SUFFIX, email)


def delete_password(email: str) -> None:
    _delete(_PASSWORD_SUFFIX, email)


# --- TOTP secret key (separate opt-in) --------------------------------------

def set_otp_secret(email: str, secret: str) -> None:
    _set(_OTP_SUFFIX, email, secret)


def get_otp_secret(email: str) -> Optional[str]:
    return _get(_OTP_SUFFIX, email)


def delete_otp_secret(email: str) -> None:
    _delete(_OTP_SUFFIX, email)


def forget(email: str) -> None:
    """Remove all stored secrets for an account."""
    delete_password(email)
    delete_otp_secret(email)
