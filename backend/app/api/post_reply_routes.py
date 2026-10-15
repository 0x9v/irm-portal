"""Private, origin-checked and bounded community post reply requests."""

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.account_mutation_route import (
    PRIVATE_NO_STORE,
    _private_json,
    _require_valid_session,
    _validation_details,
    is_trusted_account_origin,
)
from app.core.config import settings


MAX_POST_REPLY_MULTIPART_BODY_BYTES = 5_308_416
MAX_POST_REPLY_JSON_BODY_BYTES = 16 * 1024
_BOUNDARY_CHARS = frozenset(b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'()+_,-./:=? ")


def _validate_content_type(value: str | None) -> str:
    if value is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported request media type")
    if value.split(";", 1)[0].strip().lower() == "application/json":
        return "application/json"
    from starlette.formparsers import parse_options_header

    try:
        media, params = parse_options_header(value)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed multipart request") from None
    boundary = params.get(b"boundary")
    if (media.lower() != b"multipart/form-data" or not boundary or len(boundary) > 70
            or boundary.endswith(b" ") or any(char not in _BOUNDARY_CHARS for char in boundary)):
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported request media type")
    return "multipart/form-data"


async def _read_bounded_body(request: Request, max_bytes: int) -> None:
    lengths = request.headers.getlist("content-length")
    if len(lengths) > 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Length")
    if lengths:
        try:
            declared = int(lengths[0])
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Length") from None
        if declared < 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Length")
        if declared > max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Reply request body too large")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Reply request body too large")
        chunks.append(chunk)
    request._body = b"".join(chunks)


class PostReplyMutationRoute(APIRoute):
    """Check Origin and authenticate before reading/parsing bounded bodies."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request: Request):
            try:
                origins = request.headers.getlist("origin")
                if len(origins) != 1 or not is_trusted_account_origin(origins[0]):
                    raise HTTPException(status.HTTP_403_FORBIDDEN, "Untrusted request origin")
                await run_in_threadpool(
                    _require_valid_session,
                    request.cookies.get(settings.session_cookie_name),
                )
                content_types = request.headers.getlist("content-type")
                if len(content_types) != 1:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Type")
                kind = _validate_content_type(content_types[0])
                limit = MAX_POST_REPLY_MULTIPART_BODY_BYTES if kind == "multipart/form-data" else MAX_POST_REPLY_JSON_BODY_BYTES
                await _read_bounded_body(request, limit)
                response = await handler(request)
                response.headers["Cache-Control"] = PRIVATE_NO_STORE
                return response
            except StarletteHTTPException as error:
                return _private_json({"detail": error.detail}, error.status_code, error.headers)
            except RequestValidationError as error:
                return _private_json({"detail": _validation_details(error)}, status.HTTP_422_UNPROCESSABLE_ENTITY)
            except Exception:
                return _private_json({"detail": "Reply operation failed"}, status.HTTP_500_INTERNAL_SERVER_ERROR)

        return guarded


class PostReplyPrivateMediaRoute(APIRoute):
    """Keep private media headers on success and every error response."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request: Request):
            try:
                response = await handler(request)
            except StarletteHTTPException as error:
                response = _private_json({"detail": error.detail}, error.status_code, error.headers)
            except RequestValidationError as error:
                response = _private_json({"detail": _validation_details(error)}, status.HTTP_422_UNPROCESSABLE_ENTITY)
            except Exception:
                response = _private_json({"detail": "Reply image unavailable"}, status.HTTP_500_INTERNAL_SERVER_ERROR)
            response.headers["Cache-Control"] = PRIVATE_NO_STORE
            response.headers["Vary"] = "Cookie"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response

        return guarded
