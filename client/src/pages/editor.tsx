import { useState, useRef, useCallback, useEffect } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { vim, getCM, Vim } from "@replit/codemirror-vim";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Sun,
  Moon,
  FileDown,
  Printer,
  Keyboard,
  PanelLeftOpen,
  Pencil,
  FileText,
  FolderOpen,
  FilePlus,
  Save,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Link,
  List,
  ListOrdered,
  Quote,
  Minus,
  Table,
  Heading1,
  Heading2,
  Heading3,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

type ViewMode = "edit" | "preview" | "split";

// ─── Electron bridge ──────────────────────────────────────────────────────────
// When running in Electron, window.electronAPI is injected by the preload script.
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      contentChanged: (content: string, isDirty: boolean) => void;
      setFilePath: (filePath: string | null) => void;
      setDirty: (isDirty: boolean) => void;
      syncVimState: (enabled: boolean) => void;
      syncDarkState: (dark: boolean) => void;
      onNewFile: (cb: (data?: { mode?: ViewMode }) => void) => void;
      onOpenFile: (cb: (data: { content: string; filePath: string | null; fileName: string; isDirty?: boolean; mode?: ViewMode }) => void) => void;
      onFileSaved: (cb: (data: { filePath: string }) => void) => void;
      onFileLocationChanged: (cb: (data: { filePath: string; fileName: string }) => void) => void;
      onFind: (cb: () => void) => void;
      onTogglePreview: (cb: () => void) => void;
      onSetViewMode: (cb: (data: { mode: ViewMode }) => void) => void;
      onToggleVim: (cb: (data: { enabled: boolean }) => void) => void;
      onToggleDark: (cb: (data: { dark: boolean }) => void) => void;
      onPrint: (cb: () => void) => void;
      onExportPdf: (cb: () => void) => void;
      onToggleEditor: (cb: () => void) => void;
      getInitMode: () => string;
      removeAllListeners: (channel: string) => void;
      openFileDialog: () => void;
      newFileAction: () => void;
      saveFileAction: () => void;
      revealInFinder: () => void;
      renameFile: (newName: string) => Promise<{ filePath: string; fileName: string } | null>;
      moveFile: () => Promise<{ filePath: string; fileName: string } | null>;
      saveFile: () => Promise<boolean>;
      saveAndCloseFile: () => Promise<boolean>;
      closeWindow: (force?: boolean) => Promise<boolean>;
    };
    __getEditorContent?: () => string;
  }
}

const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;
const hasFSA = !isElectron && typeof window !== "undefined" && "showOpenFilePicker" in window;
const webModKey = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘" : "Ctrl";

const SAMPLE_MD = `# Vim Markdown Editor

A split-pane markdown editor with **Vim keybindings** support.

## Features

- Toggle Vim mode on/off with the toolbar switch
- Live preview updates as you type
- Export to PDF or print the rendered output
- Dark and light themes
- Resizable split panes

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| \`i\` | Enter insert mode (Vim) |
| \`Esc\` | Return to normal mode (Vim) |
| \`Cmd+S\` | Save file |
| \`dd\` | Delete line |
| \`yy\` | Yank (copy) line |
| \`p\` | Paste |
| \`/\` | Search |

## Code Example

\`\`\`python
def hello():
    print("Hello from the Vim editor!")
    return True
\`\`\`

## Blockquote

> The best way to predict the future is to invent it.
> — Alan Kay

---

### Task List

- [x] Build the editor
- [x] Add Vim keybindings
- [x] Split-pane preview
- [x] macOS desktop app
- [ ] World domination
`;

marked.setOptions({ breaks: true, gfm: true });

function getInitialDoc(): string {
  if (isElectron || typeof window === "undefined") return SAMPLE_MD;
  return localStorage.getItem("vimdown-content") ?? SAMPLE_MD;
}

function normalizeViewMode(mode: string | undefined): ViewMode {
  return mode === "edit" || mode === "preview" || mode === "split" ? mode : "split";
}

const vimCompartment = new Compartment();
const themeCompartment = new Compartment();

type WebkitAppRegionStyle = React.CSSProperties & {
  WebkitAppRegion?: "drag" | "no-drag";
};

function createLightTheme() {
  return EditorView.theme({
    "&": { backgroundColor: "hsl(210 20% 98%)", color: "hsl(220 20% 12%)" },
    ".cm-content": { caretColor: "hsl(152 56% 38%)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "hsl(220 8% 46%)" },
    ".cm-activeLineGutter": { backgroundColor: "hsl(210 14% 93% / 0.4)" },
    ".cm-activeLine": { backgroundColor: "hsl(210 14% 93% / 0.4)" },
  });
}

function createDarkTheme() {
  return EditorView.theme({
    "&": { backgroundColor: "hsl(220 16% 8%)", color: "hsl(210 15% 88%)" },
    ".cm-content": { caretColor: "hsl(152 48% 48%)" },
    ".cm-gutters": { backgroundColor: "transparent", color: "hsl(220 8% 55%)" },
    ".cm-activeLineGutter": { backgroundColor: "hsl(220 10% 20% / 0.4)" },
    ".cm-activeLine": { backgroundColor: "hsl(220 10% 20% / 0.4)" },
  });
}

export default function EditorPage() {
  const [darkMode, setDarkMode] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const [vimEnabled, setVimEnabled] = useState(true);
  const [content, setContent] = useState(getInitialDoc);
  const initMode = normalizeViewMode(isElectron ? window.electronAPI?.getInitMode?.() : "split");
  const [showPreview, setShowPreview] = useState(initMode !== "edit");
  const [showEditor, setShowEditor] = useState(initMode !== "preview");
  const [vimMode, setVimMode] = useState("NORMAL");
  const [lineInfo, setLineInfo] = useState({ line: 1, col: 1 });
  const [wordCount, setWordCount] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isDocumentMenuOpen, setIsDocumentMenuOpen] = useState(false);
  const [draftFileName, setDraftFileName] = useState("Untitled.md");

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentNameRef = useRef<HTMLInputElement>(null);
  const documentMenuContentRef = useRef<HTMLDivElement>(null);
  const skipDocumentNameBlurRef = useRef(false);
  const fileHandleRef = useRef<FileSystemFileHandle | null>(null);
  const isDragging = useRef(false);
  const [splitPercent, setSplitPercent] = useState(50);
  const saveDocumentRef = useRef<() => Promise<boolean>>(async () => false);
  const closeDocumentRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false);
  const openDocumentRef = useRef<() => void>(() => {});
  const newDocumentRef = useRef<() => void>(() => {});

  // Track whether content has been edited since last save
  const isDirtyRef = useRef(false);
  const initialContentRef = useRef(getInitialDoc());

  // ─── Dark mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    window.electronAPI?.syncDarkState(darkMode);
  }, [darkMode]);

  // ─── Word count ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setWordCount(content.trim().split(/\s+/).filter(Boolean).length);
  }, [content]);

  // ─── Invariant: at least one pane must be visible ──────────────────────────
  useEffect(() => {
    if (!showEditor && !showPreview) setShowPreview(true);
  }, [showEditor, showPreview]);

  const applyViewMode = useCallback((mode: ViewMode) => {
    if (mode === "edit") {
      setShowEditor(true);
      setShowPreview(false);
      return;
    }
    if (mode === "preview") {
      setShowEditor(false);
      setShowPreview(true);
      return;
    }
    setShowEditor(true);
    setShowPreview(true);
  }, []);

  const currentViewMode: ViewMode = showEditor && showPreview
    ? "split"
    : showEditor
      ? "edit"
      : "preview";

  // ─── Expose editor content to Electron main process ─────────────────────────
  useEffect(() => {
    window.__getEditorContent = () => viewRef.current?.state.doc.toString() ?? "";
    return () => { delete window.__getEditorContent; };
  }, []);

  // ─── Initialize CodeMirror ──────────────────────────────────────────────────
  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const doc = update.state.doc.toString();
        setContent(doc);
        const dirty = doc !== initialContentRef.current;
        if (dirty !== isDirtyRef.current) {
          isDirtyRef.current = dirty;
          setIsDirty(dirty);
          window.electronAPI?.setDirty(dirty);
        }
      }
      const cursor = update.state.selection.main.head;
      const line = update.state.doc.lineAt(cursor);
      setLineInfo({ line: line.number, col: cursor - line.from + 1 });
    });

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        vimCompartment.of(vim()),
        themeCompartment.of(darkMode ? createDarkTheme() : createLightTheme()),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        bracketMatching(),
        highlightSelectionMatches(),
        history(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        updateListener,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    const modeInterval = setInterval(() => {
      const cm = getCM(view);
      if (cm) {
        const s = (cm as any).state;
        if (s?.vim) {
          const v = s.vim;
          let mode = "NORMAL";
          if (v.insertMode) mode = "INSERT";
          else if (v.visualMode) {
            mode = "VISUAL";
            if (v.visualLine) mode = "VISUAL LINE";
            if (v.visualBlock) mode = "VISUAL BLOCK";
          } else if (v.mode === "replace") mode = "REPLACE";
          setVimMode(mode);
        }
      }
    }, 100);

    return () => { clearInterval(modeInterval); view.destroy(); };
  }, []);

  // ─── Vim toggle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: vimCompartment.reconfigure(vimEnabled ? vim() : []),
    });
    setVimMode(vimEnabled ? "NORMAL" : "");
    window.electronAPI?.syncVimState(vimEnabled);
  }, [vimEnabled]);

  // ─── Dark/light theme ───────────────────────────────────────────────────────
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure(darkMode ? createDarkTheme() : createLightTheme()),
    });
  }, [darkMode]);

  // ─── Helper: load content into editor ───────────────────────────────────────
  const loadContent = useCallback((
    text: string,
    name: string | null,
    nextFilePath?: string | null,
    options: { isDirty?: boolean; mode?: ViewMode } = {},
  ) => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: text },
      });
    }
    const dirty = options.isDirty ?? false;
    setContent(text);
    setFileName(name);
    setFilePath(nextFilePath ?? null);
    setDraftFileName(name ?? "Untitled.md");
    initialContentRef.current = dirty ? "" : text;
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
    fileHandleRef.current = null;
    window.electronAPI?.setDirty(dirty);
    if (nextFilePath) window.electronAPI?.setFilePath(nextFilePath);
    else window.electronAPI?.setFilePath(null);
    if (options.mode) applyViewMode(options.mode);
  }, [applyViewMode]);

  // ─── Electron IPC listeners ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI!;

    api.onNewFile((data) => {
      loadContent("", null, null, { mode: data?.mode ?? "split" });
    });

    api.onOpenFile(({ content: text, fileName: name, filePath, isDirty, mode }) => {
      loadContent(text, name, filePath, { isDirty, mode });
    });

    api.onFileSaved(({ filePath }) => {
      const name = filePath.split("/").pop() ?? filePath;
      setFileName(name);
      setFilePath(filePath);
      setDraftFileName(name);
      initialContentRef.current = viewRef.current?.state.doc.toString() ?? "";
      isDirtyRef.current = false;
      setIsDirty(false);
    });

    api.onFileLocationChanged(({ filePath, fileName }) => {
      setFileName(fileName);
      setFilePath(filePath);
      setDraftFileName(fileName);
    });

    api.onFind(() => {
      if (viewRef.current) openSearchPanel(viewRef.current);
    });

    api.onTogglePreview(() => setShowPreview((p) => !p));
    api.onToggleEditor(() => setShowEditor((e) => !e));
    api.onSetViewMode(({ mode }) => applyViewMode(mode));
    api.onToggleVim(({ enabled }) => setVimEnabled(enabled));
    api.onToggleDark(({ dark }) => setDarkMode(dark));
    api.onPrint(() => handlePrint());
    api.onExportPdf(() => handleExportPDF());

    return () => {
      ["menu-new-file", "menu-open-file", "file-saved", "file-location-changed", "menu-find",
       "menu-toggle-preview", "menu-toggle-editor", "menu-set-view-mode", "menu-toggle-vim",
       "menu-toggle-dark", "menu-print", "menu-export-pdf"].forEach((ch) => api.removeAllListeners(ch));
    };
  }, [applyViewMode, loadContent]);

  // ─── Print ──────────────────────────────────────────────────────────────────
  const printStyles = `
    body { font-family: -apple-system, 'Inter', BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a; font-size: 14px; line-height: 1.7; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 8px; }
    h2 { font-size: 20px; font-weight: 600; margin: 20px 0 8px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
    h3 { font-size: 16px; font-weight: 600; margin: 16px 0 6px; }
    p { margin: 0 0 10px; }
    ul, ol { margin: 0 0 10px; padding-left: 24px; }
    li { margin: 2px 0; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.88em; background: #f3f3f3; padding: 1px 4px; border-radius: 3px; }
    pre { background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; overflow-x: auto; margin: 0 0 12px; }
    pre code { background: transparent; padding: 0; font-size: 0.85em; }
    blockquote { margin: 0 0 12px; padding: 8px 16px; border-left: 3px solid #333; background: #f9f9f9; color: #555; }
    table { border-collapse: collapse; width: 100%; margin: 0 0 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 12px; text-align: left; }
    th { font-weight: 600; background: #f5f5f5; }
    hr { margin: 20px 0; border: none; border-top: 1px solid #e0e0e0; }
    a { color: #2563eb; }
    img { max-width: 100%; }
  `;

  const getRenderedHTML = useCallback(
    () => DOMPurify.sanitize(marked.parse(content, { async: false }) as string),
    [content]
  );

  const handlePrint = useCallback(() => {
    const html = getRenderedHTML();
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Print</title><style>${printStyles}</style></head><body>${html}</body></html>`);
    w.document.close();
    w.onload = () => w.print();
  }, [getRenderedHTML]);

  const handleExportPDF = useCallback(() => {
    const html = getRenderedHTML();
    const w = window.open("", "_blank");
    if (!w) return;
    const hint = `<div style="text-align:center;padding:16px;background:#fffbe6;border:1px solid #f0d860;border-radius:8px;margin-bottom:20px;font-size:13px;color:#665a00;">Use <strong>Save as PDF</strong> in the print dialog (Cmd+P) to export.</div>`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Export PDF</title><style>@page{margin:1in 0.75in;size:letter;}${printStyles}</style></head><body>${hint}${html}</body></html>`);
    w.document.close();
    w.onload = () => w.print();
  }, [getRenderedHTML]);

  // ─── Browser file ops (non-Electron) ────────────────────────────────────────
  const downloadFile = useCallback((text: string, name: string) => {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const confirmReplaceDocument = useCallback((message: string) => {
    return !isDirtyRef.current || window.confirm(message);
  }, []);

  const handleOpenFile = useCallback(async () => {
    if (isElectron) {
      window.electronAPI?.openFileDialog?.();
      return;
    }
    if (!confirmReplaceDocument("Discard unsaved changes and open another file?")) return;
    if (hasFSA) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: "Markdown", accept: { "text/markdown": [".md", ".markdown", ".txt"] } }],
          multiple: false,
        });
        fileHandleRef.current = handle;
        const file = await handle.getFile();
        loadContent(await file.text(), file.name, null, { mode: "preview" });
      } catch { /* cancelled */ }
    } else {
      fileInputRef.current?.click();
    }
  }, [confirmReplaceDocument, loadContent]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    fileHandleRef.current = null;
    const reader = new FileReader();
    reader.onload = (evt) => loadContent(evt.target?.result as string, file.name, null, { mode: "preview" });
    reader.readAsText(file);
    e.target.value = "";
  }, [loadContent]);

  const handleNewFile = useCallback(() => {
    if (isElectron) {
      window.electronAPI?.newFileAction?.();
      return;
    }
    if (!confirmReplaceDocument("Discard unsaved changes and create a new file?")) return;
    fileHandleRef.current = null;
    loadContent("", null, null, { mode: "split" });
  }, [confirmReplaceDocument, loadContent]);

  const handleSaveFile = useCallback(async (): Promise<boolean> => {
    if (isElectron) {
      return await window.electronAPI?.saveFile?.() ?? false;
    }
    const text = viewRef.current?.state.doc.toString() ?? content;
    if (hasFSA) {
      try {
        let handle = fileHandleRef.current;
        if (!handle) {
          handle = await (window as any).showSaveFilePicker({
            suggestedName: fileName ?? "untitled.md",
            types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }],
          });
          fileHandleRef.current = handle;
          setFileName((handle as FileSystemFileHandle).name);
          setDraftFileName((handle as FileSystemFileHandle).name);
        }
        const writable = await (handle as any).createWritable();
        await writable.write(text);
        await writable.close();
        initialContentRef.current = text;
        isDirtyRef.current = false;
        setIsDirty(false);
        window.electronAPI?.setDirty(false);
        return true;
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "AbortError") {
          downloadFile(text, fileName ?? "untitled.md");
          return true;
        }
        return false;
      }
    } else {
      downloadFile(text, fileName ?? "untitled.md");
      return true;
    }
  }, [content, fileName, downloadFile]);

  const handleCloseDocument = useCallback(async (force = false): Promise<boolean> => {
    if (isElectron) {
      return await window.electronAPI?.closeWindow?.(force) ?? false;
    }

    if (!force && isDirtyRef.current && !window.confirm("Close this document without saving?")) {
      return false;
    }

    window.close();
    return true;
  }, []);

  useEffect(() => {
    saveDocumentRef.current = handleSaveFile;
    closeDocumentRef.current = handleCloseDocument;
    openDocumentRef.current = handleOpenFile;
    newDocumentRef.current = handleNewFile;
  }, [handleCloseDocument, handleNewFile, handleOpenFile, handleSaveFile]);

  useEffect(() => {
    const save = () => {
      void saveDocumentRef.current();
    };
    const saveAndClose = () => {
      if (isElectron) {
        void window.electronAPI?.saveAndCloseFile?.();
        return;
      }
      void saveDocumentRef.current().then((saved) => {
        if (saved) void closeDocumentRef.current(false);
      });
    };
    const close = (_cm: unknown, params?: { argString?: string }) => {
      const force = params?.argString?.trim().startsWith("!") ?? false;
      void closeDocumentRef.current(force);
    };

    Vim.defineEx("write", "w", save);
    Vim.defineEx("wq", "wq", saveAndClose);
    Vim.defineEx("writequit", "writeq", saveAndClose);
    Vim.defineEx("xit", "x", saveAndClose);
    Vim.defineEx("quit", "q", close);
    Vim.defineEx("edit", "e", () => openDocumentRef.current());
    Vim.defineEx("enew", "ene", () => newDocumentRef.current());
  }, []);

  // ─── Markdown formatting helpers (non-Vim mode) ──────────────────────────────
  const insertMarkdown = useCallback((before: string, after = "", placeholder = "text") => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    const inner = selected || placeholder;
    view.dispatch({
      changes: { from, to, insert: before + inner + after },
      selection: { anchor: from + before.length, head: from + before.length + inner.length },
    });
  }, []);

  const insertLinePrefix = useCallback((prefix: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: prefix },
      selection: { anchor: from + prefix.length },
    });
  }, []);

  const insertBlock = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    const { from } = view.state.selection.main;
    view.dispatch({
      changes: { from, to: from, insert: text },
      selection: { anchor: from + text.length },
    });
  }, []);

  // ─── Drag-to-resize ─────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const container = document.getElementById("split-container");
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setSplitPercent(Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  // ─── Web keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    if (isElectron) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "s") { e.preventDefault(); handleSaveFile(); }
      else if (e.key === "o") { e.preventDefault(); handleOpenFile(); }
      else if (e.key === "n") { e.preventDefault(); handleNewFile(); }
      else if (e.key === "p" && !e.shiftKey) { e.preventDefault(); handlePrint(); }
      else if (e.key === "p" && e.shiftKey) { e.preventDefault(); handleExportPDF(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile, handleOpenFile, handleNewFile, handlePrint, handleExportPDF]);

  // ─── localStorage autosave ───────────────────────────────────────────────────
  useEffect(() => {
    if (isElectron) return;
    const timer = setTimeout(() => {
      // Skip docs over 500KB to avoid quota errors and slow writes.
      if (content.length > 500_000) return;
      try {
        localStorage.setItem("vimdown-content", content);
      } catch {
        // Quota exceeded or storage disabled — silently skip.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [content]);

  useEffect(() => {
    if (!isDocumentMenuOpen) return;
    const name = fileName ?? "Untitled.md";
    setDraftFileName(name);
    if (!(isElectron && filePath)) return;
    // Native-style: focus the field and select the base name (excluding extension).
    requestAnimationFrame(() => {
      const input = documentNameRef.current;
      if (!input) return;
      input.focus();
      const dot = name.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : name.length);
    });
  }, [fileName, isDocumentMenuOpen, filePath]);

  const folderPath = filePath ? filePath.split("/").slice(0, -1).join("/") || "/" : null;
  const canRenameDocument = isElectron && !!filePath;
  const saveStatusLabel = !filePath ? "Not saved" : isDirty ? "Unsaved" : "Saved";
  const saveStatusClass = !filePath
    ? "text-muted-foreground"
    : isDirty
      ? "text-amber-600 dark:text-amber-400"
      : "text-primary";

  const handleRenameDocument = useCallback(async () => {
    if (skipDocumentNameBlurRef.current) {
      skipDocumentNameBlurRef.current = false;
      setDraftFileName(fileName ?? "Untitled.md");
      setIsDocumentMenuOpen(false);
      return;
    }
    if (!canRenameDocument) return;
    const nextName = draftFileName.trim();
    if (!nextName) {
      setDraftFileName(fileName ?? "Untitled.md");
      return;
    }
    if (nextName === fileName) {
      setIsDocumentMenuOpen(false);
      return;
    }

    try {
      const result = await window.electronAPI?.renameFile(nextName);
      if (!result) {
        // Rename declined (e.g. user chose not to replace an existing file).
        setDraftFileName(fileName ?? "Untitled.md");
        return;
      }
      setFileName(result.fileName);
      setFilePath(result.filePath);
      setDraftFileName(result.fileName);
      setIsDocumentMenuOpen(false);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      setDraftFileName(fileName ?? "Untitled.md");
    }
  }, [canRenameDocument, draftFileName, fileName]);

  const handleMoveDocument = useCallback(async () => {
    if (!canRenameDocument) return;
    try {
      const result = await window.electronAPI?.moveFile();
      if (!result) return;
      setFileName(result.fileName);
      setFilePath(result.filePath);
      setDraftFileName(result.fileName);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }, [canRenameDocument]);

  const handleRevealInFinder = useCallback(() => {
    window.electronAPI?.revealInFinder?.();
    setIsDocumentMenuOpen(false);
  }, []);

  // ─── Top padding for macOS traffic lights ───────────────────────────────────
  // hiddenInset titlebar makes the toolbar sit under the traffic light area
  const toolbarStyle: WebkitAppRegionStyle = isElectron
    ? { paddingLeft: "80px" } // macOS traffic lights are ~72px wide
    : {};
  const toolbarDragStyle: WebkitAppRegionStyle = { ...toolbarStyle, WebkitAppRegion: "drag" };
  const toolbarNoDragStyle: WebkitAppRegionStyle = { WebkitAppRegion: "no-drag" };

  return (
    <div className="flex flex-col h-screen bg-background text-foreground no-print">
      {/* Toolbar */}
      <header
        className="grid grid-cols-[minmax(0,1fr)_minmax(160px,360px)_minmax(0,1fr)] items-center h-11 px-3 border-b border-border bg-card shrink-0"
        style={toolbarDragStyle}
        data-testid="toolbar"
      >
        {/* Left: Document Actions (Persistence + Output) */}
        <div className="flex items-center gap-1 min-w-0 justify-self-start" style={toolbarNoDragStyle}>
          <div className="flex items-center gap-1.5 mr-2">
            <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-label="VimDown">
              {/* Document body */}
              <rect x="5" y="2" width="18" height="24" rx="2.5" fill="#6366f1" />
              {/* Folded corner */}
              <path d="M18 2 L23 7 L18 7 Z" fill="#4f46e5" />
              {/* Heading line (amber) */}
              <rect x="8" y="11" width="5" height="2" rx="1" fill="#fb923c" />
              <rect x="14.5" y="11" width="5.5" height="2" rx="1" fill="#e0e7ff" />
              {/* Body lines */}
              <rect x="8" y="15" width="11" height="1.5" rx="0.75" fill="#c7d2fe" />
              <rect x="8" y="18.5" width="8" height="1.5" rx="0.75" fill="#c7d2fe" />
            </svg>
            <span className="text-sm font-semibold tracking-tight">VimDown</span>
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Group 1: Persistence */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleNewFile} data-testid="btn-new">
                  <FilePlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New file ({isElectron ? "⌘N" : `${webModKey}+N`})</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpenFile} data-testid="btn-open">
                  <FolderOpen className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open file ({isElectron ? "⌘O" : `${webModKey}+O`})</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSaveFile} data-testid="btn-save">
                  <Save className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save ({isElectron ? "⌘S" : `${webModKey}+S`})</TooltipContent>
            </Tooltip>
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Group 2: Output */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePrint} data-testid="btn-print">
                  <Printer className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Print ({isElectron ? "⌘P" : `${webModKey}+P`})</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExportPDF} data-testid="btn-export-pdf">
                  <FileDown className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export PDF ({isElectron ? "⌘⇧P" : `${webModKey}+⇧+P`})</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Center: Document title and location */}
        <div className="justify-self-center min-w-0 max-w-full" style={toolbarNoDragStyle}>
          <Popover open={isDocumentMenuOpen} onOpenChange={setIsDocumentMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-8 max-w-[min(360px,42vw)] min-w-0 inline-flex items-center gap-1 rounded-md px-2 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="document-title"
              >
                <span className="truncate">{fileName ?? "Untitled"}</span>
                <span className={saveStatusClass} aria-label={saveStatusLabel}>•</span>
                <span className={`hidden sm:inline text-[11px] font-normal ${saveStatusClass}`}>
                  {saveStatusLabel}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent ref={documentMenuContentRef} className="w-80 space-y-3" align="center">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="document-name">
                  Name
                </label>
                <Input
                  id="document-name"
                  ref={documentNameRef}
                  value={draftFileName}
                  disabled={!canRenameDocument}
                  onChange={(event) => setDraftFileName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      skipDocumentNameBlurRef.current = true;
                      setDraftFileName(fileName ?? "Untitled.md");
                      event.currentTarget.blur();
                    }
                  }}
                  onBlur={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      nextTarget instanceof Node &&
                      documentMenuContentRef.current?.contains(nextTarget)
                    ) {
                      return;
                    }
                    void handleRenameDocument();
                  }}
                  data-testid="document-name-input"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between rounded-md border border-border bg-background px-2 py-2 text-xs">
                  <span className="text-muted-foreground">Status</span>
                  <span className={`font-medium ${saveStatusClass}`}>{saveStatusLabel}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Where</div>
                {folderPath ? (
                  <>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={handleMoveDocument}
                      disabled={!canRenameDocument}
                      title="Move to another folder…"
                      data-testid="document-location"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={folderPath}>{folderPath}</span>
                      <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                      onClick={handleRevealInFinder}
                      data-testid="document-reveal"
                    >
                      Reveal in Finder
                    </button>
                  </>
                ) : (
                  <div className="rounded-md border border-border bg-background px-2 py-2 text-xs text-muted-foreground">
                    Not saved yet
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Right: Workspace & View Actions */}
        <div className="flex items-center gap-1 justify-self-end" style={toolbarNoDragStyle}>
          {/* Group 3: Editor Mode */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1.5 px-2 cursor-default">
                <Keyboard className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Vim</span>
                <Switch
                  checked={vimEnabled}
                  onCheckedChange={setVimEnabled}
                  className="scale-75 origin-left"
                  data-testid="toggle-vim"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Toggle Vim keybindings{isElectron ? " (⌘⌥V)" : ""}</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Group 4: Layout */}
          <div className="flex items-center rounded-md border border-border bg-background/60 p-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={currentViewMode === "preview" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => applyViewMode("preview")}
                  data-testid="mode-preview"
                >
                  <FileText className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Preview only{isElectron ? " (⌘1)" : ""}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={currentViewMode === "edit" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => applyViewMode("edit")}
                  data-testid="mode-edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit only{isElectron ? " (⌘2)" : ""}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={currentViewMode === "split" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => applyViewMode("split")}
                  data-testid="mode-split"
                >
                  <PanelLeftOpen className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Split view{isElectron ? " (⌘3)" : ""}</TooltipContent>
            </Tooltip>
          </div>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Group 5: Theme */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDarkMode(!darkMode)} data-testid="toggle-theme">
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{darkMode ? "Light mode" : "Dark mode"}{isElectron ? " (⌘⌥D)" : ""}</TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* Markdown formatting toolbar — only shown when Vim mode is off */}
      {!vimEnabled && (
        <div className="flex items-center gap-0.5 h-9 px-3 border-b border-border bg-card/60 shrink-0 flex-wrap">
          {/* Headings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("# ")}>
                <Heading1 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Heading 1</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("## ")}>
                <Heading2 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Heading 2</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("### ")}>
                <Heading3 className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Heading 3</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Inline formatting */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertMarkdown("**", "**", "bold text")}>
                <Bold className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bold</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertMarkdown("*", "*", "italic text")}>
                <Italic className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Italic</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertMarkdown("~~", "~~", "strikethrough")}>
                <Strikethrough className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Strikethrough</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertMarkdown("`", "`", "code")}>
                <Code className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Inline code</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Block elements */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("> ")}>
                <Quote className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Blockquote</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("- ")}>
                <List className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bullet list</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertLinePrefix("1. ")}>
                <ListOrdered className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Numbered list</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-border mx-1" />

          {/* Link, table, hr */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertMarkdown("[", "](url)", "link text")}>
                <Link className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Link</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertBlock("\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell     | Cell     | Cell     |\n")}>
                <Table className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Table</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => insertBlock("\n---\n")}>
                <Minus className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Horizontal rule</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 font-mono text-xs" onClick={() => insertBlock("\n```\ncode block\n```\n")}>
                <Code className="w-3.5 h-3.5 opacity-60" />
                <span className="text-[9px] -ml-1 -mt-1 font-bold">{"{ }"}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Code block</TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Editor + Preview */}
      <div id="split-container" className="flex-1 flex overflow-hidden">
        <div
          className="h-full overflow-hidden"
          style={{
            width: showEditor ? (showPreview ? `${splitPercent}%` : "100%") : 0,
            display: showEditor ? "block" : "none",
          }}
        >
          <div ref={editorRef} className="h-full" data-testid="editor-pane" />
        </div>

        {showEditor && showPreview && (
          <div
            className="w-1 cursor-col-resize bg-border hover:bg-primary/40 transition-colors shrink-0"
            onMouseDown={handleMouseDown}
            data-testid="resize-handle"
          />
        )}

        {showPreview && (
          <div
            className="h-full overflow-auto bg-background"
            style={{ width: showEditor ? `${100 - splitPercent}%` : "100%" }}
          >
            <div className="flex items-center justify-between h-8 px-4 border-b border-border bg-card/50">
              <div className="flex items-center">
                <FileText className="w-3.5 h-3.5 text-muted-foreground mr-1.5" />
                <span className="text-xs text-muted-foreground font-medium">Preview</span>
              </div>
              {!showEditor && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => setShowEditor(true)}
                  data-testid="enter-edit"
                  title={isElectron ? "Edit (⌘E)" : "Edit"}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </Button>
              )}
            </div>
            <div
              ref={previewRef}
              className="markdown-preview p-6 max-w-none"
              dangerouslySetInnerHTML={{ __html: getRenderedHTML() }}
              data-testid="preview-pane"
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <footer className="flex items-center justify-between h-7 px-3 border-t border-border bg-card text-xs text-muted-foreground shrink-0" data-testid="statusbar">
        <div className="flex items-center gap-3">
          {vimEnabled && vimMode && (
            <span className="font-mono font-semibold text-primary" data-testid="vim-mode">-- {vimMode} --</span>
          )}
          {!vimEnabled && <span className="font-mono text-muted-foreground/60">INSERT</span>}
          <span className="font-mono">Ln {lineInfo.line}, Col {lineInfo.col}</span>
        </div>
        <div className="flex items-center gap-3">
          {fileName && <span className="font-mono truncate max-w-[220px]" title={fileName}>{fileName}</span>}
          <span className={`font-mono ${saveStatusClass}`}>{saveStatusLabel}</span>
          <span>{wordCount} words</span>
          <span>Markdown</span>
          <span>UTF-8</span>
        </div>
      </footer>

      {/* Hidden browser file input (non-Electron) */}
      {!isElectron && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.markdown,.mdown,.mkd,.mkdn,.mdwn,.mdtxt,.mdtext,.text"
          className="hidden"
          onChange={handleFileChange}
          data-testid="file-input"
        />
      )}

      <div className="hidden"><PerplexityAttribution /></div>
    </div>
  );
}
