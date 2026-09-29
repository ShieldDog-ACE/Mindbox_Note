"""search:全文搜索(分词口径)。"""
from fastapi import APIRouter, Query

from ..services import search_service

router = APIRouter(tags=["search"])


@router.get("/search")
def search(q: str = Query(..., min_length=1)):
    return search_service.search(q)
