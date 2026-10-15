"""Static sticker image validation and canonical WebP conversion."""

from io import BytesIO
import re
from uuid import UUID, uuid4
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_STICKER_UPLOAD_BYTES = 2_097_152
MAX_STICKER_DIMENSION = 4096
MAX_STICKER_PIXELS = 16_000_000
MAX_STORED_STICKER_BYTES = 262_144
STICKER_SIZE = (256, 256)
_INPUT_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}


class StickerImageError(ValueError):
    """Sanitized validation/encoding failure with a stable outcome code."""

    def __init__(self, outcome: str):
        self.outcome = outcome
        super().__init__(outcome.replace("_", " "))


_STICKER_KEY = re.compile(
    r"stickers/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp\Z"
)


class InvalidStickerStorageKey(ValueError):
    pass


def generate_sticker_storage_key(owner_id: UUID, asset_id: UUID) -> str:
    if not isinstance(owner_id, UUID) or not isinstance(asset_id, UUID):
        raise TypeError("owner_id and asset_id must be UUIDs")
    return f"stickers/{owner_id}/{asset_id}/{uuid4()}.webp"


def validate_sticker_storage_key(storage_key: str, owner_id: UUID) -> tuple[UUID, UUID]:
    if not isinstance(storage_key, str) or not isinstance(owner_id, UUID):
        raise InvalidStickerStorageKey("Invalid sticker reference")
    match = _STICKER_KEY.fullmatch(storage_key)
    if match is None or match.group(1) != str(owner_id):
        raise InvalidStickerStorageKey("Invalid sticker reference")
    return UUID(match.group(2)), UUID(match.group(3))


def sticker_storage_owner_id(storage_key: str) -> UUID:
    """Read the owner UUID embedded in a trusted, canonical generated key."""
    match = _STICKER_KEY.fullmatch(storage_key) if isinstance(storage_key, str) else None
    if match is None:
        raise InvalidStickerStorageKey("Invalid sticker reference")
    return UUID(match.group(1))


def process_sticker_image(data: bytes, declared_media_type: str) -> bytes:
    """Validate one static JPEG/PNG and return metadata-free lossless WebP.

    The caller should invoke this CPU-bound function in a worker thread.
    """
    media_type = declared_media_type.split(";", 1)[0].strip().lower() if isinstance(declared_media_type, str) else ""
    expected_format = _INPUT_FORMATS.get(media_type)
    if expected_format is None:
        raise StickerImageError("unsupported_media_type")
    if not isinstance(data, bytes) or not data:
        raise StickerImageError("invalid_image")
    if len(data) > MAX_STICKER_UPLOAD_BYTES:
        raise StickerImageError("input_too_large")
    if not features_webp_available():
        raise StickerImageError("webp_encoder_unavailable")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format != expected_format:
                    raise StickerImageError("mime_mismatch")
                _validate_size(probe.size)
                _validate_single_frame(probe)
                probe.verify()
            with Image.open(BytesIO(data)) as source:
                if source.format != expected_format:
                    raise StickerImageError("mime_mismatch")
                _validate_size(source.size)
                _validate_single_frame(source)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                _validate_size(oriented.size)
                contained = ImageOps.contain(oriented, STICKER_SIZE, method=Image.Resampling.LANCZOS)
                rgba = contained.convert("RGBA")
                canvas = Image.new("RGBA", STICKER_SIZE, (0, 0, 0, 0))
                x = (STICKER_SIZE[0] - rgba.width) // 2
                y = (STICKER_SIZE[1] - rgba.height) // 2
                canvas.alpha_composite(rgba, (x, y))
                # A fresh RGBA canvas carries only pixel data; source metadata is not copied.
                output = BytesIO()
                canvas.save(output, format="WEBP", lossless=True, exact=True, method=4)
                encoded = output.getvalue()
    except StickerImageError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError,
            UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError) as error:
        raise StickerImageError("invalid_image") from error
    except Exception as error:
        # Codec/plugin errors must not expose implementation details or user bytes.
        raise StickerImageError("encoding_failed") from error

    if len(encoded) > MAX_STORED_STICKER_BYTES:
        raise StickerImageError("output_too_large")
    return encoded


def validate_canonical_sticker_bytes(data: bytes) -> None:
    """Decode and validate a stored canonical WebP without exposing details."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format != "WEBP" or probe.size != STICKER_SIZE:
                    raise StickerImageError("invalid_canonical_image")
                _validate_single_frame(probe)
                probe.verify()
            with Image.open(BytesIO(data)) as image:
                if image.format != "WEBP" or image.size != STICKER_SIZE:
                    raise StickerImageError("invalid_canonical_image")
                _validate_single_frame(image)
                image.load()
    except StickerImageError:
        raise
    except Exception as error:
        raise StickerImageError("invalid_canonical_image") from error


def _validate_size(size: tuple[int, int]) -> None:
    width, height = size
    if (width < 32 or height < 32 or width > MAX_STICKER_DIMENSION
            or height > MAX_STICKER_DIMENSION or width * height > MAX_STICKER_PIXELS):
        raise StickerImageError("dimensions_invalid")


def _validate_single_frame(image: Image.Image) -> None:
    if getattr(image, "n_frames", 1) != 1 or getattr(image, "is_animated", False):
        raise StickerImageError("animated_image")


def features_webp_available() -> bool:
    try:
        from PIL import features

        if not features.check("webp"):
            return False
        probe = BytesIO()
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(probe, format="WEBP", lossless=True, exact=True)
        return bool(probe.getvalue())
    except Exception:
        return False
