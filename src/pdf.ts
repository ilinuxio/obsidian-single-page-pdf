import { App, Modal, Notice, TFile } from "obsidian";
import { getLang, type Lang } from "./i18n";
import electron from "electron";
import { writeFile } from "fs/promises";
import { getAllStyles, getPatchStyle } from "./styles";
import { renderMarkdown, makeWebviewJs, A4_WIDTH_PX, A4_WIDTH_MM, MM_PER_INCH, PX_PER_INCH, sleep } from "./render";
import type { WebviewElement, WebviewWindow, PrintOptions, Dimensions, Measurement } from "./model";

// ── Create Webview ───────────────────────────────────────

function createWebview(): WebviewElement {
  const webview = createEl("webview" as keyof HTMLElementTagNameMap) as unknown as WebviewElement;
  webview.src = "app://obsidian.md/help.html";
  webview.className = "pdf-npb-webview";
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
  webview: WebviewElement,
  pageWidthMm: number,
  pageHeightMm: number,
): Promise<void> {
  const printOptions: PrintOptions = {
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
  const win = (webview as unknown as { win?: WebviewWindow }).win;
  const ipc = win?.electron?.ipcRenderer;
  if (ipc) {
    const data = await new Promise<Uint8Array>((resolve) => {
      ipc.once("print-to-pdf", (_event: unknown, result: Uint8Array) => resolve(result));
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
  private webview?: WebviewElement;
  private statusEl?: HTMLDivElement;
  private exportBtn?: HTMLButtonElement;
  private dimensions: Dimensions = { width: 0, height: 0 };
  private i18n: Lang;

  constructor(app: App, file: TFile) {
    super(app);
    this.pluginApp = app;
    this.file = file;
    this.i18n = getLang();
  }

  async onOpen(): Promise<void> {
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
    controls.createDiv({ cls: "pdf-npb-file-info", text: `📄 ${this.file.basename}` });

    const dimEl = controls.createDiv({ cls: "pdf-npb-dimensions" });
    dimEl.createDiv({ text: this.i18n.pageDimensions });
    const dimValue = dimEl.createDiv({ cls: "pdf-npb-dim-value" });
    dimValue.setText(this.i18n.measuring);

    const btnWrapper = controls.createDiv({ cls: "pdf-npb-btn-wrapper" });
    this.exportBtn = btnWrapper.createEl("button", {
      cls: "pdf-npb-export-btn mod-cta",
      text: this.i18n.exportPdf,
    });
    this.exportBtn.disabled = true;
    this.exportBtn.addEventListener("click", () => void this.handleExport());

    // ── Render & measure ──
    try {
      const { doc } = await renderMarkdown(this.pluginApp, this.file);

      this.webview = createWebview();
      webviewWrapper.appendChild(this.webview);

      // Wait for webview ready
      await new Promise<void>((resolve) => {
        const handler = (): void => {
          this.webview!.removeEventListener("dom-ready", handler);
          resolve();
        };
        this.webview!.addEventListener("dom-ready", handler);
      });

      // Inject styles
      for (const css of getAllStyles()) {
        await this.webview.insertCSS(css);
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
      } catch {
        // CSS variables not available
      }

      // Font is already set on printEl (in renderMarkdown), this is a JS fallback
      await this.webview.executeJavaScript(makeWebviewJs(doc, textFont, interfaceFont, monoFont));

      // Inject patch styles
      for (const css of getPatchStyle()) {
        await this.webview.insertCSS(css);
      }

      await sleep(500);

      // Measure actual content height and the webview's inner width.
      const measurement = await this.webview.executeJavaScript<Measurement>(`
        (function() {
          var orig = document.body.style.height;
          document.body.style.height = 'auto';
          var h = document.body.scrollHeight;
          var w = window.innerWidth;
          document.body.style.height = orig;
          return { bodyHeight: h, innerWidth: w };
        })()
      `);

      const widthRatio = (measurement.innerWidth || A4_WIDTH_PX) / A4_WIDTH_PX;
      const contentHeightMm = (measurement.bodyHeight / PX_PER_INCH) * MM_PER_INCH * widthRatio;

      // printToPDF renders content with a slight vertical offset (~11mm top + ~11mm bottom)
      const PDF_HEIGHT_OFFSET = 22;
      const pageHeightMm = contentHeightMm + PDF_HEIGHT_OFFSET;

      this.dimensions = {
        width: A4_WIDTH_MM,
        height: pageHeightMm,
      };

      // Scale webview to fit scroll area width
      const containerWidth = scrollArea.offsetWidth;
      const scale = Math.min(containerWidth / A4_WIDTH_PX, 1);
      this.webview.style.transform = `scale(${scale})`;
      this.webview.style.height = `${measurement.bodyHeight}px`;
      webviewWrapper.style.height = `${Math.ceil(measurement.bodyHeight * scale)}px`;

      dimValue.setText(`${this.dimensions.width}×${this.dimensions.height}mm\n${A4_WIDTH_PX}×${measurement.bodyHeight}px`);
      this.statusEl.setText(`${this.i18n.a4Width}: ${A4_WIDTH_MM}mm | ${this.i18n.contentHeight}: ${this.i18n.auto}`);
      this.exportBtn.disabled = false;
    } catch (error) {
      console.error("Render error:", error);
      this.statusEl.setText(`Error: ${String(error)}`);
      new Notice(this.i18n.renderError);
    }
  }

  async handleExport(): Promise<void> {
    if (!this.webview || this.dimensions.height === 0) {
      new Notice(this.i18n.contentNotReady);
      return;
    }

    const title = this.file.basename;
    const remote = (electron as unknown as { remote?: { dialog: { showSaveDialog: (options: unknown) => Promise<{ canceled: boolean; filePath?: string }> }; shell: { openPath: (path: string) => void } } }).remote;
    if (!remote) {
      new Notice("Electron remote not available");
      return;
    }

    const result = await remote.dialog.showSaveDialog({
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
      remote.shell.openPath(result.filePath);
      this.close();
    } catch (error) {
      console.error("Export error:", error);
      new Notice(`${this.i18n.exportFailed}: ${String(error)}`);
      this.exportBtn!.textContent = this.i18n.exportPdf;
      this.exportBtn!.disabled = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
