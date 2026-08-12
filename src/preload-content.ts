// This file contains the preload script as a string constant
// It will be written to a temp file at runtime

export const PRELOAD_SCRIPT = `
const { contextBridge, ipcRenderer } = require("electron");

// ── Request-Response Pattern ─────────────────────────────

let requestId = 0;
const pendingRequests = new Map();

// Listen for responses from parent renderer
ipcRenderer.on("pdf-exporter-response", (_event, { id, result, error }) => {
  const resolve = pendingRequests.get(id);
  if (resolve) {
    pendingRequests.delete(id);
    if (error) {
      resolve(Promise.reject(new Error(error)));
    } else {
      resolve(result);
    }
  }
});

// ── Validation Helpers ───────────────────────────────────

const PDF_HEADER = "25504446"; // %PDF

function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  if (filePath.includes("..")) return false;
  if (filePath.includes("\\0")) return false;
  return true;
}

function validatePdfData(data) {
  if (!data || data.byteLength === 0) return false;
  const bytes = new Uint8Array(data);
  const header = Array.from(bytes.slice(0, 5))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return header.startsWith(PDF_HEADER);
}

function validatePrintOptions(options) {
  if (!options || typeof options !== "object") return false;
  if (options.pageSize && typeof options.pageSize === "object") {
    if (typeof options.pageSize.width === "number" && options.pageSize.width <= 0) return false;
    if (typeof options.pageSize.height === "number" && options.pageSize.height <= 0) return false;
  }
  return true;
}

// ── Helper: Send request and wait for response ───────────

function sendRequest(channel, data) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pendingRequests.set(id, (result) => {
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    });
    ipcRenderer.sendToHost("pdf-exporter-request", { id, channel, data });
  });
}

// ── Expose Safe API ──────────────────────────────────────

contextBridge.exposeInMainWorld("pdfExporter", {
  showSaveDialog: (options) => sendRequest("show-save-dialog", options),

  savePdfToPath: (filePath, data) => {
    if (!validateFilePath(filePath)) {
      return Promise.reject(new Error("Invalid file path"));
    }
    if (!validatePdfData(data)) {
      return Promise.reject(new Error("Invalid PDF format"));
    }
    return sendRequest("save-pdf-to-path", { filePath, data });
  },

  openPath: (filePath) => {
    if (!validateFilePath(filePath)) {
      return Promise.reject(new Error("Invalid file path"));
    }
    return sendRequest("open-path", { filePath });
  },

  printToPdf: (options) => {
    if (!validatePrintOptions(options)) {
      return Promise.reject(new Error("Invalid print options"));
    }
    return sendRequest("print-to-pdf", options);
  },
});
`;
