# 使用说明(给 AI 看)

> 本文件是 `mindbox-memory` MCP Server 的**机器可读接口手册**。
> 如果你是 AI:请把本文当作你操作"外部大脑"的规范,不要凭猜测调用工具。
> 服务端实现:`server.py`(协议层)+ `memory_store.py`(存储层)。

---

## 0. 速查

| 项 | 值 |
|---|---|
| server name | `mindbox-memory` |
| 传输 | stdio,换行分隔的 JSON-RPC 2.0(UTF-8,**消息内不得含换行**) |
| protocolVersion | `2025-06-18` |
| 能力 | 仅 `tools`(无 resources / prompts / 推送) |
| 依赖 | 无(Python 3 标准库) |
| 记忆根目录 | `/media/fuka/萤捷/Mindbox-MCP/` |
| 工具数 | 9(精简过:只保留真实任务闭环所需) |

启动方式(由客户端负责,你无需手动启动):

```json
{"mcpServers": {"mindbox-memory": {
  "command": "/media/fuka/萤捷/Mindbox-MCP/run-mindbox-mcp", "args": [], "env": {}
}}}
```

---

## 1. 核心模型:三层记忆

```
短期记忆  —— 会话作用域。一个 agent 的一个会话 = 一个文件夹。= 你的工作台
长期记忆  —— 过渡区。9 类条目 + 置信度 / 来源 / 标签。        = 你的草稿箱
永久记忆  —— 知识图。已验证条目 + 三元组(主语—[关系]→宾语)。 = 你的结论库
```

**置信度门槛(硬规则,服务端会强制执行):**

| confidence | 去向 |
|---|---|
| `≥ 85` | 永久记忆(知识图) |
| `60 ~ 84` | 长期记忆 · 待验证三元组 |
| `< 60` | **拒收**,抛 `ValueError` |

**长期 → 永久:** 服务端**不提供**自动晋升工具。某条长期条目的结论被反复验证后,
直接以 `confidence ≥ 85` 用 `add_triple` 写成三元组,即进入永久知识图。

**受保护根目录:** `短期记忆/` `长期记忆/` `永久记忆/` 三个文件夹**不可删除**。
工具层只能删根目录**里的条目**,删不到根目录本身;服务每次启动与调用前校验,缺失自动重建。

---

## 2. 标准工作流(按顺序照做)

### 2.1 会话开始(必做)

```
session_open(agent="<你的名字>", session_id="<本次会话唯一 id>", title="<任务简述>")
```

`agent` 用稳定标识(如 `trae` / `cursor` / `claude-code`),`session_id` 用你生成的一次性
唯一串(如时间戳+随机)。若该会话已存在,会返回 `resumed: true` 并把旧快照带回来。

> 这一步的价值:把"当前任务状态"从你的上下文窗口**外置**到磁盘。上下文快满时,
> 再调一次 `session_open`(同 agent + 同 session_id)就能把状态读回来,
> 而不是把整段历史一直拖着。**没有单独的读接口,open 即读。**

### 2.2 会话进行中(每完成一步就写)

```
session_update(agent, session_id,
               summary="<一段话的现状摘要>",
               tasks=[{"text": "改完后端鉴权", "status": "done"}, ...],
               todos=["补单元测试"],
               conclusions=["jieba 分词在长文本上耗时 1.2s,可接受"])
```

增量语义:**只覆盖传入的字段**,没传的字段保持原值。想随手记一句,追加到 `context`:

```
session_update(agent, session_id, context=["[随手记] 用户明确不要弹窗打断"])
```

### 2.3 学到东西就沉淀

```
# 事实类知识 → 三元组(推荐)
add_triple(subject="Exfat", relation="不支持", object="符号链接", category="文件系统", confidence=95)
add_triple(subject="新方法X", relation="可能有效于", object="财报分析", category="技能", confidence=65)

# 非三元组的内容 → 条目
memory_add(layer="长期记忆", category="preference", content="用户偏好中文回答,不要问选择题", confidence=80)
memory_add(layer="长期记忆", category="skill", content="财报分析配方:先看现金流再看应收", confidence=70)

# 犯错了 → 错误案例(category=error_case,建议 confidence=90)
memory_add(layer="长期记忆", category="error_case",
           content="[直接 rm -rf 数据目录] —[没先确认路径]→ [用户笔记被删]",
           confidence=90, source="agent:<你>")
```

`long-term category` 的合法 key:

| key | 中文分类 | 用途 |
|---|---|---|
| `task` | 任务记录 | 最近 1-4 周完成/失败的任务 |
| `skill` | 技能配方 | 新学但未反复验证的做法 |
| `digest` | 资料摘要 | 看过的论文/网页/视频要点 |
| `preference` | 用户偏好 | 近期表现出的偏好 |
| `pending_triple` | 待验证三元组 | 置信度 60-84 |
| `error_case` | 错误案例 | 犯过的错,避免重犯 |
| `emotion` | 情绪历史 | 用户状态波动(**不升级永久**) |
| `ai_effect` | 外部大脑效果 | 哪个 AI 在什么场景更有效 |
| `project` | 项目上下文 | 项目进度/依赖 |

### 2.4 用之前先检索(重要)

```
memory_query(keyword="文件系统 符号链接", top_k=5)   # 缺省查 长期+永久
memory_query(keyword="偏好", layer="长期记忆")
query_graph(keyword="Exfat", depth=1)                # 只在永久知识图上,沿关系边扩一圈
```

检索命中后直接使用 `hits` 里的条目即可(返回的就是完整内容,含 `id`,便于纠错时删改)。

### 2.5 会话结束

```
session_close(agent, session_id, promote=True)   # promote=true 把中间结论转入长期记忆
```

---

## 3. 工具全集(9)

### 概览

| 工具 | 参数 | 说明 |
|---|---|---|
| `memory_overview` | — | 三层条目数、会话数、三元组数、受保护文件夹状态 |

### 短期记忆(3)

| 工具 | 必填 | 可选 | 说明 |
|---|---|---|---|
| `session_open` | `agent`, `session_id` | `title`, `summary` | 新建/续接会话,建 `<短期记忆>/<agent>/<会话>/`;**返回完整快照,兼作读接口** |
| `session_update` | `agent`, `session_id` | `summary`, `tasks`, `todos`, `conclusions`, `context`, `status` | 增量更新,只覆盖传入字段 |
| `session_close` | `agent`, `session_id` | `promote` | 冻结会话;`promote=true` 把 conclusions 转长期记忆(`project` 类) |

### 长期 / 永久条目(3)

| 工具 | 必填 | 可选 | 说明 |
|---|---|---|---|
| `memory_add` | `layer`, `category`, `content` | `confidence`(默认 50), `source`, `tags` | 写入条目(错误案例也走这里,`category="error_case"`) |
| `memory_query` | `keyword` | `layer`, `top_k`(默认 10) | 中英分词检索,重合度 × 置信度排序,返回完整条目 |
| `memory_delete` | `layer`, `item_id` | — | 删单条(纠错用);根文件夹删不到 |

### 永久知识图(2)

| 工具 | 必填 | 可选 | 说明 |
|---|---|---|---|
| `add_triple` | `subject`, `relation`, `object` | `category`, `confidence`(默认 70), `source` | 按置信度分流到 永久/待验证/拒收 |
| `query_graph` | `keyword` | `depth`(默认 1), `limit`(默认 30) | 图上检索 + 沿关系边扩展 |

`layer` 合法值:`"短期记忆"` / `"长期记忆"` / `"永久记忆"`(中文,原样传)。

> **只保留 9 个的理由:** 工具越多,模型越容易选错、越占用上下文。凡是能被
> 其它工具覆盖(`session_read` / `session_append`)、有更直观入口(`*_list`)、
> 或依赖尚不存在的自动化(`memory_hit` / `memory_promote`)的,一律移除。
> 调用已移除的工具会返回 `isError: true` + `KeyError: 未知工具:xxx`,不会断连。

---

## 4. 磁盘格式(你可以直接读写文件)

不想走工具、或需要批量操作时,可直接读写文件——服务无缓存,**下次调用即生效**。

### 短期记忆

`短期记忆/<agent>/<会话>/会话.json`

```json
{
  "agent": "trae",
  "session_id": "s-20260921-2230",
  "title": "修复打包丢数据",
  "status": "open",
  "created_at": "2026-09-21 22:30:00",
  "updated_at": "2026-09-21 22:41:12",
  "summary": "把 vault 从 resources/ 挪到 userData/,已改 electron/main.js",
  "tasks": [{"text": "改 vaultDir()", "status": "done"}],
  "todos": ["重打 .deb 验证"],
  "conclusions": ["打包态数据必须放在 app.getPath('userData') 下"],
  "context": ["[2026-09-21 22:35:00] 用户强调不能再丢笔记"]
}
```

同目录 `上下文.md` 是它的 Markdown 镜像(由服务生成,人读用)。

### 长期记忆

`长期记忆/<中文分类>/<item_id>.json`,`item_id` 形如 `20260921-223012-3f2a`

```json
{
  "id": "20260921-223012-3f2a",
  "layer": "长期记忆",
  "category": "preference",
  "category_label": "用户偏好",
  "content": "用户偏好中文回答",
  "confidence": 80,
  "tags": [],
  "source": "agent:trae",
  "session": "s-20260921-2230",
  "created_at": "2026-09-21 22:30:12",
  "updated_at": "2026-09-21 22:30:12"
}
```

### 永久记忆

- 条目:`永久记忆/<item_id>.json`(结构同上)
- 知识图:`永久记忆/triples.json`

```json
{"triples": [{"subject": "Exfat", "relation": "不支持", "object": "符号链接",
              "class": "文件系统", "confidence": 95, "source": "", "created_at": "..."}]}
```

---

## 5. 行为规范(请遵守)

1. **会话一开始就 `session_open`**,否则你的短期记忆不会落盘。
2. **不确定的东西不要抬高置信度**。宁可 60-84 进待验证区,也别伪造 ≥85。
3. **写入要自包含**:未来的读者(可能是别的 agent)没有你现在的上下文。
   写"用户要求中文回答"而不是"按要求处理"。
4. **不要重复沉淀**:写之前先 `memory_query` 查一下,已有同类条目就更新它,别堆垃圾。
5. **不要试图删除三个根文件夹**,工具层会拒绝;需要重置就删里面的条目。
6. **不要往记忆里写密钥、令牌、隐私密码**——它是明文文件。
7. **检索优先于提问**:用户问"上次怎么做的",先 `memory_query`,再考虑反问。
8. 短期记忆是**临时**的:真正重要的结论必须显式转到长期/永久,否则会话冻结后就沉底了。

---

## 6. 协议约定(实现参考)

请求(每行一条 JSON):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory_overview","arguments":{}}}
{"jsonrpc":"2.0","id":4,"method":"ping"}
```

响应:

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{...JSON...}"}],"isError":false}}
```

- `initialize` 返回 `protocolVersion`(回显客户端的)、`capabilities.tools`、
  `serverInfo` 和 `instructions`(即本文摘要)。
- 通知(`notifications/*`)服务端**不回包**。
- 工具执行异常**不会**中断连接:以 `isError: true` + 文本形式返回。
- 错误码:`-32700` 解析失败 / `-32600` 非法请求 / `-32601` 方法不存在 / `-32603` 内部错误。
- 支持 JSON-RPC 批量(数组);**日志只走 stderr**,stdout 只有协议消息。

---

## 7. 一分钟自检

```bash
python3 "/media/fuka/萤捷/Mindbox-MCP/server.py" --check
```

打印 server 名、版本、工具数与三层记忆概览。若要端到端验证,按第 6 节手工喂 JSON
或直接调 `tools/call`。
