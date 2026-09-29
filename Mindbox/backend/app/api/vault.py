"""vault:目录树、关系图、标签、文件夹、附件媒体、zip 导入导出。"""
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response

from ..models.schemas import FolderCreate, ImageSave, ItemCopy, RelationCreate
from ..services import vault_service

router = APIRouter(tags=["vault"])


@router.get("/vault/tree")
def tree() -> list[dict]:
    return vault_service.scan_tree()


@router.get("/vault/graph")
def graph() -> dict:
    """关系图数据(节点+手动关系边),前端力导向渲染。"""
    return vault_service.build_graph()


@router.post("/vault/relations")
def create_relation(body: RelationCreate):
    """建立手动关系(无方向,重复/自连报错)。"""
    try:
        return vault_service.add_relation(body.source, body.target)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except FileExistsError as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/vault/relations")
def delete_relation(source: str = Query(...), target: str = Query(...)):
    """断开手动关系。"""
    try:
        vault_service.remove_relation(source, target)
        return {"deleted": [source, target]}
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/vault/tags")
def tags() -> dict:
    """全库标签索引:tag → 次数。"""
    return vault_service.all_tags()


@router.get("/vault/tag-notes")
def tag_notes(tag: str = Query(...)) -> list[dict]:
    """包含某标签的笔记列表。"""
    return vault_service.search_tag(tag)


@router.post("/vault/folder")
def create_folder(body: FolderCreate):
    try:
        return vault_service.create_folder(body.path)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/vault/copy")
def copy_item(body: ItemCopy):
    """复制笔记/白板/文件夹(递归)。"""
    try:
        return vault_service.copy_item(body.src, body.dst)
    except FileNotFoundError:
        raise HTTPException(404, f"not found: {body.src}")
    except FileExistsError:
        raise HTTPException(409, f"already exists: {body.dst}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/vault/media")
def media(path: str = Query(...)):
    """读取 vault 内媒体附件(图片/音频/视频扩展名,防穿越由服务层保证)。"""
    resolved = vault_service.resolve_media(path)
    if not resolved:
        raise HTTPException(404, f"media not found: {path}")
    p = vault_service.VAULT_DIR / resolved
    return FileResponse(p)


@router.post("/vault/image")
def save_image(body: ImageSave):
    """剪贴板图片落盘 → vault/attachments/。"""
    try:
        return vault_service.save_image(body.name, body.data)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/vault/export")
def export_vault():
    """导出全部笔记为 zip(浏览器直接下载)。"""
    data = vault_service.export_zip()
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=mindbox-notes.zip"},
    )


@router.post("/vault/import")
async def import_vault(request: Request):
    """导入 zip:全部作为新增写入(重名自动改名),不覆盖现有笔记。"""
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty upload")
    try:
        return vault_service.import_zip(data)
    except Exception as e:
        raise HTTPException(400, f"invalid zip: {e}")
