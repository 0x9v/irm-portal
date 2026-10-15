"""Private, origin-checked and size-bounded browser account mutations."""

from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.sessions import validate_session
from app.database.session import SessionLocal
from app.models.user import User


MAX_ACCOUNT_JSON_BYTES = 16 * 1024
PRIVATE_NO_STORE = "private, no-store"


def _canonical_origin(value: str, *, configured: bool = False) -> tuple[str, str, int | None] | None:
    # urlsplit silently strips some whitespace/control characters and empty
    # query/fragment delimiters. Reject them before semantic origin matching.
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value) or "?" in value or "#" in value:
        return None
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or (parsed.path not in ("", "/") if configured else parsed.path != "")
        ):
            return None
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme.lower() == "https" else 80
        return parsed.scheme.lower(), parsed.hostname.lower(), port
    except ValueError:
        return None


def is_trusted_account_origin(origin: str | None) -> bool:
    """Compare a browser Origin to configured frontend origins by tuple."""
    if not origin or origin == "null":
        return False

    candidate = _canonical_origin(origin)
    if candidate is None:
        return False

    configured_origins = {settings.frontend_url}
    if settings.environment.lower() in {"development", "dev", "test"}:
        configured_origins.update({"http://localhost:3000", "http://127.0.0.1:3000"})

    return any(
        trusted is not None and candidate == trusted
        for trusted in (
            _canonical_origin(value, configured=True)
            for value in configured_origins
        )
    )


def _require_valid_session(raw_token: str | None) -> None:
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    db = SessionLocal()
    try:
        session = validate_session(db, raw_token)
        if session is None or db.query(User.id).filter(User.id == session.user_id).first() is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
    finally:
        db.close()


def _validation_details(exc: RequestValidationError) -> list[dict[str, object]]:
    """Keep FastAPI's locations and messages while discarding input/context."""
    safe: list[dict[str, object]] = []
    for error in exc.errors():
        safe.append({
            "loc": list(error.get("loc", ())),
            "type": str(error.get("type", "validation_error")),
            "msg": str(error.get("msg", "Invalid request")),
        })
    return safe


def _private_json(
    content: object,
    status_code: int,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    response_headers = dict(headers or {})
    response_headers["Cache-Control"] = PRIVATE_NO_STORE
    return JSONResponse(content=content, status_code=status_code, headers=response_headers)


class AccountMutationRoute(APIRoute):
    """Apply narrow request protections only to selected account mutations."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_account_handler(request: Request):
            try:
                origins = request.headers.getlist("origin")
                if len(origins) != 1 or not is_trusted_account_origin(origins[0]):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Untrusted request origin",
                    )

                content_type = request.headers.get("content-type", "")
                media_type = content_type.split(";", 1)[0].strip().lower()
                if media_type != "application/json":
                    raise HTTPException(
                        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        detail="Content-Type must be application/json",
                    )

                declared_length = request.headers.get("content-length")
                if declared_length is not None:
                    try:
                        length = int(declared_length)
                        if length < 0:
                            raise ValueError("Negative Content-Length")
                        if length > MAX_ACCOUNT_JSON_BYTES:
                            raise HTTPException(
                                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                                detail="Request body too large",
                            )
                    except ValueError:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Invalid Content-Length",
                        ) from None

                body_chunks: list[bytes] = []
                body_size = 0
                async for chunk in request.stream():
                    body_size += len(chunk)
                    if body_size > MAX_ACCOUNT_JSON_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Request body too large",
                        )
                    body_chunks.append(chunk)
                request._body = b"".join(body_chunks)

                # FastAPI parses JSON before resolving dependencies. Validate the
                # cookie first so malformed bodies cannot bypass guest denial.
                await run_in_threadpool(
                    _require_valid_session,
                    request.cookies.get(settings.session_cookie_name),
                )

                response = await handler(request)
                response.headers["Cache-Control"] = PRIVATE_NO_STORE
                return response
            except StarletteHTTPException as exc:
                return _private_json(
                    {"detail": exc.detail},
                    exc.status_code,
                    exc.headers,
                )
            except RequestValidationError as exc:
                return _private_json(
                    {"detail": _validation_details(exc)},
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            except Exception:
                # Deliberately do not log request data, exception text, SQL or
                # credentials on this private account mutation.
                return _private_json(
                    {"detail": "Account operation failed"},
                    status.HTTP_500_INTERNAL_SERVER_ERROR,
                )

        return private_account_handler
