import { MarkdownView, Plugin, TFile } from "obsidian";
import { ExportPdfModal } from "./pdf";
import { PdfSettingTab } from "./settings";
import { getLang } from "./i18n";
import { type PageSettings, DEFAULT_SETTINGS } from "./model";

export default class PdfNoPageBreakPlugin extends Plugin {
  settings: PageSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    const i18n = getLang();

    this.addSettingTab(new PdfSettingTab(this.app, this));

    this.addCommand({
      id: "export-current-file-to-pdf",
      name: i18n.exportCurrentFile,
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) return false;
        if (checking) return true;
        new ExportPdfModal(this.app, file, this.settings.pageWidthMm).open();
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
                new ExportPdfModal(this.app, file, this.settings.pageWidthMm).open();
              });
          });
        }
      }),
    );
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as Partial<PageSettings> | undefined;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // The declarative settings dropdown persists strings; normalize to number
    const width = Number(this.settings.pageWidthMm);
    if (Number.isFinite(width)) this.settings.pageWidthMm = width;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
