import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateTail,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

import {
  startAssistantPreviewServer,
  type AssistantPreviewServer,
} from "./browser-preview.js";

const FORMATS = ["html", "epub", "docx", "pdf", "svg", "png", "drawio"] as const;
const FRONTMATTER_MODES = ["hide", "table", "raw"] as const;
const TABLE_LAYOUTS = ["left", "center", "center-full-width"] as const;
const ALIGNMENTS = ["left", "center"] as const;

const DocumdParameters = Type.Object({
  input: Type.String({
    description:
      "Input file, relative to pi's working directory or absolute. Supports Markdown, SUMMARY.md, and diagram sources such as .puml, .mmd, .dot, .vega, .drawio, .echarts, .svg, .infographic, and .canvas.",
  }),
  output: Type.Optional(
    Type.String({
      description:
        "Output file, relative to pi's working directory or absolute. Its extension can select the output format.",
    }),
  ),
  format: Type.Optional(
    StringEnum(FORMATS, {
      description: "Output format. Usually inferred from the output extension.",
    }),
  ),
  book: Type.Optional(
    Type.Boolean({ description: "Export a GitBook SUMMARY.md as a whole book." }),
  ),
  diagramType: Type.Optional(
    Type.String({
      description:
        "Diagram renderer override, for example plantuml, mermaid, dot, vega, vega-lite, drawio, or echarts.",
    }),
  ),
  theme: Type.Optional(
    Type.String({
      description:
        "docu.md theme id, for example default, academic, business, technical, minimal, midnight, dracula, or nord.",
    }),
  ),
  title: Type.Optional(Type.String({ description: "Document title override." })),
  language: Type.Optional(Type.String({ description: "Document language code." })),
  frontmatter: Type.Optional(StringEnum(FRONTMATTER_MODES)),
  tableLayout: Type.Optional(StringEnum(TABLE_LAYOUTS)),
  imageLayout: Type.Optional(StringEnum(ALIGNMENTS)),
  diagramLayout: Type.Optional(StringEnum(ALIGNMENTS)),
  mergeEmptyCells: Type.Optional(
    Type.Boolean({ description: "Merge empty Markdown table cells." }),
  ),
  firstLineIndent: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 4,
      description: "First-line indent in characters (0-4).",
    }),
  ),
  chrome: Type.Optional(
    Type.String({ description: "Explicit Google Chrome executable path." }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 1800,
      description: "Overall render timeout in seconds (default: 120).",
    }),
  ),
});

export type DocumdInput = Static<typeof DocumdParameters>;

interface DocumdRunResult {
  outputPath?: string;
  stdout: string;
  stderr: string;
  text: string;
}

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(extensionDir, "..");
const bundledCliPath = path.join(packageRoot, "dist", "cli", "documd.js");
const bundledBrowserRendererPath = path.join(
  packageRoot,
  "dist",
  "cli",
  "browser-renderer.js",
);
const bundledStylesPath = path.join(packageRoot, "dist", "cli", "styles.css");
const buildCliPath = path.join(packageRoot, "scripts", "build-cli.js");
const nodeExecutable = process.env.DOCUMD_NODE_PATH || "node";

function stripFileReference(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function parametersToArgs(params: DocumdInput): string[] {
  const args = [stripFileReference(params.input)];
  if (params.output) args.push(stripFileReference(params.output));
  if (params.format) args.push("--format", params.format);
  if (params.book) args.push("--book");
  if (params.diagramType) args.push("--diagram-type", params.diagramType);
  if (params.theme) args.push("--theme", params.theme);
  if (params.title) args.push("--title", params.title);
  if (params.language) args.push("--language", params.language);
  if (params.frontmatter) args.push("--frontmatter", params.frontmatter);
  if (params.tableLayout) args.push("--table-layout", params.tableLayout);
  if (params.imageLayout) args.push("--image-layout", params.imageLayout);
  if (params.diagramLayout) args.push("--diagram-layout", params.diagramLayout);
  if (params.mergeEmptyCells) args.push("--merge-empty-cells");
  if (params.firstLineIndent !== undefined) {
    args.push("--first-line-indent", String(params.firstLineIndent));
  }
  if (params.chrome) args.push("--chrome", params.chrome);
  if (params.timeoutSeconds !== undefined) {
    args.push("--timeout", String(params.timeoutSeconds));
  }
  return args;
}

/** Split slash-command arguments without invoking a shell. */
export function splitCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;

    if (quote) {
      if (character === quote) {
        quote = undefined;
        tokenStarted = true;
        continue;
      }
      if (character === "\\" && quote === '"') {
        const next = value[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
          tokenStarted = true;
          continue;
        }
      }
      current += character;
      tokenStarted = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (character === "\\") {
      const next = value[index + 1];
      if (next && (/\s/.test(next) || next === "'" || next === '"' || next === "\\")) {
        current += next;
        index += 1;
        tokenStarted = true;
        continue;
      }
    }

    current += character;
    tokenStarted = true;
  }

  if (quote) throw new Error(`Unterminated ${quote} quote`);
  if (tokenStarted) args.push(current);
  return args;
}

function normalizeCommandInput(args: string[]): string[] {
  const normalized = [...args];
  if (normalized[0] && !normalized[0].startsWith("--")) {
    normalized[0] = stripFileReference(normalized[0]);
  }
  if (normalized[1] && !normalized[1].startsWith("--")) {
    normalized[1] = stripFileReference(normalized[1]);
  }
  return normalized;
}

function extractOutputPath(stdout: string): string | undefined {
  const matches = [...stdout.matchAll(/^(?:Rendered|Exported) (.+)$/gm)];
  return matches[matches.length - 1]?.[1]?.trim();
}

function formatOutput(stdout: string, stderr: string): string {
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  if (!combined) return "documd completed successfully.";

  const truncated = truncateTail(combined, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  return truncated.truncated
    ? `${truncated.content}\n\n[Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES} bytes.]`
    : truncated.content;
}

async function ensureCli(
  pi: ExtensionAPI,
  signal: AbortSignal | undefined,
  onProgress?: (message: string) => void,
): Promise<string> {
  const override = process.env.DOCUMD_CLI_PATH;
  if (override) {
    const resolved = path.resolve(override);
    if (!existsSync(resolved)) throw new Error(`DOCUMD_CLI_PATH does not exist: ${resolved}`);
    return resolved;
  }

  if (
    existsSync(bundledCliPath) &&
    existsSync(bundledBrowserRendererPath) &&
    existsSync(bundledStylesPath)
  ) {
    return bundledCliPath;
  }
  if (!existsSync(buildCliPath)) {
    throw new Error(
      `documd browser assets were not found at ${bundledCliPath}. Install the complete pi package or set DOCUMD_CLI_PATH.`,
    );
  }

  onProgress?.("Building documd browser assets for first use...");
  const build = await pi.exec(nodeExecutable, [buildCliPath], {
    cwd: packageRoot,
    signal,
    timeout: 10 * 60 * 1000,
  });
  if (
    build.code !== 0 ||
    !existsSync(bundledCliPath) ||
    !existsSync(bundledBrowserRendererPath) ||
    !existsSync(bundledStylesPath)
  ) {
    throw new Error(
      `Unable to build documd browser assets.\n${formatOutput(build.stdout, build.stderr)}`,
    );
  }
  return bundledCliPath;
}

async function runDocumd(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<DocumdRunResult> {
  const cliPath = await ensureCli(pi, signal, onProgress);
  const timeoutIndex = args.indexOf("--timeout");
  const requestedSeconds = timeoutIndex >= 0 ? Number(args[timeoutIndex + 1]) : 120;
  const processTimeout =
    Number.isFinite(requestedSeconds) && requestedSeconds > 0
      ? requestedSeconds * 1000 + 15_000
      : 135_000;

  onProgress?.("Rendering with documd...");
  const result = await pi.exec(nodeExecutable, [cliPath, ...args], {
    cwd,
    signal,
    timeout: processTimeout,
  });
  const text = formatOutput(result.stdout, result.stderr);

  if (signal?.aborted || result.killed) throw new Error("documd was cancelled.");
  if (result.code !== 0) {
    throw new Error(`documd exited with code ${result.code}.\n${text}`);
  }

  return {
    outputPath: extractOutputPath(result.stdout),
    stdout: result.stdout,
    stderr: result.stderr,
    text,
  };
}

const COMMAND_USAGE =
  'Usage: /doc <input> [output] [--format html|epub|docx|pdf|svg|png|drawio] [options]. Quote paths containing spaces.';
const PREVIEW_USAGE =
  "Usage: /doc-preview [on|open|off] [--theme <id>]. The default starts the live preview.";

interface PreviewCommandOptions {
  action: "on" | "open" | "off";
  theme?: string;
}

function parsePreviewCommand(rawArgs: string): PreviewCommandOptions {
  const args = splitCommandLine(rawArgs);
  let action: PreviewCommandOptions["action"] = "on";
  let theme: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value === "on" || value === "open" || value === "off") {
      action = value;
      continue;
    }
    if (value === "--theme") {
      theme = args[index + 1];
      if (!theme || theme.startsWith("--")) throw new Error("--theme requires a theme id");
      index += 1;
      continue;
    }
    throw new Error(`Unknown preview option: ${value}. ${PREVIEW_USAGE}`);
  }

  return { action, theme };
}

/** Return visible Markdown text from a Pi assistant message. */
export function extractAssistantMarkdown(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as {
    role?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
  };
  if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return undefined;

  const text = candidate.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n\n")
    .trim();
  return text || undefined;
}

function findLastAssistantMarkdown(entries: readonly unknown[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: unknown; message?: unknown } | undefined;
    if (entry?.type !== "message") continue;
    const markdown = extractAssistantMarkdown(entry.message);
    if (markdown) return markdown;
  }
  return undefined;
}

async function openInDefaultBrowser(
  pi: ExtensionAPI,
  url: string,
  cwd: string,
): Promise<void> {
  const command =
    process.platform === "darwin"
      ? { executable: "open", args: [url] }
      : process.platform === "win32"
        ? { executable: "cmd.exe", args: ["/c", "start", "", url] }
        : { executable: "xdg-open", args: [url] };
  const result = await pi.exec(command.executable, command.args, { cwd, timeout: 15_000 });
  if (result.code !== 0) {
    const reason = formatOutput(result.stdout, result.stderr);
    throw new Error(`Unable to open the default browser: ${reason}`);
  }
}

export default function documdExtension(pi: ExtensionAPI) {
  let preview: AssistantPreviewServer | undefined;
  let previewCwd: string | undefined;
  let previewTitle = "Pi assistant preview";
  let previewGeneration = 0;

  const stopPreview = async (): Promise<void> => {
    const active = preview;
    preview = undefined;
    previewCwd = undefined;
    await active?.close();
  };

  const updatePreview = (message: unknown, streaming: boolean): void => {
    const markdown = extractAssistantMarkdown(message);
    if (!preview || !markdown) return;
    preview.update(
      { markdown, streaming, title: previewTitle },
      !streaming,
    );
  };

  pi.on("message_update", (event) => {
    updatePreview(event.message, true);
  });

  pi.on("message_end", (event) => {
    updatePreview(event.message, false);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    previewGeneration += 1;
    ctx.ui.setStatus("documd-preview", undefined);
    await stopPreview();
  });
  pi.registerTool({
    name: "doc",
    label: "docu.md",
    description:
      "Render Markdown, text diagrams, or GitBook books to HTML, EPUB, DOCX, PDF, SVG, PNG, or DrawIO using the local docu.md engine and headless Google Chrome. Output is limited to 2000 lines or 50KB.",
    promptSnippet: "Render or export Markdown documents, diagrams, and GitBook books",
    promptGuidelines: [
      "Use doc when the user asks to preview, render, or export Markdown or a supported text diagram; do not recreate these document formats manually.",
    ],
    parameters: DocumdParameters,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const args = parametersToArgs(params);
      const result = await runDocumd(pi, args, ctx.cwd, signal, (message) => {
        onUpdate?.({ content: [{ type: "text", text: message }], details: {} });
      });

      return {
        content: [{ type: "text", text: result.text }],
        details: {
          outputPath: result.outputPath,
          format: params.format,
          hadWarnings: Boolean(result.stderr.trim()),
        },
      };
    },
  });

  pi.registerCommand("doc-preview", {
    description: "Show model responses in a live docu.md browser preview",
    handler: async (rawArgs, ctx) => {
      let options: PreviewCommandOptions;
      try {
        options = parsePreviewCommand(rawArgs);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : PREVIEW_USAGE, "error");
        return;
      }

      if (options.action === "off") {
        previewGeneration += 1;
        await stopPreview();
        ctx.ui.setStatus("documd-preview", undefined);
        ctx.ui.notify("docu.md browser preview stopped.", "info");
        return;
      }

      let generation = previewGeneration;
      try {
        if (preview && previewCwd !== ctx.cwd) {
          previewGeneration += 1;
          await stopPreview();
        }

        let started = false;
        if (!preview) {
          generation = ++previewGeneration;
          ctx.ui.setStatus("documd-preview", "docu.md: preparing browser preview...");
          const cliPath = await ensureCli(pi, undefined, (message) => {
            if (generation === previewGeneration) {
              ctx.ui.setStatus("documd-preview", `docu.md: ${message}`);
            }
          });
          if (generation !== previewGeneration) return;

          const assetDir = path.dirname(cliPath);
          for (const requiredAsset of ["browser-renderer.js", "styles.css"]) {
            if (!existsSync(path.join(assetDir, requiredAsset))) {
              throw new Error(
                `docu.md preview asset is missing: ${path.join(assetDir, requiredAsset)}`,
              );
            }
          }

          previewTitle = `Pi assistant · ${path.basename(ctx.cwd) || ctx.cwd}`;
          const startedPreview = await startAssistantPreviewServer({
            assetDir,
            cwd: ctx.cwd,
            title: previewTitle,
            theme: options.theme ?? process.env.DOCUMD_PREVIEW_THEME ?? "default",
          });
          if (generation !== previewGeneration) {
            await startedPreview.close();
            return;
          }
          preview = startedPreview;
          previewCwd = ctx.cwd;
          started = true;

          const lastMarkdown = findLastAssistantMarkdown(ctx.sessionManager.getBranch());
          if (lastMarkdown) {
            preview.update(
              { markdown: lastMarkdown, streaming: false, title: previewTitle },
              true,
            );
          }
        } else if (options.theme) {
          preview.setTheme(options.theme);
        }

        const activePreview = preview;
        if (!activePreview) return;
        const shouldOpen = started || options.action === "open";
        let browserOpened = false;
        if (shouldOpen) {
          try {
            await openInDefaultBrowser(pi, activePreview.url, ctx.cwd);
            browserOpened = true;
          } catch (error) {
            if (generation !== previewGeneration) return;
            ctx.ui.notify(
              `${error instanceof Error ? error.message : String(error)}\nOpen manually: ${activePreview.url}`,
              "warning",
            );
          }
        }
        if (generation !== previewGeneration) return;

        ctx.ui.setStatus("documd-preview", "docu.md: browser preview active");
        ctx.ui.notify(
          started
            ? browserOpened
              ? `Live model preview opened: ${activePreview.url}`
              : `Live model preview is ready: ${activePreview.url}`
            : options.action === "open"
              ? browserOpened
                ? `Reopened model preview: ${activePreview.url}`
                : `Model preview is available at: ${activePreview.url}`
              : `Model preview is already active: ${activePreview.url}`,
          "info",
        );
      } catch (error) {
        if (generation !== previewGeneration) return;
        previewGeneration += 1;
        await stopPreview();
        ctx.ui.setStatus("documd-preview", undefined);
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("doc", {
    description: "Render/export Markdown or diagrams with docu.md",
    handler: async (rawArgs, ctx) => {
      if (!rawArgs.trim()) {
        ctx.ui.notify(COMMAND_USAGE, "info");
        return;
      }

      try {
        const args = normalizeCommandInput(splitCommandLine(rawArgs));
        ctx.ui.setStatus("documd", "docu.md: rendering...");
        const result = await runDocumd(pi, args, ctx.cwd, undefined, (message) => {
          ctx.ui.setStatus("documd", `docu.md: ${message}`);
        });
        ctx.ui.notify(result.outputPath ? `Created ${result.outputPath}` : result.text, "info");
        if (result.stderr.trim()) {
          const warnings = result.stderr.trim();
          const preview = warnings.length > 1500 ? `${warnings.slice(0, 1500)}\n…` : warnings;
          ctx.ui.notify(`docu.md completed with browser warnings:\n${preview}`, "warning");
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      } finally {
        ctx.ui.setStatus("documd", undefined);
      }
    },
  });
}
