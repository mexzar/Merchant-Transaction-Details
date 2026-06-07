"""Visible variants of the `amazon-orders` Playwright auth forms.

The default `PlaywrightJSAuthForm` runs headless. When Amazon presents a JS
challenge that requires interaction (a visual puzzle), headless mode times out.
`VisibleJSAuthForm` opens a real browser window so the user can solve it.

This module is loaded by `amazon-orders` via `auth_forms_classes` (a list of
dotted-path strings on `AmazonOrdersConfig`). It is *not* imported at top-level
by the rest of the app, so importing the rest of `merchant` does not require
the `[browser]` extra.
"""

from __future__ import annotations

from typing import Any

from amazonorders.contrib.browser.playwright import PlaywrightJSAuthForm


class VisibleJSAuthForm(PlaywrightJSAuthForm):
    def __init__(self, config: Any) -> None:
        super().__init__(config)
        self.headless = False
