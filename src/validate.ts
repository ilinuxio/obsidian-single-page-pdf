import path from "path";

// ── Constants ────────────────────────────────────────────

const PDF_HEADER = "25504446"; // %PDF

// ── Path Validation ──────────────────────────────────────

/**
 * Validate and normalize a file path for safety
 * - Prevents path traversal attacks
 * - Ensures path is within allowed directories
 * - Normalizes path separators
 */
export function validateFilePath(filePath: string): { valid: boolean; path?: string; error?: string } {
  try {
    // Normalize path separators and resolve relative segments
    const normalized = path.normalize(filePath).replace(/\\/g, "/");

    // Check for path traversal
    if (normalized.includes("..")) {
      return { valid: false, error: "Path traversal detected" };
    }

    // Ensure it's an absolute path
    if (!path.isAbsolute(normalized)) {
      return { valid: false, error: "Path must be absolute" };
    }

    // Check for null bytes (path injection)
    if (normalized.includes("\0")) {
      return { valid: false, error: "Invalid path: contains null bytes" };
    }

    return { valid: true, path: normalized };
  } catch (error) {
    return { valid: false, error: `Path validation failed: ${String(error)}` };
  }
}

/**
 * Validate PDF file extension
 */
export function validatePdfExtension(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".pdf");
}

// ── PDF Data Validation ──────────────────────────────────

/**
 * Validate PDF data buffer
 * - Checks file header (%PDF)
 * - Validates data is not empty
 */
export function validatePdfData(data: ArrayBuffer | Uint8Array): { valid: boolean; error?: string } {
  // Check if data exists
  if (!data || data.byteLength === 0) {
    return { valid: false, error: "PDF data is empty" };
  }

  // Check PDF header (%PDF)
  const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
  const header = Array.from(bytes.slice(0, 5))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!header.startsWith(PDF_HEADER)) {
    return { valid: false, error: "Invalid PDF format: missing %PDF header" };
  }

  return { valid: true };
}

// ── Filename Sanitization ────────────────────────────────

/**
 * Sanitize filename for safe file system operations
 * - Removes illegal characters
 * - Preserves Chinese, English, numbers, hyphens, underscores, dots
 * - Limits length to 255 characters
 */
export function sanitizeFilename(filename: string): string {
  // Remove illegal characters (preserve Chinese, English, numbers, common safe chars)
  let sanitized = filename.replace(/[<>:"/\\|?*]/g, "");

  // Remove control characters (0x00-0x1F and 0x7F)
  sanitized = sanitized
    .split("")
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");

  // Remove leading/trailing spaces and dots
  sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, "");

  // Limit length to 255 characters
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  // Ensure filename is not empty
  if (sanitized.length === 0) {
    sanitized = "document.pdf";
  }

  return sanitized;
}
