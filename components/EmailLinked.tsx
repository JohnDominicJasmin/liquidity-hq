import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/supportContact';

/* Renders a label's text with the support address turned into a mailto link wherever it appears. The address is part of the label
   in every locale, so the link works in all of them without a new key. */
export default function EmailLinked({ text }: { text: string }) {
  const parts = text.split(SUPPORT_EMAIL);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <a href={SUPPORT_MAILTO} className="support-mail-link" style={{ color: 'var(--accent)', textDecoration: 'underline', unicodeBidi: 'isolate' }}>{SUPPORT_EMAIL}</a>}
        </span>
      ))}
    </>
  );
}
