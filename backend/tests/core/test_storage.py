import pytest
from app.core.storage.exceptions import InvalidPathError, ObjectNotFoundError
from app.core.storage.local import LocalFileSystemStorage

@pytest.fixture
def storage(tmp_path):
    return LocalFileSystemStorage(storage_root=tmp_path)

def test_save_and_read(storage):
    # 1. A file/object can be saved successfully.
    # 2. Saved content can be read back unchanged.
    key = "test.txt"
    content = b"Hello, World!"
    
    storage.save(key, content)
    read_content = storage.read(key)
    
    assert read_content == content

def test_exists(storage):
    # 3. The existence check works.
    key = "exists.txt"
    
    assert not storage.exists(key)
    storage.save(key, b"content")
    assert storage.exists(key)

def test_delete(storage):
    # 4. An object can be deleted.
    key = "delete.txt"
    storage.save(key, b"content")
    
    assert storage.exists(key)
    storage.delete(key)
    assert not storage.exists(key)

def test_read_missing_object(storage):
    # 5. Reading a missing object is handled predictably.
    with pytest.raises(ObjectNotFoundError):
        storage.read("missing.txt")

def test_delete_missing_object(storage):
    # 6. Deleting a missing object is handled predictably according to the chosen API.
    # The API specifies it should silently succeed
    storage.delete("missing.txt")  # Should not raise an error

def test_parent_directories_created(storage, tmp_path):
    # 7. Parent directories are created when needed.
    # 10. Stored files remain inside the configured storage root.
    key = "deep/nested/dir/file.txt"
    storage.save(key, b"deep content")
    
    assert storage.exists(key)
    assert storage.read(key) == b"deep content"
    
    # Verify it physically exists inside the temp dir
    physical_path = tmp_path / "deep" / "nested" / "dir" / "file.txt"
    assert physical_path.exists()
    assert physical_path.read_bytes() == b"deep content"

def test_path_traversal_rejected(storage):
    # 8. Path traversal attempts are rejected.
    with pytest.raises(InvalidPathError):
        storage.save("../outside.txt", b"hack")
        
    with pytest.raises(InvalidPathError):
        storage.read("folder/../../outside.txt")

def test_absolute_paths_rejected(storage):
    # 9. Absolute paths are rejected.
    with pytest.raises(InvalidPathError):
        storage.save("/etc/passwd", b"hack")

import os
from unittest import mock
from app.core.storage.exceptions import StorageError

def test_atomic_save_produces_expected_content(storage, tmp_path):
    # 2. Atomic save produces the expected final content.
    key = "atomic.txt"
    content = b"atomic content"
    storage.save(key, content)
    assert storage.read(key) == content

def test_failed_save_cleanup(storage, tmp_path):
    # 3. A failed save does not leave a corrupted final destination.
    # 4. Temporary files are cleaned up after a failed write.
    key = "failed_save.txt"
    
    # Pre-existing file
    original_content = b"original"
    storage.save(key, original_content)
    
    # Simulate a failure during write
    with mock.patch("os.fdopen") as mock_fdopen:
        mock_fdopen.side_effect = Exception("Simulated write failure")
        with pytest.raises(StorageError):
            storage.save(key, b"new content")
            
    # The original file should remain unchanged
    assert storage.read(key) == original_content
    
    # No temporary files should be left behind in the directory
    files = list(tmp_path.iterdir())
    assert len(files) == 1
    assert files[0].name == "failed_save.txt"

def test_nested_traversal_rejected(storage):
    # 6. ../ traversal remains rejected.
    # 7. Nested traversal remains rejected.
    with pytest.raises(InvalidPathError):
        storage.save("folder/../outside.txt", b"hack")
    with pytest.raises(InvalidPathError):
        storage.save("folder/../../outside.txt", b"hack")
    with pytest.raises(InvalidPathError):
        storage.save("../folder", b"hack")

def test_symlink_pointing_outside_rejected(storage, tmp_path):
    # 8. A symlink inside the storage root pointing outside the storage root is rejected.
    outside_dir = tmp_path.parent / "outside"
    outside_dir.mkdir(exist_ok=True)
    
    symlink_path = tmp_path / "symlink"
    os.symlink(outside_dir, symlink_path)
    
    with pytest.raises(InvalidPathError):
        storage.save("symlink/hack.txt", b"hack")

def test_storage_root_itself_rejected(storage):
    # 10. The storage root itself cannot be used as an object destination.
    with pytest.raises(InvalidPathError):
        storage.save("", b"hack")
    with pytest.raises(InvalidPathError):
        storage.save(".", b"hack")
