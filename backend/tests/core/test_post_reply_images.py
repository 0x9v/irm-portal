from io import BytesIO
from uuid import uuid4

from PIL import Image
import pytest

from app.core.post_reply_images import (
    MAX_REPLY_IMAGE_UPLOAD_BYTES,
    PostReplyImageError,
    process_post_reply_image,
    validate_canonical_post_reply_image,
)
from app.core.storage.exceptions import PostReplyImageStorageError
from app.core.storage.local import LocalFileSystemStorage


def _png(size=(80, 40), *, color=(100, 20, 10, 128), exif=None, animated=False):
    stream = BytesIO()
    first = Image.new("RGBA", size, color)
    if animated:
        second = Image.new("RGBA", size, (20, 200, 40, 255))
        first.save(stream, format="PNG", save_all=True, append_images=[second], duration=100, loop=0)
    else:
        first.save(stream, format="PNG", exif=exif or b"")
    return stream.getvalue()


def _jpeg():
    stream = BytesIO()
    Image.new("RGB", (80, 40), "black").save(stream, format="JPEG")
    return stream.getvalue()


def test_conversion_preserves_aspect_applies_orientation_flattens_alpha_and_strips_metadata():
    exif = Image.Exif()
    exif[274] = 6
    output = process_post_reply_image(_png(exif=exif, color=(100, 20, 10, 0)), "image/png")
    validate_canonical_post_reply_image(output)
    with Image.open(BytesIO(output)) as image:
        assert image.size == (40, 80)
        assert image.mode == "RGB"
        assert image.getpixel((0, 0))[0] > 240
        assert image.getpixel((0, 0))[1] > 240
        assert "exif" not in image.info and "icc_profile" not in image.info


@pytest.mark.parametrize("payload,mime", [
    (b"broken", "image/jpeg"),
    (_png(animated=True), "image/png"),
    (_png(size=(4097, 32)), "image/png"),
    (_png(), "image/jpeg"),
])
def test_conversion_rejects_corrupt_animated_dimensions_and_mime_spoof(payload, mime):
    with pytest.raises(PostReplyImageError):
        process_post_reply_image(payload, mime)


def test_conversion_rejects_truncated_jpeg_and_oversized_input():
    with pytest.raises(PostReplyImageError):
        process_post_reply_image(_jpeg()[:-2], "image/jpeg")
    with pytest.raises(PostReplyImageError):
        process_post_reply_image(b"x" * (MAX_REPLY_IMAGE_UPLOAD_BYTES + 1), "image/jpeg")


def test_reply_image_storage_ownership_bounded_io_and_symlink_rejection(tmp_path):
    storage = LocalFileSystemStorage(tmp_path)
    reply_id = uuid4()
    encoded = process_post_reply_image(_png(), "image/png")
    key = storage.save_post_reply_image_immutable(reply_id, encoded)
    assert key.startswith(f"post-reply-images/{reply_id}/")
    assert storage.read_post_reply_image_bounded(key, reply_id, len(encoded)) == encoded
    with pytest.raises(PostReplyImageStorageError):
        storage.read_post_reply_image_bounded(key, uuid4(), len(encoded))
    with pytest.raises(PostReplyImageStorageError):
        storage.read_post_reply_image_bounded(key, reply_id, len(encoded) - 1)
    target = tmp_path / key
    replacement = tmp_path / "outside.jpg"
    replacement.write_bytes(encoded)
    target.unlink()
    target.symlink_to(replacement)
    with pytest.raises(PostReplyImageStorageError):
        storage.read_post_reply_image_bounded(key, reply_id, len(encoded))
