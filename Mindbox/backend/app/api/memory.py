"""memory:三层记忆条目 CRUD 与检索。"""
from fastapi import APIRouter, HTTPException, Query

from ..models.schemas import MemoryHit, MemoryItemCreate
from ..services import memory_service as ms

router = APIRouter(tags=["memory"])


@router.get("/memory/summary")
def summary() -> dict:
    return ms.summary()


@router.get("/memory/{layer}")
def list_items(layer: str, category: str | None = Query(None)):
    try:
        return ms.list_items(layer, category)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/memory/{layer}")
def add_item(layer: str, body: MemoryItemCreate):
    try:
        return ms.add_item(layer, body.category, body.content, body.meta)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/memory/{layer}/{item_id}/hit")
def hit(layer: str, item_id: str, body: MemoryHit):
    """记录一次引用/成功/失败,为升降级引擎积累数据。"""
    try:
        item = ms.hit_item(layer, item_id, body.success)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if item is None:
        raise HTTPException(404, f"memory item not found: {item_id}")
    return item


@router.get("/memory/{layer}/query")
def query(layer: str, q: str = Query(..., min_length=1)):
    try:
        return ms.query(layer, q)
    except ValueError as e:
        raise HTTPException(400, str(e))
