import { useEffect, useRef, useState } from "react";
import classes from "./SectionNav.module.css";

interface Heading {
  id: string;
  label: string;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A sticky tab bar listing every record section on the page (the `h2#h-*` headings inside it), highlighting the one in
 * view. Reads the headings from the DOM so the heatmap and chart sections are included without extra wiring.
 */
export function SectionNav({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>();

  // Collect headings now and whenever sections mount (the heatmap and charts render after their data loads).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const scan = () => {
      const found = [...root.querySelectorAll<HTMLElement>("h2[id^='h-']")].map((h) => ({
        id: h.id,
        label: h.textContent ?? h.id,
      }));
      setHeadings((prev) =>
        prev.length === found.length &&
        prev.every((p, i) => p.id === found[i]?.id && p.label === found[i]?.label)
          ? prev
          : found
      );
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // Scroll-spy: the active section is the last one whose heading has passed just under the sticky bars.
  useEffect(() => {
    const update = () => {
      const bars = rootRef.current
        ? parseFloat(getComputedStyle(rootRef.current).getPropertyValue("--section-nav-height")) ||
          46
        : 46;
      const line = 60 + bars + 24;
      let current: string | undefined;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= line) current = h.id;
      }
      setActive(current ?? headings[0]?.id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [headings]);

  // Keep the active tab visible in the (horizontally scrolling) bar.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = scroller?.querySelector<HTMLElement>("[data-active]");
    if (!scroller || !tab) return;
    const left = tab.offsetLeft - scroller.clientWidth / 2 + tab.offsetWidth / 2;
    scroller.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
  }, [active]);

  return (
    <div ref={rootRef} className={classes.root}>
      {headings.length > 1 && (
        <nav className={classes.bar} aria-label="Sections on this page">
          <div ref={scrollerRef} className={classes.scroller}>
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                className={classes.tab}
                data-active={h.id === active ? "" : undefined}
                aria-current={h.id === active ? "location" : undefined}
                onClick={() =>
                  document.getElementById(h.id)?.scrollIntoView({
                    behavior: reducedMotion() ? "auto" : "smooth",
                    block: "start",
                  })
                }
              >
                {h.label}
              </button>
            ))}
          </div>
        </nav>
      )}
      {children}
    </div>
  );
}
