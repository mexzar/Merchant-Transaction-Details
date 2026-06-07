"""Push scraped data to a configured web endpoint.

PHASE 2 — scaffolded but intentionally not wired into the UI flow yet. The shape
is ready: `push()` PUTs the exact exported JSON to the configured endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import EndpointConfig
from .exporter import to_json
from .models import ScrapeResult


@dataclass
class PushResult:
    ok: bool
    status_code: int | None
    message: str


def push(result: ScrapeResult, endpoint: EndpointConfig) -> PushResult:
    """PUT the exported JSON to the configured endpoint.

    Returns a PushResult rather than raising, so the UI can show a clean status.
    """
    if not endpoint.enabled:
        return PushResult(ok=False, status_code=None, message="Endpoint push is disabled.")
    if not endpoint.url:
        return PushResult(ok=False, status_code=None, message="No endpoint URL configured.")

    import httpx

    headers = {"Content-Type": "application/json"}
    if endpoint.auth_header_name and endpoint.auth_header_value:
        headers[endpoint.auth_header_name] = endpoint.auth_header_value

    try:
        response = httpx.put(
            endpoint.url,
            content=to_json(result),
            headers=headers,
            timeout=30.0,
        )
    except httpx.HTTPError as exc:
        return PushResult(ok=False, status_code=None, message=f"Request failed: {exc}")

    ok = 200 <= response.status_code < 300
    return PushResult(
        ok=ok,
        status_code=response.status_code,
        message="Pushed successfully." if ok else f"Endpoint returned {response.status_code}.",
    )
