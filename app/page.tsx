import LandingContent from '@/components/LandingContent';
import { en } from '@/lib/i18n/dictionaries';

export default function LandingPage() {
  return <LandingContent dict={en} locale="en" dir="ltr" />;
}
