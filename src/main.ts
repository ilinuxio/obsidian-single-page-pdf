import { MarkdownView, Plugin, TFile } from "obsidian";
import { ExportPdfModal } from "./pdf";
import { getLang } from "./i18n";

export default class PdfNoPageBreakPlugin extends Plugin {
  async onload() {
    const i18n = getLang();

    this.addCommand({
      id: "export-current-file-to-pdf",
      name: i18n.exportCurrentFile,
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        const file = view?.file;
        if (!file) return false;
        if (checking) return true;
        new ExportPdfModal(this.app, file).open();
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
                new ExportPdfModal(this.app, file).open();
              });
          });
        }
      }),
    );
  }

  onunload() {}
}
