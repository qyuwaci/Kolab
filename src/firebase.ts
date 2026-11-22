import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
}

const localConfigModules = import.meta.glob<{ default: Partial<FirebaseAppletConfig> }>(
  '../firebase-applet-config.json',
  { eager: true }
);
const localConfig = Object.values(localConfigModules)[0]?.default;

const firebaseConfig: FirebaseAppletConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || localConfig?.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || localConfig?.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || localConfig?.projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || localConfig?.storageBucket || '',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || localConfig?.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || localConfig?.appId || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || localConfig?.measurementId || '',
  firestoreDatabaseId:
    import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    localConfig?.firestoreDatabaseId ||
    '(default)',
};

// Tanpa konfigurasi Firebase, login tidak bisa jalan. Tampilkan pesan yang jelas
// alih-alih membiarkan halaman tertahan di "Memeriksa sesi masuk...".
export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
if (!firebaseConfigured && typeof document !== 'undefined') {
  const showNotice = () => {
    if (document.getElementById('kolab-config-notice')) return;
    const box = document.createElement('div');
    box.id = 'kolab-config-notice';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:10000;max-width:640px;margin:0 auto;padding:16px 18px;border-radius:14px;background:#140B07;color:#fff;font:15px/1.5 Inter,system-ui,sans-serif;box-shadow:0 16px 40px rgba(0,0,0,.3)';
    box.textContent = 'Kolab belum tersambung ke Firebase, jadi login belum bisa dipakai. Pemilik website perlu mengisi variabel VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_APP_ID, dan VITE_FIREBASE_AUTH_DOMAIN, lalu build ulang.';
    document.body.appendChild(box);
    const loading = document.getElementById('loadingBox');
    if (loading) loading.textContent = 'Login belum tersedia.';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showNotice);
  else showNotice();
  console.error('Konfigurasi Firebase kosong: isi VITE_FIREBASE_* atau firebase-applet-config.json.');
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
