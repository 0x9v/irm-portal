from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image

from app.core.module_resources import (
    MAX_RESOURCE_IMAGE_OUTPUT_BYTES,
    MAX_RESOURCE_IMAGE_UPLOAD_BYTES,
    ModuleResourceInputError,
    canonical_https_link,
    canonical_youtube_video_id,
    generate_module_resource_image_key,
    process_module_resource_image,
    validate_module_resource_image_key,
)
from app.core.storage.exceptions import ModuleResourceStorageError, ObjectNotFoundError
from app.core.storage.local import LocalFileSystemStorage


def _image_bytes(fmt="PNG", size=(80, 40), *, mode=None, **save_options):
    mode = mode or ("RGBA" if fmt == "PNG" else "RGB")
    fill = 1 if mode == "1" else (20, 60, 180, 80) if mode == "RGBA" else (20, 60, 180)
    image = Image.new(mode, size, fill)
    output = BytesIO()
    image.save(output, format=fmt, **save_options)
    return output.getvalue()


@pytest.mark.parametrize("declared,fmt", [("image/jpeg", "JPEG"), ("image/png", "PNG")])
def test_resource_image_is_canonical_lossless_webp_with_orientation_and_no_metadata(declared, fmt):
    raw = _image_bytes(fmt)
    output = process_module_resource_image(raw, declared)
    decoded = Image.open(BytesIO(output))
    assert decoded.format == "WEBP"
    assert decoded.size == (80, 40)
    assert decoded.info.get("exif") is None
    assert decoded.info.get("icc_profile") is None
    assert decoded.info.get("comment") is None
    if fmt == "PNG":
        assert decoded.mode == "RGBA"


def test_resource_image_applies_exif_orientation_without_distorting_aspect_ratio():
    raw = _image_bytes("JPEG", size=(40, 80), exif=b"", mode="RGB")
    image = Image.open(BytesIO(raw))
    exif = image.getexif()
    exif[274] = 6
    output = BytesIO()
    image.save(output, format="JPEG", exif=exif)
    canonical = Image.open(BytesIO(process_module_resource_image(output.getvalue(), "image/jpeg")))
    assert canonical.size == (80, 40)


def test_resource_image_rejects_mime_mismatch_animation_and_bad_bytes():
    with pytest.raises(ModuleResourceInputError, match="mime_mismatch"):
        process_module_resource_image(_image_bytes("PNG"), "image/jpeg")
    with pytest.raises(ModuleResourceInputError, match="invalid_image"):
        process_module_resource_image(b"not an image", "image/png")

    output = BytesIO()
    frames = [Image.new("RGB", (10, 10), color) for color in ("red", "blue")]
    frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:])
    with pytest.raises(ModuleResourceInputError, match="unsupported_media_type"):
        process_module_resource_image(output.getvalue(), "image/gif")

    apng = BytesIO()
    Image.new("RGB", (20, 20), "red").save(
        apng, format="PNG", save_all=True, append_images=[Image.new("RGB", (20, 20), "blue")],
    )
    with pytest.raises(ModuleResourceInputError, match="animated_image"):
        process_module_resource_image(apng.getvalue(), "image/png")


def test_unexpected_decoder_and_encoder_failures_are_operational(monkeypatch):
    from app.core import module_resources
    raw = _image_bytes("PNG")

    def fail_decoder(*_args, **_kwargs):
        raise RuntimeError("private decoder detail")

    with monkeypatch.context() as patch:
        patch.setattr(module_resources.Image, "open", fail_decoder)
        with pytest.raises(ModuleResourceInputError) as error:
            process_module_resource_image(raw, "image/png")
        assert error.value.outcome == "image_processing_failed"

    def fail_encoder(*_args, **_kwargs):
        raise OSError("private encoder detail")

    with monkeypatch.context() as patch:
        patch.setattr(module_resources, "_webp_available", lambda: True)
        patch.setattr(module_resources.Image.Image, "save", fail_encoder)
        with pytest.raises(ModuleResourceInputError) as error:
            process_module_resource_image(raw, "image/png")
        assert error.value.outcome == "image_processing_failed"


def test_resource_image_dimension_and_pixel_limits():
    wide = _image_bytes("PNG", size=(4097, 1), mode="RGB")
    with pytest.raises(ModuleResourceInputError, match="dimensions_invalid"):
        process_module_resource_image(wide, "image/png")
    too_many_pixels = _image_bytes("PNG", size=(4096, 4096), mode="1", optimize=True)
    with pytest.raises(ModuleResourceInputError, match="dimensions_invalid"):
        process_module_resource_image(too_many_pixels, "image/png")


def test_resource_image_enforces_input_and_output_bounds(monkeypatch):
    with pytest.raises(ModuleResourceInputError, match="input_too_large"):
        process_module_resource_image(b"x" * (MAX_RESOURCE_IMAGE_UPLOAD_BYTES + 1), "image/png")

    from app.core import module_resources

    monkeypatch.setattr(module_resources, "MAX_RESOURCE_IMAGE_OUTPUT_BYTES", 1)
    with pytest.raises(ModuleResourceInputError, match="output_too_large"):
        process_module_resource_image(_image_bytes("PNG"), "image/png")


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com:443/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
])
def test_youtube_url_forms_canonicalize_to_video_identity(url, expected):
    assert canonical_youtube_video_id(url) == expected


@pytest.mark.parametrize("url", [
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtu.be.evil.test/dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&v=aaaaaaaaaaa",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&list=playlist",
    "https://youtube.com/embed/dQw4w9WgXcQ",
    "https://user@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:444/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
])
def test_youtube_rejects_ambiguous_or_unsafe_urls(url):
    with pytest.raises(ModuleResourceInputError):
        canonical_youtube_video_id(url)


@pytest.mark.parametrize("url,expected", [
    ("https://Example.com/path?q=1", "https://example.com/path?q=1"),
    ("https://example.com:443/path", "https://example.com/path"),
])
def test_https_links_validate_and_normalize_hosts(url, expected):
    assert canonical_https_link(url) == expected


@pytest.mark.parametrize("url", [
    "http://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com:444",
    "https://localhost",
    "https://example.local",
    "https://example.com/has space",
    "https://example.com/\nheader",
    "https://example.com\\@evil.test",
    "https:///missing-host",
])
def test_https_link_rejects_unsafe_or_malformed_urls(url):
    with pytest.raises(ModuleResourceInputError):
        canonical_https_link(url)


def test_resource_image_storage_is_immutable_bounded_and_scoped(tmp_path):
    storage = LocalFileSystemStorage(tmp_path)
    community_id, module_id, resource_id = uuid4(), uuid4(), uuid4()
    payload = process_module_resource_image(_image_bytes("PNG"), "image/png")
    key = storage.save_module_resource_image(community_id, module_id, resource_id, payload)
    assert validate_module_resource_image_key(key, community_id, module_id, resource_id)
    assert storage.read_module_resource_image_bounded(
        key, community_id, module_id, resource_id, len(payload)
    ) == payload
    with pytest.raises(ModuleResourceStorageError, match="unsafe"):
        storage.read_module_resource_image_bounded(key, uuid4(), module_id, resource_id, len(payload))
    with pytest.raises(ModuleResourceStorageError) as error:
        storage.read_module_resource_image_bounded(
            key, community_id, module_id, resource_id, len(payload) - 1
        )
    assert error.value.outcome == "too_large"
    assert storage.delete_module_resource_image(key, community_id, module_id, resource_id)
    assert not storage.delete_module_resource_image(key, community_id, module_id, resource_id)
    with pytest.raises(ObjectNotFoundError):
        storage.read_module_resource_image_bounded(key, community_id, module_id, resource_id, 100)


def test_resource_image_storage_rejects_symlinks_and_invalid_keys(tmp_path):
    storage = LocalFileSystemStorage(tmp_path)
    community_id, module_id, resource_id = uuid4(), uuid4(), uuid4()
    key = generate_module_resource_image_key(community_id, module_id, resource_id)
    target = tmp_path / key
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(tmp_path / "outside")
    with pytest.raises(ModuleResourceStorageError, match="unsafe"):
        storage.read_module_resource_image_bounded(key, community_id, module_id, resource_id, 10)
    with pytest.raises(ModuleResourceStorageError, match="unsafe"):
        storage.delete_module_resource_image("../outside", community_id, module_id, resource_id)


def test_resource_image_storage_cleans_only_its_own_uncertain_publication(tmp_path, monkeypatch):
    storage = LocalFileSystemStorage(tmp_path)
    community_id, module_id, resource_id = uuid4(), uuid4(), uuid4()
    payload = process_module_resource_image(_image_bytes("PNG"), "image/png")
    calls = 0

    def fail_after_link(_path):
        nonlocal calls
        calls += 1
        if calls > 4:
            raise OSError("simulated durability failure")

    monkeypatch.setattr(storage, "_fsync_directory", fail_after_link)
    with pytest.raises(ModuleResourceStorageError) as error:
        storage.save_module_resource_image(community_id, module_id, resource_id, payload)
    assert error.value.outcome == "durability_failed"
    assert error.value.storage_key is not None
    assert not list(tmp_path.rglob("*.webp"))
    assert not list(tmp_path.rglob(".resource-image-tmp-*"))
