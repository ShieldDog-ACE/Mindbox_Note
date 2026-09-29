"""请求/响应模型。"""
from pydantic import BaseModel


class NoteCreate(BaseModel):
    path: str
    content: str = ""
    meta: dict | None = None
    overwrite: bool = False


class NoteUpdate(BaseModel):
    content: str
    meta: dict | None = None


class NoteRename(BaseModel):
    path: str
    new_path: str
    update_links: bool = True


class NoteMove(BaseModel):
    path: str
    dir: str


class FolderCreate(BaseModel):
    path: str


class ItemCopy(BaseModel):
    """复制条目(笔记/白板/文件夹)。"""
    src: str
    dst: str


class RelationCreate(BaseModel):
    """手动关系(白板链接式):两个 vault 相对路径。"""
    source: str
    target: str


class SnapshotRestore(BaseModel):
    path: str
    ts: str  # 快照时间戳(即快照文件名 stem)


class ImageSave(BaseModel):
    name: str
    data: str  # base64,不含 data: 前缀


class MemoryItemCreate(BaseModel):
    category: str
    content: str
    meta: dict | None = None


class MemoryHit(BaseModel):
    success: bool | None = None
