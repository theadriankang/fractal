from fastapi import APIRouter, HTTPException, UploadFile

from .. import files

router = APIRouter(prefix="/api")


@router.post("/files")
def upload(file: UploadFile):
    """Stores one chat attachment and returns {id, name, size, kind, mediaType, chars, pages}."""
    data = file.file.read(files.MAX_BYTES + 1)
    try:
        return files.save_upload(file.filename or "file", data)
    except files.UploadError as e:
        raise HTTPException(413 if len(data) > files.MAX_BYTES else 400, str(e)) from e
