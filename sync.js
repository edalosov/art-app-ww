import { FIREBASE_CONFIG, CLOUD_ENABLED } from './firebase-config.js';

const FIREBASE_SDK_VERSION = '10.13.2';
const SYNC_CODE_KEY = 'artLinkRotator.syncCode';
const COLLECTION = 'syncedLinkLists';

let app = null;
let db = null;
let unsubscribe = null;

export function isCloudEnabled() {
  return CLOUD_ENABLED;
}

export function getStoredSyncCode() {
  return localStorage.getItem(SYNC_CODE_KEY);
}

function setStoredSyncCode(code) {
  if (code) localStorage.setItem(SYNC_CODE_KEY, code);
  else localStorage.removeItem(SYNC_CODE_KEY);
}

export function generateSyncCode() {
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=/g, '');
  return b64.slice(0, 20);
}

async function loadFirestore() {
  if (db) return db;
  const [{ initializeApp }, firestoreMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`),
  ]);
  app = initializeApp(FIREBASE_CONFIG);
  db = firestoreMod.getFirestore(app);
  db._mod = firestoreMod; // stash the module so callers can reuse doc/setDoc/onSnapshot
  return db;
}

/**
 * Connect this device to a shared link list.
 * onRemoteUpdate(data|null) fires once with the current cloud state (null if the
 * doc doesn't exist yet), then again on every subsequent remote change.
 * Returns { code }.
 */
export async function connect(code, onRemoteUpdate, onError) {
  await disconnect();
  const database = await loadFirestore();
  const { doc, onSnapshot } = database._mod;
  const ref = doc(database, COLLECTION, code);
  unsubscribe = onSnapshot(
    ref,
    (snap) => onRemoteUpdate(snap.exists() ? snap.data() : null),
    (err) => onError && onError(err)
  );
  setStoredSyncCode(code);
  return { code };
}

export async function disconnect() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

export function forgetSyncCode() {
  setStoredSyncCode(null);
}

export async function push(code, stateObj) {
  if (!db) await loadFirestore();
  const { doc, setDoc } = db._mod;
  const ref = doc(db, COLLECTION, code);
  await setDoc(ref, { ...stateObj, updatedAt: Date.now() });
}
