import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.liquidityhq.app',
  appName: 'Liquidity HQ',
  webDir: 'public',
  server: {
    url: 'https://liquidity-hq.onrender.com',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0a0a0a',
  },
};

export default config;
