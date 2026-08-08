import en from "./en";
import zhCn from "./zh-cn";

export type Lang = typeof en;

declare global {
  interface Window {
    moment?: {
      locale?: () => string;
    };
  }
}

const locales: Record<string, Lang> = {
  en,
  "zh-cn": zhCn,
  zh: zhCn,
};

export function getLang(): Lang {
  const locale: string = window.moment?.locale?.() ?? navigator.language ?? "en";
  return locales[locale] ?? locales[locale.slice(0, 2)] ?? en;
}
