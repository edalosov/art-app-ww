// Paste the values from your Firebase project's "Web app" config here.
// Firebase Console → Project settings → General → Your apps → SDK setup and configuration.
// These values are not secret (they're meant to be public in client apps) — access
// is controlled by the Firestore security rules instead. See README.md.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCmUEnaNHsxFBsLXF5ghkhKvVYGBNkAYU4',
  authDomain: 'link-app-white-walls.firebaseapp.com',
  projectId: 'link-app-white-walls',
  storageBucket: 'link-app-white-walls.firebasestorage.app',
  messagingSenderId: '1033539702383',
  appId: '1:1033539702383:web:56b1712924340c68e6079a',
};

export const CLOUD_ENABLED = FIREBASE_CONFIG.apiKey !== 'REPLACE_ME';
