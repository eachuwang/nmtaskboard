import { cn } from "./cn.js";

export function GlassMesh({ className }) {
  return (
    <div className={cn("glass-background glass-default-background", className)} aria-hidden="true">
      <span className="pointer-events-none absolute -left-[18%] -top-[16%] h-[62vmin] w-[62vmin] rounded-full bg-[var(--mesh-lavender)] blur-[88px] motion-safe:animate-[mesh-drift_22s_ease-in-out_infinite]" />
      <span className="pointer-events-none absolute -right-[12%] top-[8%] h-[54vmin] w-[54vmin] rounded-full bg-[var(--mesh-sky)] blur-[92px] motion-safe:animate-[mesh-drift_28s_ease-in-out_infinite_reverse]" />
      <span className="pointer-events-none absolute bottom-[-18%] left-[22%] h-[48vmin] w-[58vmin] rounded-full bg-[var(--mesh-cyan)] blur-[80px] motion-safe:animate-[mesh-drift_24s_ease-in-out_infinite]" />
      <span className="pointer-events-none absolute right-[18%] bottom-[6%] h-[36vmin] w-[36vmin] rounded-full bg-[var(--mesh-powder)] blur-[72px] motion-safe:animate-[mesh-drift_19s_ease-in-out_infinite]" />
    </div>
  );
}
