// Paste the values from your Firebase project's "Web app" config here.
// Firebase Console → Project settings → General → Your apps → SDK setup and configuration.
// These values are not secret (they're meant to be public in client apps) — access
// is controlled by the Firestore security rules instead. See README.md.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME',
  projectId: 'REPLACE_ME',
  storageBucket: 'REPLACE_ME',
  messagingSenderId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

export const CLOUD_ENABLED = FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
