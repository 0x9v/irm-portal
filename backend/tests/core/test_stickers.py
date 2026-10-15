from io import BytesIO
from uuid import UUID, uuid4

import pytest
from PIL import Image

from app.core.stickers import (
    MAX_STICKER_UPLOAD_BYTES,
    StickerImageError,
    generate_sticker_storage_key,
    process_sticker_image,
    validate_sticker_storage_key,
)
from app.core.storage.exceptions import ObjectNotFoundError, StickerStorageError
from app.core.storage.local import LocalFileSystemStorage


def encode(image, fmt, **options):
    out = BytesIO()
    image.save(out, format=fmt, **options)
    return out.getvalue()


def decode(data):
    image = Image.open(BytesIO(data))
    image.load()
    return image


def test_alpha_padding_and_full_image_contain():
    src = Image.new("RGBA", (80, 40), (255, 0, 0, 255))
    out = process_sticker_image(encode(src, "PNG"), "image/png")
    image = decode(out)
    assert image.format == "WEBP" and image.mode == "RGBA" and image.size == (256, 256)
    assert image.getpixel((128, 0))[3] == 0
    assert image.getpixel((128, 128)) == (255, 0, 0, 255)
    assert image.getpixel((0, 128)) == (255, 0, 0, 255)


def test_png_alpha_metadata_stripped_and_orientation_applied():
    source = Image.new("RGBA", (80, 40), (0, 0, 0, 0))
    source.paste((255, 0, 0, 255), (0, 0, 40, 40))
    payload = encode(source, "PNG", pnginfo=_png_text("secret", "metadata"))
    out = process_sticker_image(payload, "image/png")
    image = decode(out)
    assert image.info.keys().isdisjoint({"exif", "icc_profile", "comment", "xmp", "secret"})
    assert image.getpixel((32, 128))[3] == 255

    oriented = Image.new("RGB", (80, 40), "blue")
    oriented.paste("red", (0, 0, 40, 40))
    exif = Image.Exif()
    exif[274] = 6
    actual = process_sticker_image(encode(oriented, "JPEG", exif=exif), "image/jpeg")
    expected = process_sticker_image(encode(oriented.transpose(Image.Transpose.ROTATE_270), "JPEG"), "image/jpeg")
    actual_pixels = decode(actual).get_flattened_data()
    expected_pixels = decode(expected).get_flattened_data()
    assert len(actual_pixels) == len(expected_pixels)
    assert max(abs(a - b) for actual_pixel, expected_pixel in zip(actual_pixels, expected_pixels)
               for a, b in zip(actual_pixel, expected_pixel)) <= 3


def _png_text(key, value):
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text(key, value)
    return info


@pytest.mark.parametrize("data,media,outcome", [
    (b"broken", "image/png", "invalid_image"),
    (b"", "image/png", "invalid_image"),
    (encode(Image.new("RGB", (40, 40)), "PNG"), "image/jpeg", "mime_mismatch"),
    (encode(Image.new("RGB", (40, 40)), "GIF"), "image/gif", "unsupported_media_type"),
])
def test_corrupt_truncated_mime_and_unsupported_rejected(data, media, outcome):
    with pytest.raises(StickerImageError) as error:
        process_sticker_image(data, media)
    assert error.value.outcome == outcome


def test_size_and_frame_limits():
    with pytest.raises(StickerImageError, match="input too large"):
        process_sticker_image(b"x" * (MAX_STICKER_UPLOAD_BYTES + 1), "image/png")
    with pytest.raises(StickerImageError) as error:
        process_sticker_image(encode(Image.new("RGB", (31, 40)), "PNG"), "image/png")
    assert error.value.outcome == "dimensions_invalid"
    over_pixel_limit = encode(Image.new("1", (4096, 4096)), "PNG", optimize=True)
    with pytest.raises(StickerImageError) as error:
        process_sticker_image(over_pixel_limit, "image/png")
    assert error.value.outcome == "dimensions_invalid"

    frames = BytesIO()
    Image.new("RGB", (40, 40), "red").save(
        frames, format="PNG", save_all=True,
        append_images=[Image.new("RGB", (40, 40), "blue")], duration=50,
    )
    with pytest.raises(StickerImageError) as error:
        process_sticker_image(frames.getvalue(), "image/png")
    assert error.value.outcome == "animated_image"


def test_canonical_output_limit_is_enforced(monkeypatch):
    import app.core.stickers as stickers

    monkeypatch.setattr(stickers, "MAX_STORED_STICKER_BYTES", 1)
    with pytest.raises(StickerImageError) as error:
        stickers.process_sticker_image(encode(Image.new("RGB", (40, 40), "green"), "PNG"), "image/png")
    assert error.value.outcome == "output_too_large"


def test_immutable_storage_key_owner_bounds_symlinks_and_delete(tmp_path):
    storage = LocalFileSystemStorage(tmp_path)
    owner, asset = uuid4(), uuid4()
    payload = encode(Image.new("RGBA", (32, 32), (10, 20, 30, 0)), "WEBP", lossless=True)
    key = storage.save_sticker_immutable(owner, asset, payload)
    assert validate_sticker_storage_key(key, owner) == (asset, UUID(key.split("/")[-1][:-5]))
    with pytest.raises(ValueError):
        validate_sticker_storage_key(key, uuid4())
    assert storage.read_sticker_bounded(key, owner, len(payload)) == payload
    with pytest.raises(StickerStorageError) as error:
        storage.read_sticker_bounded(key, owner, len(payload) - 1)
    assert error.value.outcome == "too_large"
    with pytest.raises(StickerStorageError):
        storage.read_sticker_bounded("../outside", owner, 10)
    with pytest.raises(StickerStorageError):
        storage.delete_sticker(key, uuid4())
    assert storage.delete_sticker(key, owner) is True
    assert storage.delete_sticker(key, owner) is False
    with pytest.raises(ObjectNotFoundError):
        storage.read_sticker_bounded(key, owner, 100)

    key = generate_sticker_storage_key(owner, uuid4())
    target = tmp_path / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(tmp_path / "outside")
    with pytest.raises(StickerStorageError, match="unsafe"):
        storage.read_sticker_bounded(key, owner, 10)


def test_storage_publication_failure_cleans_temporary_and_new_object(tmp_path, monkeypatch):
    storage = LocalFileSystemStorage(tmp_path)
    owner, asset = uuid4(), uuid4()
    calls = 0
    def fail_directory_sync(_path):
        nonlocal calls
        calls += 1
        if calls > 3:
            raise OSError("simulated durability failure")
    monkeypatch.setattr(storage, "_fsync_directory", fail_directory_sync)
    with pytest.raises(StickerStorageError) as error:
        storage.save_sticker_immutable(owner, asset, b"synthetic canonical bytes")
    assert error.value.outcome == "durability_failed"
    assert error.value.storage_key is not None
    assert not list(tmp_path.rglob("*.webp"))
    assert not list(tmp_path.rglob(".sticker-tmp-*"))
