"""system:健康检查等。"""
from fastapi import APIRouter

from ..core.config import APP_VERSION

router = APIRouter(tags=["system"])


@router.get("/system/health")
def health() -> dict:
    return {"ok": True, "app": "mindbox", "version": APP_VERSION}
