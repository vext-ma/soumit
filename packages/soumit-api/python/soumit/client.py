"""Soumit API client for Python.

Official SDK for Soumit (https://soumit.ma) — Moroccan Public Procurement Intelligence.

Design principles:
* Honesty contract: Unavailable fields are strictly None, detailed in resource['unavailable'].
* Typed exceptions: Errors match API error codes and carry request_id.
* auto_paginate: Yields objects across opaque cursors transparently.
* Exponential backoff: Automatically retries 429 and 5xx responses with Retry-After honoring.
* Safe idempotency: Mutating writes automatically carry an Idempotency-Key.
"""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from typing import Any, Iterator, Mapping, MutableMapping

import httpx

DEFAULT_BASE_URL = "https://soumit.ma"
DEFAULT_TIMEOUT = 30.0
MAX_PAGE_SIZE = 100
RETRYABLE_STATUS = {429, 500, 502, 503, 504}


# --- errors -----------------------------------------------------------------


class SoumitError(Exception):
    """Base class for Soumit API exceptions. Carries stable code and request id."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        param: str | None = None,
        request_id: str | None = None,
        detail: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.param = param
        self.request_id = request_id
        self.detail = dict(detail or {})

    def __str__(self) -> str:
        bits = [self.message]
        if self.code:
            bits.append(f"[{self.code}]")
        if self.request_id:
            bits.append(f"(request_id={self.request_id})")
        return " ".join(bits)


class InvalidRequestError(SoumitError):
    """400, 413, 415 — the request is malformed. Retrying will not help."""


class AuthenticationError(SoumitError):
    """401 — missing, malformed, revoked or expired API key."""


class PermissionError_(SoumitError):
    """403 — valid key but insufficient scope or inactive organization."""


class NotFoundError(SoumitError):
    """404 — resource not found or belongs to another organization."""


class ConflictError(SoumitError):
    """409 — idempotency key conflict or invalid state transition."""


class RateLimitError(SoumitError):
    """429 — rate limit budget exceeded."""

    @property
    def retry_after(self) -> float | None:
        val = self.detail.get("retry_after_seconds")
        return float(val) if val is not None else None


class ServerError(SoumitError):
    """500, 503 — edge/server error. Retryable with exponential backoff."""


_STATUS_TO_ERROR: dict[int, type[SoumitError]] = {
    400: InvalidRequestError,
    401: AuthenticationError,
    403: PermissionError_,
    404: NotFoundError,
    409: ConflictError,
    413: InvalidRequestError,
    415: InvalidRequestError,
    429: RateLimitError,
}


def _raise_for_error(response: httpx.Response) -> None:
    if response.status_code < 400:
        return

    request_id = response.headers.get("X-Request-Id")
    code = message = param = None
    detail: Mapping[str, Any] = {}
    try:
        error = response.json().get("error", {})
        code = error.get("code")
        message = error.get("message")
        param = error.get("param")
        detail = error.get("detail") or {}
    except Exception:
        pass

    exc_type = _STATUS_TO_ERROR.get(response.status_code)
    if exc_type is None:
        exc_type = ServerError if response.status_code >= 500 else SoumitError

    raise exc_type(
        message or f"HTTP {response.status_code}",
        code=code,
        status=response.status_code,
        param=param,
        request_id=request_id,
        detail=detail,
    )


# --- resources --------------------------------------------------------------


class _Resource:
    def __init__(self, client: "Soumit", path: str) -> None:
        self._client = client
        self._path = path

    def list(self, **params: Any) -> dict[str, Any]:
        """Fetch a single page of results."""
        return self._client.request("GET", self._path, params=params)

    def auto_paginate(self, **params: Any) -> Iterator[dict[str, Any]]:
        """Yield each resource across all pages using cursor traversal."""
        clean_params = dict(params)
        clean_params.setdefault("limit", MAX_PAGE_SIZE)
        cursor: str | None = clean_params.pop("cursor", None)

        while True:
            merged = {**clean_params}
            if cursor:
                merged["cursor"] = cursor
            page = self._client.request("GET", self._path, params=merged)
            for item in page.get("data", []):
                yield item

            if not page.get("has_more"):
                return

            cursor = page.get("next_cursor")
            if not cursor:
                raise SoumitError("API reported has_more=true but omitted next_cursor.")


class Tenders(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/tenders")

    def retrieve(self, tender_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"{self._path}/{tender_id}")

    def analysis(self, tender_id: str) -> dict[str, Any]:
        """Extract structured DCE data, risk factors, and provenance tier."""
        return self._client.request("GET", f"{self._path}/{tender_id}/analysis")

    def verdict(self, tender_id: str) -> dict[str, Any]:
        """Fetch Go/Watch/No-Go decision scorecard and factor weights."""
        return self._client.request("GET", f"{self._path}/{tender_id}/verdict")

    def documents(self, tender_id: str, **params: Any) -> dict[str, Any]:
        """List consultation files (CPS, RC, BPU, Règlement) and download URLs."""
        return self._client.request("GET", f"{self._path}/{tender_id}/documents", params=params)

    def catalogue_match(self, tender_id: str, **params: Any) -> dict[str, Any]:
        """Match organization product catalogue against tender technical requirements."""
        return self._client.request("GET", f"{self._path}/{tender_id}/catalogue-match", params=params)

    def submission_package(self, tender_id: str, **params: Any) -> dict[str, Any]:
        """Inspect generated submission documents (Acte d'engagement, Déclaration sur l'honneur)."""
        return self._client.request("GET", f"{self._path}/{tender_id}/submission-package", params=params)


class Awards(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/awards")


class Barometer:
    def __init__(self, client: "Soumit") -> None:
        self._client = client

    def current(self, **params: Any) -> dict[str, Any]:
        """Fetch weekly public procurement barometer snapshot."""
        return self._client.request("GET", "/api/v1/barometer", params=params)

    def quarterly(self, **params: Any) -> dict[str, Any]:
        """Fetch quarterly procurement intelligence report."""
        return self._client.request("GET", "/api/v1/barometer/quarterly", params=params)


class Boncommandes(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/boncommandes")


class Catalogue(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/catalogue")

    def retrieve(self, reference: str) -> dict[str, Any]:
        return self._client.request("GET", f"{self._path}/{reference}")

    def upsert(
        self, item: Mapping[str, Any], *, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        """Upsert item keyed on reference."""
        return self._client.request(
            "POST", self._path, json=item, idempotency_key=idempotency_key
        )


class Pursuits(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/pursuits")

    def upsert(
        self, pursuit: Mapping[str, Any], *, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        """Upsert pipeline pursuit status keyed on tender_id."""
        return self._client.request(
            "POST", self._path, json=pursuit, idempotency_key=idempotency_key
        )


class Executive(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/executive/briefings")

    def briefings(self, **params: Any) -> dict[str, Any]:
        return self.list(**params)

    def create_briefing(
        self, data: Mapping[str, Any], *, idempotency_key: str | None = None
    ) -> dict[str, Any]:
        return self._client.request(
            "POST", self._path, json=data, idempotency_key=idempotency_key
        )


class Events(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/events")


class Webhooks(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/webhooks")

    def create(self, url: str, event_types: list[str], **extra: Any) -> dict[str, Any]:
        """Create a webhook destination. Returns signing_secret once."""
        return self._client.request(
            "POST", self._path, json={"url": url, "event_types": event_types, **extra}
        )

    def retrieve(self, endpoint_id: str) -> dict[str, Any]:
        return self._client.request("GET", f"{self._path}/{endpoint_id}")

    def update(self, endpoint_id: str, **changes: Any) -> dict[str, Any]:
        return self._client.request("PATCH", f"{self._path}/{endpoint_id}", json=changes)

    def delete(self, endpoint_id: str) -> dict[str, Any]:
        return self._client.request("DELETE", f"{self._path}/{endpoint_id}")

    def deliveries(self, **params: Any) -> dict[str, Any]:
        return self._client.request("GET", "/api/v1/webhook-deliveries", params=params)


class ApiKeys(_Resource):
    def __init__(self, client: "Soumit") -> None:
        super().__init__(client, "/api/v1/api-keys")

    def create(self, **data: Any) -> dict[str, Any]:
        return self._client.request("POST", self._path, json=data)

    def revoke(self, key_id: str) -> dict[str, Any]:
        return self._client.request("DELETE", f"{self._path}/{key_id}")


# --- client -----------------------------------------------------------------


class Soumit:
    """Client for the Soumit API.

    Args:
        api_key: Secret API token (`sk_live_...`).
        base_url: Base endpoint URL. Defaults to 'https://soumit.ma'.
        timeout: Request timeout in seconds. Defaults to 30.0.
        max_retries: Retry attempts for 429 and 5xx responses.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = 3,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("An API key is required. (e.g., Soumit(api_key='sk_live_...'))")

        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self._client = http_client or httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
                "User-Agent": "vext-soumit-python/1.1.0",
            },
        )

        self.tenders = Tenders(self)
        self.awards = Awards(self)
        self.barometer = Barometer(self)
        self.boncommandes = Boncommandes(self)
        self.catalogue = Catalogue(self)
        self.pursuits = Pursuits(self)
        self.executive = Executive(self)
        self.events = Events(self)
        self.webhooks = Webhooks(self)
        self.api_keys = ApiKeys(self)

        self.rate_limit: dict[str, int] = {}

    def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        clean_params = {k: v for k, v in (params or {}).items() if v is not None}

        headers: MutableMapping[str, str] = {}
        if json is not None:
            headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())

        last_resp: httpx.Response | None = None
        for attempt in range(self.max_retries + 1):
            response = self._client.request(
                method, url, params=clean_params or None, json=json, headers=headers
            )
            self._record_rate_limit(response)
            last_resp = response

            if response.status_code not in RETRYABLE_STATUS or attempt == self.max_retries:
                break

            time.sleep(self._backoff(response, attempt))

        assert last_resp is not None
        _raise_for_error(last_resp)
        if last_resp.status_code == 204 or not last_resp.content:
            return {}
        return last_resp.json()

    def _record_rate_limit(self, response: httpx.Response) -> None:
        for header, key in (
            ("RateLimit-Limit", "limit"),
            ("RateLimit-Remaining", "remaining"),
            ("RateLimit-Reset", "reset"),
        ):
            val = response.headers.get(header)
            if val is not None:
                try:
                    self.rate_limit[key] = int(val)
                except ValueError:
                    pass

    @staticmethod
    def _backoff(response: httpx.Response, attempt: int) -> float:
        retry_after = response.headers.get("Retry-After")
        if retry_after:
            try:
                return min(float(retry_after), 300.0)
            except ValueError:
                pass
        return min(2.0**attempt, 60.0)

    def index(self) -> dict[str, Any]:
        """Discovery service index."""
        return self.request("GET", "/api/v1")

    def usage(self, **params: Any) -> dict[str, Any]:
        """Metered API volume."""
        return self.request("GET", "/api/v1/usage", params=params)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Soumit":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


# --- webhooks ---------------------------------------------------------------


def verify_webhook_signature(
    secret: str,
    signature_header: str,
    raw_body: bytes,
    *,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify an X-Soumit-Signature header on inbound webhooks.

    Prevents replay attacks and verifies HMAC-SHA256 signature against the raw body bytes.
    """
    try:
        parts = dict(
            piece.split("=", 1) for piece in signature_header.split(",") if "=" in piece
        )
    except Exception:
        return False

    timestamp, signature = parts.get("t"), parts.get("v1")
    if not timestamp or not signature:
        return False

    try:
        if abs(time.time() - int(timestamp)) > tolerance_seconds:
            return False
    except ValueError:
        return False

    expected = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)
