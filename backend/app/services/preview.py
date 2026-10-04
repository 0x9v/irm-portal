import io
import uuid

import fitz  # PyMuPDF
from PIL import Image

from app.core.storage.base import StorageProvider
from app.core.storage.exceptions import StorageError

PREVIEW_CAPABLE_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}

def is_preview_capable(content_type: str) -> bool:
    """Check if the given mime type is supported for preview generation."""
    return content_type in PREVIEW_CAPABLE_TYPES

def generate_pdf_preview(content: bytes) -> bytes:
    """Generate a PNG preview of the first page of a PDF."""
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        if len(doc) == 0:
            raise ValueError("PDF has no pages")
            
        page = doc.load_page(0)
        # 150 DPI is usually good for a high-quality preview (zoom=1.0 is 72 DPI, so zoom=2.0 is 144 DPI)
        # For a standard thumbnail, zoom=1.0 or slightly less is fine.
        # Let's use a scale factor to constrain the size.
        matrix = fitz.Matrix(1.5, 1.5)
        pix = page.get_pixmap(matrix=matrix)
        preview_bytes = pix.tobytes("png")
        doc.close()
        return preview_bytes
    except Exception as e:
        raise RuntimeError(f"Failed to generate PDF preview: {e}") from e

def generate_image_preview(content: bytes) -> bytes:
    """Generate a standardized PNG thumbnail from an image."""
    try:
        img = Image.open(io.BytesIO(content))
        # Convert to RGB if necessary (e.g. RGBA to RGB for JPEG, but we are saving to PNG so RGBA is fine)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGBA")
            
        # Create a reasonable thumbnail size
        img.thumbnail((1024, 1024))
        
        out = io.BytesIO()
        img.save(out, format="PNG")
        return out.getvalue()
    except Exception as e:
        raise RuntimeError(f"Failed to generate image preview: {e}") from e

def create_and_store_preview(
    storage: StorageProvider,
    document_id: uuid.UUID,
    community_id: uuid.UUID,
    module_id: uuid.UUID,
    content_type: str,
    original_content: bytes
) -> str | None:
    """
    Generate a preview and store it via the storage provider.
    Returns the preview storage key on success, or None if the type is not preview-capable.
    Raises StorageError if storage fails, or RuntimeError if generation fails.
    """
    if not is_preview_capable(content_type):
        return None

    if content_type == "application/pdf":
        preview_bytes = generate_pdf_preview(original_content)
    elif content_type in ("image/jpeg", "image/png"):
        preview_bytes = generate_image_preview(original_content)
    else:
        return None

    preview_key = f"{community_id}/{module_id}/{document_id}_preview.png"
    
    storage.save(preview_key, preview_bytes)
    return preview_key
