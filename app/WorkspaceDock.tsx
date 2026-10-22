"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Keep native buttons, names and permissions supplied by the workspace. */
export default function WorkspaceDock({ children }: { children: ReactNode }) {
  const dock = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = dock.current;
    if (!element) return;
    const reveal = () => {
      const active = element.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const box = active.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      if (box.left < bounds.left || box.right > bounds.right) {
        element.scrollTo({ left: active.offsetLeft - element.clientWidth / 2 + active.clientWidth / 2,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(element, { subtree: true, attributes: true, attributeFilter: ["aria-current"] });
    return () => observer.disconnect();
  }, []);
  return <div className="workspace-dock-shell"><nav ref={dock} className="tab-bar workspace-dock" aria-label="Workspace navigation"
    onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>{children}</nav></div>;
}
