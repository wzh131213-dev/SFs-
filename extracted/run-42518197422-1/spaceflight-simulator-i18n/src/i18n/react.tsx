"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LANG, getLang, setLang as coreSetLang, subscribeLang, t as coreT, type Key, type Lang, type Params } from "./index";

/** Re-renders the calling component whenever the language changes. */
export function useLang() {
  const lang = useSyncExternalStore(subscribeLang, getLang, () => DEFAULT_LANG);
  const t = useCallback((key: Key, params?: Params) => coreT(key, params, lang), [lang]);
  const setLang = useCallback((l: Lang) => coreSetLang(l), []);
  // keep <html lang> and <title> in sync after hydration
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = coreT("meta.title", undefined, lang);
  }, [lang]);
  return { lang, t, setLang };
}

/** Compact 中文 / English toggle. */
export function LangSwitch({ className = "" }: { className?: string }) {
  const { lang, t, setLang } = useLang();
  const item = (l: Lang) => (
    <button
      key={l}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setLang(l)}
      aria-pressed={lang === l}
      className={`px-2 py-0.5 text-[11px] font-semibold transition ${lang === l ? "bg-[#ff8a1f] text-[#1a0f02]" : "text-slate-400 hover:text-white"}`}
    >
      {coreT(l === "zh" ? "lang.zh" : "lang.en", undefined, l)}
    </button>
  );
  return (
    <div role="group" aria-label={t("lang.switchLabel")} className={`inline-flex overflow-hidden rounded-md border border-[#2a3342] bg-[#141a23]/90 ${className}`}>
      {item("zh")}
      {item("en")}
    </div>
  );
}
