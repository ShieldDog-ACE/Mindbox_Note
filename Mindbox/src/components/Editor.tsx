/**
 * CodeMirror 6 Markdown 编辑器 —— Obsidian 同款内核。
 * Live Preview:光标所在行显示 Markdown 源码,其余行隐藏 #、加粗、斜体、删除线、行内码等标记符,
 * 任务 [ ] 渲染为可点击复选框;[[双链]]/#标签/==高亮== 内联装饰,双链可点击跳转。
 */
import { EditorState, StateField, Range, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, Decoration, DecorationSet, WidgetType, ViewUpdate, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, HighlightStyle, foldGutter, codeFolding, foldKeymap } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { parseFrontmatter } from "../lib/md";

interface Props {
  value: string;
  path: string; // 变化即整体换文档
  onChange: (v: string) => void;
  onOpenLink: (title: string) => void; // [[双链]]点击
  onSave: () => void; // Ctrl+S
}

const obsidianHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700", color: "var(--accent)" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "700", color: "var(--accent)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600", color: "var(--accent)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--accent)" },
  { tag: t.strong, fontWeight: "700", color: "var(--text)" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--muted)" },
  { tag: t.monospace, background: "var(--bg-2)", color: "#e8b4ff", borderRadius: "3px" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "#7fb0ff" },
  { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
  { tag: [t.list, t.contentSeparator], color: "var(--accent)" },
  { tag: t.processingInstruction, color: "var(--muted)" },
  { tag: t.keyword, color: "#ff9d7a" },
]);

const wikiDeco = Decoration.mark({ class: "cm-wikilink" });

/** frontmatter 解析结果按「文档对象」缓存:CodeMirror 的 Text 只在文档真正变化时才换引用,
 *  于是"只移动光标/改选区"这类更新不再对整篇文档做序列化 + 正则解析
 *  (旧实现在每次按键和每次光标移动时都要 toString 整篇 + parse 两次,大笔记明显卡)。 */
const fmMemo = new WeakMap<EditorState["doc"], ReturnType<typeof parseFrontmatter>>();
function frontmatterOf(state: EditorState) {
  const doc = state.doc;
  let hit = fmMemo.get(doc);
  if (hit === undefined) {
    hit = parseFrontmatter(doc.toString());
    fmMemo.set(doc, hit);
  }
  return hit;
}

/** 活跃编辑器注册表:path → EditorView,供大纲跳转等外部定位使用(每 path 一个实例)。 */
export const editorRegistry = new Map<string, EditorView>();
if (typeof window !== "undefined") (window as any).__editorRegistry = editorRegistry;
const tagDeco = Decoration.mark({ class: "cm-tag" });
const hlDeco = Decoration.mark({ class: "cm-inline-hl" });
const taskDoneDeco = Decoration.mark({ class: "cm-taskdone" });

/** 行内装饰(逐行):[[双链]] #标签 ==高亮== 已完成任务灰化。收集后统一排序,避免乱序 throw。 */
function inlineDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const wiki = /\[\[([^\]\n]+)\]\]/g;
  const tag = /(^|\s)(#[\w\u4e00-\u9fff][\w\u4e00-\u9fff/_-]*)/g;
  const hl = /==[^=\n]+==/g;
  const done = /^\s*[-*+]\s+\[[xX]\]/;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      const s = line.text;
      let m: RegExpExecArray | null;
      wiki.lastIndex = 0;
      while ((m = wiki.exec(s))) ranges.push(wikiDeco.range(line.from + m.index, line.from + m.index + m[0].length));
      tag.lastIndex = 0;
      while ((m = tag.exec(s))) {
        const start = m.index + m[1].length;
        ranges.push(tagDeco.range(line.from + start, line.from + start + m[2].length));
      }
      hl.lastIndex = 0;
      while ((m = hl.exec(s))) ranges.push(hlDeco.range(line.from + m.index, line.from + m.index + m[0].length));
      if (done.test(s)) ranges.push(taskDoneDeco.range(line.from, line.to));
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

class InlineDecoPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = inlineDecorations(view);
  }
  update(u: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (u.docChanged || u.viewportChanged) this.decorations = inlineDecorations(u.view);
  }
}

const inlinePlugin = ViewPlugin.fromClass(InlineDecoPlugin, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(this: any, event: MouseEvent, view: EditorView) {
      const el = (event.target as HTMLElement).closest(".cm-wikilink");
      if (!el) return false;
      // 光标位置反查所在行的 [[target]]
      const pos = view.posAtDOM(el as Node);
      const line = view.state.doc.lineAt(pos);
      const m = /\[\[([^\]\n]+)\]\]/.exec(line.text.slice(Math.max(0, pos - line.from - 120), pos - line.from + 120) || line.text);
      if (!m) return false;
      event.preventDefault();
      const target = m[1].split("|")[0].split("#")[0].trim();
      (view as any)._onOpenLink?.(target);
      return true;
    },
  },
});

/** 任务复选框组件:点击直接改写源码 [ ] <-> [x]。 */
class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
    readonly view: EditorView
  ) {
    super();
  }
  eq(o: TaskWidget) {
    return o.checked === this.checked && o.pos === this.pos;
  }
  ignoreEvent() {
    return false;
  }
  toDOM() {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task-box";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault(); // 不移动光标、不抢焦点
      e.stopPropagation();
    });
    box.addEventListener("click", (e) => {
      e.preventDefault(); // 阻止原生 toggle,由 dispatch 驱动状态
      e.stopPropagation();
      this.view.dispatch({ changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? "[ ]" : "[x]" } });
    });
    return box;
  }
}

/** Live Preview frontmatter 属性面板:光标不在属性区时,隐藏 YAML 源码,渲染 key/value 表;点击进入编辑。 */
class FrontmatterWidget extends WidgetType {
  constructor(
    readonly props: [string, string][],
    readonly end: number // 属性区结束行末位置(点击编辑时选区目标)
  ) {
    super();
  }
  eq(o: FrontmatterWidget) {
    return o.end === this.end && o.props.length === this.props.length && o.props.every(([k, v], i) => this.props[i][0] === k && this.props[i][1] === v);
  }
  ignoreEvent() {
    return false;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-frontmatter";
    const head = document.createElement("div");
    head.className = "fm-head";
    head.textContent = "属性";
    const table = document.createElement("table");
    for (const [k, v] of this.props) {
      const tr = document.createElement("tr");
      const tdK = document.createElement("td");
      tdK.className = "fm-key";
      tdK.textContent = k;
      const tdV = document.createElement("td");
      tdV.className = "fm-val";
      if (!v) {
        tdV.innerHTML = '<span class="fm-empty">—</span>';
      } else {
        // 值内 [[双链]] / #标签 渲染为可点击元素,其余纯文本
        const esc = v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        tdV.innerHTML = esc
          .replace(/\[\[([^\]]+)\]\]/g, (_m, tgt: string) => `<span class="cm-wikilink" data-fm-target="${encodeURIComponent(tgt.split("|")[0].split("#")[0].trim())}">${tgt.split("|").pop()}</span>`)
          .replace(/(^|\s)(#[\w\u4e00-\u9fff][\w\u4e00-\u9fff/_-]*)/g, (_m, pre: string, tag: string) => `${pre}<span class="cm-tag">${tag}</span>`);
      }
      tr.append(tdK, tdV);
      table.append(tr);
    }
    wrap.append(head, table);
    // 双链点击 → 打开笔记;面板其余区域点击 → 进入源码编辑
    // 块装饰经 StateField 提供,构造时无 view,点击时经 DOM 反查
    wrap.addEventListener("click", (e) => {
      // 只认 DOM 反查:多分屏时"取第一个注册的编辑器"会把选区打到另一篇笔记上
      const view = EditorView.findFromDOM(wrap);
      if (!view) return;
      const link = (e.target as HTMLElement).closest(".cm-wikilink[data-fm-target]") as HTMLElement | null;
      if (link) {
        e.stopPropagation();
        (view as any)._onOpenLink?.(decodeURIComponent(link.dataset.fmTarget!));
        return;
      }
      if ((e.target as HTMLElement).closest(".cm-tag")) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      view.dispatch({ selection: { anchor: 0, head: this.end } });
    });
    return wrap;
  }
}

/** frontmatter 块装饰(StateField):CodeMirror 要求块装饰经 state 提供,不可经 ViewPlugin。 */
function frontmatterDeco(state: EditorState): DecorationSet {
  const fm = frontmatterOf(state);
  if (!fm) return Decoration.none;
  const fmEndLine = fm.end < state.doc.length ? fm.end - 1 : fm.end;
  if (state.selection.ranges.some((r) => r.from <= fmEndLine && r.to >= 0)) return Decoration.none;
  return Decoration.set(
    [Decoration.replace({ widget: new FrontmatterWidget(fm.props, fmEndLine), block: true }).range(0, fmEndLine)],
    true
  );
}

const frontmatterField = StateField.define<DecorationSet>({
  create: (state) => frontmatterDeco(state),
  update: (deco, tr) => (tr.docChanged || tr.selection ? frontmatterDeco(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

/** Live Preview 装饰:光标行显示源码;其余行隐藏标题 # 前缀与行内标记符,任务渲染复选框。frontmatter 区整块渲染为属性面板。 */
function liveDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const { state } = view;
  const isActive = (line: { from: number; to: number }) =>
    state.selection.ranges.some((r) => r.from <= line.to && r.to >= line.from);
  const covered: Array<[number, number]> = [];
  const isCovered = (a: number, b: number) => covered.some(([x, y]) => a < y && b > x);
  // frontmatter 区(块装饰见 frontmatterField):面板可见时跳过行装饰,防 replace 区间重叠
  const fm = frontmatterOf(state);
  const fmEndLine = fm ? (fm.end < state.doc.length ? fm.end - 1 : fm.end) : 0;
  const fmPanelVisible = !!fm && !state.selection.ranges.some((r) => r.from <= fmEndLine && r.to >= 0);
  // 依优先级排列:先匹配者占区间,后匹配者与已覆盖区间重叠则跳过
  const patterns: Array<[RegExp, number]> = [
    [/`[^`\n]+`/g, 1], // 行内代码
    [/\*\*\*[^*\n]+\*\*\*/g, 3], // 粗斜体
    [/\*\*[^*\n]+\*\*/g, 2], // 粗体
    [/(?<![\w\\])_[^_\n]+_(?!\w)/g, 1], // 斜体 _
    [/(?<!\*)\*[^*\n]+\*(?!\*)/g, 1], // 斜体 *
    [/~~[^~\n]+~~/g, 2], // 删除线
    [/==[^=\n]+==/g, 2], // 高亮
  ];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      if (fmPanelVisible && line.from < fmEndLine) {
        pos = line.to + 1;
        continue; // frontmatter 区已整块替换,跳过防装饰重叠
      }
      const s = line.text;
      const active = isActive(line);
      const hm = /^(#{1,6})\s+/.exec(s);
      if (hm) ranges.push(Decoration.line({ class: `cm-hline cm-h${hm[1].length}` }).range(line.from));
      else if (/^>\s?/.test(s)) ranges.push(Decoration.line({ class: "cm-quote-line" }).range(line.from));
      const tm = /^(\s*[-*+]\s+)\[([ xX])\]/.exec(s);
      if (tm && !active) {
        const boxFrom = line.from + tm[1].length;
        ranges.push(
          Decoration.replace({ widget: new TaskWidget(tm[2] !== " ", boxFrom, view) }).range(boxFrom, boxFrom + 3)
        );
      }
      if (hm && !active) ranges.push(Decoration.replace({}).range(line.from, line.from + hm[0].length));
      if (!active) {
        for (const [re, n] of patterns) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(s))) {
            const a = line.from + m.index;
            const b = a + m[0].length;
            if (isCovered(a, b)) continue;
            ranges.push(Decoration.replace({}).range(a, a + n));
            ranges.push(Decoration.replace({}).range(b - n, b));
            covered.push([a, b]);
          }
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

class LiveDecoPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = liveDecorations(view);
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = liveDecorations(u.view);
  }
}

const livePlugin = ViewPlugin.fromClass(LiveDecoPlugin, {
  decorations: (v) => v.decorations,
});

export default function Editor({ value, path, onChange, onOpenLink, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const suppressRef = useRef(false); // 程序性整体换文档时跳过 onChange(避免打开笔记就触发落盘)
  const cbRef = useRef({ onChange, onOpenLink, onSave });
  cbRef.current = { onChange, onOpenLink, onSave };

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          // Ctrl+S 立即保存(最高优先级,防被其他键位吃掉)
          Prec.highest(keymap.of([{ key: "Mod-s", run: () => (cbRef.current.onSave(), true) }])),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
          highlightSelectionMatches(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(obsidianHighlight),
          inlinePlugin,
          livePlugin,
          frontmatterField,
          foldGutter({ openText: "⌄", closedText: "›" }),
          codeFolding({ placeholderText: "…" }),
          EditorView.lineWrapping,
          // 图片粘贴 → vault/attachments/,插入 ![[路径]]
          EditorView.domEventHandlers({
            paste(event, view) {
              const img = Array.from(event.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
              if (!img) return false;
              event.preventDefault();
              const reader = new FileReader();
              reader.onload = () => {
                const b64 = String(reader.result).split(",")[1] ?? "";
                api
                  .saveImage(img.name || `pasted ${Date.now()}.png`, b64)
                  .then((r) => view.dispatch(view.state.replaceSelection(`![[${r.path}]]`)))
                  .catch((e) => console.error("image paste failed:", e));
              };
              reader.readAsDataURL(img);
              return true;
            },
          }),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            if (suppressRef.current) {
              suppressRef.current = false;
              return;
            }
            cbRef.current.onChange(u.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "var(--font-size, 14px)", background: "var(--bg)" },
            ".cm-scroller": {
              fontFamily: "var(--editor-font, 'JetBrains Mono','Noto Sans Mono CJK SC',Consolas,monospace)",
              lineHeight: "var(--editor-lineheight, 1.7)",
              padding: "20px 28px 40vh",
            },
            ".cm-content": { caretColor: "var(--accent)" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground, ::selection": { background: "rgba(168,130,255,0.25)" },
            ".cm-wikilink": { color: "var(--accent)", cursor: "pointer", textDecoration: "underline dotted" },
            ".cm-tag": { color: "#7fd3a8", cursor: "pointer" },
            ".cm-inline-hl": { background: "rgba(255,214,110,0.25)", borderRadius: "2px" },
            ".cm-taskdone": { color: "var(--muted)", textDecoration: "line-through" },
            ".cm-panels": { background: "var(--bg-2)", color: "var(--text)" },
            ".cm-searchMatch": { background: "rgba(255,214,110,0.3)" },
          }),
        ],
      }),
    });
    (view as any)._onOpenLink = (t2: string) => cbRef.current.onOpenLink(t2);
    (window as any).__cmView = view; // 调试/自动化测试入口
    editorRegistry.set(path, view);
    viewRef.current = view;
    return () => {
      if (editorRegistry.get(path) === view) editorRegistry.delete(path);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切笔记/内容异步到达:整体替换文档(打字时 doc 与 value 一致,守卫会跳过)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const v = value ?? "";
    if (view.state.doc.toString() !== v) {
      suppressRef.current = true;
      // 打开笔记时光标置于 frontmatter 之后,保证属性面板默认可见
      const fm = parseFrontmatter(v);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: v },
        selection: { anchor: fm ? fm.end : 0 },
        scrollIntoView: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, value]);

  return <div ref={hostRef} className="cm-editor-host" />;
}
