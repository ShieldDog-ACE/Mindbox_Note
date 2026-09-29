"""snapshots:文件恢复快照查询与恢复。"""
from fastapi import APIRouter, HTTPException, Query

from ..models.schemas import SnapshotRestore
from ..services import snapshot_service as ss
from ..services.vault_service import _safe_path

router = APIRouter(tags=["snapshots"])


@router.get("/snapshots/files")
def files() -> list[dict]:
    """有快照留存的文件列表。"""
    return ss.snapshot_files()


@router.get("/snapshots")
def list_snapshots(path: str = Query(...)) -> list[dict]:
    try:
        _safe_path(path)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ss.list_snapshots(path)


@router.get("/snapshots/read")
def read_snapshot(path: str = Query(...), ts: str = Query(...)) -> dict:
    try:
        _safe_path(path)
        return {"content": ss.read_snapshot(path, ts)}
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))


@router.post("/snapshots/restore")
def restore(body: SnapshotRestore):
    try:
        _safe_path(body.path)
        return ss.restore_snapshot(body.path, body.ts)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(404, str(e))
