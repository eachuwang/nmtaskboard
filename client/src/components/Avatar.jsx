import { cn } from "./ui/index.js";

const PRESET_COLORS = [
  ["#5b8def", "#8f6ff0"],
  ["#3fa7a3", "#5b8def"],
  ["#e08b5c", "#d95f7a"],
  ["#6fb86a", "#3fa7a3"],
  ["#b276e0", "#5b8def"],
  ["#e0b45c", "#e08b5c"]
];

function presetAvatar(index) {
  const [from, to] = PRESET_COLORS[index % PRESET_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="96" cy="28" r="34" fill="rgba(255,255,255,0.22)"/><circle cx="26" cy="98" r="42" fill="rgba(255,255,255,0.14)"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

export const AVATAR_PRESETS = PRESET_COLORS.map((_, index) => presetAvatar(index));

export function Avatar({ name, image, className }) {
  if (image) {
    return <img className={cn("avatar avatar-image", className)} src={image} alt={name ? `${name} 的头像` : "头像"} />;
  }
  return <span className={cn("avatar", className)}>{(name || "我").slice(0, 1)}</span>;
}
