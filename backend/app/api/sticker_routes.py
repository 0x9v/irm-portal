"""Private request guards for account sticker library operations."""

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


MAX_STICKER_MULTIPART_BODY_BYTES = 2_228_224
MAX_STICKER_FILE_BYTES = 2_097_152
_BOUNDARY_CHARS = frozenset(b"0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'()+_,-./:=? ")


def _one_header(request: Request, name: str) -> str | None:
    values = request.headers.getlist(name)
    return values[0] if len(values) == 1 else None


def _validate_multipart_content_type(value: str | None) -> None:
    if value is None:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported request media type")
    from starlette.formparsers import parse_options_header

    try:
        media_type, params = parse_options_header(value)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed multipart request") from None
    if media_type.lower() != b"multipart/form-data":
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported request media type")
    boundary = params.get(b"boundary")
    if (not boundary or len(boundary) > 70 or boundary.endswith(b" ")
            or any(char not in _BOUNDARY_CHARS for char in boundary)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Malformed multipart request")


async def _read_bounded_body(request: Request) -> None:
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
        if declared > MAX_STICKER_MULTIPART_BODY_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Sticker request body too large")
    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_STICKER_MULTIPART_BODY_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Sticker request body too large")
        chunks.append(chunk)
    request._body = b"".join(chunks)


async def _require_empty_body(request: Request) -> None:
    lengths = request.headers.getlist("content-length")
    if len(lengths) > 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Removal request body must be empty")
    if lengths:
        try:
            if int(lengths[0]) != 0:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Removal request body must be empty")
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid Content-Length") from None
    async for chunk in request.stream():
        if chunk:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Removal request body must be empty")
    request._body = b""


class StickerMutationRoute(APIRoute):
    """Origin-check, bound and preflight-authenticate sticker mutations."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request: Request):
            try:
                origins = request.headers.getlist("origin")
                if len(origins) != 1 or not is_trusted_account_origin(origins[0]):
                    raise HTTPException(status.HTTP_403_FORBIDDEN, "Untrusted request origin")
                if request.method == "POST":
                    _validate_multipart_content_type(_one_header(request, "content-type"))
                    await _read_bounded_body(request)
                else:
                    await _require_empty_body(request)
                await run_in_threadpool(
                    _require_valid_session,
                    request.cookies.get(settings.session_cookie_name),
                )
                response = await handler(request)
                response.headers["Cache-Control"] = PRIVATE_NO_STORE
                return response
            except StarletteHTTPException as error:
                return _private_json({"detail": error.detail}, error.status_code, error.headers)
            except RequestValidationError as error:
                return _private_json({"detail": _validation_details(error)}, status.HTTP_422_UNPROCESSABLE_ENTITY)
            except Exception:
                return _private_json({"detail": "Sticker operation failed"}, status.HTTP_500_INTERNAL_SERVER_ERROR)

        return guarded


class StickerPrivateReadRoute(APIRoute):
    """Preflight session before owner-scoped target lookup; never cache responses."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request: Request):
            image_response = request.url.path.endswith("/image")
            try:
                await run_in_threadpool(
                    _require_valid_session,
                    request.cookies.get(settings.session_cookie_name),
                )
                response = await handler(request)
            except StarletteHTTPException as error:
                response = _private_json({"detail": error.detail}, error.status_code, error.headers)
            except RequestValidationError as error:
                response = _private_json({"detail": _validation_details(error)}, status.HTTP_422_UNPROCESSABLE_ENTITY)
            except Exception:
                response = _private_json({"detail": "Sticker operation failed"}, status.HTTP_500_INTERNAL_SERVER_ERROR)
            response.headers["Cache-Control"] = PRIVATE_NO_STORE
            if image_response:
                response.headers["Vary"] = "Cookie"
                response.headers["X-Content-Type-Options"] = "nosniff"
            return response

        return guarded
