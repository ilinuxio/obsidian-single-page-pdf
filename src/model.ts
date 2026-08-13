// ── Page Width Constants ─────────────────────────────────

export const PAGE_WIDTH_MIN = 105;   // A6
export const PAGE_WIDTH_MAX = 594;   // A1
export const PAGE_WIDTH_DEFAULT = 210; // A4

// ── Settings ──────────────────────────────────────────────

export interface PageSettings {
  pageWidthMm: number;
}

export const DEFAULT_SETTINGS: PageSettings = {
  pageWidthMm: PAGE_WIDTH_DEFAULT,
};

// ── Webview Types ────────────────────────────────────────

export interface WebviewElement extends HTMLElement {
  src: string;
  insertCSS(css: string): Promise<string>;
  executeJavaScript<T = unknown>(code: string): Promise<T>;
  printToPDF?(options: PrintOptions): Promise<Uint8Array>;
}

export interface WebviewConsoleMessageEvent extends Event {
  message: string;
}

// ── PDF Types ────────────────────────────────────────────

export interface PrintOptions {
  pageSize: { width: number; height: number };
  scale: number;
  margins: { marginType: string };
  printBackground: boolean;
  displayHeaderFooter: false;
}

export interface Dimensions {
  width: number;
  height: number;
}

// ── Measurement Types ────────────────────────────────────

export interface Measurement {
  bodyHeight: number;
  innerWidth: number;
}

// ── Electron Remote Types ────────────────────────────────

export interface ElectronRemote {
  dialog: {
    showSaveDialog: (options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      properties?: string[];
    }) => Promise<{ canceled: boolean; filePath?: string }>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
}
