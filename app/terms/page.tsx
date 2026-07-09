import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms of Use — LiquidityHQ' };

const SECTIONS = [
  {
    title: 'Acceptance of Terms',
    body: 'By accessing or using LiquidityHQ ("the Platform"), you agree to be bound by these Terms of Use. If you do not agree to these terms, do not use the Platform. We reserve the right to update these terms at any time; continued use of the Platform after changes constitutes acceptance.',
  },
  {
    title: 'Eligibility',
    body: 'You must be at least 18 years old to use LiquidityHQ. By using the Platform, you represent that you meet this requirement and that you have the legal capacity to enter into a binding agreement.',
  },
  {
    title: 'Nature of the Service',
    body: 'LiquidityHQ is an educational and informational tool. It provides market data, charting tools, AI-generated analysis, and alerts for cryptocurrency markets. Nothing on this Platform constitutes financial, investment, legal, or tax advice. All content is for informational purposes only.',
  },
  {
    title: 'User Accounts',
    body: 'You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You agree to notify us immediately of any unauthorized access. We reserve the right to suspend or terminate accounts that violate these terms.',
  },
  {
    title: 'Prohibited Uses',
    body: 'You may not use LiquidityHQ to engage in any unlawful activity, scrape or systematically extract data without authorization, attempt to reverse-engineer or bypass any security measure, resell or redistribute the Platform\'s content or signals, or interfere with the Platform\'s infrastructure or other users\' access.',
  },
  {
    title: 'Intellectual Property',
    body: 'All content, features, and functionality on LiquidityHQ — including but not limited to text, graphics, signals, scoring algorithms, and software — are the exclusive property of LiquidityHQ and its licensors. You may not reproduce, distribute, or create derivative works without express written permission.',
  },
  {
    title: 'Third-Party Data and Services',
    body: 'LiquidityHQ integrates data from third-party providers including Binance, Bybit, Finnhub, Alternative.me, and xAI Grok. We do not guarantee the accuracy, completeness, or timeliness of third-party data. Use of such data is subject to the respective third parties\' terms of service.',
  },
  {
    title: 'Limitation of Liability',
    body: 'To the maximum extent permitted by law, LiquidityHQ and its operator shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from your use of the Platform, including but not limited to trading losses, lost profits, or loss of data.',
  },
  {
    title: 'Indemnification',
    body: 'You agree to indemnify and hold harmless LiquidityHQ, its operator, and affiliates from any claims, damages, losses, or expenses (including legal fees) arising from your use of the Platform, your violation of these terms, or your violation of any rights of a third party.',
  },
  {
    title: 'Termination',
    body: 'We reserve the right to suspend or terminate your access to LiquidityHQ at any time, with or without notice, for any reason including violation of these terms. Upon termination, your right to use the Platform ceases immediately.',
  },
  {
    title: 'Governing Law',
    body: 'These Terms of Use shall be governed by and construed in accordance with applicable law. Any disputes arising under these terms shall be subject to the exclusive jurisdiction of the competent courts in the applicable jurisdiction.',
  },
  {
    title: 'Contact',
    body: 'If you have questions about these Terms of Use, please contact us at the email address provided on the About page.',
  },
];

export default function TermsOfUse() {
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
          Terms of Use.
        </h1>
        <p style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 16, lineHeight: 1.7 }}>
          Last updated: July 2026
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
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
          By using LiquidityHQ, you acknowledge that you have read, understood, and agree to these Terms of Use.
        </p>
        <p style={{ marginTop: 12 }}>© {new Date().getFullYear()} LiquidityHQ. All rights reserved.</p>
      </div>

    </div>
  );
}
