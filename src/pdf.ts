import { App, Modal, Notice, TFile } from "obsidian";
import { getLang, type Lang } from "./i18n";
import electron from "electron";
import { writeFile, readFile } from "fs/promises";
import { getAllStyles, getPatchStyle } from "./styles";
import { renderMarkdown, makeWebviewJs, A4_WIDTH_PX, A4_WIDTH_MM, MM_PER_INCH, PX_PER_INCH, sleep } from "./render";

// ── Create Webview ───────────────────────────────────────

function createWebview(): any {
  const webview = document.createElement("webview") as any;
  webview.src = "app://obsidian.md/help.html";
  webview.setAttribute(
    "style",
    `width:${A4_WIDTH_PX}px;height:100%;display:flex;flex-direction:column;
     transform-origin:top left;border:1px solid var(--background-modifier-border);`,
  );
  webview.nodeintegration = true;
  return webview;
}

// ── Export PDF ───────────────────────────────────────────

async function exportToPDF(
  outputFile: string,
  webview: any,
  pageWidthMm: number,
  pageHeightMm: number,
) {
  const printOptions = {
    pageSize: {
      width: pageWidthMm / MM_PER_INCH,
      height: pageHeightMm / MM_PER_INCH,
    },
    scale: 1,
    margins: { marginType: "none" },
    printBackground: true,
    displayHeaderFooter: false,
  };

  // Try direct webview.printToPDF() (Electron >= 28)
  if (typeof webview.printToPDF === "function") {
    const data = await webview.printToPDF(printOptions);
    await writeFile(outputFile, data);
    return;
  }

  // Fallback: IPC-based approach
  const ipc = webview.win?.electron?.ipcRenderer;
  if (ipc) {
    const data = await new Promise<Uint8Array>((resolve) => {
      ipc.once("print-to-pdf", (_event: any, result: Uint8Array) => resolve(result));
      ipc.send("print-to-pdf", { ...printOptions, filepath: outputFile });
    });
    await writeFile(outputFile, data);
    return;
  }

  throw new Error("printToPDF is not available on this webview");
}

// ── Export Modal ─────────────────────────────────────────

export class ExportPdfModal extends Modal {
  private file: TFile;
  private pluginApp: App;
  private webview?: any;
  private statusEl?: HTMLDivElement;
  private exportBtn?: HTMLButtonElement;
  private dimensions = { width: 0, height: 0 };
  private i18n: Lang;

  constructor(app: App, file: TFile) {
    super(app);
    this.pluginApp = app;
    this.file = file;
    this.i18n = getLang();
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.containerEl.addClass("pdf-npb-modal");
    this.titleEl.setText(this.i18n.exportTitle);

    const wrapper = contentEl.createDiv({ cls: "pdf-npb-wrapper" });

    // ── Left: Preview ──
    const previewArea = wrapper.createDiv({ cls: "pdf-npb-preview" });
    const scrollArea = previewArea.createDiv({ cls: "pdf-npb-scroll-area" });
    const webviewWrapper = scrollArea.createDiv({ cls: "pdf-npb-webview-wrapper" });

    this.statusEl = previewArea.createDiv({ cls: "pdf-npb-status" });
    this.statusEl.setText(this.i18n.rendering);

    // ── Right: Controls ──
    const controls = wrapper.createDiv({ cls: "pdf-npb-controls" });
    controls.createEl("div", { cls: "pdf-npb-file-info", text: `📄 ${this.file.basename}` });

    const dimEl = controls.createDiv({ cls: "pdf-npb-dimensions" });
    dimEl.createEl("div", { text: this.i18n.pageDimensions });
    const dimValue = dimEl.createEl("div", { cls: "pdf-npb-dim-value" });
    dimValue.setText(this.i18n.measuring);

    const btnWrapper = controls.createDiv({ cls: "pdf-npb-btn-wrapper" });
    this.exportBtn = btnWrapper.createEl("button", {
      cls: "pdf-npb-export-btn mod-cta",
      text: this.i18n.exportPdf,
    });
    this.exportBtn.disabled = true;
    this.exportBtn.addEventListener("click", () => this.handleExport());

    // ── Render & measure ──
    try {
      const { doc } = await renderMarkdown(this.pluginApp, this.file);

      this.webview = createWebview();
      webviewWrapper.appendChild(this.webview);

      // Wait for webview ready
      await new Promise<void>((resolve) => {
        const handler = () => {
          this.webview!.removeEventListener("dom-ready", handler);
          resolve();
        };
        this.webview!.addEventListener("dom-ready", handler);
      });

      // Inject styles
      for (const css of getAllStyles()) {
        await (this.webview as any).insertCSS(css);
      }

      // Read Obsidian font settings from CSS variables
      let textFont = "";
      let interfaceFont = "";
      let monoFont = "";
      try {
        const cs = getComputedStyle(document.body);
        textFont = cs.getPropertyValue("--font-text").trim();
        interfaceFont = cs.getPropertyValue("--font-interface").trim();
        monoFont = cs.getPropertyValue("--font-monospace").trim();
      } catch (e) {}

      // Font is already set on printEl (in renderMarkdown), this is a JS fallback
      await this.webview!.executeJavaScript(makeWebviewJs(doc, textFont, interfaceFont, monoFont));

      // Inject patch styles
      for (const css of getPatchStyle()) {
        await (this.webview as any).insertCSS(css);
      }

      // Force user font on webview body (after all CSS injection)
      try {
        const basePath = (this.pluginApp.vault.adapter as any).basePath;
        const appearance = JSON.parse(await readFile(basePath + "/.obsidian/appearance.json", "utf-8"));
        const userFont = appearance.textFontFamily || "";
        if (userFont) {
          await this.webview!.executeJavaScript(
            `document.body.style.setProperty("font-family", ${JSON.stringify(userFont)}, "important");
             document.querySelectorAll(".markdown-preview-view,.markdown-rendered,p,li,td,th,a,span,blockquote,code,pre,h1,h2,h3,h4,h5,h6")
               .forEach(el => el.style.setProperty("font-family", ${JSON.stringify(userFont)}, "important"));`
          );
        }
      } catch (e) {
        console.warn("Font injection failed:", e);
      }

      await sleep(500);

      // Measure actual content height and the webview's inner width.
      // The webview has a 1px border, so innerWidth may be slightly less than
      // A4_WIDTH_PX.  printToPDF renders at A4_WIDTH_PX, meaning the content
      // is a tiny bit wider and thus shorter (less line-wrapping).  We must
      // compensate by scaling the measured height by innerWidth/A4_WIDTH_PX.
      const { bodyHeight, innerWidth } = await this.webview!.executeJavaScript(`
        (function() {
          var orig = document.body.style.height;
          document.body.style.height = 'auto';
          var h = document.body.scrollHeight;
          var w = window.innerWidth;
          document.body.style.height = orig;
          return { bodyHeight: h, innerWidth: w };
        })()
      `);

      const widthRatio = (innerWidth || A4_WIDTH_PX) / A4_WIDTH_PX;
      const contentHeightMm = (bodyHeight / PX_PER_INCH) * MM_PER_INCH * widthRatio;

      // printToPDF renders content with a slight vertical offset compared to
      // the webview (~11mm top + ~11mm bottom).  Add this so the content fits.
      const PDF_HEIGHT_OFFSET = 22;
      const pageHeightMm = contentHeightMm + PDF_HEIGHT_OFFSET;

      this.dimensions = {
        width: A4_WIDTH_MM,
        height: pageHeightMm,
      };

      // Scale webview to fit scroll area width
      const containerWidth = scrollArea.offsetWidth;
      const scale = Math.min(containerWidth / A4_WIDTH_PX, 1);
      this.webview!.style.transform = `scale(${scale})`;
      this.webview!.style.height = `${bodyHeight}px`;
      webviewWrapper.style.height = `${Math.ceil(bodyHeight * scale)}px`;

      dimValue.setText(`${this.dimensions.width}×${this.dimensions.height}mm\n${A4_WIDTH_PX}×${bodyHeight}px`);
      this.statusEl.setText(`${this.i18n.a4Width}: ${A4_WIDTH_MM}mm | ${this.i18n.contentHeight}: ${this.i18n.auto}`);
      this.exportBtn.disabled = false;
    } catch (error) {
      console.error("Render error:", error);
      this.statusEl.setText(`Error: ${error}`);
      new Notice(this.i18n.renderError);
    }
  }

  async handleExport() {
    if (!this.webview || this.dimensions.height === 0) {
      new Notice(this.i18n.contentNotReady);
      return;
    }

    const title = this.file.basename;
    const result = await (electron as any).remote.dialog.showSaveDialog({
      title: "Export to PDF",
      defaultPath: title + ".pdf",
      filters: [
        { name: "PDF", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["showOverwriteConfirmation", "createDirectory"],
    });

    if (result.canceled || !result.filePath) return;

    this.exportBtn!.textContent = this.i18n.exporting;
    this.exportBtn!.disabled = true;

    try {
      await exportToPDF(result.filePath, this.webview, A4_WIDTH_MM, this.dimensions.height);
      new Notice(`PDF exported: ${result.filePath}`);
      (electron as any).remote.shell.openPath(result.filePath);
      this.close();
    } catch (error) {
      console.error("Export error:", error);
      new Notice(`${this.i18n.exportFailed}: ${error}`);
      this.exportBtn!.textContent = this.i18n.exportPdf;
      this.exportBtn!.disabled = false;
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
