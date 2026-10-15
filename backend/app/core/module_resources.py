"""Validation and canonicalization for non-PDF module resource payloads."""

from io import BytesIO
import re
import warnings
from uuid import UUID, uuid4
from urllib.parse import parse_qs, urlsplit

from PIL import Image, ImageOps, UnidentifiedImageError, features


MAX_RESOURCE_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_RESOURCE_IMAGE_DIMENSION = 4096
MAX_RESOURCE_IMAGE_PIXELS = 16_000_000
MAX_RESOURCE_IMAGE_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_RESOURCE_URL_LENGTH = 2048
_INPUT_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG"}
_YOUTUBE_ID = re.compile(r"[A-Za-z0-9_-]{11}\Z")
_RESOURCE_IMAGE_KEY = re.compile(
    r"module-resources/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/"
    r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.webp\Z"
)
_DNS_LABEL = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")


class ModuleResourceInputError(ValueError):
    """Stable, sanitized invalid-resource outcome."""

    def __init__(self, outcome: str):
        self.outcome = outcome
        super().__init__(outcome)


class InvalidModuleResourceImageKey(ValueError):
    """A resource-image key is not canonical or does not match its row."""


def generate_module_resource_image_key(community_id: UUID, module_id: UUID, resource_id: UUID) -> str:
    if not all(isinstance(value, UUID) for value in (community_id, module_id, resource_id)):
        raise TypeError("resource image key identifiers must be UUIDs")
    return f"module-resources/{community_id}/{module_id}/{resource_id}/{uuid4()}.webp"


def validate_module_resource_image_key(
    storage_key: str, community_id: UUID, module_id: UUID, resource_id: UUID
) -> UUID:
    if not isinstance(storage_key, str):
        raise InvalidModuleResourceImageKey("Invalid resource image reference")
    match = _RESOURCE_IMAGE_KEY.fullmatch(storage_key)
    if (match is None or match.group(1) != str(community_id)
            or match.group(2) != str(module_id) or match.group(3) != str(resource_id)):
        raise InvalidModuleResourceImageKey("Invalid resource image reference")
    return UUID(match.group(4))


def canonical_youtube_video_id(value: str) -> str:
    """Validate a supported YouTube URL without making any network request."""
    _validate_url_text(value)
    if len(value) > MAX_RESOURCE_URL_LENGTH:
        raise ModuleResourceInputError("url_too_long")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise ModuleResourceInputError("invalid_youtube_url") from error
    host = parsed.hostname
    if (parsed.scheme.lower() != "https" or host is None or host != host.lower()
            or host.endswith(".") or parsed.username is not None or parsed.password is not None
            or port not in (None, 443) or parsed.fragment):
        raise ModuleResourceInputError("invalid_youtube_url")
    if host not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        raise ModuleResourceInputError("invalid_youtube_url")

    video_id = None
    if host == "youtu.be":
        if parsed.path.count("/") != 1 or not parsed.path.startswith("/"):
            raise ModuleResourceInputError("invalid_youtube_url")
        video_id = parsed.path[1:]
        if parsed.query:
            raise ModuleResourceInputError("invalid_youtube_url")
    elif parsed.path == "/watch":
        try:
            query = parse_qs(parsed.query, strict_parsing=True, keep_blank_values=True)
        except ValueError as error:
            raise ModuleResourceInputError("invalid_youtube_url") from error
        if set(query) != {"v"} or len(query["v"]) != 1:
            raise ModuleResourceInputError("invalid_youtube_url")
        video_id = query["v"][0]
    elif parsed.path.startswith("/shorts/"):
        pieces = parsed.path.split("/")
        if len(pieces) != 3 or pieces[1] != "shorts" or parsed.query:
            raise ModuleResourceInputError("invalid_youtube_url")
        video_id = pieces[2]
    else:
        raise ModuleResourceInputError("invalid_youtube_url")

    if not _YOUTUBE_ID.fullmatch(video_id):
        raise ModuleResourceInputError("invalid_youtube_url")
    return video_id


def canonical_https_link(value: str) -> str:
    """Validate and normalize an absolute HTTPS link; never resolve or fetch it."""
    _validate_url_text(value)
    if len(value) > MAX_RESOURCE_URL_LENGTH:
        raise ModuleResourceInputError("url_too_long")
    try:
        parsed = urlsplit(value)
        port = parsed.port
        host = parsed.hostname
    except ValueError as error:
        raise ModuleResourceInputError("invalid_https_url") from error
    if (parsed.scheme.lower() != "https" or host is None or parsed.username is not None
            or parsed.password is not None or port not in (None, 443)):
        raise ModuleResourceInputError("invalid_https_url")
    if "\\" in parsed.netloc or host.endswith("."):
        raise ModuleResourceInputError("invalid_https_url")
    try:
        ascii_host = host.encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise ModuleResourceInputError("invalid_https_url") from error
    if (not ascii_host or len(ascii_host) > 253
            or any(not _DNS_LABEL.fullmatch(label) for label in ascii_host.split("."))
            or "." not in ascii_host or ascii_host.endswith((".localhost", ".local"))
            or ascii_host == "localhost"):
        raise ModuleResourceInputError("invalid_https_url")
    # Preserve path/query/fragment; only normalize scheme, host, and default port.
    netloc = ascii_host
    return parsed._replace(scheme="https", netloc=netloc).geturl()


def process_module_resource_image(data: bytes, declared_media_type: str) -> bytes:
    """Verify a static JPEG/PNG and emit bounded, metadata-free lossless WebP."""
    media_type = (declared_media_type.split(";", 1)[0].strip().lower()
                  if isinstance(declared_media_type, str) else "")
    expected_format = _INPUT_FORMATS.get(media_type)
    if expected_format is None:
        raise ModuleResourceInputError("unsupported_media_type")
    if not isinstance(data, bytes) or not data:
        raise ModuleResourceInputError("invalid_image")
    if len(data) > MAX_RESOURCE_IMAGE_UPLOAD_BYTES:
        raise ModuleResourceInputError("input_too_large")
    if not _webp_available():
        raise ModuleResourceInputError("webp_encoder_unavailable")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as probe:
                if probe.format != expected_format:
                    raise ModuleResourceInputError("mime_mismatch")
                _validate_image(probe)
                probe.verify()
            with Image.open(BytesIO(data)) as source:
                if source.format != expected_format:
                    raise ModuleResourceInputError("mime_mismatch")
                _validate_image(source)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                _validate_dimensions(oriented.size)
                output = BytesIO()
                # Paste decoded pixels into a fresh image so EXIF, ICC, comments,
                # and other source metadata are not copied into the output.
                mode = "RGBA" if "A" in oriented.getbands() else "RGB"
                pixels = oriented.convert(mode)
                canonical = Image.new(mode, pixels.size)
                canonical.paste(pixels)
                try:
                    canonical.save(output, format="WEBP", lossless=True, exact=True, method=4)
                except Exception as error:
                    raise ModuleResourceInputError("image_processing_failed") from error
                encoded = output.getvalue()
    except ModuleResourceInputError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError,
            UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError) as error:
        raise ModuleResourceInputError("invalid_image") from error
    except Exception as error:
        raise ModuleResourceInputError("image_processing_failed") from error

    if len(encoded) > MAX_RESOURCE_IMAGE_OUTPUT_BYTES:
        raise ModuleResourceInputError("output_too_large")
    return encoded


def _validate_url_text(value: str) -> None:
    if not isinstance(value, str) or not value or any(ord(char) <= 0x20 or ord(char) == 0x7f for char in value):
        raise ModuleResourceInputError("invalid_url")
    if "\\" in value:
        raise ModuleResourceInputError("invalid_url")


def _validate_image(image: Image.Image) -> None:
    _validate_dimensions(image.size)
    if getattr(image, "n_frames", 1) != 1 or getattr(image, "is_animated", False):
        raise ModuleResourceInputError("animated_image")


def _validate_dimensions(size: tuple[int, int]) -> None:
    width, height = size
    if (width < 1 or height < 1 or width > MAX_RESOURCE_IMAGE_DIMENSION
            or height > MAX_RESOURCE_IMAGE_DIMENSION or width * height > MAX_RESOURCE_IMAGE_PIXELS):
        raise ModuleResourceInputError("dimensions_invalid")


def _webp_available() -> bool:
    try:
        if not features.check("webp"):
            return False
        probe = BytesIO()
        Image.new("RGBA", (1, 1), (0, 0, 0, 0)).save(
            probe, format="WEBP", lossless=True, exact=True
        )
        return bool(probe.getvalue())
    except Exception:
        return False
