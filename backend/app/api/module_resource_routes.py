"""Request-size guard for typed module-resource creation."""

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.api.account_mutation_route import _private_json, _validation_details, is_trusted_account_origin


MAX_RESOURCE_MULTIPART_OVERHEAD = 64 * 1024
MAX_RESOURCE_JSON_BODY_BYTES = 16 * 1024


def _resource_error(detail: object, status_code: int, headers: dict[str, str] | None = None):
    return _private_json({"detail": detail}, status_code,
                         {**(headers or {}), "Vary": "Cookie"})


class ModuleResourceMutationRoute(APIRoute):
    """Check Origin and bound mutation bodies; keep all resource responses private."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def guarded(request: Request):
            try:
                if request.method in ("POST", "DELETE"):
                    origins = request.headers.getlist("origin")
                    if len(origins) != 1 or not is_trusted_account_origin(origins[0]):
                        return _resource_error("Untrusted request origin", status.HTTP_403_FORBIDDEN)
                if request.method == "DELETE":
                    lengths = request.headers.getlist("content-length")
                    if len(lengths) > 1:
                        return _resource_error("Invalid Content-Length", 400)
                    if lengths:
                        try:
                            declared = int(lengths[0])
                        except ValueError:
                            return _resource_error("Invalid Content-Length", 400)
                        if declared < 0:
                            return _resource_error("Invalid Content-Length", 400)
                        if declared:
                            return _resource_error("Resource removal takes no body", 422)
                    async for chunk in request.stream():
                        if chunk:
                            return _resource_error("Resource removal takes no body", 422)
                    request._body = b""
                if request.method == "POST":
                    content_types = request.headers.getlist("content-type")
                    if len(content_types) != 1:
                        return _resource_error("Invalid resource request media type", 415)
                    content_type = content_types[0].split(";", 1)[0].strip().lower()
                    if content_type == "multipart/form-data":
                        maximum = settings.document_upload_max_bytes + MAX_RESOURCE_MULTIPART_OVERHEAD
                    elif content_type == "application/json":
                        maximum = MAX_RESOURCE_JSON_BODY_BYTES
                    else:
                        return _resource_error("Invalid resource request media type", 415)

                    lengths = request.headers.getlist("content-length")
                    if len(lengths) > 1:
                        return _resource_error("Invalid Content-Length", 400)
                    if lengths:
                        try:
                            declared = int(lengths[0])
                        except ValueError:
                            return _resource_error("Invalid Content-Length", 400)
                        if declared < 0:
                            return _resource_error("Invalid Content-Length", 400)
                        if declared > maximum:
                            return _resource_error("Resource request body too large", 413)

                    chunks = []
                    total = 0
                    async for chunk in request.stream():
                        total += len(chunk)
                        if total > maximum:
                            return _resource_error("Resource request body too large", 413)
                        chunks.append(chunk)
                    request._body = b"".join(chunks)
                response = await handler(request)
                response.headers["Cache-Control"] = "private, no-store"
                response.headers["Vary"] = "Cookie"
                return response
            except StarletteHTTPException as error:
                return _resource_error(error.detail, error.status_code, error.headers)
            except RequestValidationError as error:
                return _resource_error(_validation_details(error), 422)
            except Exception:
                return _resource_error("Resource operation failed", 500)

        return guarded
