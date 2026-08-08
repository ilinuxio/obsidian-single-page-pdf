// ── Webview Types ────────────────────────────────────────

export interface WebviewElement extends HTMLElement {
  src: string;
  nodeintegration: boolean;
  insertCSS(css: string): Promise<string>;
  executeJavaScript<T = unknown>(code: string): Promise<T>;
  printToPDF?(options: PrintOptions): Promise<Uint8Array>;
}

export interface WebviewWindow {
  electron?: {
    ipcRenderer: {
      once(channel: string, listener: (event: unknown, result: Uint8Array) => void): void;
      send(channel: string, data: unknown): void;
    };
  };
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

// ── Appearance Types ─────────────────────────────────────

export interface AppearanceConfig {
  textFontFamily?: string;
}
