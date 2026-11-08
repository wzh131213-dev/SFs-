// Run with:  npx tsx scripts/i18n-test.ts
// Checks the zh/en dictionaries, language switching/persistence, the game-facing helpers and
// that engine messages (toasts, warp notes, crash reasons, map markers) follow the active language.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// ---- minimal browser shims (set before the i18n module is first used)
const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = {};
g.localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
};
g.document = { documentElement: { lang: "" }, title: "" };

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log("  ok  ", name);
  } catch (e) {
    console.error("  FAIL", name, "\n      ", (e as Error).message);
    process.exitCode = 1;
  }
};

async function main() {
  const i18n = await import("../src/i18n/index");
  const game = await import("../src/i18n/game");
  const { PART_LIST } = await import("../src/game/data/parts");
  const { BODY_LIST } = await import("../src/game/physics/solar");
  const { formatTime } = await import("../src/game/core/math");
  const { PRESETS, parseBlueprint, validateBlueprint, emptyBlueprint } = await import("../src/game/vab/blueprint");
  const { Simulation } = await import("../src/game/flight/simulation");
  const { predictTrajectory } = await import("../src/game/flight/prediction");
  const { STORAGE_KEY, DICT_EN, DICT_ZH, ALL_KEYS, t, tDyn, getLang, setLang, subscribeLang } = i18n;

  console.log("1) core scenarios");
  check("default language is Simplified Chinese", () => assert.equal(getLang(), "zh"));
  check("zh and en dictionaries have identical key sets", () => {
    assert.deepEqual(Object.keys(DICT_ZH).sort(), Object.keys(DICT_EN).sort());
  });
  check("no empty translations", () => {
    for (const k of ALL_KEYS) {
      assert.ok(DICT_EN[k].trim().length > 0, "en empty: " + k);
      assert.ok(DICT_ZH[k].trim().length > 0, "zh empty: " + k);
    }
  });
  check("placeholders match between zh and en for every key", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of ALL_KEYS) assert.equal(ph(DICT_ZH[k]), ph(DICT_EN[k]), "placeholder mismatch: " + k);
  });
  check("every zh string that is not a symbol/brand contains Chinese characters (or is a known unit/acronym)", () => {
    const allowed = new Set(["lang.en", "fl.tPlus", "menu.dv", "fl.rcsTip"]);
    for (const k of ALL_KEYS) {
      if (allowed.has(k)) continue;
      if (DICT_ZH[k].replace(/\{\w+\}/g, "").replace(/[\s：:→+\-−]/g, "") === "") continue; // pure placeholder template
      assert.ok(/[\u4e00-\u9fff]/.test(DICT_ZH[k]) || /^[→+\-−\d ]/.test(DICT_ZH[k]), "no Chinese in zh: " + k + " = " + DICT_ZH[k]);
    }
  });
  check("t() switches language and interpolates params", () => {
    assert.equal(t("menu.currentStats", { parts: 3, mass: "1 kg", dv: 10 }, "en"), "3 parts · 1 kg · Δv 10 m/s");
    assert.equal(t("menu.currentStats", { parts: 3, mass: "1 kg", dv: 10 }, "zh"), "3 个零件 · 1 kg · Δv 10 m/s");
  });
  check("setLang persists, notifies subscribers, updates document", () => {
    let calls = 0;
    const off = subscribeLang(() => calls++);
    setLang("en");
    assert.equal(getLang(), "en");
    assert.equal(store.get(STORAGE_KEY), "en");
    assert.equal((g.document as { documentElement: { lang: string } }).documentElement.lang, "en");
    assert.equal((g.document as { title: string }).title, DICT_EN["meta.title"]);
    setLang("zh");
    assert.equal((g.document as { documentElement: { lang: string } }).documentElement.lang, "zh-CN");
    assert.equal(calls, 2);
    off();
    setLang("en");
    assert.equal(calls, 2, "unsubscribed listener must not fire");
    setLang("zh");
  });

  console.log("2) boundary / odd inputs");
  check("unknown key falls back to the key; tDyn uses its fallback", () => {
    assert.equal(t("no.such.key" as never), "no.such.key");
    assert.equal(tDyn("part.nope.name", "FALLBACK"), "FALLBACK");
  });
  check("missing parameter leaves the placeholder visible instead of throwing", () => {
    assert.equal(t("fl.stageN", {}, "en"), "STAGE {n}");
  });
  check("numeric zero parameter is rendered, not dropped", () => {
    assert.equal(t("fl.stageN", { n: 0 }, "en"), "STAGE 0");
  });
  check("saved language is restored on a fresh page load; corrupt / unavailable storage falls back to zh", () => {
    const load = (storage: string) =>
      execFileSync(
        "npx",
        ["tsx", "-e", `globalThis.window={};globalThis.localStorage=${storage};globalThis.document={documentElement:{lang:""},title:""};import("./src/i18n/index").then(m=>console.log(m.getLang()))`],
        { encoding: "utf8", cwd: process.cwd() },
      ).trim();
    assert.equal(load(`{getItem:()=>"en",setItem(){}}`), "en");
    assert.equal(load(`{getItem:()=>"zh",setItem(){}}`), "zh");
    assert.equal(load(`{getItem:()=>"fr",setItem(){}}`), "zh");
    assert.equal(load(`{getItem:()=>{throw new Error("denied")},setItem(){}}`), "zh");
  });
  check("formatTime localises units; boundary values 0 / negative / Infinity / multi-day", () => {
    setLang("en");
    assert.equal(formatTime(0), "0s");
    assert.equal(formatTime(-61), "-1m 1s");
    assert.equal(formatTime(Infinity), "—");
    assert.equal(formatTime(90061), "1d 1h 1m 1s");
    setLang("zh");
    assert.equal(formatTime(0), "0秒");
    assert.equal(formatTime(-61), "-1分 1秒");
    assert.equal(formatTime(90061), "1天 1时 1分 1秒");
  });
  check("every part has a name+description in both languages", () => {
    for (const p of PART_LIST) {
      for (const lang of ["zh", "en"] as const) {
        assert.ok(DICT_EN[`part.${p.id}.name` as never] && DICT_ZH[`part.${p.id}.name` as never], p.id);
        assert.ok(DICT_EN[`part.${p.id}.desc` as never] && DICT_ZH[`part.${p.id}.desc` as never], p.id);
        void lang;
      }
    }
    setLang("en");
    for (const p of PART_LIST) assert.equal(game.partName(p.id), p.name, "en name must match original data for " + p.id);
    setLang("zh");
    assert.equal(game.partName("tank_m"), "中型燃料箱");
  });
  check("every celestial body is translated", () => {
    for (const b of BODY_LIST) {
      assert.ok(DICT_ZH[`body.${b.id}` as never], b.id);
      assert.equal(game.bodyName(b.id, "en"), b.name);
    }
    assert.equal(game.bodyName("moon", "zh"), "月球");
    assert.equal(game.bodyName("pluto", "zh"), "pluto"); // unknown id passes through
  });
  check("vessel / preset names: presets, Debris, ' B' suffix, custom names unchanged", () => {
    for (const p of PRESETS) assert.notEqual(game.vesselName(p.name, "zh"), p.name, p.name);
    assert.equal(game.vesselName("Debris", "zh"), "残骸");
    assert.equal(game.vesselName("Moonshot B", "zh"), "登月号 B");
    assert.equal(game.vesselName("My Custom Ship", "zh"), "My Custom Ship");
    assert.equal(game.vesselName("Moonshot", "en"), "Moonshot");
    assert.equal(game.vesselName(emptyBlueprint().name, "zh"), "未命名火箭");
  });
  check("nested Msg params: body ids, vessel names and sub-messages resolve", () => {
    const m = game.msg("ev.explosion", { vesselV: "Hopper", reasonM: game.msg("lost.crashed", { v: "12.0" }) });
    assert.equal(game.tm(m, "en"), "Hopper: Crashed at 12.0 m/s");
    assert.equal(game.tm(m, "zh"), "跳跃者：以 12.0 m/s 的速度坠毁");
  });

  console.log("3) error / invalid input");
  check("parseBlueprint errors are translatable but keep an English .message", () => {
    for (const [input, key] of [
      ["not json", "bp.errNotJson"],
      ["null", "bp.errNotObject"],
      ["{}", "bp.errNoArray"],
      ['{"parts":[{"id":"x"}]}', "bp.errMalformed"],
      ['{"parts":[{"id":1,"defId":"warp_drive","gx":0,"gy":0,"stage":0}]}', "bp.errUnknownPart"],
      ['{"parts":[{"id":1,"defId":"pod","gx":0,"gy":0,"stage":0},{"id":1,"defId":"pod","gx":0,"gy":20,"stage":0}]}', "bp.errDupId"],
      ['{"parts":[]}', "bp.noParts"],
    ] as const) {
      let err: unknown;
      try {
        parseBlueprint(input);
      } catch (e) {
        err = e;
      }
      assert.ok(err instanceof game.MsgError, "expected MsgError for " + input);
      assert.equal((err as InstanceType<typeof game.MsgError>).msg.k, key);
      assert.ok(/^[\x20-\x7e]+$/.test((err as Error).message), "message must be English ASCII: " + (err as Error).message);
      setLang("zh");
      assert.ok(/[\u4e00-\u9fff]/.test(game.errorText(err, "store.errJson")), "zh text for " + key);
    }
  });
  check("validateBlueprint overlap / detached produce messages in both languages", () => {
    const base = PRESETS[0];
    const overlapped = { ...base, parts: [...base.parts, { ...base.parts[0], id: 999 }] };
    const m = validateBlueprint(overlapped)!;
    assert.equal(m.k, "bp.overlap");
    assert.equal(game.tm(m, "en"), "Parts overlap.");
    assert.equal(game.tm(m, "zh"), "零件发生重叠。");
    const detached = { ...base, parts: [...base.parts, { id: 998, defId: "tank_s", gx: 400, gy: 400, stage: -1 }] };
    assert.equal(validateBlueprint(detached)!.k, "bp.detached");
    assert.equal(validateBlueprint(base), null);
  });
  check("apiError maps server messages and structured keys; unknown text passes through", () => {
    setLang("zh");
    assert.equal(game.errorText(game.apiError({ error: "Blueprint too large" }, "store.errSave"), "store.errSave"), "蓝图文件过大");
    assert.equal(game.errorText(game.apiError({ error: "x", errorKey: "bp.overlap" }, "store.errSave"), "store.errSave"), "零件发生重叠。");
    assert.equal(game.errorText(game.apiError({ error: "weird db error" }, "store.errSave"), "store.errSave"), "weird db error");
    assert.equal(game.errorText(game.apiError(null, "store.errLoad"), "store.errLoad"), "读取失败");
    assert.equal(game.errorText(new Error(""), "store.errFailed"), "操作失败");
  });

  console.log("4) engine messages follow the language");
  check("stage activation toast + stage part names (zh and en)", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      const sim = new Simulation(PRESETS[1]);
      sim.activateStage();
      const toast = sim.toasts[sim.toasts.length - 1].text;
      assert.equal(toast, lang === "zh" ? "第 1 级已启动" : "Stage 1 activated");
      const tel = sim.telemetry();
      assert.equal(tel.bodyName, lang === "zh" ? "地球" : "Earth");
      assert.equal(tel.name, game.vesselName("Starter Orbiter", lang));
      assert.ok(tel.stages.every((s) => s.names.every((n) => (lang === "zh" ? /[\u4e00-\u9fff]/.test(n) : /^[\x20-\x7e]+$/.test(n)))));
    }
  });
  check("telemetry re-translates live when the language changes mid-flight", () => {
    setLang("en");
    const sim = new Simulation(PRESETS[0]);
    const a = sim.telemetry();
    setLang("zh");
    const b = sim.telemetry();
    assert.equal(a.bodyName, "Earth");
    assert.equal(b.bodyName, "地球");
    assert.notEqual(a.name, b.name);
  });
  check("warp limit note and 'No more stages' toast", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      const sim = new Simulation(PRESETS[0]);
      sim.active!.throttle = 1;
      sim.activateStage(); // ignite engine
      sim.toasts.length = 0;
      sim.setWarpIndex(5);
      sim.update(0.05);
      const note = sim.telemetry().warpNote;
      assert.ok(note.length > 0, "a warp note must exist while engines fire / in atmosphere");
      assert.equal(/[\u4e00-\u9fff]/.test(note), lang === "zh", note);
    }
  });
  check("crash produces a translated 'vessel lost' reason that re-renders on language switch", () => {
    setLang("en");
    const sim = new Simulation(PRESETS[0]);
    const v = sim.active!;
    // drop the vessel straight into the ground
    const up = Math.atan2(v.pos.y, v.pos.x);
    v.vel.x = -Math.cos(up) * 200;
    v.vel.y = -Math.sin(up) * 200;
    v.pos.x += Math.cos(up) * 50;
    v.pos.y += Math.sin(up) * 50;
    v.landed = false;
    for (let i = 0; i < 400 && !sim.lost; i++) sim.update(0.05);
    assert.ok(sim.lost, "vessel should have crashed");
    const en = sim.telemetry().lost!;
    setLang("zh");
    const zh = sim.telemetry().lost!;
    assert.ok(/Crashed|Tipped|Burned/.test(en), en);
    assert.ok(/[\u4e00-\u9fff]/.test(zh), zh);
    assert.notEqual(en, zh);
  });
  check("trajectory marker labels are lazy: same marker, new language", () => {
    setLang("en");
    const sim = new Simulation(PRESETS[1]);
    const v = sim.active!;
    const pred = predictTrajectory(v.bodyId, 0, 600000 + 100000, 2400, 0, 0, null, 1500);
    const ap = pred.markers.find((m) => m.kind === "ap" || m.kind === "pe");
    assert.ok(ap, "expected an Ap/Pe marker");
    const en = ap!.label;
    setLang("zh");
    const zh = ap!.label;
    assert.ok(/^(Ap|Pe) /.test(en), en);
    assert.ok(/^(远地点|近地点) /.test(zh), zh);
  });
  setLang("zh");
  console.log(`\n${passed} checks passed${process.exitCode ? " — with FAILURES" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
