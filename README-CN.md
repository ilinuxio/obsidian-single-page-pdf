# Single Page PDF Export

一个 Obsidian 插件，将笔记导出为单页 PDF，无分页。页面高度根据内容自动计算，无需手动配置。

## 功能特性

- **单页 PDF**：无分页，整个文档在一页连续页面上
- **自动计算高度**：A4 宽度,自动测量内容高度
- **预览**：导出前可预览渲染效果
- **用户字体**：遵循 Obsidian 字体设置
- **多语言**：支持英文和简体中文
- **右键菜单**：右键文件可直接导出

## 安装

### 从插件市场安装

1. 打开 Obsidian → 设置 → 社区插件
2. 点击 **浏览**，搜索 "Single Page PDF"
3. 点击 **安装**，然后 **启用**

### 手动安装

1. 从 [Releases](https://github.com/ilinuxio/obsidian-single-page-pdf/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/single-page-pdf/`
3. 在 设置 → 社区插件 中启用

## 使用方法

### 命令面板

1. 打开要导出的 Markdown 文件
2. `Ctrl+P` → 输入 "Single Page PDF"
3. 预览打开后 → 点击 "导出 PDF"

### 文件菜单

1. 在文件资源管理器中右键点击 `.md` 文件
2. 选择 "导出为单页 PDF"

## 构建

```bash
npm install
npm run build
```

产物在 `dist/` 目录下。

## 开发

```bash
npm run dev
```

监听文件变化并自动构建。

## 工作原理

1. 使用 Obsidian 的 `MarkdownRenderer` 渲染 Markdown
2. 将渲染后的 HTML 注入 `<webview>`，宽度为 A4（794px）
3. 测量 `scrollHeight` 获取实际内容高度
4. 缩放预览以适应容器
5. 调用 `webview.printToPDF()`，自定义页面尺寸（A4 宽度 × 内容高度）

## 支持的语言

| Locale | 语言 |
|---|---|
| `en` | English |
| `zh-cn` | 简体中文 |

添加新语言：在 `src/i18n/<locale>.ts` 创建语言文件，并在 `src/i18n/index.ts` 中注册。

## 许可证

MIT
