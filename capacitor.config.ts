import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fraterna.beta',
  appName: 'Fraterna',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    backgroundColor: '#0a0a1a',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#0a0a1a',
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 2000,
      backgroundColor: '#0a0a1a',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#0a0a1a',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

// Android notification channel for Firebase Console
// When sending from Firebase Console, use channel_id: "default"
// Or create a custom channel in the app

export default config;
