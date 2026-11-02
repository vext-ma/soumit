"""Official Python SDK for Soumit (https://soumit.ma).

Programmatic access to Moroccan public procurement tenders, award history,
AI analyses, Go/No-Go scorecards, and regulatory compliance under Décret n° 2-22-431.
"""

from .client import (
    DEFAULT_BASE_URL,
    AuthenticationError,
    ConflictError,
    InvalidRequestError,
    NotFoundError,
    PermissionError_,
    RateLimitError,
    ServerError,
    Soumit,
    SoumitError,
    verify_webhook_signature,
)

__version__ = "1.1.0"
__all__ = [
    "DEFAULT_BASE_URL",
    "AuthenticationError",
    "ConflictError",
    "InvalidRequestError",
    "NotFoundError",
    "PermissionError_",
    "RateLimitError",
    "ServerError",
    "Soumit",
    "SoumitError",
    "verify_webhook_signature",
]
