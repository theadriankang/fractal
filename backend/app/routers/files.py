from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse

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


@router.get("/files/{file_id}/raw")
def raw(file_id: str):
    """Serves an upload's original bytes back -- e.g. a photo captured as Expertise
    evidence, so the browser can render it as an <img>. No auth beyond the random
    id, matching how the id itself is already handed around on Expertise/chat records."""
    found = files.raw_file(file_id)
    if not found:
        raise HTTPException(404, "File not found")
    path, media_type, name = found
    # inline, not attachment -- clicking through to a photo should open it in the
    # browser (or render in an <img>), not trigger a download dialog.
    return FileResponse(path, media_type=media_type, filename=name, content_disposition_type="inline")
