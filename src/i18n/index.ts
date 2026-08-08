import en from "./en";
import zhCn from "./zh-cn";

export type Lang = typeof en;

const locales: Record<string, Lang> = {
  en,
  "zh-cn": zhCn,
  zh: zhCn,
};

export function getLang(): Lang {
  const locale: string = (window as any).moment?.locale?.() ?? navigator.language ?? "en";
  return locales[locale] ?? locales[locale.slice(0, 2)] ?? en;
}
