"""Validation and metadata-free JPEG conversion for community post replies."""

from hashlib import sha256
from io import BytesIO
import re
import warnings
from uuid import UUID, uuid4

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_REPLY_IMAGE_UPLOAD_BYTES = 5_242_880
MAX_REPLY_IMAGE_OUTPUT_BYTES = 2_097_152
MAX_REPLY_IMAGE_DIMENSION = 4096
MAX_REPLY_IMAGE_PIXELS = 12_000_000
MAX_REPLY_IMAGE_OUTPUT_SIDE = 1600
_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}
_KEY = re.compile(
    r"post-reply-images/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg\Z"
)


class PostReplyImageError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def generate_post_reply_image_key(reply_id: UUID) -> str:
    if not isinstance(reply_id, UUID):
        raise TypeError("reply_id must be a UUID")
    return f"post-reply-images/{reply_id}/{uuid4()}.jpg"


def validate_post_reply_image_key(key: str, reply_id: UUID) -> bool:
    match = _KEY.fullmatch(key) if isinstance(key, str) else None
    return bool(match and match.group(1) == str(reply_id))


def post_reply_image_owner(key: str) -> UUID:
    match = _KEY.fullmatch(key) if isinstance(key, str) else None
    if match is None:
        raise PostReplyImageError("invalid_key")
    return UUID(match.group(1))


def request_fingerprint(content: str, declared_mime: str, raw_image: bytes | None) -> str:
    """Hash normalized request parts with explicit tags and 64-bit lengths."""
    values = (
        (b"text", content.encode("utf-8")),
        (b"mime", declared_mime.encode("ascii") if raw_image is not None else b""),
        (b"image-sha256", sha256(raw_image).digest() if raw_image is not None else b""),
    )
    digest = sha256()
    for tag, value in values:
        digest.update(len(tag).to_bytes(4, "big"))
        digest.update(tag)
        digest.update(len(value).to_bytes(8, "big"))
        digest.update(value)
    return digest.hexdigest()


def _validate_dimensions(size: tuple[int, int]) -> None:
    width, height = size
    if (width < 32 or height < 32 or width > MAX_REPLY_IMAGE_DIMENSION
            or height > MAX_REPLY_IMAGE_DIMENSION or width * height > MAX_REPLY_IMAGE_PIXELS):
        raise PostReplyImageError("dimensions_invalid")


def _check_single_frame(image: Image.Image) -> None:
    if getattr(image, "n_frames", 1) != 1 or getattr(image, "is_animated", False):
        raise PostReplyImageError("animated_image")


def process_post_reply_image(data: bytes, declared_mime: str) -> bytes:
    """Validate JPEG/PNG, orient and downsize, then emit a fresh RGB JPEG."""
    expected = _FORMATS.get(declared_mime)
    if expected is None:
        raise PostReplyImageError("unsupported_media_type")
    if not isinstance(data, bytes) or not data:
        raise PostReplyImageError("invalid_image")
    if len(data) > MAX_REPLY_IMAGE_UPLOAD_BYTES:
        raise PostReplyImageError("input_too_large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format != expected:
                    raise PostReplyImageError("mime_mismatch")
                _validate_dimensions(probe.size)
                _check_single_frame(probe)
                probe.verify()
            with Image.open(BytesIO(data)) as source:
                if source.format != expected:
                    raise PostReplyImageError("mime_mismatch")
                _validate_dimensions(source.size)
                _check_single_frame(source)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                _validate_dimensions(oriented.size)
                scale = min(1.0, MAX_REPLY_IMAGE_OUTPUT_SIDE / max(oriented.size))
                size = (max(1, round(oriented.width * scale)), max(1, round(oriented.height * scale)))
                if size != oriented.size:
                    oriented = oriented.resize(size, Image.Resampling.LANCZOS)
                rgba = oriented.convert("RGBA")
                rgb = Image.new("RGB", rgba.size, (255, 255, 255))
                rgb.paste(rgba, mask=rgba.getchannel("A"))
                output = BytesIO()
                # A new image carries pixels only; source EXIF, ICC and comments are omitted.
                rgb.save(output, format="JPEG", quality=88, optimize=True, progressive=False)
                encoded = output.getvalue()
    except PostReplyImageError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError,
            UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError) as error:
        raise PostReplyImageError("invalid_image") from error
    except Exception as error:
        raise PostReplyImageError("processing_failed") from error
    if len(encoded) > MAX_REPLY_IMAGE_OUTPUT_BYTES:
        raise PostReplyImageError("output_too_large")
    return encoded


def validate_canonical_post_reply_image(data: bytes) -> None:
    if not isinstance(data, bytes) or not data or len(data) > MAX_REPLY_IMAGE_OUTPUT_BYTES:
        raise PostReplyImageError("invalid_canonical_image")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format != "JPEG" or probe.mode != "RGB":
                    raise PostReplyImageError("invalid_canonical_image")
                if max(probe.size) > MAX_REPLY_IMAGE_OUTPUT_SIDE:
                    raise PostReplyImageError("invalid_canonical_image")
                _check_single_frame(probe)
                probe.verify()
            with Image.open(BytesIO(data)) as image:
                if image.format != "JPEG" or image.mode != "RGB" or max(image.size) > MAX_REPLY_IMAGE_OUTPUT_SIDE:
                    raise PostReplyImageError("invalid_canonical_image")
                image.load()
    except PostReplyImageError:
        raise
    except Exception as error:
        raise PostReplyImageError("invalid_canonical_image") from error
