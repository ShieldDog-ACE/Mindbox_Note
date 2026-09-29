/**
 * Mindbox markdown 渲染引擎 —— 阅读视图与悬停预览共用。
 * 覆盖 Obsidian 语法:[[双链]]、![[嵌入]]、#标签、==高亮==、> [!callout]、任务列表、表格(GFM)。
 */
import { marked } from "marked";
import { api } from "./api";

marked.setOptions({ gfm: true, breaks: false });

const WIKI = /\[\[([^\]]+)\]\]/g;
const EMBED = /!\[\[([^\]]+)\]\]/g;
const TAG = /(^|\s)#([\w\u4e00-\u9fff][\w\u4e00-\u9fff/_-]*)/g;
const HL = /==([^=\n]+)==/g;
const MATH_BLOCK = /\$\$([\s\S]+?)\$\$/g;
const MATH_INLINE = /(^|[^\w\\$])\$([^$\n]+?)\$(?![\w$])/g;
const IMAGE_RE = /\.(png|jpe?g|jfif|gif|webp|svg|bmp|avif|ico)$/i;
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus|weba)$/i;
const VIDEO_RE = /\.(mp4|webm|mkv|mov|m4v|ogv|3gp)$/i;

/** 跳过 ``` 代码围栏,对纯文本段落做语法替换。 */
function outsideCode(src: string, fn: (s: string) => string): string {
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts.map((p, i) => (i % 2 === 1 ? p : fn(p))).join("");
}

export interface EmbedRef {
  target: string;
}

/** 提取 ![[嵌入]] 引用(笔记名,不含扩展名)。 */
export function extractEmbeds(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(EMBED)) {
    const t = m[1].split("|")[0].split("#")[0].trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface FrontmatterData {
  props: [string, string][]; // key → 展示值(列表以 ", " 连接)
  end: number; // frontmatter 区块结束位置(含结尾换行),即正文起点
}

/** 剥离 YAML 值两侧包裹的引号(Obsidian 同款展示)。 */
const stripQuotes = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) ? t.slice(1, -1) : t;
};

/** 解析文档开头的 YAML frontmatter(--- 包裹)。支持 key: value / key: 列表 / 空值 / 空块。 */
export function parseFrontmatter(src: string): FrontmatterData | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---(?:\r?\n|$)/.exec(src);
  if (!m || m.index !== 0) return null;
  const props: [string, string][] = [];
  const lists = new Map<string, string[]>();
  let curKey = "";
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([^:#\n][^:\n]*):(?:[ \t]+(.*))?$/.exec(line);
    const li = /^\s+-\s+(.*)$/.exec(line);
    if (kv) {
      curKey = kv[1].trim();
      if (kv[2] !== undefined && kv[2].trim() !== "") props.push([curKey, stripQuotes(kv[2])]);
      else {
        // 空值/列表头:先占位保序,列表项随后回填
        lists.set(curKey, []);
        props.push([curKey, ""]);
      }
    } else if (li && curKey && lists.has(curKey)) {
      lists.get(curKey)!.push(stripQuotes(li[1]));
    }
  }
  for (const [k, arr] of lists) {
    const i = props.findIndex(([pk]) => pk === k);
    if (i >= 0) props[i][1] = arr.join(", ");
  }
  return { props, end: m[0].length };
}

/** frontmatter → 属性表格 HTML(阅读视图)。值内 [[双链]]/#标签 保持可点。 */
export function renderFrontmatter(fm: FrontmatterData): string {
  if (!fm.props.length) return "";
  const rows = fm.props.map(([k, v]) => {
    const val = escHtml(v)
      .replace(WIKI, (_m, t: string) => {
        const [raw, alias] = t.split("|");
        const label = alias ?? raw;
        return `<a class="wikilink" data-target="${encodeURIComponent(raw.trim())}">${label}</a>`;
      })
      .replace(TAG, (m2, pre: string, tag: string) => `${pre}<a class="tag" data-tag="${tag}">#${tag}</a>`);
    return `<tr><td class="fm-key">${escHtml(k)}</td><td class="fm-val">${val || '<span class="fm-empty">—</span>'}</td></tr>`;
  });
  return `<div class="frontmatter"><div class="fm-head">属性</div><table>${rows.join("")}</table></div>`;
}

/** 同步渲染(不含嵌入内容,嵌入渲染为占位 div)。 */
export function renderMarkdown(src: string): string {
  // 0) frontmatter → 属性表格,正文继续管线
  const fm = parseFrontmatter(src);
  if (fm) src = renderFrontmatter(fm) + "\n" + src.slice(fm.end);
  // 1) 嵌入先摘出来,避免 [[ 链接正则吃掉
  let withEmbeds = outsideCode(src, (s) =>
    s.replace(EMBED, (_m, t: string) => {
      const target = t.split("|")[0].split("#")[0].trim();
      return `\u0000EMBED\u0000${target}\u0000`;
    })
  );
  // 2) 数学公式($$块 / $行内)→ 占位,解析后用 KaTeX 还原
  withEmbeds = outsideCode(withEmbeds, (s) =>
    s.replace(MATH_BLOCK, (_m, tex: string) => `\u0000MATHB\u0000${encodeURIComponent(tex)}\u0000`)
      .replace(MATH_INLINE, (_m, pre: string, tex: string) => `${pre}\u0000MATHI\u0000${encodeURIComponent(tex)}\u0000`)
  );
  // 3) 双链 [[target|alias]] 或 [[target#heading]]
  withEmbeds = outsideCode(withEmbeds, (s) =>
    s.replace(WIKI, (_m, t: string) => {
      const [raw, alias] = t.split("|");
      const [title, anchor] = raw.split("#");
      // 链接文字必须转义:这段 HTML 是在 marked 之前手工拼进源码的,
      // 不转义的话 [[<img src=x onerror=...>]] 会在阅读视图里被当标签执行。
      const label = escHtml(alias ?? (anchor ? `${title} > ${anchor}` : title));
      const data = encodeURIComponent(raw);
      return `<a class="wikilink" data-target="${data}">${label}</a>`;
    })
  );
  // 4) 标签与高亮
  withEmbeds = outsideCode(withEmbeds, (s) =>
    s
      .replace(TAG, (m, pre: string, tag: string) => `${pre}<a class="tag" data-tag="${tag}">#${tag}</a>`)
      .replace(HL, (_m, t: string) => `<mark>${t}</mark>`)
  );
  let html = marked.parse(withEmbeds) as string;
  // 0.5) 标准 markdown 图片/媒体 ![](路径):相对路径改走后端媒体接口;按扩展名出 img/video/audio
  html = html.replace(/(<img[^>]*?\bsrc=")([^"]+)(")/g, (m, a: string, src: string, b: string) => {
    if (/^(?:https?:|data:|blob:|\/|file:)/i.test(src)) return m;
    let decoded = src;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      /* 原样使用 */
    }
    const url = api.mediaUrl(decoded);
    if (VIDEO_RE.test(decoded)) return `<video controls preload="metadata" src="${url}"></video>`;
    if (AUDIO_RE.test(decoded)) return `<audio controls preload="none" src="${url}"></audio>`;
    return `${a}${url}${b}`;
  });
  // 5) Callout:blockquote 首行 [!type] (+/-) 标题(marked 可能把标题与正文合在一个 <p> 里,需按行拆分)
  html = html.replace(
    /<blockquote>\s*(?:<\/?p>)?\[!(\w+)\]([+-])?\s*([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>/g,
    (_m, type: string, fold: string, para: string, rest: string) => {
      const lines = para.split("\n");
      const title = lines[0].trim() || type.charAt(0).toUpperCase() + type.slice(1);
      const paraRest = lines.slice(1).join("\n").trim();
      const body =
        (paraRest ? `<p>${paraRest.replace(/\n/g, "<br>")}</p>` : "") + rest;
      const icon: Record<string, string> = {
        note: "✎", abstract: "≡", info: "i", todo: "☑", tip: "🔥", success: "✓",
        question: "?", warning: "⚠", failure: "✗", danger: "⚡", bug: "🐞", example: "⋮", quote: "❝",
      };
      return `<div class="callout callout-${type.toLowerCase()}${fold === "-" ? " folded" : ""}">
        <div class="callout-title"><span class="callout-ico">${icon[type.toLowerCase()] ?? "✎"}</span>${title}</div>
        <div class="callout-body">${body}</div></div>`;
    }
  );
  // 5) 任务框可点击(marked 默认 disabled)
  html = html.replace(/<input([^>]*type="checkbox"[^>]*)>/g, (_m, attrs: string) => {
    const checked = /checked/.test(attrs);
    return `<input type="checkbox" class="task-check" ${checked ? "checked" : ""}>`;
  });
  // 7) 数学占位 → 占位容器(fillMath 异步渲染,katex 按需加载)
  html = html.replace(/\u0000MATHB\u0000(.*?)\u0000/g, (_m, enc: string) => `<div class="math-block math-pending" data-display="1" data-math="${enc}"></div>`);
  html = html.replace(/\u0000MATHI\u0000(.*?)\u0000/g, (_m, enc: string) => `<span class="math-inline math-pending" data-display="0" data-math="${enc}"></span>`);
  // 8) mermaid 围栏 → 占位容器(fillMermaids 异步渲染)
  html = html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_m, code: string) => `<div class="mermaid-box" data-mermaid="${encodeURIComponent(code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'))}"><div class="embed-loading">mermaid 渲染中…</div></div>`
  );
  // 9) 嵌入占位 → 容器 div(内容由调用方异步填充)
  html = html.replace(
    /\u0000EMBED\u0000(.*?)\u0000/g,
    (_m, target: string) => `<div class="embed" data-embed="${encodeURIComponent(target)}"><div class="embed-loading">加载 ${target} …</div></div>`
  );
  // 10) 标题锚点(大纲跳转)
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m, lvl: string, inner: string) => {
    const id = inner.replace(/<[^>]+>/g, "").trim().replace(/\s+/g, "-");
    return `<h${lvl} id="h-${encodeURIComponent(id)}">${inner}</h${lvl}>`;
  });
  return html;
}

/** 嵌入内容异步填充:图片出 <img>;音视频出 <audio>/<video>;笔记渲染其内容(深度 1,防循环)。 */
export async function fillEmbeds(html: string, depth = 0): Promise<string> {
  const placeholders = Array.from(html.matchAll(/data-embed="([^"]+)"/g)).map((m) => decodeURIComponent(m[1]));
  if (!placeholders.length || depth > 1) return html;
  const parts = await Promise.all(
    placeholders.map(async (t) => {
      const label = escHtml(t); // 嵌入目标来自笔记正文,写进 HTML 前必须转义
      if (IMAGE_RE.test(t)) {
        return `<div class="embed embed-img" data-embed="${encodeURIComponent(t)}"><img src="${api.mediaUrl(t)}" alt="${label}" loading="lazy"></div>`;
      }
      if (AUDIO_RE.test(t)) {
        return `<div class="embed embed-audio" data-embed="${encodeURIComponent(t)}"><div class="embed-title">${label}</div><audio controls preload="none" src="${api.mediaUrl(t)}"></audio></div>`;
      }
      if (VIDEO_RE.test(t)) {
        return `<div class="embed embed-video" data-embed="${encodeURIComponent(t)}"><video controls preload="metadata" src="${api.mediaUrl(t)}"></video></div>`;
      }
      try {
        const r = await api.resolve(t);
        if (!r.path) return `<div class="embed embed-missing" data-embed="${encodeURIComponent(t)}">未找到笔记: ${label}</div>`;
        const note = await api.readNote(r.path);
        let inner = renderMarkdown(note.content);
        inner = await fillEmbeds(inner, depth + 1);
        // 嵌入内容只读:任务复选框禁用,避免点击时错误翻转外层笔记的任务
        inner = inner.replace(/class="task-check"/g, 'class="task-check" disabled');
        return `<div class="embed" data-embed="${encodeURIComponent(t)}"><div class="embed-title">${label}</div>${inner}</div>`;
      } catch {
        return `<div class="embed embed-missing" data-embed="${encodeURIComponent(t)}">未找到笔记: ${label}</div>`;
      }
    })
  );
  // 按占位顺序替换(含图片/音视频分支,统一按占位序号换)
  let i = 0;
  return html.replace(
    /<div class="embed[^"]*" data-embed="[^"]+">(<div class="embed-loading">[\s\S]*?<\/div>|<img[^>]*>|<div class="embed-title">[\s\S]*?<\/div><audio[^>]*><\/audio>|<video[^>]*><\/video>)<\/div>/g,
    () => parts[i++]
  );
}

/** KaTeX 公式异步渲染(动态加载 katex + 字体 CSS,均不进首包)。 */
export async function fillMath(container: HTMLElement): Promise<void> {
  const nodes = Array.from(container.querySelectorAll(".math-pending[data-math]")) as HTMLElement[];
  if (!nodes.length) return;
  try {
    const [mod] = await Promise.all([import("katex"), import("katex/dist/katex.min.css")]);
    const katex = mod.default;
    for (const el of nodes) {
      try {
        el.innerHTML = katex.renderToString(decodeURIComponent(el.dataset.math!), {
          displayMode: el.dataset.display === "1",
          throwOnError: false,
          output: "html",
        });
      } catch {
        el.innerHTML = `<code class="math-err">${el.dataset.math}</code>`;
      }
      el.classList.remove("math-pending");
    }
  } catch (e) {
    console.warn("katex load failed:", e);
  }
}

/** mermaid 图表异步渲染(动态加载,减小首包)。 */
export async function fillMermaids(container: HTMLElement): Promise<void> {
  const boxes = Array.from(container.querySelectorAll(".mermaid-box[data-mermaid]")) as HTMLElement[];
  if (!boxes.length) return;
  try {
    const mod = await import("mermaid");
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, theme: document.documentElement.dataset.theme === "light" ? "default" : "dark", securityLevel: "strict" });
    for (const box of boxes) {
      const code = decodeURIComponent(box.dataset.mermaid!);
      const id = `mmd-${Math.random().toString(36).slice(2, 9)}`;
      try {
        const { svg } = await mermaid.render(id, code);
        box.innerHTML = svg;
      } catch (e) {
        box.innerHTML = `<div class="embed-missing">mermaid 语法错误</div>`;
        console.warn("mermaid render failed:", e);
      }
    }
  } catch (e) {
    console.warn("mermaid load failed:", e);
  }
}

/** 点击任务框:翻转源文中第 index 个 - [ ] / - [x]。 */
export function toggleTask(src: string, index: number): string {
  let i = 0;
  return src.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/gm, (m, pre: string, mark: string, post: string) => {
    if (i++ !== index) return m;
    return `${pre}${mark === " " ? "x" : " "}${post}`;
  });
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** 大纲:标题列表(带行号,编辑器定位用)。 */
export function extractHeadings(src: string): Heading[] {
  const out: Heading[] = [];
  let inCode = false;
  const fmEnd = parseFrontmatter(src)?.end ?? 0;
  let pos = 0;
  src.split("\n").forEach((line, i) => {
    const lineStart = pos;
    pos += line.length + 1;
    if (/^```/.test(line.trim())) inCode = !inCode;
    if (inCode) return;
    if (lineStart < fmEnd) return; // frontmatter 区间内的行不参与大纲
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/#+\s*$/, "").trim(), line: i });
  });
  return out;
}

/** 当前笔记里的行内标签(去重)。 */
export function extractTags(src: string): string[] {
  const text = src.replace(/```[\s\S]*?```/g, "");
  return [...new Set([...text.matchAll(TAG)].map((m) => m[2]))];
}

/** 字数统计(中文按字,英文按词)。 */
export function wordCount(src: string): { words: number; chars: number } {
  const text = src.replace(/```[\s\S]*?```/g, "").replace(/[#>*`~\[\]()!|-]/g, " ");
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const en = (text.match(/[a-zA-Z0-9]+/g) ?? []).length;
  return { words: cjk + en, chars: src.length };
}
