import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy Policy' };

const SECTIONS = [
  {
    title: 'Information We Collect',
    body: 'We collect information you provide directly: email address and password when creating an account, and any preferences or settings you configure within the Platform. We also collect usage data automatically - pages visited, features used, session duration - to improve the service.',
  },
  {
    title: 'How We Use Your Information',
    body: 'We use your information to operate and improve LiquidityHQ, authenticate your account, send service-related communications (such as account updates or security notices), and analyze usage patterns to prioritize features. We do not use your data to provide personalized investment advice.',
  },
  {
    title: 'Data Storage and Security',
    body: 'Account data is stored securely via Supabase, a managed cloud database provider. We implement industry-standard security measures including encryption in transit (TLS) and at rest. No system is perfectly secure, and we cannot guarantee absolute security of your data.',
  },
  {
    title: 'Third-Party Services',
    body: 'LiquidityHQ integrates with third-party services including Supabase (database), xAI Grok (AI analysis), Binance, Bybit, Finnhub, and Alternative.me (market data). These providers have their own privacy policies and data practices. We are not responsible for their data handling.',
  },
  {
    title: 'Cookies and Tracking',
    body: 'We use session cookies necessary for authentication and platform functionality. We do not currently use third-party advertising cookies or cross-site tracking. You may disable cookies in your browser, but doing so will prevent you from logging in.',
  },
  {
    title: 'Data Retention',
    body: 'We retain your account data for as long as your account is active. If you delete your account, we will remove your personal data from active systems within 30 days, except where retention is required by law or for legitimate business purposes such as fraud prevention.',
  },
  {
    title: 'Sharing of Information',
    body: 'We do not sell your personal data. We do not share your data with third parties for marketing purposes. We may share data with service providers who assist in operating the Platform (e.g., hosting, analytics) under data processing agreements, and when required by law.',
  },
  {
    title: 'Your Rights',
    body: 'Depending on your jurisdiction, you may have the right to access, correct, or delete your personal data; to restrict or object to processing; and to data portability. To exercise these rights, contact us at the address below. We will respond within 30 days.',
  },
  {
    title: 'Children\'s Privacy',
    body: 'LiquidityHQ is not intended for users under 18 years of age. We do not knowingly collect personal information from minors. If we learn that we have collected data from a user under 18, we will delete it promptly.',
  },
  {
    title: 'International Users',
    body: 'LiquidityHQ is operated from the Philippines. If you access the Platform from outside the Philippines, your data may be transferred to and processed in the Philippines or other countries where our service providers operate. By using the Platform, you consent to this transfer.',
  },
  {
    title: 'Changes to This Policy',
    body: 'We may update this Privacy Policy from time to time. When we do, we will update the date at the top of this page. Continued use of the Platform after changes constitute acceptance of the updated policy. For material changes, we will provide notice via email or an in-app notification.',
  },
  {
    title: 'Contact Us',
    body: 'If you have questions about this Privacy Policy or how we handle your data, please contact us at the email address listed on the About page. We take privacy inquiries seriously and will respond promptly.',
  },
];

export default function PrivacyPolicy() {
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>

      <div style={{ marginBottom: 48 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 14,
        }}>
          Legal
        </div>
        <h1 style={{ fontSize: 42, fontWeight: 800, color: 'var(--txt)', margin: 0, lineHeight: 1.1 }}>
          Privacy Policy.
        </h1>
        <p style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          Last updated: July 2026
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '40px 52px',
        marginBottom: 64,
      }}>
        {SECTIONS.map(s => (
          <div key={s.title}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', marginBottom: 10, lineHeight: 1.3 }}>
              {s.title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.75 }}>
              {s.body}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        borderTop: '1px solid var(--bdr)',
        paddingTop: 28,
        fontSize: 12,
        color: 'var(--txt3)',
        lineHeight: 1.9,
      }}>
        <p>
          By using LiquidityHQ, you acknowledge that you have read and understood this Privacy Policy and consent to the collection and use of your information as described.
        </p>
        <p style={{ marginTop: 12 }}>© {new Date().getFullYear()} LiquidityHQ. All rights reserved.</p>
      </div>

    </div>
  );
}
