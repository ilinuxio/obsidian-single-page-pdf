import { App, Modal, Notice, TFile } from "obsidian";
import { getLang, type Lang } from "./i18n";
import electron from "electron";
import { writeFile } from "fs/promises";
import { getAllStyles, getPatchStyle } from "./styles";
import { renderMarkdown, makeWebviewJs, mmToPx, MM_PER_INCH, PX_PER_INCH, sleep } from "./render";
import { validateFilePath, validatePdfData, validatePdfExtension, sanitizeFilename, countPdfPages } from "./validate";
import { PAGE_WIDTH_MIN, PAGE_WIDTH_MAX } from "./model";
import type { WebviewElement, PrintOptions, Dimensions, Measurement, ElectronRemote, WebviewConsoleMessageEvent } from "./model";

// ── Create Webview ───────────────────────────────────────

function createWebview(pageWidthPx: number): WebviewElement {
  const webview = createEl("webview" as keyof HTMLElementTagNameMap) as unknown as WebviewElement;
  webview.src = "app://obsidian.md/help.html";
  webview.className = "pdf-npb-webview";
  webview.setAttribute(
    "style",
    `width:${pageWidthPx}px;height:100%;display:flex;flex-direction:column;
     transform-origin:top left;border:1px solid var(--background-modifier-border);`,
  );

  // Security: Disable node integration
  webview.setAttribute("nodeintegration", "false");
  webview.setAttribute("nodeintegrationinsubframes", "false");

  return webview;
}

// ── Helper: Get Electron Remote ──────────────────────────

function getRemote(): ElectronRemote {
  const remote = (electron as unknown as { remote?: ElectronRemote }).remote;
  if (!remote) {
    throw new Error("Electron remote not available");
  }
  return remote;
}

// ── Page Height Safety Margin ────────────────────────────
// The printed layout can be slightly taller than the measured one (trailing
// leading, image scaling), so the page is printed a little taller than the
// content. If the export still spills onto a second page, it is retried with
// a larger margin before giving up.
const DEFAULT_SLACK_MM = 8;
const PAGE_HEIGHT_SLACK_MM = [DEFAULT_SLACK_MM, 48, 256, 1024];

// Chromium refuses a print page taller than 65536 PDF points (2^16 pt =
// 910.22in = 23119.6mm) with "Printing failed" — it does not clamp or split,
// the whole export fails. Verified on Electron 43 (Obsidian 1.13.x):
// 65534pt prints, 65537pt fails. Keep a small margin below the hard limit.
const MAX_PAGE_HEIGHT_MM = 23100;

// ── Build Print Options ──────────────────────────────────

function buildPrintOptions(
  measurement: Measurement,
  pageWidthPx: number,
  slackMm: number,
): PrintOptions {
  // Print the page at the guest's measured CSS pixel width, not at the width
  // in mm: mmToPx() rounds, and a print layout narrower than the measured one
  // re-wraps the text and makes it taller than the page.
  const pageWidthPxActual = measurement.innerWidth > 0 ? measurement.innerWidth : pageWidthPx;
  const slackPx = (slackMm / MM_PER_INCH) * PX_PER_INCH;

  return {
    pageSize: {
      width: pageWidthPxActual / PX_PER_INCH,
      height: (measurement.bodyHeight + slackPx) / PX_PER_INCH,
    },
    scale: 1,
    // printToPDF() ignores margins.marginType and then falls back to its
    // default margins (0.4in on every side). Those shrink the printable area
    // below the page size, which pushes the end of the document onto a
    // second page.
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    printBackground: true,
    displayHeaderFooter: false,
  };
}

// ── Export PDF ───────────────────────────────────────────

async function exportToPDF(
  outputFile: string,
  webview: WebviewElement,
  measurement: Measurement,
  pageWidthPx: number,
): Promise<number> {
  // Validate output path
  const pathResult = validateFilePath(outputFile);
  if (!pathResult.valid) {
    throw new Error(`Invalid output path: ${pathResult.error}`);
  }

  if (!validatePdfExtension(outputFile)) {
    throw new Error("Output file must have .pdf extension");
  }

  // Use webview.printToPDF() directly (Electron >= 28)
  const printToPDF = webview.printToPDF?.bind(webview);
  if (!printToPDF) {
    throw new Error("printToPDF is not available on this webview");
  }

  // Print, then verify that everything landed on one page. The printed layout
  // can be taller than the measured one, in which case the page size is
  // increased and the export retried.
  let data: Uint8Array = new Uint8Array(0);
  let pages = 0;
  for (const slackMm of PAGE_HEIGHT_SLACK_MM) {
    data = await printToPDF(buildPrintOptions(measurement, pageWidthPx, slackMm));
    pages = countPdfPages(data);
    if (pages <= 1) break;
  }

  // Validate generated PDF
  const pdfResult = validatePdfData(data);
  if (!pdfResult.valid) {
    throw new Error(`Generated PDF is invalid: ${pdfResult.error}`);
  }

  // Save file
  await writeFile(outputFile, data);

  return pages;
}

// ── Export Modal ─────────────────────────────────────────

export class ExportPdfModal extends Modal {
  private file: TFile;
  private pluginApp: App;
  private webview?: WebviewElement;
  private statusEl?: HTMLDivElement;
  private warnEl?: HTMLDivElement;
  private exportBtn?: HTMLButtonElement;
  private dimensions: Dimensions = { width: 0, height: 0 };
  private i18n: Lang;
  private currentWidthMm: number;
  private currentWidthPx: number;
  private widthChangeTimer: number = 0;
  private viewHeightPx: number = 0;
  private wheelHandler?: (e: WheelEvent) => void;
  private dragMoveHandler?: (e: MouseEvent) => void;
  private dragUpHandler?: (e: MouseEvent) => void;

  constructor(app: App, file: TFile, defaultWidthMm: number) {
    super(app);
    this.pluginApp = app;
    this.file = file;
    this.i18n = getLang();
    this.currentWidthMm = defaultWidthMm;
    this.currentWidthPx = mmToPx(defaultWidthMm);
  }

  /** Measure the guest page content height and inner width */
  private async measureGuest(): Promise<Measurement> {
    return this.webview!.executeJavaScript<Measurement>(`
      (function() {
        var orig = document.body.style.height;
        document.body.style.height = 'auto';
        var h = document.body.scrollHeight;
        var w = window.innerWidth;
        document.body.style.height = orig;
        return { bodyHeight: h, innerWidth: w };
      })()
    `);
  }

  /** Warn in the preview when the content is too tall to print on one page */
  private updateTootallWarning(contentHeightMm: number): void {
    if (!this.warnEl) return;
    const tooTall = contentHeightMm + DEFAULT_SLACK_MM > MAX_PAGE_HEIGHT_MM;
    this.warnEl.toggleClass("is-visible", tooTall);
    if (tooTall) {
      this.warnEl.setText(
        this.i18n.tooTallWarning
          .replace("{height}", String(Math.round(contentHeightMm)))
          .replace("{limit}", String(MAX_PAGE_HEIGHT_MM)),
      );
    }
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

    // Custom scrollbar overlay (the guest scrolls internally; this mirrors it)
    const scrollbar = scrollArea.createDiv({ cls: "pdf-npb-custom-scrollbar" });
    const thumb = scrollbar.createDiv({ cls: "pdf-npb-custom-scrollbar-thumb" });

    this.warnEl = previewArea.createDiv({ cls: "pdf-npb-warning" });

    this.statusEl = previewArea.createDiv({ cls: "pdf-npb-status" });
    this.statusEl.setText(this.i18n.rendering);

    // ── Right: Controls ──
    const controls = wrapper.createDiv({ cls: "pdf-npb-controls" });
    controls.createDiv({ cls: "pdf-npb-file-info", text: `📄 ${this.file.basename}` });

    // ── Width controls (frozen during render) ──
    const PRESETS = [
      { label: "A6", width: 105 },
      { label: "A5", width: 148 },
      { label: "A4", width: 210 },
      { label: "A3", width: 297 },
      { label: "A2", width: 420 },
      { label: "A1", width: 594 },
    ];

    const widthContainer = controls.createDiv({ cls: "pdf-npb-width-slider" });
    const widthLabel = widthContainer.createDiv({ cls: "pdf-npb-width-label" });
    widthLabel.setText(`${this.i18n.width}: ${this.currentWidthMm}mm`);

    const sliderInput = widthContainer.createEl("input", {
      type: "range",
      attr: {
        min: String(PAGE_WIDTH_MIN),
        max: String(PAGE_WIDTH_MAX),
        step: "1",
        value: String(this.currentWidthMm),
      },
    });
    sliderInput.className = "pdf-npb-slider";
    sliderInput.disabled = true;

    // Preset buttons (frozen)
    const presetsRow = widthContainer.createDiv({ cls: "pdf-npb-presets" });
    const presetBtns: Record<number, HTMLButtonElement> = {};

    const setActivePreset = (width: number): void => {
      for (const [w, btn] of Object.entries(presetBtns)) {
        btn.toggleClass("is-active", Number(w) === width);
      }
    };

    for (const preset of PRESETS) {
      const btn = presetsRow.createEl("button", {
        cls: "pdf-npb-preset-btn",
        text: preset.label,
      });
      btn.disabled = true;
      presetBtns[preset.width] = btn;
    }

    // Initial active state
    const initialPreset = PRESETS.find((p) => p.width === this.currentWidthMm);
    if (initialPreset) {
      presetBtns[initialPreset.width]?.toggleClass("is-active", true);
    }

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

      this.webview = createWebview(this.currentWidthPx);

      // Fallback: if wheel events land on the embedder (over the preview
      // area, or when input routing skips the webview), drive the guest
      // scroll directly. Document-level capture so nothing above can
      // swallow the event before us. Removed in onClose().
      this.wheelHandler = (e: WheelEvent): void => {
        const t = e.target as HTMLElement | null;
        if (t?.closest(".pdf-npb-preview") == null || !this.webview) return;
        const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY;
        void this.webview.executeJavaScript(`(function(){ window.scrollBy(0, ${d}); return window.scrollY; })()`);
      };
      document.addEventListener("wheel", this.wheelHandler, true);

      // ── Custom scrollbar: mirror the guest scroll position ──
      // The guest reports via document.title; this listens for
      // "page-title-updated" and positions the overlay thumb.
      let lastScroll = { y: 0, sh: 0, ch: 0 };
      let rafPending = false;
      let pendingScrollTo = 0;

      const updateThumb = (y: number, sh: number, ch: number): void => {
        lastScroll = { y, sh, ch };
        const scrollable = sh > ch + 1;
        scrollbar.toggleClass("is-visible", scrollable);
        if (!scrollable) return;
        const trackH = scrollbar.clientHeight;
        const thumbH = Math.max(24, (ch / sh) * trackH);
        const maxTop = trackH - thumbH;
        const top = Math.min(maxTop, (y / Math.max(1, sh - ch)) * maxTop);
        thumb.style.height = `${thumbH}px`;
        thumb.style.top = `${top}px`;
      };

      const scrollGuestTo = (y: number): void => {
        pendingScrollTo = y;
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(() => {
          rafPending = false;
          void this.webview!.executeJavaScript(`window.scrollTo(0, ${pendingScrollTo})`);
        });
      };

      this.webview.addEventListener("console-message", (event) => {
        const msg = (event as WebviewConsoleMessageEvent).message;
        if (typeof msg !== "string" || !msg.startsWith("__npb_scroll__")) return;
        const parts = msg.slice("__npb_scroll__".length).split("|");
        const y = Number(parts[0]);
        const sh = Number(parts[1]);
        const ch = Number(parts[2]);
        if (Number.isFinite(y) && Number.isFinite(sh) && Number.isFinite(ch)) updateThumb(y, sh, ch);
      });

      const positionFromMouse = (e: MouseEvent): number => {
        const rect = scrollbar.getBoundingClientRect();
        const thumbH = thumb.offsetHeight;
        const maxTop = Math.max(1, rect.height - thumbH);
        const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top - thumbH / 2) / maxTop));
        return ratio * Math.max(0, lastScroll.sh - lastScroll.ch);
      };

      // Click on the track: jump to that position
      scrollbar.addEventListener("mousedown", (e) => {
        if (e.target !== scrollbar) return;
        e.preventDefault();
        scrollGuestTo(positionFromMouse(e));
      });

      // Drag the thumb
      thumb.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        scrollbar.addClass("is-dragging");
        const startY = e.clientY;
        const startScroll = lastScroll.y;
        const range = Math.max(1, lastScroll.sh - lastScroll.ch);
        const maxTop = Math.max(1, scrollbar.clientHeight - thumb.offsetHeight);

        this.dragMoveHandler = (ev: MouseEvent): void => {
          const delta = ((ev.clientY - startY) / maxTop) * range;
          scrollGuestTo(startScroll + delta);
        };
        this.dragUpHandler = (): void => {
          scrollbar.removeClass("is-dragging");
          document.removeEventListener("mousemove", this.dragMoveHandler!);
          document.removeEventListener("mouseup", this.dragUpHandler!);
          this.dragMoveHandler = undefined;
          this.dragUpHandler = undefined;
        };
        document.addEventListener("mousemove", this.dragMoveHandler);
        document.addEventListener("mouseup", this.dragUpHandler);
      });

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
      let monoFont = "";
      try {
        const cs = getComputedStyle(document.body);
        textFont = cs.getPropertyValue("--font-text").trim();
        monoFont = cs.getPropertyValue("--font-monospace").trim();
      } catch {
        // CSS variables not available
      }

      // Font is already set on printEl (in renderMarkdown), this is a JS fallback
      await this.webview.executeJavaScript(makeWebviewJs(doc, textFont, monoFont));

      // Inject patch styles
      for (const css of getPatchStyle()) {
        await this.webview.insertCSS(css);
      }

      await sleep(500);

      // Measure actual content height and the webview's inner width.
      const measurement = await this.measureGuest();

      const widthRatio = (measurement.innerWidth || this.currentWidthPx) / this.currentWidthPx;
      const contentHeightMm = (measurement.bodyHeight / PX_PER_INCH) * MM_PER_INCH * widthRatio;

      // Page height = content height + the default safety margin used on export
      const pageHeightMm = contentHeightMm + DEFAULT_SLACK_MM;

      this.dimensions = {
        width: this.currentWidthMm,
        height: pageHeightMm,
      };

      this.updateTootallWarning(contentHeightMm);

      // ── Shared pipeline: measure → update dimensions → scale preview → display ──
      const measureAndUpdate = async (): Promise<void> => {
        const m = await this.measureGuest();

        const ratio = (m.innerWidth || this.currentWidthPx) / this.currentWidthPx;
        const cHeightMm = (m.bodyHeight / PX_PER_INCH) * MM_PER_INCH * ratio;
        this.dimensions = {
          width: this.currentWidthMm,
          height: cHeightMm + DEFAULT_SLACK_MM,
        };

        this.updateTootallWarning(cHeightMm);

        // Scale webview to fit scroll area width.
        // The webview is sized taller than the viewport by 1/s so that,
        // after the transform scale, the preview fills the whole area
        // (otherwise a blank strip remains below at scales < 1).
        const cw = scrollArea.offsetWidth;
        const s = Math.min(cw / this.currentWidthPx, 1);
        const viewH = scrollArea.clientHeight;
        const webviewH = Math.ceil(viewH / s);
        this.viewHeightPx = webviewH;
        this.webview!.style.transform = `scale(${s})`;
        this.webview!.style.height = `${webviewH}px`;
        webviewWrapper.style.height = `${viewH}px`;

        dimValue.setText(`${this.dimensions.width}×${Math.round(this.dimensions.height)}mm\n${this.currentWidthPx}×${m.bodyHeight}px`);
        this.statusEl!.setText(`${this.i18n.width}: ${this.currentWidthMm}mm | ${this.i18n.contentHeight}: ${this.i18n.auto}`);

        // Reflow changed the guest metrics; ask it to re-report for the scrollbar
        void this.webview!.executeJavaScript(`window.dispatchEvent(new Event("scroll"))`);
      };

      // ── Enable width controls (DOM already created, frozen during render) ──
      sliderInput.disabled = false;

      sliderInput.addEventListener("input", () => {
        const value = parseInt(sliderInput.value, 10);
        this.currentWidthMm = value;
        this.currentWidthPx = mmToPx(value);
        widthLabel.setText(`${this.i18n.width}: ${value}mm`);
        setActivePreset(
          PRESETS.find((p) => p.width === value)?.width ?? -1,
        );

        window.clearTimeout(this.widthChangeTimer);
        this.widthChangeTimer = window.setTimeout(() => {
          void (async () => {
            try {
              this.webview!.style.width = `${this.currentWidthPx}px`;
              await sleep(150);
              await measureAndUpdate();
            } catch (err) {
              console.error("Remeasure error:", err);
            }
          })();
        }, 300);
      });

      // Enable preset buttons + bind click handlers
      for (const [width, btn] of Object.entries(presetBtns)) {
        btn.disabled = false;
        const w = Number(width);
        btn.addEventListener("click", () => {
          if (this.currentWidthMm === w) return;
          this.currentWidthMm = w;
          this.currentWidthPx = mmToPx(w);
          sliderInput.value = String(w);
          widthLabel.setText(`${this.i18n.width}: ${w}mm`);
          setActivePreset(w);

          window.clearTimeout(this.widthChangeTimer);
          this.widthChangeTimer = window.setTimeout(() => {
            void (async () => {
              try {
                this.webview!.style.width = `${this.currentWidthPx}px`;
                await sleep(150);
                await measureAndUpdate();
              } catch (err) {
                console.error("Remeasure error:", err);
              }
            })();
          }, 100);
        });
      }

      // Initial preview setup
      {
        const cw = scrollArea.offsetWidth;
        const s = Math.min(cw / this.currentWidthPx, 1);
        const viewH = scrollArea.clientHeight;
        const webviewH = Math.ceil(viewH / s);
        this.viewHeightPx = webviewH;
        this.webview.style.transform = `scale(${s})`;
        this.webview.style.height = `${webviewH}px`;
        webviewWrapper.style.height = `${viewH}px`;

        dimValue.setText(`${this.dimensions.width}×${Math.round(this.dimensions.height)}mm\n${this.currentWidthPx}×${measurement.bodyHeight}px`);
        this.statusEl.setText(`${this.i18n.width}: ${this.currentWidthMm}mm | ${this.i18n.contentHeight}: ${this.i18n.auto}`);

        // Re-report the guest metrics now that the webview is sized
        void this.webview.executeJavaScript(`window.dispatchEvent(new Event("scroll"))`);
      }

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

    // Chromium cannot print a page past MAX_PAGE_HEIGHT_MM at all — the same
    // message is shown in the preview, so don't start a doomed export.
    if (this.dimensions.height > MAX_PAGE_HEIGHT_MM) {
      new Notice(
        this.i18n.tooTallWarning
          .replace("{height}", String(Math.round(this.dimensions.height - DEFAULT_SLACK_MM)))
          .replace("{limit}", String(MAX_PAGE_HEIGHT_MM)),
      );
      return;
    }

    const title = sanitizeFilename(this.file.basename);

    this.exportBtn!.textContent = this.i18n.exporting;
    this.exportBtn!.disabled = true;

    try {
      // 1. Show system save dialog via remote
      const remote = getRemote();
      const result = await remote.dialog.showSaveDialog({
        title: this.i18n.exportTitle,
        defaultPath: `${title}.pdf`,
        filters: [
          { name: "PDF", extensions: ["pdf"] },
          { name: "All Files", extensions: ["*"] },
        ],
        properties: ["showOverwriteConfirmation", "createDirectory"],
      });

      if (result.canceled || !result.filePath) {
        this.exportBtn!.textContent = this.i18n.exportPdf;
        this.exportBtn!.disabled = false;
        return;
      }

      // 2. Validate selected path
      const pathResult = validateFilePath(result.filePath);
      if (!pathResult.valid) {
        new Notice(`Invalid path: ${pathResult.error}`);
        this.exportBtn!.textContent = this.i18n.exportPdf;
        this.exportBtn!.disabled = false;
        return;
      }

      if (!validatePdfExtension(result.filePath)) {
        new Notice("Please select a PDF file");
        this.exportBtn!.textContent = this.i18n.exportPdf;
        this.exportBtn!.disabled = false;
        return;
      }

      // 3. Export PDF
      // Restore the full content height so the print viewport matches the
      // original design (webview as tall as the document) during printing.
      const exportMeasure = await this.measureGuest();
      this.webview.style.height = `${exportMeasure.bodyHeight}px`;
      await sleep(100);

      let pages: number;
      try {
        pages = await exportToPDF(result.filePath, this.webview, exportMeasure, this.currentWidthPx);
      } finally {
        this.webview.style.height = `${this.viewHeightPx}px`;
      }

      // 4. Success notification (or a warning when the content did not fit)
      if (pages > 1) {
        new Notice(this.i18n.multiPageWarning.replace("{count}", String(pages)), 10000);
      } else {
        new Notice(`PDF exported: ${result.filePath}`);
      }

      // 5. Open the exported file
      await remote.shell.openPath(result.filePath);

      // 6. Close modal
      this.close();
    } catch (error) {
      console.error("Export error:", error);
      new Notice(`${this.i18n.exportFailed}: ${String(error)}`);
      this.exportBtn!.textContent = this.i18n.exportPdf;
      this.exportBtn!.disabled = false;
    }
  }

  onClose(): void {
    if (this.wheelHandler) {
      document.removeEventListener("wheel", this.wheelHandler, true);
      this.wheelHandler = undefined;
    }
    if (this.dragMoveHandler) {
      document.removeEventListener("mousemove", this.dragMoveHandler);
      this.dragMoveHandler = undefined;
    }
    if (this.dragUpHandler) {
      document.removeEventListener("mouseup", this.dragUpHandler);
      this.dragUpHandler = undefined;
    }
    this.contentEl.empty();
  }
}
