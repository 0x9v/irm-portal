"""Private content responses, including authentication/masking failures."""

from fastapi import HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse


class PrivateContentRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request: Request):
            try:
                response = await handler(request)
            except HTTPException as exc:
                exc.headers = {**(exc.headers or {}), "Cache-Control": "private, no-store"}
                raise
            except RequestValidationError as exc:
                response = await request_validation_exception_handler(request, exc)
            response.headers["Cache-Control"] = "private, no-store"
            return response

        return private_handler


class PrivateStickerMediaRoute(PrivateContentRoute):
    """Apply private image headers to successful and concealed responses."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_image_handler(request: Request):
            try:
                response = await handler(request)
            except HTTPException as exc:
                exc.headers = {
                    **(exc.headers or {}),
                    "Cache-Control": "private, no-store",
                    "Vary": "Cookie",
                    "X-Content-Type-Options": "nosniff",
                }
                raise
            except Exception:
                response = JSONResponse(
                    {"detail": "Sticker unavailable"},
                    status_code=500,
                    headers={
                        "Cache-Control": "private, no-store",
                        "Vary": "Cookie",
                        "X-Content-Type-Options": "nosniff",
                    },
                )
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Vary"] = "Cookie"
            response.headers["X-Content-Type-Options"] = "nosniff"
            return response

        return private_image_handler
