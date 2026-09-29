"""Mindbox 后端应用入口。仅绑定 loopback,数据不出本机。

两条对外通道,共用 services 层:
- REST /api/v1/*  → 给自家前端(Electron 渲染进程)
- POST /mcp       → 给外部 agent(MCP Streamable HTTP)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import memory, notes, search, snapshots, system, vault
from .core.config import API_PREFIX, APP_VERSION
from .mcp_server import router as mcp_router
from .services import vault_service

app = FastAPI(title="Mindbox", version=APP_VERSION, docs_url=None, redoc_url=None, openapi_url=None)

# Electron 渲染进程来源包含 file://(Origin: null)与 vite dev server,本地服务收紧到 loopback
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (system.router, vault.router, notes.router, search.router, memory.router, snapshots.router):
    app.include_router(router, prefix=API_PREFIX)

app.include_router(mcp_router)  # /mcp 不带版本前缀

# 启动即创建内置记忆文件夹(短期/长期/永久记忆),它们不可删除
vault_service.ensure_memory_folders()
