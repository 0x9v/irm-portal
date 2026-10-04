import io
import uuid
from pathlib import Path
from PIL import Image

import pytest
from app.core.storage.local import LocalFileSystemStorage
from app.services.preview import (
    create_and_store_preview,
    generate_image_preview,
    generate_pdf_preview,
    is_preview_capable,
)
from app.core.storage.exceptions import StorageError

def create_dummy_pdf() -> bytes:
    import fitz
    doc = fitz.open()
    # Create page 1
    page1 = doc.new_page(width=200, height=200)
    page1.insert_text((50, 50), "Page 1", fontsize=20)
    # Create page 2
    page2 = doc.new_page(width=200, height=200)
    page2.insert_text((50, 50), "Page 2", fontsize=20)
    
    return doc.write()

def create_dummy_image(format="JPEG") -> bytes:
    img = Image.new("RGB", (100, 100), color="red")
    out = io.BytesIO()
    img.save(out, format=format)
    return out.getvalue()

@pytest.fixture
def temp_storage(tmp_path):
    # Use temporary filesystem storage for tests
    return LocalFileSystemStorage(storage_root=tmp_path)


def test_preview_capability():
    assert is_preview_capable("application/pdf")
    assert is_preview_capable("image/jpeg")
    assert is_preview_capable("image/png")
    assert not is_preview_capable("application/zip")
    assert not is_preview_capable("text/plain")


def test_pdf_preview_generation():
    pdf_bytes = create_dummy_pdf()
    preview_bytes = generate_pdf_preview(pdf_bytes)
    
    # Verify the result is a PNG image
    img = Image.open(io.BytesIO(preview_bytes))
    assert img.format == "PNG"
    
    # Note: We can't strictly assert it's only page 1 easily via the image itself, 
    # but the implementation only loads page 0. We'll trust the logic or could do OCR.
    # We at least know it succeeded and didn't crash on multi-page.


def test_image_preview_generation_jpeg():
    img_bytes = create_dummy_image("JPEG")
    preview_bytes = generate_image_preview(img_bytes)
    
    img = Image.open(io.BytesIO(preview_bytes))
    assert img.format == "PNG"


def test_image_preview_generation_png():
    img_bytes = create_dummy_image("PNG")
    preview_bytes = generate_image_preview(img_bytes)
    
    img = Image.open(io.BytesIO(preview_bytes))
    assert img.format == "PNG"


def test_create_and_store_preview_unsupported(temp_storage):
    doc_id = uuid.uuid4()
    comm_id = uuid.uuid4()
    mod_id = uuid.uuid4()
    
    result = create_and_store_preview(
        temp_storage, doc_id, comm_id, mod_id, "text/plain", b"Hello"
    )
    assert result is None


def test_create_and_store_preview_pdf(temp_storage):
    doc_id = uuid.uuid4()
    comm_id = uuid.uuid4()
    mod_id = uuid.uuid4()
    pdf_bytes = create_dummy_pdf()
    
    key = create_and_store_preview(
        temp_storage, doc_id, comm_id, mod_id, "application/pdf", pdf_bytes
    )
    assert key is not None
    assert str(doc_id) in key
    assert key.endswith("_preview.png")
    
    # Verify it exists in storage
    assert temp_storage.exists(key)
    stored_bytes = temp_storage.read(key)
    
    img = Image.open(io.BytesIO(stored_bytes))
    assert img.format == "PNG"
    
    # Ensure no path traversal
    path = temp_storage.get_path(key)
    assert Path(path).is_relative_to(temp_storage.root)
