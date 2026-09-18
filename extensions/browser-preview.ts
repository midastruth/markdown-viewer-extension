import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import http, { type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREVIEW_UPDATE_DELAY_MS = 300;

export interface AssistantPreviewUpdate {
  markdown: string;
  title?: string;
  streaming?: boolean;
}

export interface AssistantPreviewOptions {
  assetDir: string;
  cwd: string;
  theme?: string;
  title?: string;
}

export interface AssistantPreviewServer {
  readonly url: string;
  update(update: AssistantPreviewUpdate, immediate?: boolean): void;
  setTheme(theme: string): void;
  close(): Promise<void>;
}

interface PreviewState {
  revision: number;
  markdown: string;
  title: string;
  theme: string;
  streaming: boolean;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mimeType(filePath: string): string {
  return {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".ttf": "font/ttf",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function setNoStore(response: ServerResponse, contentType: string): void {
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
}

async function sendFile(response: ServerResponse, filePath: string): Promise<void> {
  try {
    const data = await readFile(filePath);
    setNoStore(response, mimeType(filePath));
    response.writeHead(200);
    response.end(data);
  } catch (error) {
    const status = (error as NodeJS.ErrnoException)?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : "Unable to read file");
  }
}

function previewHtml(basePath: string, cwd: string): string {
  const request = JSON.stringify({
    filename: "pi-assistant-message.md",
    documentPath: path.join(cwd, "pi-assistant-message.md"),
    documentDir: cwd,
    documentBaseUrl: `${basePath}/document`,
    fileReadUrl: `${basePath}/file`,
    resourceBaseUrl: `${basePath}/assets/`,
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="${basePath}/assets/styles.css">
  <style>
    #documd-preview-status {
      position: fixed;
      right: 12px;
      bottom: 10px;
      z-index: 2147483647;
      padding: 5px 9px;
      border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, Canvas 90%, transparent);
      color: GrayText;
      font: 12px/1.25 system-ui, sans-serif;
      backdrop-filter: blur(8px);
      opacity: .8;
    }
    #documd-preview-status[data-error="true"] { color: #c62828; opacity: 1; }
  </style>
</head>
<body>
  <div id="markdown-page"><div id="markdown-content"></div></div>
  <div id="documd-preview-status">Waiting for an assistant message…</div>
  <script src="${basePath}/assets/browser-renderer.js"></script>
  <script>
    (() => {
      const baseRequest = ${request};
      baseRequest.documentBaseUrl = new URL(baseRequest.documentBaseUrl, window.location.origin).href;
      baseRequest.fileReadUrl = new URL(baseRequest.fileReadUrl, window.location.origin).href;
      baseRequest.resourceBaseUrl = new URL(baseRequest.resourceBaseUrl, window.location.origin).href;
      const status = document.getElementById("documd-preview-status");
      let renderedRevision = 0;
      let pending = null;
      let rendering = false;

      const setStatus = (text, error = false) => {
        status.textContent = text;
        status.dataset.error = String(error);
      };

      const drain = async () => {
        if (rendering || !pending) return;
        rendering = true;
        const next = pending;
        pending = null;
        try {
          setStatus(next.streaming ? "Rendering streamed response…" : "Rendering response…");
          const render = window.markdownCli.renderPreview || window.markdownCli.render;
          await render({
            ...baseRequest,
            markdown: next.markdown,
            title: next.title,
            theme: next.theme,
          });
          renderedRevision = next.revision;
          document.title = next.title || "Pi assistant preview";
          setStatus(next.streaming ? "Live · receiving…" : "Up to date");
        } catch (error) {
          // Do not retry a broken partial Markdown revision on every poll. A
          // later streaming update receives a new revision and renders again.
          renderedRevision = next.revision;
          console.error("[docu.md preview]", error);
          setStatus(error instanceof Error ? error.message : String(error), true);
        } finally {
          rendering = false;
          if (pending && pending.revision > renderedRevision) void drain();
        }
      };

      const poll = async () => {
        try {
          const response = await fetch("${basePath}/api/message", { cache: "no-store" });
          if (!response.ok) throw new Error("Preview server returned " + response.status);
          const next = await response.json();
          if (next.revision > renderedRevision && (!pending || next.revision > pending.revision)) {
            pending = next;
            void drain();
          }
        } catch (error) {
          setStatus("Preview disconnected", true);
        }
      };

      window.addEventListener("error", (event) => setStatus(event.message || "Render failed", true));
      void poll();
      setInterval(poll, 250);
    })();
  </script>
</body>
</html>`;
}

/**
 * Start a loopback-only page that renders the latest assistant Markdown in the
 * browser using the same docu.md bundle as the export CLI.
 */
export async function startAssistantPreviewServer(
  options: AssistantPreviewOptions,
): Promise<AssistantPreviewServer> {
  const assetDir = path.resolve(options.assetDir);
  const cwd = path.resolve(options.cwd);
  const token = `documd-preview-${randomUUID()}`;
  const basePath = `/${token}`;
  let origin = "";
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let pending: AssistantPreviewUpdate | undefined;
  const state: PreviewState = {
    revision: 0,
    markdown: "",
    title: options.title ?? "Pi assistant preview",
    theme: options.theme ?? "default",
    streaming: false,
  };

  const commit = (update: AssistantPreviewUpdate): void => {
    state.markdown = update.markdown;
    state.title = update.title ?? state.title;
    state.streaming = update.streaming ?? false;
    state.revision += 1;
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "GET") {
          response.writeHead(405, { allow: "GET" }).end();
          return;
        }

        const url = new URL(request.url ?? "/", origin || "http://127.0.0.1");
        const pathname = decodeURIComponent(url.pathname);

        if (pathname === basePath || pathname === `${basePath}/`) {
          setNoStore(response, "text/html; charset=utf-8");
          response.writeHead(200);
          response.end(previewHtml(basePath, cwd));
          return;
        }

        if (pathname === `${basePath}/api/message`) {
          setNoStore(response, "application/json; charset=utf-8");
          response.writeHead(200);
          response.end(JSON.stringify(state));
          return;
        }

        if (pathname === `${basePath}/file`) {
          const requestedPath = url.searchParams.get("path");
          if (!requestedPath) {
            response.writeHead(400).end("Missing path");
            return;
          }
          const localPath = requestedPath.toLowerCase().startsWith("file:")
            ? fileURLToPath(requestedPath)
            : path.isAbsolute(requestedPath)
              ? requestedPath
              : path.resolve(cwd, requestedPath);
          await sendFile(response, path.resolve(localPath));
          return;
        }

        if (pathname.startsWith(`${basePath}/document/`)) {
          const relativePath = pathname.slice(`${basePath}/document/`.length);
          const localPath = path.resolve(cwd, relativePath);
          if (!isWithin(cwd, localPath)) {
            response.writeHead(403).end("Outside project directory");
            return;
          }
          await sendFile(response, localPath);
          return;
        }

        if (pathname.startsWith(`${basePath}/assets/`)) {
          const relativePath = pathname.slice(`${basePath}/assets/`.length);
          const localPath = path.resolve(assetDir, relativePath);
          if (!isWithin(assetDir, localPath)) {
            response.writeHead(403).end("Outside asset directory");
            return;
          }
          await sendFile(response, localPath);
          return;
        }

        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Not found");
      } catch (error) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : "Internal server error");
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to determine docu.md preview server address");
  }
  origin = `http://127.0.0.1:${address.port}`;

  return {
    url: `${origin}${basePath}/`,
    update(update, immediate = false) {
      if (closed) return;
      pending = update;
      if (immediate) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        const next = pending;
        pending = undefined;
        if (next) commit(next);
        return;
      }
      if (!timer) {
        timer = setTimeout(() => {
          timer = undefined;
          const next = pending;
          pending = undefined;
          if (next) commit(next);
        }, PREVIEW_UPDATE_DELAY_MS);
      }
    },
    setTheme(theme) {
      if (closed || !theme || theme === state.theme) return;
      state.theme = theme;
      state.revision += 1;
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
