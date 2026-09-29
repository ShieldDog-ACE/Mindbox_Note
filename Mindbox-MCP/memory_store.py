"""Mindbox-MCP 三层记忆存储层(纯标准库,零依赖)。

目录结构(三个根文件夹为系统自带,受保护,任何入口都不得删除):

    Mindbox-MCP/
    ├── 短期记忆/<agent>/<session_id>/会话.json + 上下文.md
    ├── 长期记忆/<分类中文名>/<item_id>.json
    └── 永久记忆/<item_id>.json + triples.json

三层职责:
    短期 —— 会话作用域。每个 agent 的每个会话一个文件夹,存上下文摘要 /
            任务进度 / 中间结论 / 待办,防上下文爆满。
    长期 —— 过渡区。9 类条目 + 置信度 / 引用 / 成败计数,验证后晋升永久。
    永久 —— 知识图。三元组(主语—关系→宾语)+ 已验证条目。
"""
from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SHORT_DIR = ROOT / "短期记忆"
LONG_DIR = ROOT / "长期记忆"
PERM_DIR = ROOT / "永久记忆"

# 受保护的三个根文件夹(不可删除)
PROTECTED_DIRS = (SHORT_DIR, LONG_DIR, PERM_DIR)

LAYERS = ("短期记忆", "长期记忆", "永久记忆")

# 长期记忆九类条目:机读 key -> 中文分类(同时是文件夹名,人类可直接浏览)
LONG_CATEGORIES = {
    "task": "任务记录",
    "skill": "技能配方",
    "digest": "资料摘要",
    "preference": "用户偏好",
    "pending_triple": "待验证三元组",
    "error_case": "错误案例",
    "emotion": "情绪历史",
    "ai_effect": "外部大脑效果",
    "project": "项目上下文",
}
LABEL_TO_KEY = {v: k for k, v in LONG_CATEGORIES.items()}

TRIPLES_FILE = PERM_DIR / "triples.json"

_README = """# {title} —— 系统自带,不可删除

这是 Mindbox-MCP 三层记忆的{desc}。**请勿删除、勿重命名本文件夹。**

- 该文件夹由 MCP Server 在每次启动与每次调用前自动校验,缺失即重建。
- 通过 MCP 工具无法删除本文件夹,只能增删其中的单条记忆。
- 里面的文件都是普通 JSON / Markdown,可用任意编辑器手改,改完 MCP 立即生效。

手工修改时请勿破坏 JSON 语法;结构说明见 `使用说明-人.md`。
"""

_DIR_DESC = {
    "短期记忆": ("工作记忆区", "存放各 agent 会话的上下文快照,按 <agent>/<会话> 分文件夹"),
    "长期记忆": ("过渡区", "存放待验证的 9 类条目,按分类分文件夹"),
    "永久记忆": ("知识图", "存放已验证条目与三元组关系图 triples.json"),
}

_SAFE_RE = re.compile(r"[^0-9A-Za-z\u4e00-\u9fff._\- ]+")


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------

def _safe_name(raw: str, fallback: str = "default") -> str:
    """把外部传入的名字压成安全的单层目录/文件名(防目录穿越)。"""
    name = _SAFE_RE.sub("_", str(raw or "").strip()).strip(". ")
    name = name.replace("..", "_")[:80]
    return name or fallback


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _new_id() -> str:
    return f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"


def _dump(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_dirs() -> dict:
    """确保三个受保护文件夹存在;缺失则重建(含说明文件)。幂等。"""
    created = []
    for d in PROTECTED_DIRS:
        if not d.is_dir():
            d.mkdir(parents=True, exist_ok=True)
            created.append(d.name)
        title, desc = _DIR_DESC[d.name]
        readme = d / "_保护说明.md"
        if not readme.is_file():
            readme.write_text(_README.format(title=title, desc=desc), encoding="utf-8")
    return {"protected": [d.name for d in PROTECTED_DIRS], "recreated": created}


def _guard_root(path: Path) -> Path:
    """拒绝任何指向三个受保护根文件夹本身的删除/移动操作。"""
    target = Path(path).resolve()
    for d in PROTECTED_DIRS:
        if target == d.resolve():
            raise PermissionError(f"⛔ {d.name} 是系统自带文件夹,不可删除")
    if ROOT.resolve() not in target.parents and target != ROOT.resolve():
        raise PermissionError("⛔ 越界路径,已拒绝")
    return target


def tokenize(text: str) -> set[str]:
    """无依赖中英文分词:ASCII 词 + 中文单字 + 中文双字(兼顾召回)。"""
    text = str(text or "").lower()
    tokens = set(re.findall(r"[a-z0-9_]+", text))
    for run in re.findall(r"[\u4e00-\u9fff]+", text):
        tokens.update(run)
        tokens.update(run[i:i + 2] for i in range(len(run) - 1))
    return {t for t in tokens if t}


# --------------------------------------------------------------------------
# 短期记忆:每个 agent 的每个会话一个文件夹
# --------------------------------------------------------------------------

_EMPTY_SESSION = {
    "summary": "",
    "tasks": [],
    "todos": [],
    "conclusions": [],
    "context": [],
}


def session_dir(agent: str, session_id: str, create: bool = False) -> Path:
    d = SHORT_DIR / _safe_name(agent, "agent") / _safe_name(session_id, "session")
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _render_context_md(data: dict) -> str:
    """把会话快照渲染成人类可读的 Markdown。"""
    lines = [
        f"# 会话上下文 —— {data.get('title') or data['session_id']}",
        "",
        f"- Agent:`{data['agent']}`",
        f"- 会话:`{data['session_id']}`",
        f"- 状态:{data.get('status', 'open')}",
        f"- 创建:{data.get('created_at', '')}",
        f"- 更新:{data.get('updated_at', '')}",
        "",
    ]
    if data.get("summary"):
        lines += ["## 上下文摘要", "", data["summary"], ""]
    for field, title in (("tasks", "任务进度"), ("todos", "待办"),
                         ("conclusions", "中间结论"), ("context", "关键上下文")):
        rows = data.get(field) or []
        if not rows:
            continue
        lines += [f"## {title}", ""]
        for row in rows:
            if isinstance(row, dict):
                mark = "x" if row.get("status") in ("done", "完成") else " "
                lines.append(f"- [{mark}] {row.get('text', row)}")
            else:
                lines.append(f"- {row}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def session_open(agent: str, session_id: str, title: str = "", summary: str = "") -> dict:
    """新建(或取回)一个会话的短期记忆文件夹。"""
    ensure_dirs()
    d = session_dir(agent, session_id, create=True)
    path = d / "会话.json"
    if path.is_file():
        data = _load(path)
        data["resumed"] = True
    else:
        data = {
            "agent": str(agent),
            "session_id": str(session_id),
            "title": title or str(session_id),
            "status": "open",
            "created_at": _now(),
            **_EMPTY_SESSION,
        }
        data["summary"] = summary
        data["resumed"] = False
    data["updated_at"] = _now()
    _dump(path, data)
    (d / "上下文.md").write_text(_render_context_md(data), encoding="utf-8")
    return {"folder": str(d.relative_to(ROOT)), **data}


def _read_session(agent: str, session_id: str) -> dict:
    """内部:读会话快照(不对外暴露工具,由 session_open / session_close 复用)。"""
    path = session_dir(agent, session_id) / "会话.json"
    if not path.is_file():
        return {"exists": False, "agent": agent, "session_id": session_id, **_EMPTY_SESSION}
    return {"exists": True, **_load(path)}


def session_update(
    agent: str,
    session_id: str,
    summary: str | None = None,
    tasks: list | None = None,
    todos: list | None = None,
    conclusions: list | None = None,
    context: list | None = None,
    status: str | None = None,
) -> dict:
    """增量更新会话快照:只覆盖传入的字段,其余保留。"""
    ensure_dirs()
    d = session_dir(agent, session_id, create=True)
    path = d / "会话.json"
    data = _load(path) if path.is_file() else {
        "agent": str(agent), "session_id": str(session_id), "title": str(session_id),
        "status": "open", "created_at": _now(), **_EMPTY_SESSION,
    }
    for field, value in (("summary", summary), ("tasks", tasks), ("todos", todos),
                         ("conclusions", conclusions), ("context", context),
                         ("status", status)):
        if value is not None:
            data[field] = value
    data["updated_at"] = _now()
    _dump(path, data)
    (d / "上下文.md").write_text(_render_context_md(data), encoding="utf-8")
    return {"folder": str(d.relative_to(ROOT)), **data}


def session_list() -> dict:
    """内部:列出所有会话(供 memory_overview 统计,不对外暴露工具)。"""
    ensure_dirs()
    base = SHORT_DIR
    if not base.is_dir():
        return {"count": 0, "sessions": []}
    out = []
    for f in sorted(base.glob("*/*/会话.json")):
        try:
            data = _load(f)
        except Exception:
            continue
        out.append({
            "agent": data.get("agent", f.parent.parent.name),
            "session_id": data.get("session_id", f.parent.name),
            "title": data.get("title", ""),
            "status": data.get("status", "open"),
            "updated_at": data.get("updated_at", ""),
            "folder": str(f.parent.relative_to(ROOT)),
        })
    out.sort(key=lambda x: x["updated_at"], reverse=True)
    return {"count": len(out), "sessions": out}


def session_close(agent: str, session_id: str, promote: bool = False) -> dict:
    """冻结会话。promote=true 时把中间结论转入长期记忆(项目上下文)。"""
    if promote:
        cur = _read_session(agent, session_id)
        for text in cur.get("conclusions") or []:
            body = text.get("text", text) if isinstance(text, dict) else text
            add_item("长期记忆", "project", f"[会话 {session_id}] {body}",
                     confidence=60, source=f"agent:{agent}", session=session_id)
    out = session_update(agent, session_id, status="closed")
    return {"closed": True, "folder": out["folder"], "promoted": bool(promote)}


# --------------------------------------------------------------------------
# 长期 / 永久记忆:条目
# --------------------------------------------------------------------------

def _category_dir(category: str) -> Path:
    label = LONG_CATEGORIES.get(category, category)
    return LONG_DIR / _safe_name(label, "未分类")


def _item_files(layer: str):
    if layer == "长期记忆":
        dirs = [d for d in LONG_DIR.iterdir() if d.is_dir()] if LONG_DIR.is_dir() else []
    elif layer == "永久记忆":
        dirs = [PERM_DIR]
    elif layer == "短期记忆":
        raise ValueError("短期记忆按会话文件夹存储,请用 session_* 工具")
    else:
        raise ValueError(f"未知记忆层:{layer}(应为 短期记忆/长期记忆/永久记忆)")
    for d in dirs:
        for f in sorted(d.glob("*.json")):
            yield f


def add_item(
    layer: str,
    category: str,
    content: str,
    confidence: int = 50,
    source: str = "",
    session: str = "",
    tags: list | None = None,
) -> dict:
    """写入一条长期/永久记忆条目。"""
    ensure_dirs()
    if layer not in ("长期记忆", "永久记忆"):
        raise ValueError(f"add_item 只支持 长期记忆/永久记忆,收到:{layer}")
    key = LABEL_TO_KEY.get(category, category)
    item_id = _new_id()
    item = {
        "id": item_id,
        "layer": layer,
        "category": key,
        "category_label": LONG_CATEGORIES.get(key, category),
        "content": content,
        "confidence": max(0, min(100, int(confidence))),
        "tags": list(tags or []),
        "source": source,
        "session": session,
        "created_at": _now(),
        "updated_at": _now(),
    }
    path = (_category_dir(key) if layer == "长期记忆" else PERM_DIR) / f"{item_id}.json"
    _dump(path, item)
    return {"stored": layer, "path": str(path.relative_to(ROOT)), "item": item}


def list_items(layer: str) -> list[dict]:
    """内部:列出某层全部条目(供 memory_query / memory_overview 使用)。"""
    items = []
    for f in _item_files(layer):
        try:
            data = _load(f)
        except Exception:
            continue
        if isinstance(data, dict) and "id" in data:  # 跳过 triples.json 等非条目文件
            items.append(data)
    items.sort(key=lambda x: x["updated_at"], reverse=True)
    return items


def _item_path(layer: str, item_id: str) -> Path:
    for f in _item_files(layer):
        if f.stem == item_id:
            return f
    raise KeyError(f"未找到条目:{item_id}")


def delete_item(layer: str, item_id: str) -> dict:
    """删除单条记忆(纠错用)。三个受保护根文件夹本身不可删除。"""
    path = _item_path(layer, item_id)
    _guard_root(path)
    path.unlink()
    return {"deleted": item_id, "layer": layer}


def query(keyword: str, layer: str | None = None, top_k: int = 10) -> dict:
    """按分词重合度 × 置信度检索记忆(中英文均可)。"""
    tokens = tokenize(keyword)
    layers = [layer] if layer else ["长期记忆", "永久记忆"]
    scored = []
    for ly in layers:
        for item in list_items(ly):
            hay = " ".join(str(item.get(k, "")) for k in ("content", "category_label", "tags"))
            words = tokenize(hay)
            overlap = len(tokens & words)
            if overlap == 0:
                continue
            score = overlap * (1 + int(item.get("confidence", 0)) / 100)
            scored.append((score, ly, item))
    scored.sort(key=lambda x: -x[0])
    hits = [{"layer": ly, "score": round(s, 3), **item} for s, ly, item in scored[:top_k]]
    return {"keyword": keyword, "tokens": sorted(tokens), "count": len(hits), "hits": hits}


# --------------------------------------------------------------------------
# 永久记忆:三元组知识图
# --------------------------------------------------------------------------

def _load_triples() -> dict:
    if TRIPLES_FILE.is_file():
        try:
            return _load(TRIPLES_FILE)
        except Exception:
            pass
    return {"triples": []}


def add_triple(subject: str, relation: str, obj: str, category: str = "",
               confidence: int = 70, source: str = "") -> dict:
    """加三元组。置信度 ≥85 直接进永久知识图;60-84 进长期待验证区;<60 拒收。"""
    ensure_dirs()
    triple = {"subject": subject, "relation": relation, "object": obj,
              "class": category or "未分类", "confidence": int(confidence),
              "source": source, "created_at": _now()}
    if confidence >= 85:
        data = _load_triples()
        data.setdefault("triples", []).append(triple)
        _dump(TRIPLES_FILE, data)
        return {"stored": "永久记忆", "triple": triple, "total": len(data["triples"])}
    if confidence >= 60:
        label = f"[{subject}] —[{relation}]→ [{obj}]"
        item = add_item("长期记忆", "pending_triple", label,
                        confidence=confidence, source=source)
        return {"stored": "长期记忆(待验证三元组)", "item": item["item"]}
    raise ValueError("置信度 < 60,证据不足,已拒收。请先收集更多证据再写入。")


def query_graph(keyword: str, depth: int = 1, limit: int = 30) -> dict:
    """在永久知识图上检索,并沿关系边扩展 depth 圈(默认一圈)。"""
    tokens = tokenize(keyword)
    triples = _load_triples().get("triples", [])
    hit_idx = {i for i, t in enumerate(triples)
               if tokens & tokenize(f"{t.get('subject')} {t.get('relation')} {t.get('object')} {t.get('class')}")}
    for _ in range(max(0, depth - 1)):
        nodes = set()
        for i in hit_idx:
            nodes |= {triples[i].get("subject"), triples[i].get("object")}
        hit_idx |= {i for i, t in enumerate(triples)
                    if t.get("subject") in nodes or t.get("object") in nodes}
    return {
        "keyword": keyword,
        "count": len(hit_idx),
        "triples": [triples[i] for i in sorted(hit_idx)][:limit],
    }


# --------------------------------------------------------------------------
# 概览
# --------------------------------------------------------------------------

def overview() -> dict:
    ensure_dirs()
    sessions = session_list().get("count", 0)
    long_items = list_items("长期记忆")
    perm_items = list_items("永久记忆")
    by_cat: dict[str, int] = {}
    for it in long_items:
        label = it.get("category_label", it.get("category", "未分类"))
        by_cat[label] = by_cat.get(label, 0) + 1
    return {
        "root": str(ROOT),
        "protected_folders": [d.name for d in PROTECTED_DIRS],
        "短期记忆": {"sessions": sessions},
        "长期记忆": {"items": len(long_items), "by_category": by_cat},
        "永久记忆": {"items": len(perm_items),
                     "triples": len(_load_triples().get("triples", []))},
    }
