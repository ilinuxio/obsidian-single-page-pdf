# Single Page PDF Export

[中文文档](README-CN.md)

An Obsidian plugin that exports notes as a single-page PDF without page breaks. The page height is automatically calculated based on content — no manual configuration needed.

## Features

- **Single-page PDF**: No page breaks, entire document on one continuous page
- **Auto-calculated height**: Content height measured automatically at A4 width
- **Preview**: See the rendered content before exporting
- **User fonts**: Respects your Obsidian font settings
- **i18n**: English and Chinese (Simplified) supported
- **Context menu**: Right-click a file to export directly

## Installation

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/ilinuxio/obsidian-single-page-pdf/releases)
2. Copy to `<vault>/.obsidian/plugins/single-page-pdf/`
3. Enable in Settings → Community Plugins

## Usage

### Command Palette

1. Open the markdown file you want to export
2. `Ctrl+P` → type "Single Page PDF"
3. Preview opens → click "Export PDF"

### File Menu

1. Right-click a `.md` file in the file explorer
2. Select "Export to single-page PDF"

## Build

```bash
npm install
npm run build
```

Output is in the `dist/` folder.

## Development

```bash
npm run dev
```

Watches for changes and rebuilds automatically.

## How It Works

1. Renders markdown using Obsidian's `MarkdownRenderer`
2. Injects the rendered HTML into a `<webview>` at A4 width (794px)
3. Measures `scrollHeight` to get actual content height
4. Scales the preview to fit the container
5. Calls `webview.printToPDF()` with custom page size (A4 width × content height)

## Supported Languages

| Locale | Language |
|---|---|
| `en` | English |
| `zh-cn` | 简体中文 |

To add a new language, create `src/i18n/<locale>.ts` and register it in `src/i18n/index.ts`.

## License

MIT
