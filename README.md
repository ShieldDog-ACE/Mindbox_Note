<p align="center">
  <img src="./Mindbox/Mindbox.png" alt="Mindbox" width="160" />
</p>

<h1 align="center">Mindbox</h1>

<p align="center">
  给 AI 装一个不会忘的脑子喵<br />
  <em>A brain that never forgets, bolted onto your AI. Meow.</em>
</p>

<p align="center">
  <img alt="desktop" src="https://img.shields.io/badge/desktop-1.0.4-8a6cff?style=flat-square" />
  <img alt="mcp" src="https://img.shields.io/badge/MCP_server-1.0.0-7fd3a8?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-7fb0ff?style=flat-square" />
  <img alt="deps" src="https://img.shields.io/badge/deps-zero-ffb36b?style=flat-square" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Ubuntu_%2F_Linux-6ad4d4?style=flat-square" />
</p>

---

## 介绍 · Introduction

### 中文

- 你有没有发现，昨天陪 AI 聊了一下午的项目，今天开个新会话它就跟没发生过一样喵。
- 不是它笨，是它没地方存东西喵。
- Mindbox 就是给它安的那个脑子——一个躺在你自己硬盘上的记忆库喵。
- 记忆分三层：短期是便签纸，长期是草稿箱，永久是刻在石头上的知识图喵。
- 每写一条都要报个"把握度"，85 分以上才准进永久区，专门挡住 AI 随口瞎编喵。
- 它通过 MCP 协议接进任何 AI 客户端，一共 9 个小工具，接上就能用喵。
- 记的东西全是普通文件（.md + .json），记事本打开就能看、能改，数据一步都不出你的电脑喵。
- 它自己不是 AI，也不碰模型权重——真正动脑子的是你的 AI，它只负责记住喵。
- 仓库里还附了一个 Obsidian 味道的桌面笔记软件，Ubuntu 上装个 .deb 就能用喵。
- 现在桌面版 1.0.4、MCP 服务 1.0.0 测试版，MIT 协议，随便拿去玩喵。

### English

- Ever noticed how your AI forgets the whole project you two spent yesterday afternoon on, the moment you open a fresh chat? Meow.
- It is not dumb. It just has nowhere to put things. Meow.
- Mindbox is the brain you bolt on — a memory box that lives on your own disk. Meow.
- Memory comes in three layers: a sticky note for the session, a drawer of drafts, and a knowledge graph carved in stone. Meow.
- Every entry carries a confidence score, and only 85+ may enter the permanent zone, which is how AI guesswork gets kept out. Meow.
- It plugs into any AI client over MCP through nine small tools, usable the moment you connect. Meow.
- Everything is stored as plain files (.md + .json) you can open and edit in any text editor, and nothing ever leaves your machine. Meow.
- Mindbox is not an AI itself and never touches model weights — your AI does the thinking, Mindbox just remembers. Meow.
- The repo also ships a desktop notes app with an Obsidian flavour; on Ubuntu you just install the .deb. Meow.
- Right now: desktop 1.0.4, MCP server 1.0.0 beta, MIT licensed. Go play with it. Meow.

> 一句话版：AI 有记性了，文件在你手上喵。<br />
> One-liner: your AI remembers, and the files are yours. Meow.

---

## 目录

- [介绍 · Introduction](#介绍--introduction)
- [第一部分：软件本身](#第一部分--软件本身)
  - [一、这是什么](#一这是什么)
  - [二、它能做到什么（功能）](#二它能做到什么功能)
  - [三、里面实际实现了什么](#三里面实际实现了什么)
  - [四、怎么下载](#四怎么下载)
  - [五、怎么用](#五怎么用)
  - [六、依赖项](#六依赖项)
  - [七、一些实话](#七一些实话)
  - [八、文件说明](#八文件说明)
- [第二部分：MCP 接口手册](#第二部分--mcp-接口手册)
  - [一、这部分给谁看](#一这部分给谁看)
  - [二、先说清楚 MCP 是什么](#二先说清楚-mcp-是什么)
  - [三、怎么接进去](#三怎么接进去)
  - [四、传输与协议约定](#四传输与协议约定)
  - [五、9 个工具](#五9-个工具)
  - [六、数据落在磁盘上长什么样](#六数据落在磁盘上长什么样)
  - [七、自己加一个工具](#七自己加一个工具)
  - [八、已知边界](#八已知边界)
  - [九、版本信息](#九版本信息)
  - [十、一句话总结](#十一句话总结)
- [这个项目从哪来的](#这个项目从哪来的)
- [许可](#许可)

---

## 第一部分 · 软件本身

### 一、这是什么

Mindbox 是一个跑在你自己电脑上的"记忆库"，外加一个 Obsidian 风格的桌面笔记软件。

你平时用 AI 大概都遇到过：昨天聊了一下午的项目，今天开个新会话它就完全不认识你了；上周踩过的坑，这周原样再踩一遍。这不是它笨，是它没地方存放记忆——每次对话结束，一切归零。Mindbox 补的就是这一块。

它通过 MCP 协议（AI 客户端通用的一套接口标准）接进你的 AI 客户端，之后 AI 就能把东西写进去、需要时再读出来；下次开新会话，它先把记忆读一遍，于是它还记得你。

它本身不是 AI，不会跟你聊天，也不碰任何模型权重——真正干活的是你的 AI。数据全在你自己的硬盘上，不联网、不上传。

（三层记忆的细节见 [二、它能做到什么](#二它能做到什么功能)；桌面软件长什么样见 [八、文件说明](#八文件说明) 里的 `Mindbox/`。）

### 二、它能做到什么（功能）

1. 三层记忆，各管一段

   - 短期记忆 —— 当前会话的工作台。每个会话单独一个文件夹，记着这一轮在干什么、做到哪了、有什么中间结论、还剩什么没做。会话结束就冻结。好处是：AI 不用把整段聊天历史一直背着，随时可以把状态写出去、再读回来，上下文不容易爆。
   - 长期记忆 —— 过渡区，放"可能有用但还没定论"的东西。分 9 类：任务记录、技能配方、资料摘要、用户偏好、待验证三元组、错误案例、情绪历史、外部大脑效果、项目上下文。每条都带置信度和来源，不急着下结论。
   - 永久记忆 —— 只放已经确认的事实。以三元组的形式存（主语 —[关系]→ 宾语），构成一张知识图，支持顺着关系往下找。比如存了"exfat 不支持符号链接"，以后问起符号链接，它能沿着关系把相关的东西一起捞出来。

2. 置信度当闸门

   写三元组的时候要给个 0-100 的把握度，系统按这个分流：

   | 置信度 | 去向 |
   |---|---|
   | 85 分以上 | 进永久记忆（知识图） |
   | 60 到 84 | 进长期记忆的"待验证"区 |
   | 60 分以下 | 直接退回，不收 |

   这样能挡住一大批"AI 随口瞎编"的内容。不敢肯定就别往永久里塞。

3. 检索是真的能搜到

   中文英文都能搜，不用装分词库。它把查询词和库里的内容都切一遍，按重合度再乘上置信度排序，返回完整的条目。不是简单的字符串包含，像"打包 数据目录 笔记丢失"这种组合查询，能把最相关的那条错误案例排到最前面。

4. 三个文件夹删不掉

   短期记忆 / 长期记忆 / 永久记忆，这三个是系统自带的根文件夹。删除操作在工具层面就被拦住了，程序每次启动还会检查一遍，少了就自动重建。

   为什么这么设计？记忆系统最怕的不是写错，是被清空。

5. 人能看懂、能改

   所有记忆都是普通文件：JSON 存结构，Markdown 存给人看的摘要。你随时可以用记事本打开看 AI 到底记了什么，觉得哪条不对直接改，或者删掉。改完 MCP 下次读到的就是新的。数据主权在你手上，不存在"导不出来"这回事。

### 三、里面实际实现了什么

如果你想了解技术细节，这部分是实话实说的清单：

#### MCP 协议层（手写的，没引官方 SDK）

- stdio 传输，逐行 JSON，符合 JSON-RPC 2.0
- 9 个工具，加上连接保护、错误兜底、批量请求
- 协议细节、错误码、怎么自己加一个工具，全部写在下面的 [第二部分 · MCP 接口手册](#第二部分--mcp-接口手册) 里

#### 记忆存储层

- 三层记忆的文件布局与读写
- 条目元数据：id、分类、置信度、来源、标签、创建/更新时间
- 会话快照增量更新（只覆盖传进来的字段，其余保留）
- 每次写快照时自动重新生成一份 Markdown 镜像给你看
- 中英文无依赖分词（ASCII 词 + 中文单字 + 中文双字）
- 检索排序：命中词数 × 置信度
- 三元组知识图，支持沿关系边往外扩一圈
- 删除保护 + 根文件夹缺失自动重建
- 路径消毒，防目录穿越

#### 工具面：9 个

| 工具名 | 干什么 |
|---|---|
| `memory_overview` | 看三层记忆的总体情况 |
| `session_open` | 开一个会话（也会返回已有快照，等于读） |
| `session_update` | 更新会话进度 |
| `session_close` | 结束会话，可把结论转进长期记忆 |
| `memory_add` | 写一条长期/永久条目 |
| `memory_query` | 检索记忆 |
| `memory_delete` | 删一条（纠错用） |
| `add_triple` | 写三元组，按置信度自动分流 |
| `query_graph` | 在知识图上检索 |

为什么只有 9 个？因为工具越多，AI 越容易挑错、越浪费上下文。凡是能被别的工具覆盖的（比如"读会话"被"打开会话"覆盖）、或者你打开文件夹就能看的（比如"列出所有条目"），一律没做。中间版本曾经有 17 个，后来砍掉 8 个。

#### 测试情况

- 协议层端到端自测：46 项断言全通过
- 精简后回归测试：24 项全通过
- 真机接入过 Trae，跑通了完整的写入 / 检索 / 清空流程
- 上面这些都有记录，不是估计值

### 四、怎么下载

仓库里是两样东西，分开装：

**桌面笔记软件（`Mindbox/`）**

- Ubuntu：发布页下载 `mindbox_x.y.z_amd64.deb`，然后

  ```bash
  sudo apt install ./mindbox_1.0.4_amd64.deb
  ```

  版本号递增时 apt 会正常升级；如果想用同一个版本号覆盖安装，要显式加 `--reinstall`（否则 apt 会直接跳过，你会以为装上了、其实还是旧代码）。
- 目标机需要系统里有 **Python 3.12**（后端依赖随包分发，但解释器用系统的）。Ubuntu 24.04 自带；22.04 / 25.04 需要自己装一个 3.12。
- 想从源码构建：

  ```bash
  cd Mindbox
  npm install
  node node_modules/vite/bin/vite.js build                # 前端
  node node_modules/electron-builder/cli.js --linux deb   # 打 .deb
  ```

**MCP 记忆服务（`Mindbox-MCP/`）**

这东西没有安装包，也不需要编译。它就是一个 Python 脚本。

- 方式一：下载压缩包。在发布页面点 Code → Download ZIP，解压到任意目录就行。
- 方式二：用 git。

  ```bash
  git clone <仓库地址> Mindbox-MCP
  ```

（仓库地址以发布页面为准。）

下载完你会发现目录里有一堆文件，但真正必需的只有两个：

- `server.py`：协议层
- `memory_store.py`：存储层

其他都是可选的：`run-mindbox-mcp` 是个启动脚本，`mcp.json` 是配置模板，三份 .md 是文档。那三个记忆文件夹如果不存在，程序第一次启动会自己建。

所以哪怕你只拷这两个 .py 文件到别的目录，它也能跑。

### 五、怎么用

第一步，让你的 AI 客户端认识它。

在客户端的 MCP 设置里加一段配置，把 `command` 指向启动脚本：

```json
{
  "mcpServers": {
    "mindbox-memory": {
      "command": "/你的路径/Mindbox-MCP/run-mindbox-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

各个客户端的位置：

- Trae：设置 → MCP → 添加服务器 → 选"手动配置"，把上面那段贴进去 → 保存。然后重载窗口（Ctrl+Shift+P 输入 Reload Window），工具列表才会刷新。
- Cursor：同样的 JSON 合并进 `~/.cursor/mcp.json`，重启 Cursor。
- Claude Code / CodeBuddy Code：`claude mcp add-json mindbox-memory "$(cat mcp.json)"`，或者在项目根目录建 `.mcp.json`，把配置写进去。

  - 注意 `command` 一定要写绝对路径，别写相对路径，因为客户端的工作目录不一定在哪。

第二步，先自己确认服务是好的。

```bash
python3 /你的路径/Mindbox-MCP/server.py --check
```

会打印出服务器名、版本、工具数量，以及三层记忆当前各有多少条。能打出来说明服务本身没问题。这一步不需要任何客户端配合。

第三步，正常聊天就行。

接好之后不用你操心怎么调工具，AI 会自己用。你只要正常说话：

- 你说"记住：我的项目在 /x/y" → 它写进长期记忆
- 你说"上次那个 bug 怎么修的" → 它先去检索，命中就用；还会先查一下有没有重复的
- 你说"从现在起我们做长期的" → 它开会话、每完成一步记一次进度
- 你说"今天先到这" → 它结束会话，把有价值的结论转进长期记忆

也可以直接下命令，比如"把这条写进永久记忆"、"查一下我记忆里有没有关于 XX 的"、"这个结论还不够确定，先放待验证区"。

第四步，想看 AI 到底记了什么，直接打开文件夹。

- `短期记忆/`：里面是 `<agent>/<会话>/`，每个会话一对文件：`会话.json` 和 `上下文.md`（后者是给人读的）
- `长期记忆/`：按九个分类分了子文件夹，每个条目一个 `.json`
- `永久记忆/`：条目 + `triples.json`（知识图）

想改哪条就打开改，想删哪条就删文件。改完立刻生效，不用重启。

想彻底清空重来：把三个文件夹里的内容删掉，保留文件夹本身（或者干脆删干净，下次启动会自动重建）。然后重载一下客户端。

### 六、依赖项

#### 运行环境

- Python 3.8 或更新版本（开发和实测用的是 3.12）
- 对操作系统没要求，Linux / macOS / Windows 都行

#### 第三方库

没有。一个都没有。

整个项目只用 Python 标准库：`json`、`re`、`time`、`uuid`、`pathlib`、`os`、`sys`，就这些。

所以：不需要 `pip install`，不需要虚拟环境，不需要 Node.js，不需要编译，不需要数据库。

为什么坚持零依赖？因为这东西是要长期躺在你硬盘上用的。依赖越少，三年后它还能跑的概率就越大。

#### 磁盘

每个记忆条目就是一个几 KB 的小 JSON，除非攒到几万条，否则占的空间可以忽略。

#### 网络

完全不需要。stdio 本地进程，数据不出本机。

#### 文件系统注意事项

如果你的数据盘是 exfat（比如某些 U 盘、移动硬盘、或者某些双系统共用的分区），有两件事要知道：

1. exfat 不支持符号链接，所以不要用 `ln -s` 这种方式部署
2. exfat 上 `chmod` 和 `chattr` 都是无效的，所以三个文件夹的"不可删除"只能是程序层面的保护：MCP 工具删不掉它，但你要是用文件管理器手动删，程序拦不住，只能等下次启动自动重建（内容会丢）。

   - 解决办法很朴素：定期把整个文件夹复制一份备份。

### 七、一些实话

这部分不放宣传，说说它现在的问题：

1. 没有自动升级机制。本来设计了"引用超过 100 次、成功率超过 90% 就从长期升到永久"，但这个门槛在实际使用里基本达不到，而且没有东西去自动跑它。所以现在暂时把这个功能撤掉了，等自动化那块做完再说。目前想让某条进永久，就自己用 `add_triple` 以 85 分以上写一遍。
2. 并发写入没有加锁。正常情况下你是一个 AI 在用，没影响；但如果你同时挂了好几个客户端，而且恰好同一秒往同一条记忆写，理论上有可能互相覆盖。后面会加上文件锁。
3. 中文分词是自己写的（单字 + 双字），不是 jieba。好处是零依赖，坏处是召回率不如专业分词库，低相关度的结果里会有点噪声。够用，但不是最好。
4. 只在 Trae 上做过真机接入测试。Cursor、Claude Code、CodeBuddy 的配置都给了，但我没实地跑过，不排除有细节要调。
5. 没有鉴权。因为它是本地 stdio 进程，只有本机能碰，风险不大。如果哪天要做成 HTTP 远程服务，那必须补 Token。

知道这些再决定用不用，比看到一堆好话强。

### 八、文件说明

| 文件 | 说明 |
|---|---|
| `server.py` | MCP 协议层（JSON-RPC / 工具注册表） |
| `memory_store.py` | 三层记忆的存储和检索 |
| `run-mindbox-mcp` | 启动脚本，客户端配置里指向它就行 |
| `mcp.json` | 配置模板，复制粘贴用 |
| `README.md` | 本文档，软件介绍 + MCP 接口手册合并版 |
| `使用说明-人.md` | 给人看的完整手册 |
| `使用说明-AI.md` | 给 AI 看的接口手册（工具参数、协议细节） |
| `测试报告-20260921.md` | 这次测试的完整记录 |
| `短期记忆/` | 系统自带，不可删除 |
| `长期记忆/` | 系统自带，不可删除 |
| `永久记忆/` | 系统自带，不可删除 |

桌面笔记软件的目录（`Mindbox/`）：

| 文件 | 说明 |
|---|---|
| `Mindbox/src/` | 前端：React + TypeScript + Vite，CodeMirror 6 编辑器、力导向关系图、白板、双链/标签/反链 |
| `Mindbox/backend/` | 后端：Python + FastAPI，笔记 CRUD、分词检索、记忆 API、内嵌 MCP 端点（走 `/mcp`） |
| `Mindbox/electron/` | 桌面壳：Electron 主进程，负责拉起后端与开窗 |
| `Mindbox/build/` | 打包资源：应用图标与 .deb 安装脚本模板 |
| `Mindbox/public/` | 渲染层静态资源：`icon.png`、`favicon.ico` |
| `Mindbox/任务书.md` | 桌面版的需求与设计文档（含里程碑与接口预留原则） |
| `Mindbox/vault/` | 开发态笔记库（安装后数据在 `~/.config/mindbox/vault`，升级重装不会丢） |


---

## 第二部分 · MCP 接口手册

### 一、这部分给谁看

本文第一部分讲的是"这软件是什么、怎么装、怎么用"。这一部分讲的是"它的 MCP 接口长什么样"。

如果你属于下面这几种情况，看这一部分：

- 你想自己写一个 MCP 客户端来接它，需要知道协议细节
- 你想给它加一个自己的工具
- 你想让 AI 直接按格式调，而不是等它自己摸索
- 你遇到报错，想看错误码是什么意思
- 你想知道记忆到底存成什么样，或者想绕开工具直接改文件

如果你只是想装上用起来，看第一部分就够了，这一部分可以先不看。

### 二、先说清楚 MCP 是什么

MCP 全称 Model Context Protocol，是给 AI 客户端用的一套接口约定。你可以把它理解成"AI 版的 USB 接口"：

```text
客户端（Trae、Cursor、Claude Code 这些）
    ↓ 按约定的格式发请求
服务端（就是本项目）
    ↓ 按约定的格式回结果
```

约定本身不复杂：消息是 JSON，走标准输入输出，一来一回，每条消息占一行。

有个概念要先分清：MCP 里说的"工具"（tool），就是一个带参数的函数。客户端会把所有工具的名字和参数说明告诉 AI，AI 自己决定调哪个、传什么。

所以我们要做的事只有两件：

1. 把工具清单报给客户端（`tools/list`）
2. 客户端说"调这个工具、参数是这些"的时候执行它（`tools/call`）

就这么简单。剩下的都是格式细节。

### 三、怎么接进去

配置就一段 JSON，把它交给客户端：

```json
{
  "mcpServers": {
    "mindbox-memory": {
      "command": "/你的绝对路径/Mindbox-MCP/run-mindbox-mcp",
      "args": [],
      "env": {}
    }
  }
}
```

几个要点：

1. `command` 一定要绝对路径。客户端的工作目录不固定，写相对路径十有八九找不到。
2. server 的名字（这里叫 `mindbox-memory`）可以自己改，但改了之后在各客户端里显示的名字也跟着变。
3. 不需要传任何环境变量，`env` 留空就行。
4. 如果你不想用 `run-mindbox-mcp` 这个启动脚本，可以换成：

   ```json
   "command": "python3",
   "args": ["/你的绝对路径/Mindbox-MCP/server.py"]
   ```

   两种写法效果一样。脚本的好处是它会自己定位所在目录，哪怕你从别的目录启动也不会找错文件。

各客户端放配置的位置，第一部分里写了，这里不重复。

接好之后先自检，不用等客户端：

```bash
python3 /你的路径/Mindbox-MCP/server.py --check
```

正常的话会打印服务器名、版本、工具数量，以及三层记忆的条数。这命令只是打印信息，不会进入服务模式。

排错顺序，按这个来基本都能定位：

1. `--check` 报错 → Python 版本或文件路径有问题
2. `--check` 正常但客户端连不上 → 配置里 `command` 不是绝对路径
3. 连上了但看不到工具 → 客户端没重载，或者配置在错误的文件里
4. 工具调用报错 → 看下面第四节和第五节的说明

注意：改完配置通常要重载客户端才会生效。Trae 是按 Ctrl+Shift+P 输入 Reload Window。

### 四、传输与协议约定

#### 4.1 帧格式

走标准输入输出（stdio），UTF-8 编码。一条消息一行，用换行符分隔。消息内部不能出现换行符，要分行就转义成 `\n`。

所有消息都是标准 JSON-RPC 2.0 格式，带 `jsonrpc` / `method` / `id` 字段。如果客户端是逐行读的，每条回复也必须只占一行。

#### 4.2 支持的方法

| 方法 | 说明 |
|---|---|
| `initialize` | 握手，交换版本和能力 |
| `notifications/initialized` | 客户端通知已就绪（不用回包） |
| `ping` | 探活 |
| `tools/list` | 取工具清单 |
| `tools/call` | 执行工具 |

其他方法一律返回 `-32601` 方法不存在。

这里有个容易踩的坑：任何以 `notifications/` 开头的方法都是通知，服务端不回包。如果你的客户端发了通知还在等回复，会一直卡住。

#### 4.3 initialize 的返回

请求：

```json
{"jsonrpc":"2.0","id":1,"method":"initialize",
 "params":{"protocolVersion":"2025-06-18",
           "capabilities":{},
           "clientInfo":{"name":"demo","version":"1.0"}}}
```

返回的 result 里有四样东西：

| 字段 | 说明 |
|---|---|
| `protocolVersion` | 回显客户端传进来的版本（没传就用 2025-06-18） |
| `capabilities` | 声明能力，这里只有 tools |
| `serverInfo` | 服务端名字和版本 |
| `instructions` | 一段给 AI 看的说明，讲三层记忆怎么用 |

`instructions` 这个字段值得留意。它是写给 AI 看的"使用须知"，客户端通常会把这段塞进系统提示里。如果你在写客户端，建议别丢掉它——它能让 AI 少用错工具。

#### 4.4 调用工具与返回格式

请求：

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call",
 "params":{"name":"memory_overview","arguments":{}}}
```

返回：

```json
{"jsonrpc":"2.0","id":2,"result":{
  "content":[{"type":"text","text":"{...JSON 字符串...}"}],
  "isError":false
}}
```

两个要注意的地方：

1. `content` 是数组，里面每一项有 `type` 和 `text`。本项目固定只返回一项，`type` 是 "text"，而 `text` 是一段 **JSON 字符串**，需要你自己再解析一次。

   为什么不用 structuredContent？因为这样兼容性最好，老客户端新客户端都能用，代价就是多一层解析。

2. `isError` 在工具执行失败时是 true，但 HTTP/连接层不会失败。也就是说 AI 参数传错了，你会收到 `isError:true` + 一段错误文本，连接还在，可以接着调下一个工具。

   这是有意设计的：工具级错误不该把整个会话搞断。

#### 4.5 错误处理

JSON-RPC 层面的错误（这些是协议错误，连接可能不好继续）：

| 错误码 | 说明 |
|---|---|
| `-32700` | 收到的不是合法 JSON |
| `-32600` | 请求不是合法的 JSON-RPC 对象 |
| `-32601` | 方法不存在 |
| `-32603` | 服务端内部异常（兜底） |

工具层面的错误（`isError:true`，连接不受影响）：

| 情况 | 错误 |
|---|---|
| 未知工具 | `KeyError: 未知工具:xxx` |
| 条目不存在 | `KeyError: 未找到条目:xxx` |
| 记忆层写错 | `ValueError: 未知记忆层:xxx` |
| 置信度太低 | `ValueError: 置信度 < 60，证据不足，已拒收` |
| 想删根文件夹 | `PermissionError: xxx 是系统自带文件夹，不可删除` |
| 越界路径 | `PermissionError: 越界路径，已拒绝` |

#### 4.6 三条硬性约定

一、服务端的日志全部走 `stderr`，`stdout` 只跑协议消息。你自己写客户端或者改服务端时务必守这条，否则日志会混进 JSON 流里，客户端一解析就炸。这类 bug 特别难查。

二、通知不回包。理由上面说过了。

三、支持批量请求。如果你一次发一个 JSON 数组，服务端会逐个处理，然后把所有回复打包成一个数组返回。如果数组里全是通知，就一个包都不回。

### 五、9 个工具

#### 总表

| 分组 | 工具名 | 干什么 |
|---|---|---|
| 概览 | `memory_overview` | 看三层记忆的总体情况 |
| 短期记忆 | `session_open` | 开会话，也兼作读会话 |
| | `session_update` | 更新会话进度 |
| | `session_close` | 结束会话 |
| 长期/永久 | `memory_add` | 写一条记忆条目 |
| | `memory_query` | 检索记忆 |
| | `memory_delete` | 删一条（纠错） |
| 知识图 | `add_triple` | 写三元组，按置信度分流 |
| | `query_graph` | 在知识图上检索 |

只有 9 个是刻意控制的。工具越多，AI 越容易挑错，而且每个工具的定义都会占用上下文。凡是能被别的工具覆盖的，或者你打开文件夹就能看的，一律没做。

下面每个工具先列参数，再给个调用例子。带 * 的是必填。

#### memory_overview

参数：无

返回三层记忆的条数统计和受保护文件夹状态。

调用：`memory_overview()`

```json
{
  "root": "/media/.../Mindbox-MCP",
  "protected_folders": ["短期记忆","长期记忆","永久记忆"],
  "短期记忆": {"sessions": 3},
  "长期记忆": {"items": 12, "by_category": {"用户偏好": 2, ...}},
  "永久记忆": {"items": 4, "triples": 17}
}
```

适合 AI 在会话开始时快速确认记忆库里有什么。

#### session_open

参数：

| 参数 | 说明 |
|---|---|
| `agent` * | 你的标识，比如 trae / cursor / claude-code |
| `session_id` * | 这次会话的唯一 ID，建议时间戳加随机串 |
| `title` | 任务简述 |
| `summary` | 现状摘要 |

作用：在"短期记忆/`<agent>`/`<session_id>`/"下建文件夹，写一份 `会话.json`，再顺手生成一份给人看的 `上下文.md`。

如果这个会话已经存在，会返回 `resumed: true` 并把旧快照带回来。所以它同时是"新建"和"读取"两个功能——没有单独的读会话工具。

调用：`session_open(agent="trae", session_id="s-20260921-2300", title="修打包丢数据")`

```json
{
  "folder": "短期记忆/trae/s-20260921-2300",
  "agent": "trae", "session_id": "s-20260921-2300",
  "title": "修打包丢数据", "status": "open",
  "resumed": false, "created_at": "...", "updated_at": "...",
  "summary": "", "tasks": [], "todos": [], "conclusions": [], "context": []
}
```

为什么这事重要：它把"当前任务状态"从 AI 的上下文窗口里挪到磁盘上。上下文快满的时候，AI 再 open 一次就把状态读回来了，不用把整段历史一直背着。

#### session_update

参数：

| 参数 | 说明 |
|---|---|
| `agent` * | 同上 |
| `session_id` * | 同上 |
| `summary` | 现状摘要（覆盖） |
| `tasks` | 任务列表，元素形如 `{"text":"...","status":"done"}` |
| `todos` | 待办字符串列表 |
| `conclusions` | 中间结论列表 |
| `context` | 关键上下文列表 |
| `status` | 状态，open / closed |

作用：增量更新。**只覆盖你传进来的字段**，没传的保持原值。所以想只改待办就只传 `todos`，不用担心把别的字段清空。

想随手记一句，追加到 `context` 就行：

调用：`session_update(agent="trae", session_id="s-20260921-2300", context=["[随手记] 用户说不要弹窗打断"])`

每次更新都会重新生成 `上下文.md`。

#### session_close

参数：

| 参数 | 说明 |
|---|---|
| `agent` * | 同上 |
| `session_id` * | 同上 |
| `promote` | 布尔，默认 false |

作用：把会话状态标成 `closed`，冻结快照。

如果 `promote` 传 true，会把 `conclusions` 里的每一条转成一条长期记忆（归到"项目上下文"类，置信度 60）。

调用：`session_close(agent="trae", session_id="s-20260921-2300", promote=True)`

```json
{"closed": true, "folder": "...", "promoted": true}
```

为什么置信度只给 60：会话结论只是"当时的判断"，不一定经得起验证，所以先放长期区，不直接进永久。

#### memory_add

参数：

| 参数 | 说明 |
|---|---|
| `layer` * | "长期记忆" 或 "永久记忆" |
| `category` * | 分类，见下面的表 |
| `content` * | 正文 |
| `confidence` | 置信度 0-100，默认 50 |
| `source` | 来源，比如 "agent:trae" |
| `tags` | 标签数组 |

分类的合法值（左边是机读 key，右边是对应的中文文件夹名）：

| key | 中文文件夹名 | 说明 |
|---|---|---|
| `task` | 任务记录 | 最近 1-4 周完成或失败的任务 |
| `skill` | 技能配方 | 新学但还没反复验证的做法 |
| `digest` | 资料摘要 | 看过的论文/网页/视频要点 |
| `preference` | 用户偏好 | 近期表现出的偏好 |
| `pending_triple` | 待验证三元组 | 置信度 60-84 的三元组会落在这里 |
| `error_case` | 错误案例 | 犯过的错，避免重犯 |
| `emotion` | 情绪历史 | 用户状态波动（这类不会升永久） |
| `ai_effect` | 外部大脑效果 | 哪个 AI 在什么场景更有效 |
| `project` | 项目上下文 | 项目进度、依赖 |

`category` 传中文名或 key 都认。

记错误案例也走这个工具，格式建议统一成 `"[做了什么] —[什么原因]→ [什么后果]"`：

调用：`memory_add(layer="长期记忆", category="error_case", content="[把 vault 放在打包产物下] —[打包会清空该目录]→ [笔记被删]", confidence=90, source="agent:trae")`

```json
{
  "stored": "长期记忆",
  "path": "长期记忆/错误案例/20260921-224223-a1bb.json",
  "item": {"id": "20260921-224223-a1bb", "layer": "长期记忆",
           "category": "error_case", "category_label": "错误案例",
           "content": "...", "confidence": 90,
           "tags": [], "source": "agent:trae", "session": "",
           "created_at": "...", "updated_at": "..."}
}
```

file 名就是 item 的 id，后面 `memory_delete` 要用它。

#### memory_query

参数：

| 参数 | 说明 |
|---|---|
| `keyword` * | 查询词，中英文都行 |
| `layer` | 限定某一层；不传就查长期 + 永久 |
| `top_k` | 返回条数上限，默认 10 |

作用：分词检索。把查询词和库里内容都切一遍，按"命中词数 × 置信度"排序。

调用：`memory_query(keyword="打包 数据目录 笔记丢失", top_k=3)`

```json
{
  "keyword": "打包 数据目录 笔记丢失",
  "tokens": ["打","打包", ...],
  "count": 4,
  "hits": [
    {"layer": "长期记忆", "score": 24.7,
     "id": "...", "category": "error_case", ... },
    ...
  ]
}
```

`hits` 里是**完整条目**（不只是摘要），所以搜到就能直接用，不用再调一次"按 id 取详情"。

#### memory_delete

参数：

| 参数 | 说明 |
|---|---|
| `layer` * | "长期记忆" 或 "永久记忆" |
| `item_id` * | 条目 id |

作用：删掉一条。给 AI 纠正自己写错的东西用。

调用：`memory_delete(layer="长期记忆", item_id="20260921-224223-a1bb")`

```json
{"deleted": "20260921-224223-a1bb", "layer": "长期记忆"}
```

注意它删的只是**条目**。三个记忆根文件夹本身删不掉，工具层会直接拒绝，这是有意的。

#### add_triple

参数：

| 参数 | 说明 |
|---|---|
| `subject` * | 主语 |
| `relation` * | 关系 |
| `object` * | 宾语 |
| `category` | 大类，默认"未分类" |
| `confidence` | 置信度，默认 70 |
| `source` | 来源 |

作用：写一条"主语 —[关系]→ 宾语"的三元组。置信度决定它去哪，这是整套系统里最硬的一条规则：

| 置信度 | 去向 |
|---|---|
| `confidence >= 85` | 写进 永久记忆/triples.json（知识图） |
| `confidence 60-84` | 落成一条长期记忆，归"待验证三元组"类 |
| `confidence < 60` | 直接拒收，报错 |

调用（进永久）：

```python
add_triple(subject="exfat 分区", relation="不支持", object="符号链接",
           category="文件系统", confidence=95)
```

返回：`{"stored": "永久记忆", "triple": {...}, "total": 3}`

调用（进待验证）：

```python
add_triple(subject="新方法X", relation="可能有效于", object="财报分析",
           confidence=65)
```

返回：`{"stored": "长期记忆(待验证三元组)", "item": {...}}`

调用（被拒）：

```python
add_triple(subject="瞎猜", relation="也许", object="没用", confidence=20)
```

返回：`isError=true`，"`ValueError: 置信度 < 60，证据不足，已拒收...`"

注意参数名叫 `object`，虽然它是 Python 的关键字之一，但在 JSON 里这就是个普通字段名，照传就行。

#### query_graph

参数：

| 参数 | 说明 |
|---|---|
| `keyword` * | 查询词 |
| `depth` | 往外扩几圈，默认 1 |
| `limit` | 返回条数上限，默认 30 |

作用：只在永久知识图上检索。先找出命中的三元组，然后以它们的节点为起点，沿关系边往外扩 `depth-1` 圈。默认扩 1 圈，也就是"直接相关 + 相邻一层"。

调用：`query_graph(keyword="exfat 打包", depth=1)`

```json
{"keyword": "exfat 打包", "count": 3, "triples": [{...}, {...}]}
```

这个工具和 `memory_query` 的区别：`memory_query` 是关键词匹配，`query_graph` 是顺着关系找。两个都要用，互补。

#### 置信度门槛，再强调一遍

| 置信度 | 去向 |
|---|---|
| `>= 85` | 进永久知识图 |
| `60-84` | 进长期待验证区 |
| `< 60` | 拒收 |

这条规则是在服务端强制执行的，不是建议。所以如果你在写 AI 的提示词，别让它为了"想记住"就乱报高分。宁可 70 分放待验证区，也别编个 95。

长期记忆转到永久，现在的办法是：确认无误之后，用 `>= 85` 的置信度重新写成一条三元组。目前没有自动晋升。

### 六、数据落在磁盘上长什么样

服务端没有缓存。你直接改文件，下次调用就读到新的。

整体结构：

```text
Mindbox-MCP/
├── 短期记忆/
│   └── <agent>/<session_id>/
│       ├── 会话.json      机读
│       └── 上下文.md      人读镜像（服务生成）
├── 长期记忆/
│   └── <中文分类>/<item_id>.json
└── 永久记忆/
    ├── <item_id>.json
    └── triples.json
```

短期记忆的 `会话.json`：

```json
{
  "agent": "trae",
  "session_id": "s-20260921-2300",
  "title": "修打包丢数据",
  "status": "open",
  "created_at": "2026-09-21 22:30:00",
  "updated_at": "2026-09-21 22:41:12",
  "summary": "把 vault 从 resources 挪到 userData，已改 main.js",
  "tasks": [{"text": "改 vaultDir()", "status": "done"}],
  "todos": ["重打 deb 验证"],
  "conclusions": ["打包态数据必须放 userData 下"],
  "context": ["[2026-09-21 22:35:00] 用户强调不能再丢笔记"]
}
```

长期/永久条目的结构：

```json
{
  "id": "20260921-224218-f350",
  "layer": "长期记忆",
  "category": "preference",
  "category_label": "用户偏好",
  "content": "用户要求中文回答",
  "confidence": 85,
  "tags": [],
  "source": "agent:trae",
  "session": "",
  "created_at": "2026-09-21 22:42:18",
  "updated_at": "2026-09-21 22:42:18"
}
```

id 的格式是 年月日-时分秒-四位随机，文件名就是它。

永久记忆的 `triples.json`：

```json
{"triples": [
  {"subject": "exfat 分区", "relation": "不支持", "object": "符号链接",
   "class": "文件系统", "confidence": 95, "source": "",
   "created_at": "2026-09-21 22:42:18"}
]}
```

读的时候有个坑：`list` 那层会把 `triples.json` 和普通条目文件放在同一个目录下，代码里是靠"有没有 `id` 字段"来区分的。你如果自己写脚本遍历这个目录，记得跳过 `triples.json`。

### 七、自己加一个工具

工具用的是注册表模式，加一个工具只要改两处，不需要动协议层。

第一步，在 `memory_store.py` 里写你的逻辑函数。比如加一个统计：

```python
def count_by_confidence(layer: str) -> dict:
    items = list_items(layer)
    buckets = {"高": 0, "中": 0, "低": 0}
    for it in items:
        c = it.get("confidence", 0)
        buckets["高" if c >= 85 else "中" if c >= 60 else "低"] += 1
    return {"layer": layer, "buckets": buckets}
```

第二步，在 `server.py` 的 `TOOLS` 字典里加一项。格式是：工具名、说明、参数定义、必填参数、处理函数。

```python
"count_by_confidence": _tool(
    "count_by_confidence", "按置信度分档统计条目数",
    {"layer": {"type": "string", "enum": list(LAYERS)}},
    ["layer"], count_by_confidence),
```

第三步，重启服务（客户端重载一下就行）。

就这样。函数名和参数名要对上，因为服务端是把 `arguments` 里的字段直接当关键字参数传进去的：

```python
tool["handler"](**args)
```

所以参数名写错了会直接报 `TypeError`，调试时看到这个错误就往这里想。

写处理函数时有两条建议：

1. 拿不准的情况抛异常就行，服务端会把它转成 `isError` 文本，连接不会断。不需要自己 try/except 包一层。
2. 返回值能 JSON 序列化就行。复杂结构（嵌套字典、列表）都没问题。别返回自定义对象。

另外，如果你要加的是"读文件"之类的工具，注意 `_guard_root()` 这个函数。它负责拦截对三个根文件夹的删除和越界路径访问，涉及路径的地方建议过一遍。

### 八、已知边界

这些是当前版本的实际情况，用之前心里有数：

1. 没有鉴权。因为它是本机 stdio 进程，只有能启动进程的人才能碰它，风险不大。但如果哪天你要把它改成 HTTP 远程服务，必须自己补 Token 鉴权，现在完全没有。
2. 没有并发写锁。正常情况下一个 AI 在用，没影响。如果你挂了多个客户端，而且恰好同一秒往同一条记忆写，理论上可能互相覆盖。要解决得加文件锁。
3. 中文分词是自己写的，切法是"中文单字 + 双字"。好处是零依赖，坏处是召回率不如 jieba，低相关度的结果里会有噪声。够用，但不是最好。
4. 三个根文件夹的"不可删除"是程序级保护，不是文件系统级。如果数据盘是 exfat，连 chmod / chattr 都不起作用，所以手动用文件管理器删是删得掉的（下次启动会重建，内容会丢）。想彻底防住只能靠备份。
5. `protocolVersion` 是回显客户端传进来的值，没有做版本协商校验。也就是说客户端说自己是哪个版本，服务端就认哪个。实际用下来没什么问题，因为用到的方法都很基础。
6. 目前只在 Trae 上做过真机接入测试。Cursor、Claude Code、CodeBuddy 的配置都给了，但没实地跑过，不排除有细节要调。

### 九、版本信息

| 项 | 值 |
|---|---|
| 服务名 | `mindbox-memory` |
| 版本 | 1.0.0 测试版（本目录的独立 MCP 服务） |
| 桌面版 | Mindbox 1.0.4（仓库内 `Mindbox/`，桌面笔记软件） |
| 工具数 | 9 |
| protocolVersion | 2025-06-18 |
| 传输 | stdio，换行分隔的 JSON-RPC 2.0 |
| 依赖 | 无（Python 3 标准库） |
| 记忆根目录 | 就是本项目所在目录 |

开发过程中删掉了 8 个工具（`session_read` / `session_append` / `session_list` / `memory_list` / `memory_get` / `memory_hit` / `memory_promote` / `report_error`），同时清掉了它们对应的死代码和条目里的 `refs` / `success` / `fail` 三个字段。删掉的理由见第一部分的"七、一些实话"一节。

### 十、一句话总结

协议很薄，工具很少，数据很土（就是文件）。薄和少是为了不坏，土是为了你能随时接手。

有 bug 或者想加工具，直接改两个 .py 文件就行，没有构建流程，没有依赖需要升级。

---

## 这个项目从哪来的

这项目的想法来自另一款本地优先的 AI 笔记软件 Mindbox，本来是它内部的三层记忆引擎，后来觉得这东西单独拿出来也有用，就拆成了独立的 MCP 服务。

一句话收尾：

> 短期是便签纸，长期是资料柜，永久是刻在石头上的。
> 你负责用，它负责记。

---

## 许可

MIT
