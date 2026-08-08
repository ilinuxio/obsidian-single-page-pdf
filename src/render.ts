import { App, Component, MarkdownRenderer, TFile, type FrontMatterCache } from "obsidian";

// ── Constants ────────────────────────────────────────────
export const A4_WIDTH_MM = 210;
export const MM_PER_INCH = 25.4;
export const PX_PER_INCH = 96;
export const A4_WIDTH_PX = Math.round((A4_WIDTH_MM / MM_PER_INCH) * PX_PER_INCH); // ~794px

// ── Helpers ──────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function generateDocId(n: number): string {
  return Array.from({ length: n }, () => ((16 * Math.random()) | 0).toString(16)).join("");
}

function getFrontMatter(app: App, file: TFile): FrontMatterCache {
  const cache = app.metadataCache.getFileCache(file);
  return cache?.frontmatter ?? ({} as FrontMatterCache);
}

function getCssclasses(frontMatter: FrontMatterCache): string[] {
  const cssclasses: string[] = [];
  for (const [key, val] of Object.entries(frontMatter)) {
    if (key.toLowerCase() === "cssclass" || key.toLowerCase() === "cssclasses") {
      if (Array.isArray(val)) {
        cssclasses.push(...(val as string[]));
      } else {
        cssclasses.push(val as string);
      }
    }
  }
  return cssclasses;
}

/** Generate JavaScript to inject rendered HTML into webview */
export function makeWebviewJs(doc: Document, fontText: string, fontInterface: string, fontMono: string): string {
  return `
    document.body.innerHTML = decodeURIComponent(\`${encodeURIComponent(doc.body.innerHTML)}\`);
    document.head.innerHTML = decodeURIComponent(\`${encodeURIComponent(doc.head.innerHTML)}\`);

    function decodeAndReplaceEmbed(element) {
      element.innerHTML = decodeURIComponent(element.innerHTML);
      const newEmbeds = element.querySelectorAll("span.markdown-embed");
      newEmbeds.forEach(decodeAndReplaceEmbed);
    }
    document.querySelectorAll("span.markdown-embed").forEach(decodeAndReplaceEmbed);

    document.body.setAttribute("class", \`${document.body.getAttribute("class")}\`);
    document.body.setAttribute("style", \`${document.body.getAttribute("style")}\`);
    document.body.addClass("theme-light");
    document.body.removeClass("theme-dark");
    document.title = \`${doc.title}\`;

    // Apply Obsidian user fonts via inline style (highest priority)
    var _ft = ${JSON.stringify(fontText)};
    var _fi = ${JSON.stringify(fontInterface)};
    var _fm = ${JSON.stringify(fontMono)};
    if (_ft) document.body.style.setProperty("font-family", _ft, "important");
    if (_fi) document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach(function(h) {
      h.style.setProperty("font-family", _fi, "important");
    });
    if (_fm) document.querySelectorAll("code,pre,kbd,samp").forEach(function(c) {
      c.style.setProperty("font-family", _fm, "important");
    });
  `;
}

// ── Render Markdown ──────────────────────────────────────

export async function renderMarkdown(
  app: App,
  file: TFile,
): Promise<{ doc: Document; frontMatter: FrontMatterCache }> {
  const data = await app.vault.cachedRead(file);
  if (!data) throw new Error("File content is empty");

  const frontMatter = getFrontMatter(app, file);
  const cssclasses = getCssclasses(frontMatter);

  // Read user font settings from CSS variables
  let textFont = "";
  try {
    const cs = getComputedStyle(document.body);
    textFont = cs.getPropertyValue("--font-text").trim();
  } catch {
    // CSS variables not available
  }

  const comp = new Component();
  comp.load();

  const printEl = document.body.createDiv("print theme-light");
  if (textFont) {
    printEl.style.setProperty("font-family", textFont, "important");
  }
  const viewEl = printEl.createDiv({
    cls: "markdown-preview-view markdown-rendered" + cssclasses.join(" "),
  });

  const vaultConfig = app.vault as unknown as { getConfig: (key: string) => unknown };
  viewEl.toggleClass("rtl", vaultConfig.getConfig("rightToLeft") as boolean);
  viewEl.toggleClass("show-properties", "hidden" !== (vaultConfig.getConfig("propertiesInDocument") as string));

  const title = frontMatter?.title ?? file.basename;
  viewEl.createEl("h1", { text: title }, (e) => e.addClass("__title__"));

  // Add block IDs
  const cache = app.metadataCache.getFileCache(file);
  const blocks = new Map(Object.entries(cache?.blocks ?? {}));
  const lines = (data?.split("\n") ?? []).map((line, i) => {
    for (const { id, position } of blocks.values()) {
      const blockid = `^${id}`;
      if (line.includes(blockid) && i >= position.start.line && i <= position.end.line) {
        blocks.delete(id);
        return line.replace(blockid, `<span id="${blockid}" class="blockid"></span> ${blockid}`);
      }
    }
    return line;
  });
  [...blocks.values()].forEach(({ id, position }) => {
    lines[position.start.line] = `<span id="^${id}" class="blockid"></span>\n\n` + lines[position.start.line];
  });

  // Render markdown to HTML fragment
  const fragment = {
    children: undefined as HTMLCollection | undefined,
    appendChild(e: DocumentFragment): void {
      this.children = e?.children;
      throw new Error("exit");
    },
  };

  const promises: Promise<void>[] = [];
  try {
    await MarkdownRenderer.render(app, lines.join("\n"), fragment as unknown as HTMLElement, file.path, comp);
  } catch {
    // Expected - fragment trick
  }

  const el = createFragment();
  Array.from(fragment.children ?? []).forEach((item) => {
    el.createDiv({}, (t) => t.appendChild(item as unknown as Node));
  });
  viewEl.appendChild(el);

  await (MarkdownRenderer as unknown as { postProcess: (app: App, ctx: unknown) => Promise<void> }).postProcess(app, {
    docId: generateDocId(16),
    sourcePath: file.path,
    frontmatter: {},
    promises,
    addChild: (e: Component) => comp.addChild(e),
    getSectionInfo: () => null,
    containerEl: viewEl,
    el: viewEl,
    displayMode: true,
  });
  await Promise.all(promises);

  // Remove internal link hrefs
  printEl.findAll("a.internal-link").forEach((el) => {
    const [t, anchor] = el.dataset.href?.split("#") ?? [];
    if ((!t || t.length === 0 || t === file.basename) && anchor?.startsWith("^")) return;
    el.removeAttribute("href");
  });

  // Wait for async rendering (dataview, etc.)
  if (data.includes("```dataview") || data.includes("![[")) {
    await sleep(2000);
  }

  // Convert canvas to images
  for (const canvas of Array.from(printEl.querySelectorAll("canvas"))) {
    const dataUrl = canvas.toDataURL();
    const img = document.createElement("img");
    img.src = dataUrl;
    img.className = "__canvas__";
    canvas.replaceWith(img);
  }

  // Create standalone document
  const doc = document.implementation.createHTMLDocument("document");
  doc.body.appendChild(printEl.cloneNode(true));

  // Inject user font as a <style> in doc.head
  if (textFont) {
    const fontStyle = doc.createElement("style");
    fontStyle.textContent = `body,.markdown-preview-view,.markdown-rendered,p,li,td,th,a,span,blockquote{font-family:${textFont}!important}`;
    doc.head.appendChild(fontStyle);
  }

  printEl.detach();
  comp.unload();
  printEl.remove();
  doc.title = title;

  return { doc, frontMatter };
}
