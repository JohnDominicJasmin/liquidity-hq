/* THE COOKIE BAR'S WORDS FOR THE LOCALE-PREFIXED LANDING PAGES (/ko, /zh, /ru; #1185, PM 2026-11-13).
 *
 * The landing page does not read the label table (#1889), so on /ru the bar - which reads the label table through `useLabels` in the shared shell - showed English. This is a
 * small separate module, not `dictionaries.ts`, because the cookie bar is in every page's bundle and the landing dictionary is not: importing the whole dictionary here would put
 * every landing word on every page.
 *
 * The strings are the ones already live in `lhq_labels` for CONSENT_BODY, CONSENT_ACCEPT, CONSENT_DECLINE, CONSENT_PRIVACY_LINK and CONSENT_ARIA_LABEL (read from the dev project
 * on 2026-11-13), so the bar says the same thing on the landing as it does inside the app. `ar` is included for when that locale is switched on. English is not here: it is the
 * label default the bar already uses.
 */
export type ConsentWords = { body: string; accept: string; decline: string; privacy: string; aria: string };

export const CONSENT_WORDS: Record<string, ConsentWords> = {
  ko: {
    body: '앱이 어떻게 사용되는지 이해하기 위해 분석 쿠키와 세션 녹화를 사용합니다. 수락하지 않으면 실행되지 않습니다. 로그인에 필요한 쿠키는 항상 켜져 있습니다.',
    accept: '수락', decline: '거부', privacy: '개인정보 처리방침', aria: '쿠키 및 분석 동의',
  },
  zh: {
    body: '我们使用分析 Cookie 和会话录制来了解应用的使用情况。除非您接受，否则这些功能不会运行。登录所需的 Cookie 始终开启。',
    accept: '接受', decline: '拒绝', privacy: '隐私政策', aria: 'Cookie 与分析同意',
  },
  ru: {
    body: 'Мы используем аналитические файлы cookie и записи сессий, чтобы понять, как используется приложение. Они не работают, пока вы не дадите согласие. Файлы cookie, необходимые для входа в аккаунт, включены всегда.',
    accept: 'Принять', decline: 'Отклонить', privacy: 'Политика конфиденциальности', aria: 'Согласие на cookie и аналитику',
  },
  ar: {
    body: 'نستخدم ملفات تعريف ارتباط التحليلات وتسجيلات الجلسات لفهم كيفية استخدام التطبيق. لا تعمل هذه إلا إذا وافقت. ملفات تعريف الارتباط اللازمة لتسجيل دخولك مفعّلة دائمًا.',
    accept: 'قبول', decline: 'رفض', privacy: 'سياسة الخصوصية', aria: 'الموافقة على ملفات تعريف الارتباط والتحليلات',
  },
};

/** The locale of a locale-prefixed landing path ('/ru', '/ru/'), or null for every other path. */
export function landingLocaleOf(pathname: string | null): string | null {
  const m = (pathname ?? '').match(/^\/(ko|zh|ru|ar)\/?$/);
  return m ? m[1] : null;
}
