import { MarkdownView, Plugin, TFile } from "obsidian";
import { ExportPdfModal } from "./pdf";
import { getLang } from "./i18n";
import { PRELOAD_SCRIPT } from "./preload-content";
import path from "path";
import fs from "fs";
import os from "os";

export default class PdfNoPageBreakPlugin extends Plugin {
  private preloadPath: string = "";

  async onload() {
    const i18n = getLang();

    // Write preload script to temp file
    this.preloadPath = await this.writePreloadScript();

    this.addCommand({
      id: "export-current-file-to-pdf",
      name: i18n.exportCurrentFile,
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) return false;
        if (checking) return true;
        new ExportPdfModal(this.app, file, this.preloadPath).open();
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle(i18n.exportFileMenu)
              .setIcon("download")
              .setSection("action")
              .onClick(async () => {
                new ExportPdfModal(this.app, file, this.preloadPath).open();
              });
          });
        }
      }),
    );
  }

  onunload() {
    // Clean up temp preload file
    this.cleanupPreloadScript();
  }

  private async writePreloadScript(): Promise<string> {
    const tempDir = path.join(os.tmpdir(), "obsidian-single-page-pdf");
    const preloadPath = path.join(tempDir, "preload.js");

    try {
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Write preload script
      fs.writeFileSync(preloadPath, PRELOAD_SCRIPT, "utf-8");

      return preloadPath;
    } catch (error) {
      console.error("Failed to write preload script:", error);
      // Fallback: try to use the plugin directory
      return path.join(this.manifest.dir || "", "preload.js");
    }
  }

  private cleanupPreloadScript(): void {
    try {
      if (this.preloadPath && fs.existsSync(this.preloadPath)) {
        fs.unlinkSync(this.preloadPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
