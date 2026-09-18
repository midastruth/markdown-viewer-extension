# ![Pi Markdown Viewer](icons/icon48.png) pi-markdown-viewer

[English](https://github.com/markdown-viewer/docs/blob/main/readme/README.en.md) · [简体中文](https://github.com/markdown-viewer/docs/blob/main/readme/README.zh-CN.md) · [繁體中文](https://github.com/markdown-viewer/docs/blob/main/readme/README.zh-TW.md) · [Русский](https://github.com/markdown-viewer/docs/blob/main/readme/README.ru.md) · [日本語](https://github.com/markdown-viewer/docs/blob/main/readme/README.ja.md) · [한국어](https://github.com/markdown-viewer/docs/blob/main/readme/README.ko.md) · [Deutsch](https://github.com/markdown-viewer/docs/blob/main/readme/README.de.md) · [Français](https://github.com/markdown-viewer/docs/blob/main/readme/README.fr.md) · [Español](https://github.com/markdown-viewer/docs/blob/main/readme/README.es.md)

> This fork is primarily maintained as a [Pi](https://pi.dev) package.
> It brings docu.md Markdown rendering and document export into Pi.

Preview Markdown. Preserve the complex parts. Export finished documents.

docu.md Markdown Viewer opens local or online Markdown as a polished reading page and exports it when you need a document people can actually use. It keeps the source file simple while preserving the parts that usually break during handoff: tables, images, code blocks, math, diagrams, themes, and document spacing.

It is built for technical documentation, engineering notes, research drafts, weekly reports, knowledge-base pages, README files, and AI-generated Markdown that needs final formatting.

## Install in Pi

Install this fork directly from GitHub:

```bash
pi install git:github.com/midastruth/pi-markdown-viewer
pi
```

The package installs the Pi extension and its local rendering dependencies automatically.

## Use in Pi

The package adds `/doc` and `/doc-preview` commands for interactive use. It does not expose a document-rendering tool to the model.

```text
# Inside Pi:
/doc-preview
/doc README.md README.html
/doc notes.md report.pdf --theme technical
/doc flow.puml flow.svg
```

`/doc-preview` opens a live browser window for model responses. It updates
while the model streams and renders the latest response with the full docu.md
pipeline, including Mermaid, PlantUML, math, tables, and charts. The preview is
served only on `127.0.0.1` with a random session URL. Use
`/doc-preview open` to reopen the page, `/doc-preview off` to stop it, or
`/doc-preview --theme technical` to select a docu.md theme.

Use `/doc` to export a Markdown file to HTML, EPUB, DOCX, or PDF, or to render
a supported diagram to SVG, PNG, or DrawIO. Processing stays local and uses the
existing docu.md CLI engine. Google Chrome must be installed for exports. A Git
installation builds the browser assets automatically on first use.

For local development:

```bash
npm install
npm run build:cli
pi -e ./extensions/documd.ts
```

Use `/reload` after changing the extension source. Set `DOCUMD_CLI_PATH` to an
alternate built `documd.js` entry or `DOCUMD_NODE_PATH` to a specific Node.js
executable if needed.

## Node.js HTML CLI

The repository includes a headless-Chrome CLI that renders a Markdown file with
the same parser, themes, math support, and diagram renderers used by the viewer.
It requires Node.js 24 or newer and an installed Google Chrome browser.

```bash
npm install
npm run build:cli
npm run documd -- README.md README.html
```

Chrome runs headlessly and uses a temporary browser profile. A separate Chromium
download is not required. Common options include:

```bash
npm run documd -- notes.md --theme technical
npm run documd -- report.md --frontmatter table --merge-empty-cells
npm run documd -- night.md night.pdf --theme midnight
```

Run `npm run documd -- --help` for all options. Theme IDs are listed in
`src/themes/registry.json`.

## Highlights

- Clean Markdown preview for local files and supported web URLs.
- DOCX export for editable Word documents.
- PDF, self-contained HTML, and EPUB export where supported by the platform.
- Editable formulas in Word output.
- Syntax highlighting for code blocks.
- Document themes for business reports, academic writing, technical notes, reading layouts, and Chinese typography.
- Smart rendering and caching for large documents.
- Local processing for normal preview and export workflows.

## Why It Exists

Markdown is fast to write and easy to version. It is also the default format for many AI assistants, developer notes, project reports, and technical drafts.

The problem appears at the handoff stage. A `.md` file is not always acceptable when a colleague expects a Word document, a reviewer wants a printable PDF, or a client needs a self-contained page. Copying content into another editor often means rebuilding layout, screenshots, formulas, code formatting, and tables by hand.

docu.md bridges that gap. Open the Markdown file, review the rendered result, choose a document style, and export when it is ready.

## Rich Content Support

docu.md supports standard Markdown, GitHub-style tables and task lists, images, highlighted code, math formulas, SVG content, complex HTML tables, and diagrams or charts written in common text-based formats such as PlantUML, Mermaid, Vega/Vega-Lite, drawio, Canvas, Infographic, Graphviz, and ECharts.

That feature list appears here once because it is useful. The rest of the README focuses on workflows, platforms, and practical setup.

## What You Can Do

- Open local or online Markdown files in a clean reading view.
- Export finished documents to DOCX, PDF, self-contained HTML, or EPUB where supported by the platform.
- Keep formulas editable in Word instead of flattening them into screenshots.
- Render diagrams and charts directly from Markdown source blocks.
- Preserve code highlighting, tables, images, headings, and long-form document structure.
- Switch document themes for academic, business, technical, reading, and Chinese typography needs.
- Work with local processing so your documents stay on your device.

## Common Workflows

### AI Draft to Shareable Document

Paste or save Markdown from an AI assistant, open it with docu.md, review the formatted result, and export a polished document for colleagues, clients, classmates, or reviewers.

### Technical Notes to Documentation

Keep architecture notes, project READMEs, API drafts, and visual blocks in Markdown. Preview them with formatted code and rendered content before sharing.

### Reports and Research Drafts

Use Markdown for writing speed, then export documents with tables, formulas, headings, and document themes preserved for review or submission.

## Document Output

docu.md focuses on the handoff formats people ask for after the writing is done:

- **DOCX** for editable Word documents.
- **PDF** for print-ready sharing where supported.
- **HTML** for self-contained publishing where supported.
- **EPUB** for ebooks and whole-book exports where supported.
- **Image/vector exports** for rendered visual blocks where supported.
- **XLSX** for tables saved as spreadsheets where supported.

Exact output options vary by platform. See the platform docs for the environment you use.

## Scope of This Fork

This fork focuses on the Pi integration. It keeps the docu.md rendering engine and
CLI, while making the Pi package the primary installation and usage path.

The original project also provides browser, Obsidian, VS Code, and mobile
integrations. See the [upstream repository](https://github.com/markdown-viewer/markdown-viewer-extension)
if you need those platform-specific packages.

## Privacy

Document processing is local. docu.md does not require uploading your Markdown files to a remote rendering service for normal preview and export workflows.

## Getting Started in Pi

1. Install the package with `pi install git:github.com/midastruth/pi-markdown-viewer`.
2. Start Pi and run `/doc-preview` to preview model responses.
3. Use `/doc` to render Markdown files, diagrams, or GitBook books.
4. Choose a theme and export to HTML, PDF, DOCX, or EPUB when needed.

## Documentation

- [Getting Started](https://github.com/markdown-viewer/docs/blob/main/getting-started/installation.md)
- [Feature Guide](https://github.com/markdown-viewer/docs/blob/main/features/README.md)
- [Platform Comparison](https://github.com/markdown-viewer/docs/blob/main/platforms/platform-comparison.md)
- [FAQ](https://github.com/markdown-viewer/docs/blob/main/faq.md)
- [Privacy Policy](PRIVACY.md)

## Development Testing

See [Testing Architecture and E2E Requirements](TESTING.md) for the
project's test-layer boundaries, E2E rules, CI workflow, and review checklist.

After installing dependencies and building the CLI and Chrome extension, run
the compatibility tests and the installed-extension E2E tests separately:

```bash
npm run test:unit
npm run test:e2e
```

`npm test` runs both suites. The extension E2E suite uses Node.js and
Playwright directly, with no model-backed browser agent involved in test
execution.

## Open Source

docu.md Markdown Viewer is open source under GPLv3.
