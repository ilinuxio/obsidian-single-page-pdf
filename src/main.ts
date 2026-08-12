import { MarkdownView, Plugin, TFile } from "obsidian";
import { ExportPdfModal } from "./pdf";
import { PdfSettingTab } from "./settings";
import { getLang } from "./i18n";
import { PRELOAD_SCRIPT } from "./preload-content";
import { type PageSettings, DEFAULT_SETTINGS } from "./model";

export default class PdfNoPageBreakPlugin extends Plugin {
  settings: PageSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    const i18n = getLang();

    // Write preload script via vault adapter (avoids direct fs usage)
    const preloadPath = await this.writePreloadScript();

    this.addSettingTab(new PdfSettingTab(this.app, this));

    this.addCommand({
      id: "export-current-file-to-pdf",
      name: i18n.exportCurrentFile,
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) return false;
        if (checking) return true;
        new ExportPdfModal(this.app, file, preloadPath, this.settings.pageWidthMm).open();
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
                new ExportPdfModal(this.app, file, preloadPath, this.settings.pageWidthMm).open();
              });
          });
        }
      }),
    );
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as Partial<PageSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async writePreloadScript(): Promise<string> {
    // Write to plugin directory using Obsidian's vault adapter (no raw fs)
    const preloadRelPath = `${this.app.vault.configDir}/plugins/single-page-pdf/preload.js`;
    try {
      await this.app.vault.adapter.write(preloadRelPath, PRELOAD_SCRIPT);
    } catch {
      // Plugin directory already writable on desktop; ignore write errors
    }
    return `${this.manifest.dir}/preload.js`;
  }
}
