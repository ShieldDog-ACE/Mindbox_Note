"""Mindbox MCP Server:Streamable HTTP + JSON-RPC 2.0 最小实现(不引 SDK)。

- 方法:initialize / tools/list / tools/call / ping / notifications/*
- 工具注册表模式:新增工具只需在 TOOLS 里加一项(任务书 0.1 第 5 条)
- 与 REST 共用 services 层,MCP 只是另一层皮
"""
from __future__ import annotations

import json
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from .core.config import APP_VERSION, TOKEN, VAULT_DIR
from .services import memory_service as ms
from .services import search_service, session_service
from .services import vault_service as vs

router = APIRouter(tags=["mcp"])
PROTO_VERSION = "2025-06-18"


def _tool(name: str, desc: str, props: dict, required: list[str], handler: Callable):
    return {
        "name": name,
        "description": desc,
        "inputSchema": {"type": "object", "properties": props, "required": required},
        "handler": handler,
    }


# ---------------- 工具 handler(全部薄封装 services) ----------------

def h_describe_vault() -> dict:
    notes = list(VAULT_DIR.rglob("*.md"))
    total = sum(f.stat().st_size for f in notes)
    return {
        "name": VAULT_DIR.name,
        "note_count": len(notes),
        "total_bytes": total,
        "memory": ms.summary(),
    }


def h_append_note(path: str, text: str, position: str = "tail") -> dict:
    note = vs.read_note(path)
    content = (text + "\n" + note["content"]) if position == "head" else (note["content"].rstrip("\n") + "\n" + text)
    return vs.write_note(path, content)


def h_patch_note(path: str, find: str, replace: str) -> dict:
    note = vs.read_note(path)
    if find not in note["content"]:
        raise ValueError(f"text not found in {path}")
    return vs.write_note(path, note["content"].replace(find, replace, 1))


def h_list_folder(path: str = "", recursive: bool = False) -> dict:
    base = vs._safe_path(path or ".")
    if base.is_file():
        raise ValueError(f"not a directory: {path}")
    if recursive:
        out = []
        for f in sorted(base.rglob("*.md")):
            out.append(str(f.relative_to(VAULT_DIR)))
        return {"paths": out}
    out = []
    for child in sorted(base.iterdir()):
        if child.name.startswith("."):
            continue
        out.append({"name": child.name, "type": "dir" if child.is_dir() else "file"})
    return {"entries": out}


def h_get_metadata(path: str) -> dict:
    note = vs.read_note(path)
    return {"path": note["path"], "name": note["name"], "meta": note["meta"]}


def h_add_memory(layer: str, category: str, content: str, confidence: int = 50) -> dict:
    return ms.add_item(layer, category, content, {"confidence": confidence})


def h_report_error(what: str, cause: str, consequence: str) -> dict:
    content = f"[{what}] —[{cause}]→ [{consequence}]"
    return ms.add_item("long", "error_case", content, {"confidence": 90})


def h_add_triple(subject: str, relation: str, object: str, confidence: int = 70, **kw) -> dict:
    """三元组写入:≥85 直接进永久知识图;60-84 进长期待验证区;<60 拒收。"""
    cls = kw.get("class", "未分类")  # class 是 JSON 入参名,Python 里用 kw 接
    triple = {"subject": subject, "relation": relation, "object": object, "class": cls}
    if confidence >= 85:
        path = VAULT_DIR / "memory" / "permanent" / "triples.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"triples": []}
        triple["confidence"] = confidence
        data.setdefault("triples", []).append(triple)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"stored": "permanent", "triple": triple}
    if confidence >= 60:
        item = ms.add_item("long", "pending_triple", f"[{subject}] —[{relation}]→ [{object}]",
                           {"confidence": confidence, "triple": triple})
        return {"stored": "pending", "item": item}
    raise ValueError("confidence < 60 rejected; gather more evidence first")


# ---------------- 工具注册表 ----------------

T = _tool
TOOLS: dict[str, dict] = {
    # 笔记组
    "read_note": T("read_note", "读取笔记正文与元数据",
                   {"path": {"type": "string"}}, ["path"], vs.read_note),
    "create_note": T("create_note", "创建笔记(防覆盖,自动建父目录)",
                     {"path": {"type": "string"}, "content": {"type": "string"},
                      "meta": {"type": "object"}}, ["path"],
                     lambda path, content="", meta=None: vs.write_note(path, content, meta, overwrite=False)),
    "edit_note": T("edit_note", "整体替换笔记内容",
                   {"path": {"type": "string"}, "content": {"type": "string"},
                    "meta": {"type": "object"}}, ["path", "content"], vs.write_note),
    "append_note": T("append_note", "追加文本到笔记头/尾",
                     {"path": {"type": "string"}, "text": {"type": "string"},
                      "position": {"type": "string", "enum": ["head", "tail"]}},
                     ["path", "text"], h_append_note),
    "patch_note": T("patch_note", "定点查找替换(只替换第一处)",
                    {"path": {"type": "string"}, "find": {"type": "string"},
                     "replace": {"type": "string"}}, ["path", "find", "replace"], h_patch_note),
    "delete_note": T("delete_note", "删除笔记(连带元数据)",
                     {"path": {"type": "string"}}, ["path"], vs.delete_note),
    "list_folder": T("list_folder", "列目录;recursive=true 列全库 .md",
                     {"path": {"type": "string"}, "recursive": {"type": "boolean"}}, [], h_list_folder),
    "search_notes": T("search_notes", "分词全文搜索笔记",
                      {"query": {"type": "string"}}, ["query"], search_service.search),
    "get_metadata": T("get_metadata", "只取笔记元数据不取正文",
                      {"path": {"type": "string"}}, ["path"], h_get_metadata),
    "describe_vault": T("describe_vault", "库概况:笔记数/大小/记忆分布", {}, [], h_describe_vault),
    # 记忆组
    "query_memory": T("query_memory", "按层检索记忆(short/long/permanent)",
                      {"layer": {"type": "string", "enum": list(ms.LAYERS)},
                       "keyword": {"type": "string"}, "top_k": {"type": "number"}},
                      ["layer", "keyword"], ms.query),
    "get_session": T("get_session", "读短期记忆快照(任务进度/摘要)",
                     {"session_id": {"type": "string"}}, ["session_id"], session_service.get_session),
    "update_session": T("update_session", "写短期记忆快照,防上下文爆满",
                        {"session_id": {"type": "string"}, "summary": {"type": "string"},
                         "tasks": {"type": "array"}, "conclusions": {"type": "array"}},
                        ["session_id"], session_service.update_session),
    "add_memory": T("add_memory", "写入记忆条目(长期9类或永久)",
                    {"layer": {"type": "string", "enum": list(ms.LAYERS)},
                     "category": {"type": "string"}, "content": {"type": "string"},
                     "confidence": {"type": "number"}},
                    ["layer", "category", "content"], h_add_memory),
    "report_error": T("report_error", "记录错误案例,避免重犯",
                      {"what": {"type": "string"}, "cause": {"type": "string"},
                       "consequence": {"type": "string"}},
                      ["what", "cause", "consequence"], h_report_error),
    "add_triple": T("add_triple", "加三元组:≥85 进永久知识图,60-84 进待验证区",
                    {"subject": {"type": "string"}, "relation": {"type": "string"},
                     "object": {"type": "string"}, "class": {"type": "string"},
                     "confidence": {"type": "number"}},
                    ["subject", "relation", "object"], h_add_triple),
    "hit_memory": T("hit_memory", "记录记忆条目的引用/成败,为升降级积累数据",
                    {"layer": {"type": "string", "enum": list(ms.LAYERS)},
                     "item_id": {"type": "string"}, "success": {"type": "boolean"}},
                    ["layer", "item_id"], ms.hit_item),
}


def _call_tool(name: str, args: dict) -> Any:
    tool = TOOLS.get(name)
    if tool is None:
        raise KeyError(f"unknown tool: {name}")
    return tool["handler"](**args)


# ---------------- JSON-RPC 端点 ----------------

def _err(code: int, message: str, rid: Any = None, status: int = 200) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "error": {"code": code, "message": message}, "id": rid},
                        status_code=status)


@router.post("/mcp")
async def mcp_endpoint(request: Request):
    if TOKEN and request.headers.get("authorization", "") != f"Bearer {TOKEN}":
        return _err(-32001, "unauthorized", status=401)
    try:
        body = await request.json()
    except Exception:
        return _err(-32700, "parse error", status=400)

    method: str = body.get("method", "")
    rid = body.get("id")
    if method.startswith("notifications/"):
        return Response(status_code=202)

    if method == "initialize":
        result = {
            "protocolVersion": PROTO_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mindbox", "version": APP_VERSION},
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": [{k: t[k] for k in ("name", "description", "inputSchema")} for t in TOOLS.values()]}
    elif method == "tools/call":
        params = body.get("params") or {}
        try:
            data = _call_tool(params.get("name", ""), params.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=2)}],
                      "isError": False}
        except Exception as e:  # 工具级错误按 MCP 规范放进结果
            result = {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
    else:
        return _err(-32601, f"method not found: {method}", rid)

    return JSONResponse({"jsonrpc": "2.0", "result": result, "id": rid})
