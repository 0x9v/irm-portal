import asyncio

from fastapi import HTTPException
import pytest

from app.api.post_reply_routes import (
    MAX_POST_REPLY_MULTIPART_BODY_BYTES,
    _read_bounded_body,
    _validate_content_type,
)


class Headers:
    def __init__(self, pairs):
        self.pairs = pairs

    def getlist(self, name):
        return [value for key, value in self.pairs if key == name]


class StreamRequest:
    def __init__(self, chunks, content_length=None):
        self.chunks = chunks
        self.headers = Headers([] if content_length is None else [("content-length", str(content_length))])
        self._body = None

    async def stream(self):
        for chunk in self.chunks:
            yield chunk


def test_multipart_content_type_requires_a_bounded_boundary():
    assert _validate_content_type("multipart/form-data; boundary=abc123") == "multipart/form-data"
    with pytest.raises(HTTPException):
        _validate_content_type("multipart/form-data")
    with pytest.raises(HTTPException):
        _validate_content_type("multipart/form-data; boundary=" + "a" * 71)


def test_body_limit_checks_declared_and_streamed_bytes():
    declared = StreamRequest([], MAX_POST_REPLY_MULTIPART_BODY_BYTES + 1)
    with pytest.raises(HTTPException) as oversized_declaration:
        asyncio.run(_read_bounded_body(declared, MAX_POST_REPLY_MULTIPART_BODY_BYTES))
    assert oversized_declaration.value.status_code == 413

    streamed = StreamRequest([b"a" * 8, b"b" * 8])
    with pytest.raises(HTTPException) as oversized_stream:
        asyncio.run(_read_bounded_body(streamed, 10))
    assert oversized_stream.value.status_code == 413

    bounded = StreamRequest([b"abc", b"def"])
    asyncio.run(_read_bounded_body(bounded, 6))
    assert bounded._body == b"abcdef"
