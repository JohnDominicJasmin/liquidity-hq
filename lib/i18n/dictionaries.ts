// Landing-page translation dictionaries. Only the landing page is localized
// for now - the rest of the app (dashboard, Arena, etc.) stays English-only.

export const SUPPORTED_LOCALES = ['ko', 'zh', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number] | 'en';

export function isSupportedLocale(v: string): v is (typeof SUPPORTED_LOCALES)[number] {
  return (SUPPORTED_LOCALES as readonly string[]).includes(v);
}

export function dirForLocale(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export interface LandingDict {
  nav: { signIn: string; getStarted: string };
  hero: {
    badge: string;
    h1Line1: string;
    h1Line2: string;
    sub: string;
    ctaPrimary: string;
    ctaGhost: string;
    stats: { coins: string; signals: string; ai: string; telegram: string };
  };
  features: {
    label: string;
    h2: string;
    sub: string;
    openLabel: string;
    cards: Array<{ title: string; desc: string; pills: string[] }>;
  };
  howItWorks: {
    label: string;
    h2: string;
    steps: Array<{ title: string; desc: string }>;
  };
  pricing: {
    label: string;
    h2: string;
    free: { name: string; sub: string; features: string[]; cta: string };
    pro: { badge: string; name: string; sub: string; features: string[]; cta: string };
  };
  finalCta: { h2: string; sub: string; cta: string };
  footer: {
    brandDesc: string;
    columns: { product: string; analysis: string; tools: string; account: string };
    links: {
      dashboard: string; arena: string; briefing: string; news: string;
      scanner: string; liq: string; funding: string; correlation: string;
      journal: string; calc: string; alerts: string; hours: string;
      signIn: string; createAccount: string; pricing: string; about: string; disclaimer: string;
    };
    copyright: string;
    fullDisclaimer: string;
  };
}

export const en: LandingDict = {
  nav: { signIn: 'Sign In', getStarted: 'Get Started Free' },
  hero: {
    badge: 'Live · 50 coins · Real-time signals',
    h1Line1: 'Read the map.',
    h1Line2: 'Hunt the stops.',
    sub: 'Professional-grade crypto intelligence for retail traders. Squeeze scores, whale alerts, AI analysis, and macro events - all in one dashboard.',
    ctaPrimary: 'Start for free →',
    ctaGhost: 'See live briefing',
    stats: { coins: 'Coins tracked', signals: 'Signal types', ai: 'AI analysis', telegram: 'Telegram alerts' },
  },
  features: {
    label: 'What you get',
    h2: 'Everything a serious trader needs',
    sub: 'Live signals, alerts, and analysis - each tool built to answer one specific question, better than any alternative. All included free.',
    openLabel: 'Open',
    cards: [
      { title: 'AI Arena', desc: '35-signal confluence engine with live chart and Grok AI analysis. Funding rate, CVD, open interest trend, squeeze score, whale flow, GEX - all in one view.', pills: ['Grok 4.3', '35 signals', '50 coins'] },
      { title: 'Telegram Alerts', desc: 'Auto-fire alerts for squeeze setups, whale trades, RSI extremes, EMA crosses, rapid price moves, open interest spikes, and breaking news - before the crowd.', pills: ['Squeeze alerts', 'Whale trades', 'Breaking news'] },
      { title: 'Morning Briefing', desc: 'Daily macro snapshot: BTC dominance, DXY, S&P correlation, ETF flows, economic calendar, and hot setups. Know the backdrop before the session opens.', pills: ['Macro events', 'ETF flows', 'Hot setups'] },
      { title: 'News Feed', desc: 'Reuters, AP, Al Jazeera, Fox News, Politico, TruthSocial, CoinDesk and more - all classified and scored. Breaking geo-political news that moves crypto.', pills: ['12+ sources', 'Auto-classify', '~1 min lag'] },
      { title: 'Whale Tracker', desc: 'Real-time large trade detection across Binance and Bybit. Know when institutions move size. Configurable thresholds with per-coin sensitivity.', pills: ['Real-time', 'Binance + Bybit', 'All 50 coins'] },
      { title: 'Squeeze Scanner', desc: '3-signal squeeze score across all 50 coins simultaneously. Funding rate + L/S ratio + taker pressure - when all three align, the flush is coming.', pills: ['Score 0–100', 'All coins', '4h cooldown'] },
    ],
  },
  howItWorks: {
    label: 'How it works',
    h2: 'From signal to trade in seconds',
    steps: [
      { title: 'Connect Telegram', desc: 'Link your Telegram in Settings. Alerts fire automatically - squeeze setups, whale trades, FR extremes, breaking news.' },
      { title: 'Pick your coins', desc: 'Choose from 50 coins across majors, alts, and meme. The Squeeze Scanner watches all of them live, 24/7.' },
      { title: 'Run AI analysis', desc: 'Open AI Arena, select a coin, hit Analyze. Grok reads 35 live signals and gives you a direct, actionable trade bias.' },
    ],
  },
  pricing: {
    label: 'Pricing',
    h2: 'Start free. Upgrade when ready.',
    free: {
      name: 'Free', sub: 'Always free, no card needed',
      features: ['Dashboard + market overview', 'Morning briefing', 'News feed', 'All 50 coins - squeeze scanner', '7 Quick + 5 Deep AI analyses / day', '15 AI chat messages / day', 'Telegram alerts', 'Price alerts'],
      cta: 'Get started free',
    },
    pro: {
      badge: 'Most popular', name: 'Pro', sub: 'Everything, unlimited',
      features: ['Everything in Free', 'Telegram alerts - all signal types', 'Unlimited price alerts', '50 Quick + 25 Deep analyses / day', '100 AI chat messages / day', '25 live searches / day', 'Priority support'],
      cta: 'Get Pro - $15/mo',
    },
  },
  finalCta: { h2: 'Ready to read the map?', sub: 'Join traders who see the liquidity before it moves.', cta: 'Create free account →' },
  footer: {
    brandDesc: 'Live crypto intelligence for retail traders - squeeze scores, whale alerts, AI analysis, and macro events in one dashboard.',
    columns: { product: 'Product', analysis: 'Analysis', tools: 'Tools', account: 'Account' },
    links: {
      dashboard: 'Dashboard', arena: 'AI Arena', briefing: 'Briefing', news: 'News',
      scanner: 'Setup Scanner', liq: 'Liquidation Map', funding: 'FR History', correlation: 'Correlation',
      journal: 'Journal', calc: 'Position Sizer', alerts: 'Alerts', hours: 'Best Hours',
      signIn: 'Sign In', createAccount: 'Create Account', pricing: 'Pricing', about: 'About', disclaimer: 'Disclaimer',
    },
    copyright: '© 2026 LiquidityHQ · Educational content only, not financial advice ·',
    fullDisclaimer: 'Full disclaimer',
  },
};

export const ko: LandingDict = {
  nav: { signIn: '로그인', getStarted: '무료로 시작하기' },
  hero: {
    badge: '실시간 · 50개 코인 · 실시간 신호',
    h1Line1: '지도를 읽으세요.',
    h1Line2: '손절을 사냥하세요.',
    sub: '리테일 트레이더를 위한 전문가급 암호화폐 인텔리전스. 스퀴즈 점수, 고래 알림, AI 분석, 매크로 이벤트까지 하나의 대시보드에서 확인하세요.',
    ctaPrimary: '무료로 시작하기 →',
    ctaGhost: '실시간 브리핑 보기',
    stats: { coins: '추적 코인', signals: '신호 유형', ai: 'AI 분석', telegram: '텔레그램 알림' },
  },
  features: {
    label: '제공 기능',
    h2: '진지한 트레이더에게 필요한 모든 것',
    sub: '실시간 신호, 알림, 분석까지 - 각 도구는 하나의 질문에 가장 정확하게 답하도록 만들어졌습니다. 모두 무료로 제공됩니다.',
    openLabel: '열기',
    cards: [
      { title: 'AI 아레나', desc: '35개 신호가 합류하는 엔진에 실시간 차트와 Grok AI 분석까지. 펀딩비, CVD, 미결제약정 추세, 스퀴즈 점수, 고래 흐름, GEX를 한 화면에서 확인하세요.', pills: ['Grok 4.3', '35개 신호', '50개 코인'] },
      { title: '텔레그램 알림', desc: '스퀴즈 셋업, 고래 거래, RSI 과열/과매도, EMA 교차, 급격한 가격 변동, 미결제약정 급등, 속보까지 - 남들보다 먼저 자동으로 알려드립니다.', pills: ['스퀴즈 알림', '고래 거래', '속보'] },
      { title: '모닝 브리핑', desc: '매일의 매크로 스냅샷: BTC 도미넌스, 달러 지수(DXY), S&P 상관관계, ETF 자금 흐름, 경제 캘린더, 핫한 셋업까지. 장이 열리기 전에 배경을 파악하세요.', pills: ['매크로 이벤트', 'ETF 자금 흐름', '핫 셋업'] },
      { title: '뉴스 피드', desc: '로이터, AP, 알자지라, 폭스뉴스, 폴리티코, 트루스소셜, 코인데스크 등 - 모두 분류되고 점수화됩니다. 암호화폐를 움직이는 지정학적 속보까지.', pills: ['12개 이상 소스', '자동 분류', '약 1분 지연'] },
      { title: '고래 트래커', desc: '바이낸스와 바이빗 전반의 대형 거래를 실시간으로 감지합니다. 기관이 대규모로 움직이는 순간을 놓치지 마세요. 코인별 민감도로 임계값을 설정할 수 있습니다.', pills: ['실시간', 'Binance + Bybit', '50개 코인 전체'] },
      { title: '스퀴즈 스캐너', desc: '50개 코인 전체를 동시에 스캔하는 3가지 신호 기반 스퀴즈 점수. 펀딩비 + 롱숏 비율 + 테이커 압력 - 세 가지가 모두 일치하면 플러시가 옵니다.', pills: ['0~100점', '전체 코인', '4시간 쿨다운'] },
    ],
  },
  howItWorks: {
    label: '이용 방법',
    h2: '신호에서 거래까지, 몇 초 만에',
    steps: [
      { title: '텔레그램 연결', desc: '설정에서 텔레그램을 연결하세요. 스퀴즈 셋업, 고래 거래, 펀딩비 극값, 속보까지 알림이 자동으로 발송됩니다.' },
      { title: '코인 선택', desc: '메이저, 알트, 밈 코인까지 50개 코인 중에서 선택하세요. 스퀴즈 스캐너가 24시간 실시간으로 모두 감시합니다.' },
      { title: 'AI 분석 실행', desc: 'AI 아레나를 열고 코인을 선택한 뒤 분석하기를 누르세요. Grok이 35개의 실시간 신호를 읽고 명확하고 실행 가능한 트레이딩 방향을 제시합니다.' },
    ],
  },
  pricing: {
    label: '요금제',
    h2: '무료로 시작하고, 준비되면 업그레이드하세요.',
    free: {
      name: '무료', sub: '항상 무료, 카드 필요 없음',
      features: ['대시보드 + 시장 개요', '모닝 브리핑', '뉴스 피드', '전체 50개 코인 - 스퀴즈 스캐너', '일일 퀵 분석 7회 + 딥 분석 5회', '일일 AI 채팅 15회', '텔레그램 알림', '가격 알림'],
      cta: '무료로 시작하기',
    },
    pro: {
      badge: '가장 인기', name: 'Pro', sub: '모든 기능, 무제한',
      features: ['무료 플랜의 모든 기능', '텔레그램 알림 - 전체 신호 유형', '무제한 가격 알림', '일일 퀵 분석 50회 + 딥 분석 25회', '일일 AI 채팅 100회', '일일 실시간 검색 25회', '우선 지원'],
      cta: 'Pro 시작하기 - $15/월',
    },
  },
  finalCta: { h2: '지도를 읽을 준비가 되셨나요?', sub: '유동성이 움직이기 전에 미리 보는 트레이더들과 함께하세요.', cta: '무료 계정 만들기 →' },
  footer: {
    brandDesc: '리테일 트레이더를 위한 실시간 암호화폐 인텔리전스 - 스퀴즈 점수, 고래 알림, AI 분석, 매크로 이벤트를 하나의 대시보드에서.',
    columns: { product: '제품', analysis: '분석', tools: '도구', account: '계정' },
    links: {
      dashboard: '대시보드', arena: 'AI 아레나', briefing: '브리핑', news: '뉴스',
      scanner: '셋업 스캐너', liq: '청산 맵', funding: '펀딩비 히스토리', correlation: '상관관계',
      journal: '매매일지', calc: '포지션 사이저', alerts: '알림', hours: '최적 시간대',
      signIn: '로그인', createAccount: '계정 만들기', pricing: '요금제', about: '소개', disclaimer: '면책조항',
    },
    copyright: '© 2026 LiquidityHQ · 교육 목적의 콘텐츠이며 투자 자문이 아닙니다 ·',
    fullDisclaimer: '전체 면책조항 보기',
  },
};

export const zh: LandingDict = {
  nav: { signIn: '登录', getStarted: '免费开始使用' },
  hero: {
    badge: '实时 · 50种币 · 实时信号',
    h1Line1: '读懂地图。',
    h1Line2: '猎取止损点。',
    sub: '为散户交易者打造的专业级加密货币情报系统。挤压评分、巨鲸警报、AI分析和宏观事件--尽在一个仪表盘。',
    ctaPrimary: '免费开始 →',
    ctaGhost: '查看实时简报',
    stats: { coins: '追踪币种', signals: '信号类型', ai: 'AI分析', telegram: 'Telegram提醒' },
  },
  features: {
    label: '您将获得',
    h2: '专业交易者所需的一切',
    sub: '实时信号、提醒与分析--每个工具只为回答一个问题而生,做得比任何替代方案都好。全部免费提供。',
    openLabel: '打开',
    cards: [
      { title: 'AI Arena', desc: '35信号共振引擎,搭载实时图表与Grok AI分析。资金费率、CVD、未平仓合约趋势、挤压评分、巨鲸流向、GEX--尽在一屏。', pills: ['Grok 4.3', '35个信号', '50种币'] },
      { title: 'Telegram提醒', desc: '挤压形态、巨鲸交易、RSI极值、EMA交叉、价格快速波动、未平仓合约激增、突发新闻--自动提醒,抢先一步。', pills: ['挤压提醒', '巨鲸交易', '突发新闻'] },
      { title: '晨间简报', desc: '每日宏观快照:BTC市占率、美元指数(DXY)、标普关联性、ETF资金流向、经济日历及热门形态。开盘前先了解大局。', pills: ['宏观事件', 'ETF资金流', '热门形态'] },
      { title: '新闻资讯', desc: '路透社、美联社、半岛电视台、福克斯新闻、Politico、TruthSocial、CoinDesk等--全部经过分类与评分。影响加密市场的地缘政治突发新闻。', pills: ['12+信息源', '自动分类', '约1分钟延迟'] },
      { title: '巨鲸追踪', desc: '实时侦测币安与Bybit上的大额交易。机构大举出手时第一时间知晓。可按币种自定义灵敏度阈值。', pills: ['实时', 'Binance + Bybit', '全部50种币'] },
      { title: '挤压扫描器', desc: '同时扫描全部50种币的三信号挤压评分。资金费率+多空比+吃单压力--三者共振时,插针行情即将到来。', pills: ['0-100分', '所有币种', '4小时冷却'] },
    ],
  },
  howItWorks: {
    label: '使用方法',
    h2: '从信号到交易,只需几秒',
    steps: [
      { title: '连接Telegram', desc: '在设置中连接您的Telegram。警报将自动触发--挤压形态、巨鲸交易、资金费率极值、突发新闻。' },
      { title: '选择币种', desc: '从主流币、山寨币到meme币,共50种可供选择。挤压扫描器24/7实时监控全部币种。' },
      { title: '运行AI分析', desc: '打开AI Arena,选择币种,点击分析。Grok读取35个实时信号,为您提供直接、可执行的交易倾向。' },
    ],
  },
  pricing: {
    label: '定价',
    h2: '免费开始,准备好后再升级。',
    free: {
      name: '免费版', sub: '永久免费,无需信用卡',
      features: ['仪表盘+市场概览', '晨间简报', '新闻资讯', '全部50种币--挤压扫描器', '每日7次快速+5次深度AI分析', '每日15条AI聊天消息', 'Telegram提醒', '价格提醒'],
      cta: '免费开始使用',
    },
    pro: {
      badge: '最受欢迎', name: 'Pro', sub: '全部功能,无限制',
      features: ['免费版全部功能', 'Telegram提醒--全部信号类型', '无限价格提醒', '每日50次快速+25次深度分析', '每日100条AI聊天消息', '每日25次实时搜索', '优先支持'],
      cta: '升级Pro--$15/月',
    },
  },
  finalCta: { h2: '准备好读懂地图了吗?', sub: '加入那些在流动性变动前就已洞察先机的交易者行列。', cta: '创建免费账户 →' },
  footer: {
    brandDesc: '为散户交易者打造的实时加密货币情报--挤压评分、巨鲸警报、AI分析与宏观事件,尽在一个仪表盘。',
    columns: { product: '产品', analysis: '分析', tools: '工具', account: '账户' },
    links: {
      dashboard: '仪表盘', arena: 'AI Arena', briefing: '简报', news: '新闻',
      scanner: '形态扫描器', liq: '清算地图', funding: '资金费率历史', correlation: '关联性',
      journal: '交易日志', calc: '仓位计算器', alerts: '提醒', hours: '最佳时段',
      signIn: '登录', createAccount: '创建账户', pricing: '定价', about: '关于我们', disclaimer: '免责声明',
    },
    copyright: '© 2026 LiquidityHQ · 仅供教育用途,非投资建议 ·',
    fullDisclaimer: '查看完整免责声明',
  },
};

export const ar: LandingDict = {
  nav: { signIn: 'تسجيل الدخول', getStarted: 'ابدأ مجانًا' },
  hero: {
    badge: 'مباشر · 50 عملة · إشارات لحظية',
    h1Line1: 'اقرأ الخريطة.',
    h1Line2: 'اصطد نقاط وقف الخسارة.',
    sub: 'معلومات احترافية عن العملات الرقمية لصالح المتداولين الأفراد. درجات الانضغاط، تنبيهات الحيتان، تحليل الذكاء الاصطناعي، والأحداث الاقتصادية الكلية - كل ذلك في لوحة تحكم واحدة.',
    ctaPrimary: 'ابدأ مجانًا ←',
    ctaGhost: 'شاهد الموجز المباشر',
    stats: { coins: 'عملات متتبعة', signals: 'أنواع الإشارات', ai: 'تحليل الذكاء الاصطناعي', telegram: 'تنبيهات تيليجرام' },
  },
  features: {
    label: 'ما ستحصل عليه',
    h2: 'كل ما يحتاجه المتداول الجاد',
    sub: 'إشارات وتنبيهات وتحليلات مباشرة - كل أداة مصمّمة للإجابة عن سؤال محدد بدقة تفوق أي بديل آخر. كل ذلك متاح مجانًا.',
    openLabel: 'افتح',
    cards: [
      { title: 'AI Arena', desc: 'محرك تقارب من 35 إشارة مع مخطط مباشر وتحليل Grok للذكاء الاصطناعي. معدل التمويل، CVD، اتجاه الفائدة المفتوحة، درجة الانضغاط، تدفق الحيتان، GEX - كل ذلك في شاشة واحدة.', pills: ['Grok 4.3', '35 إشارة', '50 عملة'] },
      { title: 'تنبيهات تيليجرام', desc: 'تنبيهات تلقائية لإعدادات الانضغاط، صفقات الحيتان، تطرف RSI، تقاطعات EMA، تحركات الأسعار السريعة، ارتفاعات الفائدة المفتوحة، والأخبار العاجلة - قبل الجميع.', pills: ['تنبيهات الانضغاط', 'صفقات الحيتان', 'أخبار عاجلة'] },
      { title: 'الموجز الصباحي', desc: 'لقطة اقتصادية يومية: هيمنة البيتكوين، مؤشر الدولار DXY، الارتباط مع S&P، تدفقات صناديق ETF، التقويم الاقتصادي، وأفضل الإعدادات. اعرف الخلفية قبل بدء الجلسة.', pills: ['أحداث اقتصادية كلية', 'تدفقات ETF', 'إعدادات رائجة'] },
      { title: 'خلاصة الأخبار', desc: 'رويترز، أسوشيتد برس، الجزيرة، فوكس نيوز، بوليتيكو، تروث سوشال، كوين ديسك، والمزيد - مصنّفة ومقيّمة بالكامل. أخبار جيوسياسية عاجلة تحرك سوق العملات الرقمية.', pills: ['+12 مصدر', 'تصنيف تلقائي', 'تأخير ~دقيقة واحدة'] },
      { title: 'متتبع الحيتان', desc: 'كشف لحظي للصفقات الكبيرة عبر Binance وBybit. اعرف متى تتحرك المؤسسات بكميات كبيرة. حدود قابلة للتخصيص لكل عملة.', pills: ['لحظي', 'Binance + Bybit', 'جميع العملات الـ50'] },
      { title: 'ماسح الانضغاط', desc: 'درجة انضغاط بثلاث إشارات عبر جميع العملات الـ50 في آن واحد. معدل التمويل + نسبة الشراء/البيع + ضغط المتداولين - عندما تتوافق الثلاثة، يقترب الانفجار السعري.', pills: ['درجة 0-100', 'جميع العملات', 'فترة انتظار 4 ساعات'] },
    ],
  },
  howItWorks: {
    label: 'كيف يعمل',
    h2: 'من الإشارة إلى الصفقة في ثوانٍ',
    steps: [
      { title: 'اربط تيليجرام', desc: 'اربط حساب تيليجرام في الإعدادات. تُرسَل التنبيهات تلقائيًا - إعدادات الانضغاط، صفقات الحيتان، تطرف معدل التمويل، الأخبار العاجلة.' },
      { title: 'اختر عملاتك', desc: 'اختر من بين 50 عملة تشمل العملات الرئيسية والبديلة وعملات الميم. يراقب ماسح الانضغاط جميعها مباشرة على مدار الساعة.' },
      { title: 'شغّل تحليل الذكاء الاصطناعي', desc: 'افتح AI Arena، اختر عملة، واضغط تحليل. يقرأ Grok 35 إشارة مباشرة ويمنحك اتجاه تداول واضحًا وقابلاً للتنفيذ.' },
    ],
  },
  pricing: {
    label: 'الأسعار',
    h2: 'ابدأ مجانًا. قم بالترقية عندما تكون جاهزًا.',
    free: {
      name: 'مجاني', sub: 'مجاني دائمًا، بدون الحاجة لبطاقة',
      features: ['لوحة التحكم + نظرة عامة على السوق', 'الموجز الصباحي', 'خلاصة الأخبار', 'جميع العملات الـ50 - ماسح الانضغاط', '7 تحليلات سريعة + 5 تحليلات معمّقة يوميًا', '15 رسالة دردشة ذكاء اصطناعي يوميًا', 'تنبيهات تيليجرام', 'تنبيهات الأسعار'],
      cta: 'ابدأ مجانًا',
    },
    pro: {
      badge: 'الأكثر شيوعًا', name: 'Pro', sub: 'كل شيء، بلا حدود',
      features: ['كل ما في الخطة المجانية', 'تنبيهات تيليجرام - جميع أنواع الإشارات', 'تنبيهات أسعار غير محدودة', '50 تحليل سريع + 25 تحليلًا معمّقًا يوميًا', '100 رسالة دردشة ذكاء اصطناعي يوميًا', '25 بحثًا مباشرًا يوميًا', 'دعم ذو أولوية'],
      cta: 'احصل على Pro - 15$/شهريًا',
    },
  },
  finalCta: { h2: 'هل أنت مستعد لقراءة الخريطة؟', sub: 'انضم إلى المتداولين الذين يرون السيولة قبل أن تتحرك.', cta: 'أنشئ حسابًا مجانيًا ←' },
  footer: {
    brandDesc: 'معلومات لحظية عن العملات الرقمية للمتداولين الأفراد - درجات الانضغاط، تنبيهات الحيتان، تحليل الذكاء الاصطناعي، والأحداث الاقتصادية الكلية في لوحة تحكم واحدة.',
    columns: { product: 'المنتج', analysis: 'التحليل', tools: 'الأدوات', account: 'الحساب' },
    links: {
      dashboard: 'لوحة التحكم', arena: 'AI Arena', briefing: 'الموجز', news: 'الأخبار',
      scanner: 'ماسح الإعدادات', liq: 'خريطة التصفية', funding: 'سجل معدل التمويل', correlation: 'الارتباط',
      journal: 'سجل التداول', calc: 'حاسبة حجم المركز', alerts: 'التنبيهات', hours: 'أفضل الأوقات',
      signIn: 'تسجيل الدخول', createAccount: 'إنشاء حساب', pricing: 'الأسعار', about: 'من نحن', disclaimer: 'إخلاء المسؤولية',
    },
    copyright: '© 2026 LiquidityHQ · محتوى تعليمي فقط، وليس نصيحة مالية ·',
    fullDisclaimer: 'إخلاء المسؤولية الكامل',
  },
};

export const dictionaries: Record<Locale, LandingDict> = { en, ko, zh, ar };

export function getDictionary(locale: string): LandingDict {
  return isSupportedLocale(locale) ? dictionaries[locale] : dictionaries.en;
}
