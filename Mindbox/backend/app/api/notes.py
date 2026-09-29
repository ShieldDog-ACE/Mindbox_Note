"""notes:笔记 CRUD + 重命名/移动 + 反链/出链。"""
from fastapi import APIRouter, HTTPException, Query

from ..models.schemas import NoteCreate, NoteRename, NoteUpdate
from ..services import vault_service as vs

router = APIRouter(tags=["notes"])


@router.get("/notes")
def read_note(path: str = Query(...)):
    try:
        return vs.read_note(path)
    except FileNotFoundError:
        raise HTTPException(404, f"note not found: {path}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/notes")
def create_note(body: NoteCreate):
    try:
        return vs.write_note(body.path, body.content, body.meta, overwrite=body.overwrite)
    except FileExistsError:
        raise HTTPException(409, f"note already exists: {body.path}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.put("/notes")
def save_note(path: str = Query(...), body: NoteUpdate = None):
    # body 必填:旧签名允许缺省,缺 body 时会走到 body.content 抛 AttributeError(500),
    # 现在明确回 400,并把 FastAPI 自动校验失败的 422 留给类型不符的情况。
    if body is None or not isinstance(body.content, str):
        raise HTTPException(400, "missing or invalid body: {content: string} required")
    try:
        return vs.write_note(path, body.content, body.meta, overwrite=True)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/notes")
def delete_note(path: str = Query(...)):
    try:
        vs.delete_note(path)
        return {"deleted": path}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/notes/resolve")
def resolve(title: str = Query(...)):
    """双链跳转:按笔记名解析路径。"""
    return {"path": vs.find_by_name(title)}


@router.post("/notes/rename")
def rename_note(body: NoteRename):
    try:
        return vs.rename_note(body.path, body.new_path, body.update_links)
    except FileNotFoundError:
        raise HTTPException(404, f"note not found: {body.path}")
    except FileExistsError:
        raise HTTPException(409, f"target exists: {body.new_path}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/notes/backlinks")
def backlinks(path: str = Query(...)):
    try:
        return vs.backlinks(path)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))


@router.get("/notes/outlinks")
def outlinks(path: str = Query(...)):
    try:
        return vs.outlinks(path)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))
