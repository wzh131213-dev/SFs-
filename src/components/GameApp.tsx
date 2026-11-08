"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Blueprint } from "@/game/core/types";
import { formatMass } from "@/game/core/math";
import { blueprintStats } from "@/game/flight/vessel";
import { PRESETS, parseBlueprint, serializeBlueprint } from "@/game/vab/blueprint";
import { LangSwitch, useLang } from "@/i18n/react";
import { vesselName } from "@/i18n/game";
import FlightScreen from "./FlightScreen";
import VabScreen from "./VabScreen";

type Screen = "menu" | "vab" | "flight";
type DeviceMode = "auto" | "phone" | "tablet" | "desktop";
type DeviceKind = Exclude<DeviceMode, "auto">;
const STORAGE_KEY = "orbital.blueprint.v1";
const DEVICE_KEY = "orbital.display.device.v1";

function detectDevice(): DeviceKind {
  if (typeof window === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  const touchMac = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPad|Tablet/i.test(ua) || touchMac || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "phone";
  if (window.matchMedia("(max-width: 680px)").matches) return "phone";
  if (window.matchMedia("(max-width: 1100px)").matches) return "tablet";
  return "desktop";
}

function deviceName(device: DeviceKind, lang: string) {
  const zh = lang === "zh";
  return device === "phone" ? (zh ? "手机" : "Phone")
    : device === "tablet" ? (zh ? "平板电脑" : "Tablet")
    : (zh ? "电脑" : "Desktop");
}

export default function GameApp() {
  const { lang } = useLang();
  const [screen, setScreen] = useState<Screen>("menu");
  const [bp, setBp] = useState<Blueprint>(PRESETS[1]);
  const [flightKey, setFlightKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("auto");
  const [detectedDevice, setDetectedDevice] = useState<DeviceKind>("desktop");
  const [showDeviceSetup, setShowDeviceSetup] = useState(false);
  const [display, setDisplay] = useState({ screenWidth: 0, screenHeight: 0, viewportWidth: 0, viewportHeight: 0, dpr: 1 });

  const refreshDisplay = useCallback(() => {
    if (typeof window === "undefined") return;
    setDisplay({
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      viewportWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
      viewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
      dpr: window.devicePixelRatio || 1,
    });
    setDetectedDevice(detectDevice());
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setBp(parseBlueprint(raw));
      const savedDevice = localStorage.getItem(DEVICE_KEY) as DeviceMode | null;
      if (savedDevice === "auto" || savedDevice === "phone" || savedDevice === "tablet" || savedDevice === "desktop") {
        setDeviceMode(savedDevice);
      } else {
        setShowDeviceSetup(true);
      }
    } catch {
      setShowDeviceSetup(true);
    }
    refreshDisplay();
    setReady(true);
    const onResize = () => refreshDisplay();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [refreshDisplay]);

  const activeDevice: DeviceKind = deviceMode === "auto" ? detectedDevice : deviceMode;
  useEffect(() => {
    document.documentElement.dataset.device = activeDevice;
  }, [activeDevice]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, serializeBlueprint(bp));
    } catch {
      /* storage may be unavailable */
    }
  }, [bp, ready]);

  const chooseDevice = (mode: DeviceMode) => {
    setDeviceMode(mode);
    try { localStorage.setItem(DEVICE_KEY, mode); } catch { /* storage may be unavailable */ }
    if (mode === "auto") refreshDisplay();
    setShowDeviceSetup(false);
  };

  const launch = useCallback((b?: Blueprint) => {
    if (b) setBp(b);
    setFlightKey((k) => k + 1);
    setScreen("flight");
  }, []);

  if (!ready) return null;
  const gameScreen = screen === "vab"
    ? <VabScreen bp={bp} onChange={setBp} onLaunch={() => launch()} onMenu={() => setScreen("menu")} />
    : screen === "flight"
      ? <FlightScreen key={flightKey} bp={bp} onRevert={() => setScreen("vab")} onRestart={() => launch()} onMenu={() => setScreen("menu")} />
      : <MainMenu current={bp} deviceLabel={deviceName(activeDevice, lang)} onDeviceSettings={() => setShowDeviceSetup(true)}
          onVab={(b) => { if (b) setBp(b); setScreen("vab"); }} onLaunch={launch} />;

  return (
    <div className="app-shell min-h-[100dvh] w-full overflow-hidden" data-device={activeDevice}>
      {gameScreen}
      {showDeviceSetup && (
        <DeviceSetup
          mode={deviceMode}
          detected={detectedDevice}
          display={display}
          lang={lang}
          onChoose={chooseDevice}
        />
      )}
    </div>
  );
}

function DeviceSetup({ mode, detected, display, lang, onChoose }: {
  mode: DeviceMode;
  detected: DeviceKind;
  display: { screenWidth: number; screenHeight: number; viewportWidth: number; viewportHeight: number; dpr: number };
  lang: string;
  onChoose: (mode: DeviceMode) => void;
}) {
  const zh = lang === "zh";
  const options: { id: DeviceMode; title: string; desc: string; icon: string }[] = [
    { id: "auto", title: zh ? "自动识别" : "Auto detect", desc: zh ? "根据屏幕尺寸、触控能力和设备信息自动适配" : "Fit from screen size, touch support and device hints", icon: "✦" },
    { id: "phone", title: zh ? "手机" : "Phone", desc: zh ? "窄屏布局，适合竖屏或横屏手机" : "Compact layout for portrait or landscape phones", icon: "▯" },
    { id: "tablet", title: zh ? "平板电脑" : "Tablet", desc: zh ? "平板布局，兼顾触控与较大画布" : "Balanced touch layout and larger canvas", icon: "▭" },
    { id: "desktop", title: zh ? "电脑" : "Desktop", desc: zh ? "完整宽屏界面与侧边控制面板" : "Full wide layout with side panels", icon: "▰" },
  ];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#03060b]/95 p-3 backdrop-blur-md sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="device-setup-title" className="w-full max-w-2xl rounded-2xl border border-[#29384b] bg-[#0b121d] p-4 shadow-2xl sm:p-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#4da3ff]">ORBITAL · DISPLAY SETUP</div>
        <h2 id="device-setup-title" className="mt-2 text-2xl font-black text-white sm:text-3xl">{zh ? "你正在使用什么设备？" : "What device are you using?"}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{zh ? "游戏会读取屏幕尺寸、可用视口和像素比例，自动调整界面密度与画布大小。你也可以手动指定设备类型。" : "The game reads screen size, viewport and pixel ratio to fit the interface and rendering canvas. You can also choose the device type manually."}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((option) => (
            <button key={option.id} type="button" onClick={() => onChoose(option.id)} aria-pressed={mode === option.id}
              className={`min-h-28 rounded-xl border p-3 text-left transition ${mode === option.id ? "border-[#ff8a1f] bg-[#2a1b0d] ring-1 ring-[#ff8a1f]/40" : "border-[#273346] bg-[#111b29] hover:border-[#4da3ff]"}`}>
              <div className="text-2xl text-[#ffad59]">{option.icon}</div>
              <div className="mt-2 text-sm font-bold text-white">{option.title}</div>
              <div className="mt-1 text-[10px] leading-relaxed text-slate-400">{option.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-[#243247] bg-[#07101b] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-200">{zh ? "自动检测结果" : "Detected device"}</span>
            <span className="rounded-full bg-[#13283b] px-2 py-1 text-[#8ccaff]">{deviceName(detected, lang)}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 font-mono text-[11px] sm:grid-cols-4">
            <Metric label={zh ? "屏幕尺寸" : "Screen"} value={display.screenWidth && display.screenHeight ? `${display.screenWidth} × ${display.screenHeight}` : "—"} />
            <Metric label={zh ? "可用画面" : "Viewport"} value={display.viewportWidth && display.viewportHeight ? `${display.viewportWidth} × ${display.viewportHeight}` : "—"} />
            <Metric label="DPR" value={display.dpr.toFixed(2)} />
            <Metric label={zh ? "渲染像素" : "Render pixels"} value={display.viewportWidth ? `${Math.round(display.viewportWidth * display.dpr)} × ${Math.round(display.viewportHeight * display.dpr)}` : "—"} />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={() => onChoose(mode)} className="rounded-lg bg-[#ff8a1f] px-5 py-2.5 text-sm font-black text-[#1a0f02] hover:bg-[#ffa13d]">
            {zh ? "确认并进入游戏" : "Confirm and continue"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] text-slate-500">{label}</div><div className="mt-1 font-semibold text-[#b8dfff]">{value}</div></div>;
}

function MainMenu({ current, onVab, onLaunch, onDeviceSettings, deviceLabel }: {
  current: Blueprint;
  onVab: (b?: Blueprint) => void;
  onLaunch: (b?: Blueprint) => void;
  onDeviceSettings: () => void;
  deviceLabel: string;
}) {
  const { t, lang } = useLang();
  const cards = useMemo(() => PRESETS.map((p) => ({ bp: p, stats: blueprintStats(p) })), []);
  const curStats = useMemo(() => blueprintStats(current), [current]);
  return (
    <div className="relative min-h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#07090d] text-slate-200">
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ backgroundImage: "radial-gradient(1px 1px at 20% 30%, #fff 50%, transparent), radial-gradient(1px 1px at 70% 20%, #fff 50%, transparent), radial-gradient(1.5px 1.5px at 40% 70%, #cfe3ff 50%, transparent), radial-gradient(1px 1px at 85% 60%, #fff 50%, transparent), radial-gradient(1px 1px at 10% 80%, #fff 50%, transparent), radial-gradient(1px 1px at 55% 45%, #fff 50%, transparent)" }} />
      <div className="pointer-events-none absolute -bottom-[55vh] left-1/2 h-[90vh] w-[160vw] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#3f9b59] to-[#1d4d2d] shadow-[0_-30px_120px_rgba(110,180,255,0.35)]" />
      <div className="relative mx-auto flex max-w-5xl flex-col px-4 py-12 sm:px-6 sm:py-14">
        <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-5">
          <button type="button" onClick={onDeviceSettings} className="rounded-md border border-[#2a3342] bg-[#141a23]/90 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:border-[#4da3ff]">
            {lang === "zh" ? `设备：${deviceLabel} · 调整` : `Device: ${deviceLabel} · Change`}
          </button>
          <LangSwitch />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-[0.4em] text-[#4da3ff]">{t("menu.tagline")}</div>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-6xl">
          ORBITAL<span className="text-[#ff8a1f]">·</span>FLIGHT
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-slate-400 sm:text-base">{t("menu.intro")}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button className="rounded-lg bg-[#ff8a1f] px-5 py-3 text-sm font-black tracking-wide text-[#1a0f02] shadow-lg shadow-[#ff8a1f]/20 hover:bg-[#ffa13d] sm:px-6" onClick={() => onVab()}>
            {t("menu.openVab", { name: vesselName(current.name) })}
          </button>
          <button className="rounded-lg border border-[#2a3342] bg-[#10151d]/80 px-5 py-3 text-sm font-bold hover:border-[#4da3ff] sm:px-6" onClick={() => onLaunch()}>
            {t("menu.launchCurrent")}
          </button>
          {curStats && <div className="self-center text-xs text-slate-500">{t("menu.currentStats", { parts: curStats.parts, mass: formatMass(curStats.mass), dv: curStats.dv.total.toFixed(0) })}</div>}
        </div>
        <h2 className="mt-10 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">{t("menu.starter")}</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ bp, stats }) => (
            <div key={bp.name} className="rounded-xl border border-[#1f2835] bg-[#0d1218]/90 p-4 backdrop-blur">
              <div className="text-lg font-bold text-white">{vesselName(bp.name)}</div>
              <div className="mt-1 text-xs text-slate-500">{t("menu.cardParts", { parts: bp.parts.length, mass: stats ? formatMass(stats.mass) : "" })}</div>
              {stats && <div className="mt-3 grid grid-cols-2 gap-1 font-mono text-[11px]">
                <span className="text-slate-500">{t("menu.dv")}</span><span className="text-right text-[#4da3ff]">{stats.dv.total.toFixed(0)} m/s</span>
                <span className="text-slate-500">{t("menu.launchTwr")}</span><span className="text-right">{stats.twr.toFixed(2)}</span>
                <span className="text-slate-500">{t("menu.stages")}</span><span className="text-right">{stats.dv.stages.length}</span>
              </div>}
              <div className="mt-4 flex gap-2">
                <button className="flex-1 rounded-md bg-[#ff8a1f] py-2 text-xs font-bold text-[#1a0f02] hover:bg-[#ffa13d]" onClick={() => onLaunch(bp)}>{t("menu.launch")}</button>
                <button className="flex-1 rounded-md border border-[#2a3342] py-2 text-xs hover:border-[#4da3ff]" onClick={() => onVab(bp)}>{t("menu.edit")}</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 grid gap-4 rounded-xl border border-[#1f2835] bg-[#0d1218]/90 p-4 text-xs text-slate-400 backdrop-blur sm:grid-cols-3 sm:p-5">
          <div><div className="mb-1 font-bold uppercase tracking-widest text-[#ff8a1f]">{t("menu.flight")}</div>{t("menu.flightHelp")}</div>
          <div><div className="mb-1 font-bold uppercase tracking-widest text-[#4da3ff]">{t("menu.nav")}</div>{t("menu.navHelp")}</div>
          <div><div className="mb-1 font-bold uppercase tracking-widest text-[#6ee7a8]">{t("menu.tips")}</div>{t("menu.tipsHelp")}</div>
        </div>
      </div>
    </div>
  );
}
