"""vault 服务:目录树扫描、笔记对(.md 正文 + .json 元数据)读写、白板(.canvas)、关系图。

约定:一切路径都以 vault 根为相对路径,严禁逃逸(防路径穿越)。
"""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
from pathlib import Path

from ..core.config import BLACKLIST, MEMORY_FOLDERS, VAULT_DIR
from .snapshot_service import move_snapshots, snapshot_before_write

NOTE_EXTS = {".md"}
CANVAS_EXT = ".canvas"
WIKILINK = re.compile(r"\[\[([^\]]+)\]\]")

# ---------- 缓存层 ----------
# 全库扫描(搜索/反链/标签/图谱)的瓶颈是逐文件读盘,而 vault 常在 exFAT 移动盘上。
# 这里做两层缓存:文本按 (mtime_ns, size) 校验命中;标题索引带脏标记 + TTL 兜底。
# 应用自身的写入会显式失效(见 _invalidate_cache),规避 FAT 时间戳 2 秒精度问题;
# TTL 用于兜住"用户在文件管理器里手改"这类外部变更,限制陈旧窗口。
_CACHE_LOCK = threading.Lock()
_TEXT_CACHE: dict[str, tuple[tuple[int, int], str]] = {}
_INDEX_CACHE: tuple[float, dict[str, str]] | None = None
_INDEX_TTL = 2.0
_INDEX_DIRTY = True

# 顶层不参与检索/图谱的目录:内置记忆文件夹(与英文 memory 等价语义)+ 英文 memory
_SKIP_TOP = set(MEMORY_FOLDERS) | {"memory"}


def _is_hidden_or_skipped(rel: Path) -> bool:
    """隐藏项(.trash/.snapshots/.snapshots 等)与内置记忆文件夹都不进检索与图谱。"""
    if any(part.startswith(".") for part in rel.parts):
        return True
    return bool(rel.parts) and rel.parts[0] in _SKIP_TOP


def _invalidate_cache(*paths: Path | str) -> None:
    """写入/删除/重命名后清缓存,保证下一次读取看到最新状态。"""
    global _INDEX_CACHE, _INDEX_DIRTY
    with _CACHE_LOCK:
        _INDEX_CACHE = None
        _INDEX_DIRTY = True
        for p in paths:
            _TEXT_CACHE.pop(str(p), None)


def read_text_cached(p: Path) -> str:
    """带 stat 校验的文本读取:命中缓存时只做一次 stat,不再读盘。"""
    try:
        st = p.stat()
        key: tuple[int, int] | None = (st.st_mtime_ns, st.st_size)
    except OSError:
        key = None
    sp = str(p)
    if key is not None:
        with _CACHE_LOCK:
            hit = _TEXT_CACHE.get(sp)
        if hit is not None and hit[0] == key:
            return hit[1]
    text = p.read_text(encoding="utf-8", errors="ignore")
    if key is not None:
        with _CACHE_LOCK:
            _TEXT_CACHE[sp] = (key, text)
    return text


def ensure_memory_folders() -> None:
    """启动时保证内置记忆文件夹(短期/长期/永久记忆)存在。"""
    VAULT_DIR.mkdir(parents=True, exist_ok=True)
    for name in MEMORY_FOLDERS:
        (VAULT_DIR / name).mkdir(exist_ok=True)


def _is_memory_folder(path: Path) -> bool:
    """顶层内置记忆文件夹判断(仅文件夹本身,不含其中内容)。"""
    try:
        rel = path.relative_to(VAULT_DIR).as_posix()
    except ValueError:
        return False
    return "/" not in rel and rel in MEMORY_FOLDERS


def _safe_path(path: str) -> Path:
    """把 vault 相对路径转为绝对路径,确保不逃逸且不命中黑名单。"""
    p = (VAULT_DIR / path).resolve()
    if not p.is_relative_to(VAULT_DIR.resolve()):
        raise ValueError(f"path escapes vault: {path}")
    for b in BLACKLIST:
        if path == b or path.startswith(b.rstrip("/") + "/"):
            raise ValueError(f"path is blacklisted: {path}")
    return p


def scan_tree() -> list[dict]:
    """返回 vault 目录树(目录 + .md,忽略隐藏项)。"""

    def walk(d: Path) -> list[dict]:
        items: list[dict] = []
        for child in sorted(d.iterdir(), key=lambda c: (c.is_file(), c.name.lower())):
            if child.name.startswith("."):
                continue
            rel = str(child.relative_to(VAULT_DIR))
            if child.is_dir():
                items.append({"name": child.name, "path": rel, "type": "dir", "children": walk(child)})
            elif child.suffix == CANVAS_EXT:
                items.append({"name": child.stem, "path": rel, "type": "canvas"})
            elif child.suffix in NOTE_EXTS:
                items.append({"name": child.stem, "path": rel, "type": "note"})
        return items

    return walk(VAULT_DIR)


def read_note(path: str) -> dict:
    p = _safe_path(path)
    if p.suffix == CANVAS_EXT:
        # 白板是自包含 JSON,没有配对元数据文件
        if not p.is_file():
            raise FileNotFoundError(path)
        return {"path": path, "name": p.stem, "content": p.read_text(encoding="utf-8"), "meta": {}}
    if p.suffix not in NOTE_EXTS or not p.is_file():
        raise FileNotFoundError(path)
    meta_path = p.with_suffix(".json")
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
    return {"path": path, "name": p.stem, "content": p.read_text(encoding="utf-8"), "meta": meta}


def write_note(path: str, content: str, meta: dict | None = None, overwrite: bool = True) -> dict:
    p = _safe_path(path)
    if p.suffix not in NOTE_EXTS and p.suffix != CANVAS_EXT:
        raise ValueError("only .md notes and .canvas boards are supported")
    if p.exists() and not overwrite:
        raise FileExistsError(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    snapshot_before_write(p, path)  # 覆盖前留快照(文件恢复用)
    p.write_text(content, encoding="utf-8")
    if meta is not None:
        p.with_suffix(".json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    _invalidate_cache(p, p.with_suffix(".json"))
    return {"path": path}


def delete_note(path: str) -> None:
    """删除进 vault/.trash(Obsidian 同款行为,可恢复)。文件夹则整体移入。"""
    p = _safe_path(path)
    if _is_memory_folder(p):
        raise ValueError("内置记忆文件夹不可删除")
    trash = _safe_path(".trash")
    trash.mkdir(exist_ok=True)
    target = trash / p.name
    if p.is_dir():
        if target.exists():  # 重名加时间戳
            target = trash / f"{p.name} {int(time.time())}"
            shutil.rmtree(target, ignore_errors=True)
        shutil.move(str(p), str(target))
        _invalidate_cache(p)
        return
    if target.exists():  # 重名加时间戳
        target = trash / f"{p.stem} {int(time.time())}{p.suffix}"
    meta = p.with_suffix(".json")
    if p.is_file():
        p.replace(target)
        # 元数据(.json)跟着正文一起进回收站,保证从 .trash 恢复时信息完整
        # (旧实现直接 unlink,恢复后只剩正文、元数据全丢)
        if meta.is_file():
            meta.replace(target.with_suffix(".json"))
    _invalidate_cache(p, meta)


def _retarget_canvas_prefix(old_prefix: str, new_prefix: str) -> None:
    """文件夹改名/移动后,改写白板 file 节点的路径前缀(前缀一致才改,避免误伤)。"""
    for cv in VAULT_DIR.rglob(f"*{CANVAS_EXT}"):
        if _is_hidden_or_skipped(cv.relative_to(VAULT_DIR)):
            continue
        try:
            data = json.loads(read_text_cached(cv))
        except (json.JSONDecodeError, OSError):
            continue
        changed = False
        for n in data.get("nodes", []):
            f = n.get("file")
            if n.get("type") == "file" and isinstance(f, str) and (f == old_prefix or f.startswith(f"{old_prefix}/")):
                n["file"] = new_prefix + f[len(old_prefix):]
                changed = True
        if changed:
            cv.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            _invalidate_cache(cv)


def copy_item(src: str, dst: str) -> dict:
    """复制笔记/白板,文件夹递归复制。"""
    s = _safe_path(src)
    d = _safe_path(dst)
    if not s.exists():
        raise FileNotFoundError(src)
    if d.exists():
        raise FileExistsError(dst)
    d.parent.mkdir(parents=True, exist_ok=True)
    if s.is_dir():
        shutil.copytree(s, d)
        _invalidate_cache(d)
        return {"path": dst}
    shutil.copy2(s, d)
    meta = s.with_suffix(".json")
    if meta.is_file():
        shutil.copy2(meta, d.with_suffix(".json"))
    _invalidate_cache(d, d.with_suffix(".json"))
    return {"path": dst}


def rename_note(path: str, new_path: str, update_links: bool = True) -> dict:
    """重命名/移动笔记或白板。update_links 时全库同步替换按标题引用的 [[双链]],
    并同步所有白板里的 file 节点引用。"""
    src = _safe_path(path)
    dst = _safe_path(new_path)
    if not src.exists():
        raise FileNotFoundError(path)
    if _is_memory_folder(src):
        raise ValueError("内置记忆文件夹不可重命名/移动")
    if dst.exists():
        raise FileExistsError(new_path)
    if src.is_dir():
        if dst == src or dst.is_relative_to(src):
            raise ValueError("不能把文件夹移动到它自己的子目录")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        move_snapshots(path, new_path)
        _retarget_canvas_prefix(path, new_path)  # 白板里指向该目录的 file 路径同步
        _retarget_relations(path, new_path)  # 关系网里的路径同步
        return {"path": new_path}
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.replace(dst)
    meta = src.with_suffix(".json")
    if meta.is_file():
        meta.replace(dst.with_suffix(".json"))
    move_snapshots(path, new_path)  # 快照目录同步迁移
    _retarget_relations(path, new_path)  # 关系网里的路径同步

    old_stem, new_stem = src.stem, dst.stem
    if update_links:
        # 引用形态:[[标题]] 与 [[目录/标题]](不含扩展名),含 ![[嵌入]] / 别名 / 锚点。
        # 旧实现只替换 old_stem,「[[dir/note]]」这类按路径写的双链改名后会变红;
        # 纯移动(标题不变、目录变了)也完全不会更新 —— 这里两种形态都覆盖。
        pairs: list[tuple[str, str]] = []
        old_rel = src.relative_to(VAULT_DIR).with_suffix("").as_posix()
        new_rel = dst.relative_to(VAULT_DIR).with_suffix("").as_posix()
        if old_stem != new_stem:
            pairs.append((old_stem, new_stem))
        if old_rel != new_rel:
            pairs.append((old_rel, new_rel))
        for old_ref, new_ref in pairs:
            pat = re.compile(r"(\[\[!?)" + re.escape(old_ref) + r"(\]\]|\||#)")
            for md in VAULT_DIR.rglob("*.md"):
                if _is_hidden_or_skipped(md.relative_to(VAULT_DIR)):
                    continue
                text = read_text_cached(md)
                new_text = pat.sub(lambda m: f"{m.group(1)}{new_ref}{m.group(2)}", text)
                if new_text != text:
                    md.write_text(new_text, encoding="utf-8")
                    _invalidate_cache(md)
    if path != new_path:
        # 白板 file 引用同步(重命名与移动均生效;含引用 .canvas 的情形)
        for cv in VAULT_DIR.rglob(f"*{CANVAS_EXT}"):
            if _is_hidden_or_skipped(cv.relative_to(VAULT_DIR)):
                continue
            try:
                data = json.loads(read_text_cached(cv))
                changed = False
                for n in data.get("nodes", []):
                    if n.get("type") == "file" and n.get("file") == path:
                        n["file"] = new_path
                        changed = True
                if changed:
                    cv.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                    _invalidate_cache(cv)
            except (json.JSONDecodeError, OSError):
                pass
    _invalidate_cache(src, dst, src.with_suffix(".json"), dst.with_suffix(".json"))
    return {"path": new_path}


def create_folder(path: str) -> dict:
    p = _safe_path(path)
    p.mkdir(parents=True, exist_ok=True)
    _invalidate_cache(p)
    return {"path": path}


def _note_links_context(text: str, p: Path) -> list[str]:
    """返回引用了该笔记的行片段(反链上下文)。支持 [[标题]] 与 [[目录/标题]] 两种写法。"""
    ref1 = re.escape(p.stem)
    ref2 = re.escape(p.with_suffix("").as_posix())
    pat = re.compile(r"\[\[!?(?:" + ref1 + r"|" + ref2 + r")(\]\]|\||#)")
    return [line.strip()[:120] for line in text.splitlines() if pat.search(line)]


def backlinks(path: str) -> list[dict]:
    """扫描全库,返回引用了 path 的笔记列表(含上下文片段)。链接按标题或路径解析。"""
    p = _safe_path(path)
    if not p.is_file():
        raise FileNotFoundError(path)
    out: list[dict] = []
    for md in VAULT_DIR.rglob("*.md"):
        if md == p or _is_hidden_or_skipped(md.relative_to(VAULT_DIR)):
            continue
        text = read_text_cached(md)
        ctx = _note_links_context(text, p)
        if ctx:
            out.append({"source": str(md.relative_to(VAULT_DIR)), "name": md.stem, "contexts": ctx})
    return out


def _build_title_index() -> dict[str, str]:
    """标题 → vault 相对路径(.md 与 .canvas),供双链解析。
    同时收录 目录/标题 形式,支持路径式 [[dir/note]] 引用。跳过隐藏目录与内置记忆文件夹。"""
    index: dict[str, str] = {}
    for f in VAULT_DIR.rglob("*"):
        if f.suffix not in NOTE_EXTS and f.suffix != CANVAS_EXT:
            continue
        rel_path = f.relative_to(VAULT_DIR)
        if _is_hidden_or_skipped(rel_path):
            continue
        rel = str(rel_path)
        index.setdefault(f.stem, rel)
        index.setdefault(rel_path.with_suffix("").as_posix(), rel)
    return index


def _title_index() -> dict[str, str]:
    """带缓存的标题索引(脏标记 + TTL 兜底)。双链解析/图谱/双链跳转的高频入口。

    返回的是缓存本体:调用方只读,不要就地修改。
    """
    global _INDEX_CACHE, _INDEX_DIRTY
    now = time.monotonic()
    with _CACHE_LOCK:
        cached, dirty = _INDEX_CACHE, _INDEX_DIRTY
    if not dirty and cached is not None and now - cached[0] < _INDEX_TTL:
        return cached[1]
    index = _build_title_index()
    with _CACHE_LOCK:
        _INDEX_CACHE = (now, index)
        _INDEX_DIRTY = False
    return index


def outlinks(path: str) -> list[dict]:
    """解析当前笔记的全部 [[链接]],返回 {target, resolved}。"""
    p = _safe_path(path)
    if not p.is_file():
        raise FileNotFoundError(path)
    text = p.read_text(encoding="utf-8")
    index = _title_index()
    seen: dict[str, str | None] = {}
    for m in WIKILINK.finditer(text):
        raw = m.group(1).split("|")[0].split("#")[0].strip()
        if raw and raw not in seen:
            seen[raw] = index.get(raw)
    return [{"target": k, "resolved": v} for k, v in seen.items()]


TAG_PAT = re.compile(r"(?:^|\s)#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/_-]*)", re.MULTILINE)


def all_tags() -> dict[str, int]:
    """全库标签索引:#tag → 出现次数。跳过隐藏目录、内置记忆文件夹与代码块。"""
    counts: dict[str, int] = {}
    for md in VAULT_DIR.rglob("*.md"):
        if _is_hidden_or_skipped(md.relative_to(VAULT_DIR)):
            continue
        text = read_text_cached(md)
        text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)  # 排除代码块
        for tag in TAG_PAT.findall(text):
            counts[tag] = counts.get(tag, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))


def search_tag(tag: str) -> list[dict]:
    """返回包含某标签的笔记。"""
    hits: list[dict] = []
    for md in VAULT_DIR.rglob("*.md"):
        if _is_hidden_or_skipped(md.relative_to(VAULT_DIR)):
            continue
        text = re.sub(r"```.*?```", "", read_text_cached(md), flags=re.DOTALL)
        if tag in TAG_PAT.findall(text):
            hits.append({"path": str(md.relative_to(VAULT_DIR)), "name": md.stem})
    return hits


def find_by_name(title: str) -> str | None:
    """按笔记名(不含扩展名)查找 vault 相对路径,.md 与 .canvas 均可,供双链跳转。"""
    return _title_index().get(title)


# ---------- 手动关系(白板链接式):存 vault/relations.json,不写进笔记 ----------

RELATIONS_FILE = "relations.json"


def _relations_path() -> Path:
    return VAULT_DIR / RELATIONS_FILE


def load_relations() -> list[dict]:
    p = _relations_path()
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    return [r for r in data if isinstance(r, dict) and r.get("source") and r.get("target")]


def _save_relations(rels: list[dict]) -> None:
    _relations_path().write_text(json.dumps(rels, ensure_ascii=False, indent=2), encoding="utf-8")


def _rel_key(a: str, b: str) -> tuple[str, str]:
    """关系无方向:A-B 与 B-A 视为同一条。"""
    return (a, b) if a <= b else (b, a)


def add_relation(source: str, target: str) -> dict:
    s, t = _safe_path(source), _safe_path(target)
    if not s.is_file():
        raise FileNotFoundError(source)
    if not t.is_file():
        raise FileNotFoundError(target)
    if source == target:
        raise ValueError("不能和自己建立关系")
    rels = load_relations()
    key = _rel_key(source, target)
    if any(_rel_key(r["source"], r["target"]) == key for r in rels):
        raise FileExistsError(f"relation exists: {source} - {target}")
    rels.append({"source": source, "target": target})
    _save_relations(rels)
    return {"source": source, "target": target}


def remove_relation(source: str, target: str) -> None:
    rels = load_relations()
    key = _rel_key(source, target)
    kept = [r for r in rels if _rel_key(r["source"], r["target"]) != key]
    if len(kept) == len(rels):
        raise FileNotFoundError(f"relation not found: {source} - {target}")
    _save_relations(kept)


def _retarget_relations(old: str, new: str) -> None:
    """重命名/移动后同步关系里的路径(文件精确匹配,文件夹按前缀)。"""
    rels = load_relations()
    changed = False
    for r in rels:
        for k in ("source", "target"):
            p = r[k]
            if p == old:
                r[k] = new
                changed = True
            elif p.startswith(old.rstrip("/") + "/"):
                r[k] = new + p[len(old):]
                changed = True
    if changed:
        _save_relations(rels)


def _canvas_ref(value, canvas_dir: str, known: set[str]) -> str | None:
    """把白板 file 节点的 file 值解析成 vault 相对路径。
    白板里存的是 vault 相对路径;兼容相对白板自身目录的写法。"""
    if not isinstance(value, str) or not value:
        return None
    raw = value.replace("\\", "/").lstrip("/")
    if raw.startswith("./"):
        raw = raw[2:]
    for cand in (raw, f"{canvas_dir}/{raw}" if canvas_dir else raw):
        if cand in known:
            return cand
    return None


def canvas_links(known: set[str]) -> list[tuple[str, str, str]]:
    """读全部白板文件,把白板内的连线翻译成"被引用文件之间"的关系。
    返回 (来源, 目标, 所属白板路径)。只有两端都是 file 节点、且目标文件真实存在时才计入。"""
    out: list[tuple[str, str, str]] = []
    for f in VAULT_DIR.rglob(f"*{CANVAS_EXT}"):
        rel_path = f.relative_to(VAULT_DIR)
        if _is_hidden_or_skipped(rel_path):
            continue
        try:
            data = json.loads(read_text_cached(f))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        by_id = {n.get("id"): n for n in data.get("nodes", []) if isinstance(n, dict)}
        canvas_dir = rel_path.parent.as_posix()
        canvas_dir = "" if canvas_dir == "." else canvas_dir
        for e in data.get("edges", []):
            if not isinstance(e, dict):
                continue
            a, b = by_id.get(e.get("fromNode")), by_id.get(e.get("toNode"))
            if not a or not b or a.get("type") != "file" or b.get("type") != "file":
                continue
            pa = _canvas_ref(a.get("file"), canvas_dir, known)
            pb = _canvas_ref(b.get("file"), canvas_dir, known)
            if pa and pb and pa != pb:
                out.append((pa, pb, str(rel_path)))
    return out


def build_graph() -> dict:
    """关系图数据:节点 = 全部笔记/白板,边 = 手动关系(relations.json)+ 白板内连线。
    悬空关系(指向已删除文件)读取时顺手清理。"""
    index = _title_index()
    nodes: dict[str, dict] = {}
    for path in sorted(set(index.values())):
        nodes[path] = {"id": path, "name": Path(path).stem}

    links: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def push(s: str, t: str, kind: str, origin: str = "") -> None:
        if s == t or s not in nodes or t not in nodes:
            return
        key = _rel_key(s, t)
        if key in seen:
            return
        seen.add(key)
        item = {"source": s, "target": t, "kind": kind}
        if origin:
            item["from"] = origin
        links.append(item)

    # 手动关系(relation.json)优先:同一对文件两边都有时,以用户显式建立的为准
    rels = load_relations()
    alive: list[dict] = []
    for r in rels:
        s, t = r["source"], r["target"]
        if s in nodes and t in nodes and s != t:
            alive.append({"source": s, "target": t})
        push(s, t, "manual")
    if len(alive) != len(rels):
        _save_relations(alive)

    # 白板内连线 → 派生关系。白板里删掉即消失,不能在关系网里单独断开
    for s, t, canvas in canvas_links(set(nodes)):
        push(s, t, "canvas", canvas)

    degree: dict[str, int] = {}
    for l in links:
        degree[l["source"]] = degree.get(l["source"], 0) + 1
        degree[l["target"]] = degree.get(l["target"], 0) + 1
    for nid, n in nodes.items():
        n["degree"] = degree.get(nid, 0)
    return {"nodes": list(nodes.values()), "links": links}


# ---------- 附件(图片/音视频) ----------

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".ico", ".jfif"}
MEDIA_EXTS = IMAGE_EXTS | {
    ".mp3", ".wav", ".ogg", ".oga", ".m4a", ".flac", ".aac", ".opus", ".weba",  # 音频
    ".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv", ".3gp",  # 视频
}
ATTACH_DIR = "attachments"


def save_image(name: str, data_b64: str) -> dict:
    """保存剪贴板图片到 vault/attachments/,重名自动追加序号。返回 vault 相对路径。"""
    import base64
    import binascii

    suffix = Path(name).suffix.lower()
    if suffix not in IMAGE_EXTS:
        suffix = ".png"
    try:
        raw = base64.b64decode(data_b64)
    except (binascii.Error, ValueError) as e:
        raise ValueError(f"invalid image data: {e}") from e
    if len(raw) > 20 * 1024 * 1024:
        raise ValueError("image too large (>20MB)")

    dest_dir = VAULT_DIR / ATTACH_DIR
    dest_dir.mkdir(exist_ok=True)
    stem = Path(name).stem or "pasted"
    stem = re.sub(r'[\\/:*?"<>|]', "_", stem)[:60]
    p = dest_dir / f"{stem}{suffix}"
    n = 1
    while p.exists():
        p = dest_dir / f"{stem} {n}{suffix}"
        n += 1
    p.write_bytes(raw)
    return {"path": f"{ATTACH_DIR}/{p.name}", "name": p.name}


def resolve_media(target: str) -> str | None:
    """按文件名(可带目录)查找 vault 内图片/音视频附件,返回 vault 相对路径。

    快路径先行:笔记里的图片绝大多数就在 attachments/,命中即返回,
    不必像旧实现那样对全库做一次 rglob(exFAT 上尤其昂贵)。
    """
    target = target.strip()
    direct = VAULT_DIR / target
    if direct.is_file() and direct.suffix.lower() in MEDIA_EXTS:
        return target
    wanted = target.split("/")[-1]
    if not wanted:
        return None
    in_attach = VAULT_DIR / ATTACH_DIR / wanted
    if in_attach.is_file() and in_attach.suffix.lower() in MEDIA_EXTS:
        return f"{ATTACH_DIR}/{wanted}"
    for f in VAULT_DIR.rglob(wanted):  # 兜底:全库按文件名找
        if not f.is_file() or f.suffix.lower() not in MEDIA_EXTS:
            continue
        rel = f.relative_to(VAULT_DIR)
        if _is_hidden_or_skipped(rel):
            continue
        return rel.as_posix()
    return None


# ---------- 笔记打包导入/导出(zip) ----------


def export_zip() -> bytes:
    """把整个 vault 打成 zip(跳过 .trash 等隐藏项与 config.json)。"""
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(VAULT_DIR.rglob("*")):
            if not f.is_file():
                continue
            rel = f.relative_to(VAULT_DIR)
            if any(part.startswith(".") for part in rel.parts):
                continue
            if rel.as_posix() == "config.json":
                continue
            zf.write(f, rel.as_posix())
    return buf.getvalue()


def import_zip(data: bytes) -> dict:
    """导入 zip:全部作为新增写入(重名自动追加「导入 n」后缀),绝不覆盖现有笔记。"""
    import io
    import zipfile

    imported = skipped = 0
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for info in zf.infolist():
            if info.is_dir() or info.file_size > 100 * 1024 * 1024:
                continue
            parts = [p for p in info.filename.replace("\\", "/").split("/") if p not in ("", ".", "..")]
            # 跳过隐藏目录(如 macOS 的 __MACOSX/.DS_Store)与可疑路径
            if not parts or any(p.startswith(".") or p == "__MACOSX" for p in parts):
                skipped += 1
                continue
            rel = "/".join(parts)
            try:
                dest = _safe_path(rel)
            except ValueError:
                skipped += 1
                continue
            if dest.exists():  # 冲突 → 新名字,不覆盖
                n = 1
                stem, suffix = dest.stem, dest.suffix
                while dest.exists():
                    dest = dest.with_name(f"{stem} 导入 {n}{suffix}")
                    n += 1
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(info))
            imported += 1
    _invalidate_cache()
    return {"imported": imported, "skipped": skipped}
