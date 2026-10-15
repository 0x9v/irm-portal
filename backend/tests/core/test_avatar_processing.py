from io import BytesIO
import struct
import zlib

import pytest
from fastapi import HTTPException
from PIL import Image

from app.services.avatar import process_avatar_image


def encode(image, format_name, **options):
    stream = BytesIO()
    image.save(stream, format=format_name, **options)
    return stream.getvalue()


def test_processes_png_to_fresh_metadata_free_canonical_jpeg():
    image = Image.new("RGB", (80, 48), (220, 30, 40))
    exif = Image.Exif()
    exif[274] = 6
    payload = encode(image, "JPEG", exif=exif, comment=b"secret comment", quality=96)

    canonical = process_avatar_image(payload, "image/jpeg")
    with Image.open(BytesIO(canonical)) as result:
        assert result.format == "JPEG" and result.mode == "RGB" and result.size == (256, 256)
        assert not ({"exif", "icc_profile", "comment", "xmp"} & result.info.keys())


def test_exif_orientation_is_applied_before_center_crop():
    image = Image.new("RGB", (80, 40), "white")
    for x in range(0, 40):
        for y in range(40):
            image.putpixel((x, y), (220, 20, 20))
    for x in range(40, 80):
        for y in range(40):
            image.putpixel((x, y), (20, 20, 220))
    exif = Image.Exif()
    exif[274] = 6
    oriented_input = encode(image, "JPEG", exif=exif, quality=98)
    already_oriented = encode(image.transpose(Image.Transpose.ROTATE_270), "JPEG", quality=98)

    actual = process_avatar_image(oriented_input, "image/jpeg")
    expected = process_avatar_image(already_oriented, "image/jpeg")
    with Image.open(BytesIO(actual)) as actual_image, Image.open(BytesIO(expected)) as expected_image:
        assert actual_image.size == expected_image.size == (256, 256)
        # JPEG encoder roundoff is allowed; the dominant half-colors must
        # land in the same top/bottom positions after orientation.
        actual_top = actual_image.getpixel((128, 32))
        actual_bottom = actual_image.getpixel((128, 224))
        expected_top = expected_image.getpixel((128, 32))
        expected_bottom = expected_image.getpixel((128, 224))
        assert max(abs(a - b) for a, b in zip(actual_top, expected_top)) < 12
        assert max(abs(a - b) for a, b in zip(actual_bottom, expected_bottom)) < 12


def test_transparency_is_composited_on_white():
    image = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
    for x in range(5, 35):
        for y in range(5, 35):
            image.putpixel((x, y), (255, 0, 0, 255))
    canonical = process_avatar_image(encode(image, "PNG"), "image/png")
    with Image.open(BytesIO(canonical)) as result:
        assert result.getpixel((0, 0))[0] > 240
        center = result.getpixel((128, 128))
        assert center[0] > 220 and center[1] < 50 and center[2] < 50


@pytest.mark.parametrize("declared", ["image/jpeg", "image/png"])
def test_mime_mismatch_and_corrupt_or_truncated_images_are_sanitized(declared):
    with pytest.raises(HTTPException) as error:
        process_avatar_image(b"not an image", declared)
    assert error.value.status_code == 422
    assert error.value.detail == "Invalid avatar image"

    png = encode(Image.new("RGB", (40, 40), "blue"), "PNG")
    mismatched = "image/jpeg" if declared == "image/jpeg" else "image/png"
    if declared == "image/jpeg":
        with pytest.raises(HTTPException) as error:
            process_avatar_image(png, mismatched)
        assert error.value.status_code == 422
    with pytest.raises(HTTPException) as error:
        process_avatar_image(png[:24], "image/png")
    assert error.value.status_code == 422

    jpeg = encode(Image.new("RGB", (40, 40), "green"), "JPEG")
    with pytest.raises(HTTPException) as error:
        process_avatar_image(jpeg, "image/png")
    assert error.value.status_code == 422


def test_dimensions_pixel_limit_and_animation_are_rejected_before_storage():
    # A minimal PNG IHDR is enough for Pillow to report unsafe dimensions;
    # no large pixel buffer is allocated by this test.
    width, height = 4097, 32
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    oversized = b"\x89PNG\r\n\x1a\n" + struct.pack(">I", len(ihdr)) + b"IHDR" + ihdr + struct.pack(">I", zlib.crc32(b"IHDR" + ihdr))
    with pytest.raises(HTTPException) as error:
        process_avatar_image(oversized, "image/png")
    assert error.value.status_code == 422

    frame1 = Image.new("RGB", (40, 40), "red")
    frame2 = Image.new("RGB", (40, 40), "blue")
    animated = BytesIO()
    frame1.save(animated, format="PNG", save_all=True, append_images=[frame2], duration=50, loop=0)
    with pytest.raises(HTTPException) as error:
        process_avatar_image(animated.getvalue(), "image/png")
    assert error.value.status_code == 422


def test_unsupported_media_type_is_415():
    with pytest.raises(HTTPException) as error:
        process_avatar_image(b"image", "image/gif")
    assert error.value.status_code == 415
