import { useEffect } from "react";

const HASH_PATH = "/prototype/admin";

export function readPrototypeVariant(keys) {
  const hash = window.location.hash.slice(1);
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const value = new URLSearchParams(query).get("variant") || "A";
  return keys.includes(value) ? value : keys[0];
}

export function writePrototypeVariant(variant) {
  const hash = window.location.hash.slice(1);
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const params = new URLSearchParams(query);
  params.set("variant", variant);
  history.replaceState(null, "", `#${HASH_PATH}?${params.toString()}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export default function PrototypeSwitcher({ variants, current }) {
  if (import.meta.env.PROD) return null;

  const keys = variants.map((item) => item.key);
  const cycle = (delta) => {
    const index = keys.indexOf(current);
    const next = keys[(index + delta + keys.length) % keys.length];
    writePrototypeVariant(next);
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const tag = event.target?.closest?.("input, textarea, select, [contenteditable='true']");
      if (tag) return;
      event.preventDefault();
      cycle(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, keys.join(",")]);

  const meta = variants.find((item) => item.key === current);

  return (
    <div className="proto-switcher-pill" role="navigation" aria-label="原型变体">
      <button type="button" aria-label="上一个变体" onClick={() => cycle(-1)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <span className="proto-switcher-title">{current} · {meta?.name || ""}</span>
      <button type="button" aria-label="下一个变体" onClick={() => cycle(1)}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
    </div>
  );
}
