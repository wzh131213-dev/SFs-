// Game-facing translation helpers: parts, bodies, vessels and structured messages.
import { getLang, hasKey, t, tDyn, type Key, type Lang, type Params } from "./index";

/** A translatable message that can be stored and rendered later in whatever language is active. */
export interface Msg {
  k: Key;
  p?: Record<string, string | number | Msg>;
}
export const msg = (k: Key, p?: Msg["p"]): Msg => ({ k, p });
const isMsg = (v: unknown): v is Msg => typeof v === "object" && v !== null && "k" in v;

export const bodyName = (id: string, lang?: Lang): string => tDyn(`body.${id}`, id, undefined, lang);
export const partName = (id: string, fallback = id): string => tDyn(`part.${id}.name`, fallback);
export const partDesc = (id: string, fallback = ""): string => tDyn(`part.${id}.desc`, fallback);
export const categoryLabel = (c: string): string => tDyn(`cat.${c}`, c);

/** Preset blueprints and generated vessels carry English names; show them in the active language. */
export function vesselName(name: string, lang?: Lang): string {
  const debris = name === "Debris";
  if (debris) return t("vessel.debris", undefined, lang);
  const m = /^(.*) B$/.exec(name);
  if (m) return vesselName(m[1], lang) + " B";
  return tDyn(`preset.${name}`, name, undefined, lang);
}

/**
 * Render a message. By naming convention a parameter whose name ends in an upper-case letter
 * is resolved before interpolation: `...B` = body id, `...V` = vessel name, `...M` = nested Msg.
 */
export function tm(m: Msg, lang: Lang = getLang()): string {
  const params: Params = {};
  for (const [k, v] of Object.entries(m.p ?? {})) {
    if (isMsg(v)) params[k] = tm(v, lang);
    else if (/[a-z]B$/.test(k)) params[k] = bodyName(String(v), lang);
    else if (/[a-z]V$/.test(k)) params[k] = vesselName(String(v), lang);
    else params[k] = v;
  }
  return t(m.k, params, lang);
}

/** Error carrying a translatable message; `.message` is always the English rendering. */
export class MsgError extends Error {
  readonly msg: Msg;
  constructor(m: Msg) {
    super(tm(m, "en"));
    this.msg = m;
    this.name = "MsgError";
  }
}

/** Best-effort text for any thrown value, translated when it carries a Msg. */
export function errorText(e: unknown, fallback: Key): string {
  if (e instanceof MsgError) return tm(e.msg);
  if (e instanceof Error && e.message) return e.message;
  return t(fallback);
}

const API_KEYS: Record<string, Key> = {
  "Failed to load blueprints": "api.listFailed",
  "Blueprint too large": "api.tooLarge",
  "Bad id": "api.badId",
  "Not found": "api.notFound",
};

/** Turn a JSON error body from our API routes into a translatable error. */
export function apiError(data: { error?: string; errorKey?: string; errorParams?: Msg["p"] } | null | undefined, fallback: Key): Error {
  if (data?.errorKey && hasKey(data.errorKey)) return new MsgError({ k: data.errorKey, p: data.errorParams });
  const known = data?.error ? API_KEYS[data.error] : undefined;
  if (known) return new MsgError({ k: known });
  return data?.error ? new Error(data.error) : new MsgError({ k: fallback });
}
