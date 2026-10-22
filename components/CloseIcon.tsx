/* The one close (x) icon for dismiss buttons (owner, 2026-10-22, #1673 item 3: "the X icon the size should be the same"). The trial banner
   used ✕ (U+2715) at --fs-body and the page hint × (U+00D7) at 1rem and 60% opacity; the two glyphs come from different fonts per OS and
   rendered at visibly different sizes side by side on the Arena page. An SVG is the same pixels everywhere. The owner chose the trial
   banner's x as the size: 14 px, a 10 px cross, the colour of the button it sits in (currentColor). Decorative: the button carries the
   accessible name. */
export default function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" fill="none" />
    </svg>
  );
}
