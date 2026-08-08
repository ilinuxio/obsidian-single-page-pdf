/** Collect all CSS rules from the parent document */
export function getAllStyles(): string[] {
  const cssTexts: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    const id = (sheet.ownerNode as HTMLElement)?.id;
    if (id?.startsWith("svelte-")) return;

    const href = (sheet.ownerNode as HTMLLinkElement)?.href;
    const division = `/* ----------${id ? `id:${id}` : href ? `href:${href}` : ""}---------- */`;
    cssTexts.push(division);

    try {
      Array.from(sheet?.cssRules ?? []).forEach((rule) => {
        cssTexts.push(rule.cssText);
      });
    } catch (error) {
      console.error(error);
    }
  });
  return cssTexts;
}

/** Get print-specific CSS rules */
function getPrintStyle(): string[] {
  const cssTexts: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      const cssRules = sheet?.cssRules ?? [];
      Array.from(cssRules).forEach((rule) => {
        if (rule.constructor.name === "CSSMediaRule") {
          if ((rule as CSSMediaRule).conditionText === "print") {
            const res = rule.cssText.replace(/@media print\s*\{(.+)\}/gms, "$1");
            cssTexts.push(res);
          }
        }
      });
    } catch (error) {
      console.error(error);
    }
  });
  return cssTexts;
}

/** CSS patches for proper rendering */
export function getPatchStyle(): string[] {
  return [
    `
/* Use overlay scrollbar so it doesn't take layout space */
body { overflow: auto !important; scrollbar-width: none !important; }
body::-webkit-scrollbar { display: none !important; }
@media print {
  .print .markdown-preview-view { height: auto !important; }
  .md-print-anchor, .blockid {
    white-space: pre !important;
    border-left: none !important; border-right: none !important;
    border-top: none !important; border-bottom: none !important;
    display: inline-block !important; position: absolute !important;
    width: 1px !important; height: 1px !important;
    right: 0 !important; outline: 0 !important;
    background: 0 0 !important; text-decoration: initial !important;
    text-shadow: initial !important;
  }
}
@media print {
  table { break-inside: auto; }
  tr { break-inside: avoid; break-after: auto; }
}
`,
    ...getPrintStyle(),
  ];
}
