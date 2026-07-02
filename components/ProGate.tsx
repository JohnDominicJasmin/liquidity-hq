'use client';
import { useAuth } from './AuthProvider';

interface ProGateProps {
  children: React.ReactNode;
  feature?: string;
}

export default function ProGate({ children, feature }: ProGateProps) {
  const { isPro } = useAuth();
  if (isPro) return <>{children}</>;

  return (
    <div className="pro-gate">
      
      <div className="pro-gate-title">Pro Feature</div>
      <p className="pro-gate-desc">
        {feature ?? 'Upgrade to Pro to unlock this feature.'}
      </p>
      <a href="/upgrade" className="pro-gate-btn">
        Upgrade to Pro — $15/mo
      </a>
    </div>
  );
}
