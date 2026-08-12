import { PluginSettingTab, Setting } from "obsidian";
import type { Plugin } from "obsidian";
import { getLang } from "./i18n";
import { PAGE_WIDTH_MIN, PAGE_WIDTH_MAX } from "./model";
import type PdfNoPageBreakPlugin from "./main";

const PRESETS = [
  { label: "A6", width: 105 },
  { label: "A5", width: 148 },
  { label: "A4", width: 210 },
  { label: "A3", width: 297 },
  { label: "A2", width: 420 },
  { label: "A1", width: 594 },
];

export class PdfSettingTab extends PluginSettingTab {
  private plugin: PdfNoPageBreakPlugin;

  constructor(app: Plugin["app"], plugin: PdfNoPageBreakPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const i18n = getLang();
    containerEl.empty();
    containerEl.addClass("pdf-npb-settings-tab");

    let sliderRef: { setValue: (v: number) => void } | null = null;

    new Setting(containerEl)
      .setName(i18n.pageWidth)
      .setDesc(i18n.pageWidthDesc)
      .addSlider((slider) => {
        sliderRef = { setValue: (v: number) => { slider.setValue(v); } };
        slider
          .setLimits(PAGE_WIDTH_MIN, PAGE_WIDTH_MAX, 1)
          .setValue(this.plugin.settings.pageWidthMm)
          .onChange((value) => {
            this.plugin.settings.pageWidthMm = value;
            void this.plugin.saveSettings().then(() => {
              updateActivePreset(value);
            });
          });
      });

    // Preset buttons
    const presetsRow = containerEl.createDiv({ cls: "pdf-npb-presets" });
    const presetBtns: Map<number, HTMLElement> = new Map();

    const updateActivePreset = (width: number): void => {
      presetBtns.forEach((btn, w) => btn.toggleClass("is-active", w === width));
    };

    for (const preset of PRESETS) {
      const btn = presetsRow.createEl("button", {
        cls: "pdf-npb-preset-btn",
        text: preset.label,
      });
      presetBtns.set(preset.width, btn);

      btn.addEventListener("click", () => {
        this.plugin.settings.pageWidthMm = preset.width;
        void this.plugin.saveSettings().then(() => {
          sliderRef?.setValue(preset.width);
          updateActivePreset(preset.width);
        });
      });
    }

    // Initial active state
    updateActivePreset(this.plugin.settings.pageWidthMm);
  }
}
