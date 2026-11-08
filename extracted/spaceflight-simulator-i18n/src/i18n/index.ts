// Language core — framework independent so both React components and the physics/game code can use it.
import { en, type Key } from "./en";
import { zh } from "./zh";

export type Lang = "zh" | "en";
export type { Key };
export const LANGS: readonly Lang[] = ["zh", "en"];
export const DEFAULT_LANG: Lang = "zh";
export const STORAGE_KEY = "orbital.lang.v1";

const DICTS: Record<Lang, Record<string, string>> = { en, zh };

let current: Lang = DEFAULT_LANG;
let loaded = false;
const listeners = new Set<() => void>();

export const isLang = (x: unknown): x is Lang => x === "zh" || x === "en";

function readStored(): Lang {
  try {
    const s = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (isLang(s)) return s;
  } catch {
    /* storage unavailable (private mode / SSR) */
  }
  return DEFAULT_LANG;
}

function applyDocument(lang: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("meta.title", undefined, lang);
}

/** Current language. On the client the saved choice is picked up lazily on first access. */
export function getLang(): Lang {
  if (!loaded && typeof window !== "undefined") {
    loaded = true;
    current = readStored();
  }
  return current;
}

export function setLang(lang: Lang): void {
  loaded = true;
  current = lang;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  applyDocument(lang);
  listeners.forEach((l) => l());
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type Params = Record<string, string | number>;

function interpolate(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate a statically known key. Falls back to English, then to the key itself. */
export function t(key: Key, params?: Params, lang: Lang = getLang()): string {
  return interpolate(DICTS[lang][key] ?? en[key] ?? key, params);
}

/** Translate a key built at runtime (e.g. `part.${id}.name`). Returns `fallback` if no entry exists. */
export function tDyn(key: string, fallback: string, params?: Params, lang: Lang = getLang()): string {
  const s = DICTS[lang][key] ?? DICTS.en[key];
  return s === undefined ? fallback : interpolate(s, params);
}

export function hasKey(key: string): key is Key {
  return key in en;
}

/** Keys of the English dictionary (used by tests to check zh completeness). */
export const ALL_KEYS = Object.keys(en) as Key[];
export const DICT_ZH = zh;
export const DICT_EN = en;
