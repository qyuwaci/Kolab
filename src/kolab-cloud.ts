import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  GoogleAuthProvider,
  linkWithPopup,
  reauthenticateWithPopup,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  increment,
  type Timestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { openPaymentGatewayModal, type PaymentPurpose } from './kolab-payment-modal';

export interface SessionInfo {
  id: string;
  role: 'umkm' | 'creator' | 'admin';
  name: string;
  email?: string;
  avatarUrl?: string;
}

const SESSION_ROLE_KEY = 'kolab_active_role';
const MIN_PAYOUT = 50000;

const PLANS: Record<string, Record<string, any>> = {
  umkm: {
    free: {
      id: 'free',
      name: 'Gratis',
      monthlyPrice: 0,
      yearlyPrice: 0,
      monthly: 0,
      yearly: 0,
      maxActiveCampaigns: 2,
      recommendationLimit: 3,
      recommendLimit: 3,
      licenseDiscount: 0,
      featured: false,
      tagline: 'Mulai kolaborasi UGC tanpa biaya langganan.',
      features: [
        'Maksimal 2 kampanye aktif bersamaan',
        'Rekomendasi maksimal 3 kreator per kampanye',
        'Sistem pembayaran escrow aman',
        'Akses Pasar Lisensi Konten (harga standar)',
      ],
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      monthlyPrice: 149000,
      yearlyPrice: 1490000,
      monthly: 149000,
      yearly: 1490000,
      maxActiveCampaigns: 10,
      recommendationLimit: 10,
      recommendLimit: 10,
      licenseDiscount: 0.1,
      featured: false,
      tagline: 'Ideal untuk UMKM bertumbuh yang rutin memproduksi konten iklan.',
      features: [
        'Maksimal 10 kampanye aktif bersamaan',
        'Rekomendasi hingga 10 kreator per kampanye',
        'Diskon 10% pembelian lisensi iklan & buyout',
        'Analitik ROI & performa konten lengkap',
      ],
    },
    business: {
      id: 'business',
      name: 'Business',
      monthlyPrice: 399000,
      yearlyPrice: 3990000,
      monthly: 399000,
      yearly: 3990000,
      maxActiveCampaigns: 999,
      recommendationLimit: 999,
      recommendLimit: 999,
      licenseDiscount: 0.2,
      featured: true,
      tagline: 'Skala penuh untuk brand dengan kebutuhan UGC agresif.',
      features: [
        'Kampanye aktif tanpa batas (unlimited)',
        'Akses semua rekomendasi kreator terbaik',
        'Diskon 20% pembelian semua lisensi konten',
        'Badge Kampanye Unggulan (prioritas tampil teratas)',
      ],
    },
  },
  creator: {
    free: {
      id: 'free',
      name: 'Gratis',
      monthlyPrice: 0,
      yearlyPrice: 0,
      monthly: 0,
      yearly: 0,
      platformFeeRate: 0.15,
      feeRate: 0.15,
      maxLibraryListings: 2,
      priorityBoost: 0,
      boost: 0,
      tagline: 'Mulai menghasilkan dari konten review autentik.',
      features: [
        'Fee platform standar 15% per transaksi',
        'Maksimal 2 konten dijual di Pasar Lisensi',
        'Akses seluruh kampanye terbuka',
        'Pencairan penghasilan ke bank/e-wallet',
      ],
    },
    plus: {
      id: 'plus',
      name: 'Plus',
      monthlyPrice: 39000,
      yearlyPrice: 390000,
      monthly: 39000,
      yearly: 390000,
      platformFeeRate: 0.1,
      feeRate: 0.1,
      maxLibraryListings: 10,
      priorityBoost: 15,
      boost: 0.15,
      tagline: 'Tingkatkan margin bersih & katalog konten lisensi Anda.',
      features: [
        'Fee platform lebih hemat: hanya 10%',
        'Hingga 10 listing di Pasar Lisensi Konten',
        'Prioritas rekomendasi ke brand UMKM (+15 skor)',
        'Badge Creator Plus di profil publik',
      ],
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      monthlyPrice: 89000,
      yearlyPrice: 890000,
      monthly: 89000,
      yearly: 890000,
      platformFeeRate: 0.07,
      feeRate: 0.07,
      maxLibraryListings: 999,
      priorityBoost: 30,
      boost: 0.3,
      tagline: 'Maksimal profit untuk kreator UGC profesional.',
      features: [
        'Fee platform terendah: hanya 7%',
        'Listing konten tanpa batas di Pasar Lisensi',
        'Prioritas tertinggi rekomendasi brand (+30 skor)',
        'Analitik performa & verifikasi OAuth sosial media',
      ],
    },
  },
};

function tsToIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  return new Date().toISOString();
}

function formatRupiah(amount: number): string {
  return 'Rp' + Math.round(Number(amount) || 0).toLocaleString('id-ID');
}

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getInfluencerTier(followers: number): 'Nano' | 'Mikro' | 'Makro' | 'Mega' {
  const f = Number(followers) || 0;
  if (f >= 1000000) return 'Mega';
  if (f >= 100000) return 'Makro';
  if (f >= 10000) return 'Mikro';
  return 'Nano';
}

interface CacheState {
  users: any[];
  privateInfo: Record<string, any>;
  wallets: Record<string, { balance: number; held: number }>;
  campaigns: any[];
  applications: any[];
  submissions: any[];
  licenses: any[];
  reviews: any[];
  transactions: any[];
  socialAccounts: Record<string, Record<string, any>>;
}

const state: CacheState = {
  users: [],
  privateInfo: {},
  wallets: {},
  campaigns: [],
  applications: [],
  submissions: [],
  licenses: [],
  reviews: [],
  transactions: [],
  socialAccounts: {},
};

let currentFirebaseUser: FirebaseUser | null = null;
let currentSession: SessionInfo | null = null;
let readyPromise: Promise<void> | null = null;
const pendingWrites: Promise<unknown>[] = [];

function enqueueWrite(p: Promise<unknown>): void {
  pendingWrites.push(
    p.catch((err) => {
      console.error('Background Firestore write failed:', err);
    })
  );
}

async function flush(): Promise<void> {
  if (pendingWrites.length === 0) return;
  const copy = pendingWrites.splice(0, pendingWrites.length);
  await Promise.allSettled(copy);
}

function findBy<T extends Record<string, any>>(arr: T[], key: string, val: unknown): T | undefined {
  return arr.find((x) => x[key] === val);
}

async function loadCloudState(fbUser: FirebaseUser | null): Promise<void> {
  state.users = [];
  state.privateInfo = {};
  state.wallets = {};
  state.campaigns = [];
  state.applications = [];
  state.submissions = [];
  state.licenses = [];
  state.reviews = [];
  state.transactions = [];
  state.socialAccounts = {};
  currentSession = null;

  if (!fbUser) return;

  const uid = fbUser.uid;
  const isAdminEmail = fbUser.email === 'kikynepth@gmail.com' && fbUser.emailVerified;

  // 1. Fetch own user doc
  let ownUserDoc: any = null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      const d = snap.data();
      ownUserDoc = {
        ...d,
        id: d.uid || snap.id,
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
        subscription: d.planId
          ? {
              planId: d.planId,
              cycle: d.planCycle || 'monthly',
              status: d.planStatus || 'active',
              expiresAt: d.planExpiresAt || null,
            }
          : null,
      };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  // Determine active session
  const preferredRole = sessionStorage.getItem(SESSION_ROLE_KEY);
  if (isAdminEmail && preferredRole === 'admin') {
    currentSession = {
      id: uid,
      role: 'admin',
      name: ownUserDoc?.name || fbUser.displayName || 'Administrator Kolab',
      email: fbUser.email || '',
      avatarUrl: ownUserDoc?.avatarUrl || fbUser.photoURL || '',
    };
  } else if (ownUserDoc) {
    currentSession = {
      id: uid,
      role: ownUserDoc.role,
      name: ownUserDoc.name,
      email: fbUser.email || '',
      avatarUrl: ownUserDoc.avatarUrl || fbUser.photoURL || '',
    };
  }

  // 2. Fetch own private PII doc
  try {
    const privSnap = await getDoc(doc(db, 'users', uid, 'private', 'info'));
    if (privSnap.exists()) {
      state.privateInfo[uid] = privSnap.data();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}/private/info`);
  }

  // 3. Fetch own wallet
  try {
    const wSnap = await getDoc(doc(db, 'wallets', uid));
    if (wSnap.exists()) {
      const wd = wSnap.data();
      state.wallets[uid] = { balance: Number(wd.balance || 0), held: Number(wd.held || 0) };
    } else {
      state.wallets[uid] = { balance: 0, held: 0 };
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `wallets/${uid}`);
  }

  // 4. Fetch active users (and suspended if admin)
  const userMap = new Map<string, any>();
  if (ownUserDoc) userMap.set(uid, ownUserDoc);

  try {
    const qActive = query(collection(db, 'users'), where('status', '==', 'active'));
    const snap = await getDocs(qActive);
    snap.forEach((dSnap) => {
      const d = dSnap.data();
      userMap.set(dSnap.id, {
        ...d,
        id: d.uid || dSnap.id,
        createdAt: tsToIso(d.createdAt),
        updatedAt: tsToIso(d.updatedAt),
        subscription: d.planId
          ? {
              planId: d.planId,
              cycle: d.planCycle || 'monthly',
              status: d.planStatus || 'active',
              expiresAt: d.planExpiresAt || null,
            }
          : null,
      });
    });
    if (isAdminEmail) {
      const qSusp = query(collection(db, 'users'), where('status', '==', 'suspended'));
      const suspSnap = await getDocs(qSusp);
      suspSnap.forEach((dSnap) => {
        const d = dSnap.data();
        userMap.set(dSnap.id, {
          ...d,
          id: d.uid || dSnap.id,
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'users');
  }
  state.users = Array.from(userMap.values());

  // For admin view, populate user emails from private/info
  if (isAdminEmail) {
    await Promise.all(
      state.users.map(async (u) => {
        try {
          const ps = await getDoc(doc(db, 'users', u.id, 'private', 'info'));
          if (ps.exists()) {
            const pData = ps.data();
            state.privateInfo[u.id] = pData;
            if (pData.email) u.email = pData.email;
          }
        } catch {
          // ignore if missing
        }
      })
    );
  } else if (ownUserDoc && state.privateInfo[uid]?.email) {
    ownUserDoc.email = state.privateInfo[uid].email;
  }

  // 5. Fetch social accounts (own + public)
  try {
    const saQueries = [
      query(collection(db, 'social_accounts'), where('userId', '==', uid)),
      query(collection(db, 'social_accounts'), where('isPublic', '==', true)),
    ];
    for (const q of saQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        if (!state.socialAccounts[d.userId]) state.socialAccounts[d.userId] = {};
        let topVideos: any[] = [];
        try {
          if (d.topContentSummary) topVideos = JSON.parse(d.topContentSummary);
        } catch {
          topVideos = [];
        }
        state.socialAccounts[d.userId][d.platform] = {
          ...d,
          topVideos,
          lastSyncedAt: tsToIso(d.lastSyncedAt || d.updatedAt),
          updatedAt: tsToIso(d.updatedAt),
        };
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'social_accounts');
  }

  // 6. Fetch campaigns
  const campMap = new Map<string, any>();
  try {
    const campQueries = isAdminEmail
      ? [query(collection(db, 'campaigns'), where('status', 'in', ['open', 'completed', 'cancelled']))]
      : [
          query(collection(db, 'campaigns'), where('status', 'in', ['open', 'completed'])),
          query(collection(db, 'campaigns'), where('umkmId', '==', uid)),
        ];
    for (const q of campQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        campMap.set(dSnap.id, {
          ...d,
          id: d.id || dSnap.id,
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'campaigns');
  }
  state.campaigns = Array.from(campMap.values());

  // 7. Fetch applications
  const appMap = new Map<string, any>();
  try {
    const appQueries = [
      query(collection(db, 'applications'), where('creatorId', '==', uid)),
      query(collection(db, 'applications'), where('umkmId', '==', uid)),
      query(collection(db, 'applications'), where('status', 'in', ['accepted', 'completed'])),
    ];
    for (const q of appQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        appMap.set(dSnap.id, {
          ...d,
          id: d.id || dSnap.id,
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'applications');
  }
  state.applications = Array.from(appMap.values());

  // 8. Fetch submissions
  const subMap = new Map<string, any>();
  try {
    const subQueries = [
      query(collection(db, 'submissions'), where('creatorId', '==', uid)),
      query(collection(db, 'submissions'), where('umkmId', '==', uid)),
      query(collection(db, 'submissions'), where('listed', '==', true)),
    ];
    for (const q of subQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        subMap.set(dSnap.id, {
          ...d,
          id: d.id || dSnap.id,
          licensePricing: d.adsPrice && d.buyoutPrice ? { ads: d.adsPrice, buyout: d.buyoutPrice } : null,
          performance:
            d.perfViews !== undefined
              ? { views: d.perfViews || 0, likes: d.perfLikes || 0, comments: d.perfComments || 0, clicks: d.perfClicks || 0 }
              : null,
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'submissions');
  }
  state.submissions = Array.from(subMap.values());

  // 9. Fetch licenses
  const licMap = new Map<string, any>();
  try {
    const licQueries = isAdminEmail
      ? [query(collection(db, 'licenses'), where('price', '>', 0))]
      : [
          query(collection(db, 'licenses'), where('buyerId', '==', uid)),
          query(collection(db, 'licenses'), where('sellerId', '==', uid)),
        ];
    for (const q of licQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        licMap.set(dSnap.id, {
          ...d,
          id: d.id || dSnap.id,
          fee: d.platformFee || 0,
          net: d.netSeller || 0,
          createdAt: tsToIso(d.createdAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'licenses');
  }
  state.licenses = Array.from(licMap.values());

  // 10. Fetch reviews
  try {
    const revSnap = await getDocs(query(collection(db, 'reviews'), where('rating', '>=', 1)));
    revSnap.forEach((dSnap) => {
      const d = dSnap.data();
      state.reviews.push({ ...d, id: d.id || dSnap.id, createdAt: tsToIso(d.createdAt) });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'reviews');
  }

  // 11. Fetch transactions
  const txMap = new Map<string, any>();
  try {
    const txQueries = isAdminEmail
      ? [query(collection(db, 'transactions'), where('amount', '>=', 0))]
      : [
          query(collection(db, 'transactions'), where('fromUserId', '==', uid)),
          query(collection(db, 'transactions'), where('toUserId', '==', uid)),
        ];
    for (const q of txQueries) {
      const snap = await getDocs(q);
      snap.forEach((dSnap) => {
        const d = dSnap.data();
        txMap.set(dSnap.id, {
          ...d,
          id: d.id || dSnap.id,
          note: d.note || d.description || '',
          createdAt: tsToIso(d.createdAt),
        });
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'transactions');
  }
  state.transactions = Array.from(txMap.values());
}

function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      const unsub = onAuthStateChanged(auth, async (fbUser) => {
        unsub();
        currentFirebaseUser = fbUser;
        try {
          await loadCloudState(fbUser);
        } catch (err) {
          console.error('Failed loading Kolab cloud state:', err);
        }
        resolve();
      });
    });
  }
  return readyPromise;
}

async function reload(): Promise<void> {
  currentFirebaseUser = auth.currentUser;
  await loadCloudState(currentFirebaseUser);
}

// =========================================================
// GOOGLE SIGN-IN & ONBOARDING
// =========================================================
async function signInWithGoogle(options?: { role?: 'umkm' | 'creator' | 'admin'; profile?: any }) {
  const result = await signInWithPopup(auth, googleProvider);
  const fbUser = result.user;
  currentFirebaseUser = fbUser;

  const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
  if (userSnap.exists()) {
    const uData = userSnap.data();
    if (options?.role === 'admin' && fbUser.email === 'kikynepth@gmail.com') {
      sessionStorage.setItem(SESSION_ROLE_KEY, 'admin');
    } else {
      sessionStorage.setItem(SESSION_ROLE_KEY, uData.role);
    }
    await loadCloudState(fbUser);
    return { ok: true, isNew: false, needsOnboarding: false, user: findBy(state.users, 'id', fbUser.uid), role: currentSession?.role };
  }

  if (options?.role === 'admin' && fbUser.email === 'kikynepth@gmail.com') {
    sessionStorage.setItem(SESSION_ROLE_KEY, 'admin');
    await loadCloudState(fbUser);
    return { ok: true, isNew: false, needsOnboarding: false, role: 'admin' };
  }

  if (options?.role && (options.role === 'umkm' || options.role === 'creator') && options.profile) {
    return await completeGoogleOnboarding(options.role, options.profile);
  }

  return {
    ok: true,
    isNew: true,
    needsOnboarding: true,
    googleUser: {
      uid: fbUser.uid,
      email: fbUser.email || '',
      displayName: fbUser.displayName || '',
      photoURL: fbUser.photoURL || '',
    },
  };
}

async function completeGoogleOnboarding(role: 'umkm' | 'creator', profile: Record<string, any>) {
  const fbUser = auth.currentUser;
  if (!fbUser) {
    throw new Error('Silakan masuk dengan Google terlebih dahulu.');
  }

  const uid = fbUser.uid;
  const displayName = String(profile.name || fbUser.displayName || 'Pengguna Kolab').slice(0, 120);
  const userPayload: Record<string, any> = {
    uid,
    role,
    name: displayName,
    avatarUrl: String(fbUser.photoURL || '').slice(0, 500),
    status: 'active',
    planId: 'free',
    planCycle: 'monthly',
    planStatus: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (role === 'umkm') {
    userPayload.businessName = String(profile.businessName || displayName).slice(0, 140);
    userPayload.category = String(profile.category || 'Lainnya').slice(0, 80);
    userPayload.city = String(profile.city || 'Indonesia').slice(0, 80);
  } else {
    userPayload.niche = String(profile.niche || 'lifestyle').slice(0, 80);
    userPayload.followers = Number(profile.followers || 0);
    userPayload.tier = getInfluencerTier(userPayload.followers);
    userPayload.bio = String(profile.bio || '').slice(0, 500);
  }

  try {
    await setDoc(doc(db, 'users', uid), userPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
  }

  try {
    await setDoc(doc(db, 'users', uid, 'private', 'info'), {
      uid,
      email: String(profile.email || fbUser.email || 'user@kolab.id').slice(0, 160),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/private/info`);
  }

  try {
    const wSnap = await getDoc(doc(db, 'wallets', uid));
    if (!wSnap.exists()) {
      await setDoc(doc(db, 'wallets', uid), {
        userId: uid,
        balance: 0,
        held: 0,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `wallets/${uid}`);
  }

  sessionStorage.setItem(SESSION_ROLE_KEY, role);
  await loadCloudState(fbUser);
  return { ok: true, isNew: true, needsOnboarding: false, user: findBy(state.users, 'id', uid), role };
}

async function signOut(): Promise<void> {
  sessionStorage.removeItem(SESSION_ROLE_KEY);
  currentSession = null;
  currentFirebaseUser = null;
  await fbSignOut(auth);
}

function getCurrentGoogleUser() {
  return auth.currentUser;
}

// =========================================================
// SOCIAL MEDIA OAUTH & REAL STATS ANALYTICS
// =========================================================
async function saveConnectedSocialProfile(uid: string, platform: 'youtube' | 'instagram' | 'tiktok', profile: any) {
  const docId = `${uid}_${platform}`;
  const followers = Math.max(0, Math.round(Number(profile.followers || 0)));
  const engagementRate = Math.max(0, Number(profile.engagementRate || 0));
  const payload = {
    id: docId,
    userId: uid,
    platform,
    handle: String(profile.handle || `@${platform}`).slice(0, 120),
    channelTitle: String(profile.channelTitle || profile.handle || platform).slice(0, 160),
    profileUrl: String(profile.profileUrl || '').slice(0, 400),
    connected: true,
    isPublic: true,
    followers,
    totalViews: Math.max(0, Math.round(Number(profile.totalViews || 0))),
    mediaCount: Math.max(0, Math.round(Number(profile.mediaCount || 0))),
    engagementRate,
    avgLikes: Math.max(0, Math.round(Number(profile.avgLikes || 0))),
    avgComments: Math.max(0, Math.round(Number(profile.avgComments || 0))),
    avgViews: Math.max(0, Math.round(Number(profile.avgViews || 0))),
    topContentSummary: JSON.stringify(profile.topVideos || []).slice(0, 1950),
    lastSyncedAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'social_accounts', docId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `social_accounts/${docId}`);
  }

  if (!state.socialAccounts[uid]) state.socialAccounts[uid] = {};
  state.socialAccounts[uid][platform] = {
    ...payload,
    topVideos: profile.topVideos || [],
    updatedAt: new Date().toISOString(),
  };

  const totalFollowers = Object.values(state.socialAccounts[uid]).reduce(
    (sum: number, acc: any) => sum + (acc.connected ? Number(acc.followers || 0) : 0),
    0
  );
  const newTier = getInfluencerTier(totalFollowers);

  const u = findBy(state.users, 'id', uid);
  if (u) {
    u.followers = totalFollowers;
    u.tier = newTier;
  }
  try {
    await updateDoc(doc(db, 'users', uid), {
      followers: totalFollowers,
      tier: newTier,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }

  return state.socialAccounts[uid][platform];
}

async function connectYouTubeWithGoogle(uid: string) {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Silakan masuk dengan Google terlebih dahulu.');

  const ytProvider = new GoogleAuthProvider();
  ytProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
  ytProvider.setCustomParameters({ prompt: 'consent' });

  let result;
  try {
    result = await reauthenticateWithPopup(fbUser, ytProvider);
  } catch {
    try {
      result = await linkWithPopup(fbUser, ytProvider);
    } catch {
      result = await signInWithPopup(auth, ytProvider);
    }
  }

  const cred = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = cred?.accessToken;
  if (!accessToken) {
    throw new Error('Tidak mendapatkan akses token YouTube dari Google.');
  }

  const resp = await fetch('/api/social/youtube/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) {
    throw new Error(data.message || 'Gagal menyinkronkan data channel YouTube.');
  }

  return await saveConnectedSocialProfile(uid, 'youtube', data.profile);
}

async function disconnectSocialAccount(userId: string, platform: string) {
  const docId = `${userId}_${platform}`;
  try {
    await deleteDoc(doc(db, 'social_accounts', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `social_accounts/${docId}`);
  }
  if (state.socialAccounts[userId]) {
    delete state.socialAccounts[userId][platform];
  }
  const totalFollowers = Object.values(state.socialAccounts[userId] || {}).reduce(
    (sum: number, acc: any) => sum + (acc.connected ? Number(acc.followers || 0) : 0),
    0
  );
  const newTier = getInfluencerTier(totalFollowers);
  const u = findBy(state.users, 'id', userId);
  if (u) {
    u.followers = totalFollowers;
    u.tier = newTier;
  }
  try {
    await updateDoc(doc(db, 'users', userId), {
      followers: totalFollowers,
      tier: newTier,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`);
  }
  return { ok: true };
}

function socialSummaryOf(userId: string) {
  const u = findBy(state.users, 'id', userId);
  const accounts = state.socialAccounts[userId] || {};
  const platforms: string[] = [];
  let totalFollowers = 0;
  let connectedCount = 0;
  let erSum = 0;

  Object.entries(accounts).forEach(([key, acc]: [string, any]) => {
    if (acc && acc.connected) {
      platforms.push(key);
      totalFollowers += Number(acc.followers || 0);
      erSum += Number(acc.engagementRate || 0);
      connectedCount += 1;
    }
  });

  if (totalFollowers === 0 && u?.followers) totalFollowers = Number(u.followers);
  const avgEngagementRate = connectedCount > 0 ? Number((erSum / connectedCount).toFixed(2)) : 0;

  return {
    accounts,
    platforms,
    totalFollowers,
    tier: getInfluencerTier(totalFollowers),
    connectedCount,
    avgEngagementRate,
    avgEngagement: avgEngagementRate,
  };
}

// =========================================================
// PAYMENT GATEWAY (QRIS & VIRTUAL ACCOUNT)
// =========================================================
function openPaymentGateway(opts: {
  userId: string;
  amount: number;
  purpose: PaymentPurpose;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  onSettled: (order: any) => Promise<void> | void;
}) {
  const u = findBy(state.users, 'id', opts.userId);
  const priv = state.privateInfo[opts.userId];
  openPaymentGatewayModal({
    userId: opts.userId,
    userName: u?.name || currentSession?.name || 'Pengguna Kolab',
    userEmail: priv?.email || currentSession?.email || 'user@kolab.id',
    amount: opts.amount,
    purpose: opts.purpose,
    title: opts.title,
    subtitle: opts.subtitle,
    metadata: opts.metadata,
    onCreateOrderRecord: async (order) => {
      try {
        await setDoc(doc(db, 'payment_orders', order.orderId), {
          orderId: order.orderId,
          userId: opts.userId,
          provider: order.provider,
          method: order.method,
          purpose: order.purpose,
          amount: Number(order.amount),
          status: 'pending',
          vaNumber: order.vaNumber || '',
          qrString: String(order.qrString || '').slice(0, 1900),
          expiresAt: order.expiresAt || '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `payment_orders/${order.orderId}`);
      }
    },
    onSettled: async (order) => {
      try {
        await updateDoc(doc(db, 'payment_orders', order.orderId), {
          status: 'settled',
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `payment_orders/${order.orderId}`);
      }
      await opts.onSettled(order);
    },
  });
}

// =========================================================
// CORE KOLAB MARKETPLACE LOGIC (FIRESTORE SYNCED)
// =========================================================
function walletOf(userId: string) {
  if (!state.wallets[userId]) state.wallets[userId] = { balance: 0, held: 0 };
  return state.wallets[userId];
}

function planOf(userId: string) {
  const u = findBy(state.users, 'id', userId);
  const role = u ? u.role : 'creator';
  const rolePlans = PLANS[role] || PLANS.creator;
  const sub = u?.subscription || null;
  const active = Boolean(sub && sub.planId && sub.planId !== 'free' && (!sub.expiresAt || new Date(sub.expiresAt).getTime() > Date.now()));
  const plan = active && rolePlans[sub.planId] ? rolePlans[sub.planId] : rolePlans.free;
  return { role, plan, active, subscription: sub };
}

function reviewsFor(userId: string) {
  const list = state.reviews
    .filter((r) => r.revieweeId === userId)
    .map((r) => {
      const reviewer = findBy(state.users, 'id', r.reviewerId);
      const camp = findBy(state.campaigns, 'id', r.campaignId);
      return {
        ...r,
        reviewerName: reviewer?.name || 'Pengguna',
        reviewerAvatar: reviewer?.avatarUrl || '',
        campaignTitle: camp?.title || 'Kampanye',
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const avg = list.length ? Math.round((list.reduce((s, r) => s + Number(r.rating || 0), 0) / list.length) * 10) / 10 : null;
  return { reviews: list, average: avg, count: list.length };
}

function topUp(userId: string, amount: number, methodLabel = 'Gateway QRIS / VA') {
  const num = Math.round(Number(amount));
  if (!num || num <= 0) return { ok: false, message: 'Nominal harus lebih dari 0' };
  const w = walletOf(userId);
  w.balance += num;

  enqueueWrite(
    updateDoc(doc(db, 'wallets', userId), {
      balance: increment(num),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${userId}`))
  );

  const txId = genId('tx');
  const desc = `Top up saldo via ${methodLabel}`;
  const tx = {
    id: txId,
    type: 'topup',
    toUserId: userId,
    amount: num,
    fee: 0,
    description: desc,
    note: desc,
    createdAt: new Date().toISOString(),
  };
  state.transactions.push(tx);

  enqueueWrite(
    setDoc(doc(db, 'transactions', txId), {
      id: txId,
      type: 'topup',
      toUserId: userId,
      amount: num,
      fee: 0,
      description: desc,
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
  );

  return { ok: true, balance: w.balance };
}

function requestPayout(userId: string, amount: number, method?: string, accountNumber?: string) {
  const num = Math.round(Number(amount));
  if (!num || num < MIN_PAYOUT) return { ok: false, message: `Nominal minimal penarikan adalah ${formatRupiah(MIN_PAYOUT)}` };
  const w = walletOf(userId);
  if (w.balance < num) return { ok: false, message: 'Saldo tidak mencukupi' };
  w.balance -= num;

  enqueueWrite(
    updateDoc(doc(db, 'wallets', userId), {
      balance: w.balance,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${userId}`))
  );

  if (method && accountNumber) {
    enqueueWrite(
      updateDoc(doc(db, 'users', userId, 'private', 'info'), {
        bankMethod: String(method).slice(0, 40),
        bankAccountNumber: String(accountNumber).slice(0, 60),
        updatedAt: serverTimestamp(),
      }).catch(() => {})
    );
  }

  const txId = genId('tx');
  const desc = `Penarikan dana ke ${method ? method.toUpperCase() : 'Rekening'}${accountNumber ? ` (${accountNumber})` : ''}`;
  const tx = {
    id: txId,
    type: 'payout',
    fromUserId: userId,
    amount: num,
    fee: 0,
    description: desc,
    note: desc,
    createdAt: new Date().toISOString(),
  };
  state.transactions.push(tx);

  enqueueWrite(
    setDoc(doc(db, 'transactions', txId), {
      id: txId,
      type: 'payout',
      fromUserId: userId,
      amount: num,
      fee: 0,
      description: desc.slice(0, 240),
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
  );

  return { ok: true, balance: w.balance };
}

function createCampaign(umkmId: string, data: Record<string, any>) {
  const budget = Math.round(Number(data.budgetPerSlot));
  const slots = Math.round(Number(data.slots));
  const briefText = String(data.brief || '').trim() || 'Buat konten UGC autentik sesuai arahan brand.';
  if (!data.title || String(data.title).trim().length < 3 || !budget || budget < 10000 || !slots || slots < 1) {
    return { ok: false, message: 'Lengkapi judul kampanye (min. 3 huruf), slot (>= 1), dan budget (min. Rp10.000/slot).' };
  }
  const p = planOf(umkmId).plan;
  const activeCount = state.campaigns.filter((c) => c.umkmId === umkmId && c.status === 'open').length;
  if (activeCount >= p.maxActiveCampaigns) {
    return { ok: false, needUpgrade: true, message: `Kuota kampanye aktif paket ${p.name} (${p.maxActiveCampaigns}) penuh. Upgrade paket untuk membuat lebih banyak.` };
  }
  const total = budget * slots;
  const w = walletOf(umkmId);
  if (w.balance < total) {
    return { ok: false, needTopup: true, requiredAmount: total - w.balance, message: `Saldo tidak cukup. Butuh ${formatRupiah(total)}, saldo tersedia ${formatRupiah(w.balance)}.` };
  }

  w.balance -= total;
  w.held += total;
  enqueueWrite(
    updateDoc(doc(db, 'wallets', umkmId), {
      balance: w.balance,
      held: w.held,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${umkmId}`))
  );

  const id = genId('camp');
  const now = new Date().toISOString();
  const platforms = Array.isArray(data.platform) && data.platform.length > 0 ? data.platform : ['TikTok'];
  const deliverableText = String(data.deliverable || `${data.contentType || 'Video Review'} (${platforms.join(', ')})`).slice(0, 300);
  const nicheVal = String(data.niche || data.targetNiche || 'food').slice(0, 80);

  const camp = {
    id,
    umkmId,
    title: String(data.title).trim().slice(0, 180),
    niche: nicheVal,
    targetNiche: nicheVal,
    brief: briefText.slice(0, 2000),
    deliverable: deliverableText,
    contentType: String(data.contentType || deliverableText),
    platform: platforms,
    budgetPerSlot: budget,
    slots,
    deadline: String(data.deadline || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)).slice(0, 64),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  state.campaigns.push(camp);

  enqueueWrite(
    setDoc(doc(db, 'campaigns', id), {
      id: camp.id,
      umkmId: camp.umkmId,
      title: camp.title,
      niche: camp.niche,
      brief: camp.brief,
      deliverable: camp.deliverable,
      budgetPerSlot: camp.budgetPerSlot,
      slots: camp.slots,
      deadline: camp.deadline,
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `campaigns/${id}`))
  );

  const txId = genId('tx');
  const desc = `Dana escrow kampanye ${camp.title}`;
  state.transactions.push({
    id: txId,
    type: 'escrow_hold',
    fromUserId: umkmId,
    campaignId: id,
    amount: total,
    fee: 0,
    description: desc,
    note: desc,
    createdAt: now,
  });
  enqueueWrite(
    setDoc(doc(db, 'transactions', txId), {
      id: txId,
      type: 'escrow_hold',
      fromUserId: umkmId,
      campaignId: id,
      amount: total,
      fee: 0,
      description: desc.slice(0, 240),
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
  );

  return { ok: true, campaign: enrichCampaign(camp) };
}

function cancelCampaign(campaignId: string, umkmId: string) {
  const c = findBy(state.campaigns, 'id', campaignId);
  if (!c || c.umkmId !== umkmId) return { ok: false, message: 'Kampanye tidak ditemukan.' };
  if (c.status !== 'open') return { ok: false, message: 'Kampanye sudah selesai atau dibatalkan.' };
  const approvedApps = state.applications.filter(
    (a) => a.campaignId === campaignId && state.submissions.some((s) => s.applicationId === a.id && s.status === 'approved')
  ).length;
  const refundSlots = Math.max(0, c.slots - approvedApps);
  const refundAmt = refundSlots * c.budgetPerSlot;
  c.status = 'cancelled';

  const w = walletOf(umkmId);
  w.held = Math.max(0, w.held - refundAmt);
  w.balance += refundAmt;

  enqueueWrite(
    updateDoc(doc(db, 'campaigns', campaignId), { status: 'cancelled', updatedAt: serverTimestamp() })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `campaigns/${campaignId}`))
  );
  enqueueWrite(
    updateDoc(doc(db, 'wallets', umkmId), { balance: w.balance, held: w.held, updatedAt: serverTimestamp() })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${umkmId}`))
  );

  if (refundAmt > 0) {
    const txId = genId('tx');
    state.transactions.push({
      id: txId,
      type: 'escrow_refund',
      toUserId: umkmId,
      campaignId,
      amount: refundAmt,
      fee: 0,
      description: `Refund escrow pembatalan ${c.title}`,
      createdAt: new Date().toISOString(),
    });
    enqueueWrite(
      setDoc(doc(db, 'transactions', txId), {
        id: txId,
        type: 'escrow_refund',
        toUserId: umkmId,
        campaignId,
        amount: refundAmt,
        fee: 0,
        description: `Refund escrow pembatalan ${c.title}`,
        createdAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
    );
  }
  return { ok: true };
}

function acceptedCount(campaignId: string): number {
  return state.applications.filter((a) => a.campaignId === campaignId && (a.status === 'accepted' || a.status === 'completed')).length;
}

function applyToCampaign(campaignId: string, creatorId: string) {
  const c = findBy(state.campaigns, 'id', campaignId);
  if (!c || c.status !== 'open') return { ok: false, message: 'Kampanye tidak lagi tersedia.' };
  const existing = state.applications.find((a) => a.campaignId === campaignId && a.creatorId === creatorId);
  if (existing) return { ok: false, message: 'Anda sudah tergabung dalam kampanye ini.' };
  if (acceptedCount(campaignId) >= c.slots) return { ok: false, message: 'Maaf, seluruh slot kreator sudah penuh.' };

  const id = genId('app');
  const now = new Date().toISOString();
  const app = { id, campaignId, umkmId: c.umkmId, creatorId, status: 'accepted', createdAt: now, updatedAt: now };
  state.applications.push(app);

  enqueueWrite(
    setDoc(doc(db, 'applications', id), {
      id,
      campaignId,
      umkmId: c.umkmId,
      creatorId,
      status: 'accepted',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `applications/${id}`))
  );
  return { ok: true, application: app };
}

function submitContent(
  applicationId: string,
  creatorIdOrUrl: string | { fileUrl: string; note?: string },
  maybeData?: { fileUrl: string; note?: string }
) {
  const app = findBy(state.applications, 'id', applicationId);
  let creatorId = currentSession?.id || '';
  let data: { fileUrl: string; note?: string };

  if (typeof creatorIdOrUrl === 'string' && !maybeData) {
    data = { fileUrl: creatorIdOrUrl, note: '' };
    if (app && !creatorId) creatorId = app.creatorId;
  } else if (typeof creatorIdOrUrl === 'string' && maybeData) {
    creatorId = creatorIdOrUrl;
    data = maybeData;
  } else {
    data = creatorIdOrUrl as { fileUrl: string; note?: string };
    if (app && !creatorId) creatorId = app.creatorId;
  }

  if (!app || app.creatorId !== creatorId) return { ok: false, message: 'Aplikasi tidak valid.' };
  if (!data.fileUrl || data.fileUrl.length < 5) return { ok: false, message: 'Tautan konten tidak valid.' };

  const existingSub = state.submissions.find((s) => s.applicationId === applicationId);
  const now = new Date().toISOString();

  if (existingSub) {
    existingSub.fileUrl = data.fileUrl.slice(0, 500);
    existingSub.note = String(data.note || '').slice(0, 1000);
    existingSub.status = 'submitted';
    existingSub.updatedAt = now;
    enqueueWrite(
      updateDoc(doc(db, 'submissions', existingSub.id), {
        fileUrl: existingSub.fileUrl,
        note: existingSub.note,
        status: 'submitted',
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${existingSub.id}`))
    );
    return { ok: true, submission: existingSub };
  }

  const id = genId('sub');
  const sub = {
    id,
    applicationId,
    campaignId: app.campaignId,
    umkmId: app.umkmId,
    creatorId,
    fileUrl: data.fileUrl.slice(0, 500),
    note: String(data.note || '').slice(0, 1000),
    status: 'submitted',
    listed: false,
    exclusiveSold: false,
    licensePricing: null,
    performance: null,
    createdAt: now,
    updatedAt: now,
  };
  state.submissions.push(sub);

  enqueueWrite(
    setDoc(doc(db, 'submissions', id), {
      id,
      applicationId,
      campaignId: app.campaignId,
      umkmId: app.umkmId,
      creatorId,
      fileUrl: sub.fileUrl,
      note: sub.note,
      status: 'submitted',
      listed: false,
      exclusiveSold: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `submissions/${id}`))
  );
  return { ok: true, submission: sub };
}

function requestRevision(submissionId: string) {
  const s = findBy(state.submissions, 'id', submissionId);
  if (!s) return { ok: false, message: 'Konten tidak ditemukan.' };
  s.status = 'revision';
  s.updatedAt = new Date().toISOString();
  enqueueWrite(
    updateDoc(doc(db, 'submissions', submissionId), {
      status: 'revision',
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
  );
  return { ok: true };
}

function approveSubmission(submissionId: string) {
  const s = findBy(state.submissions, 'id', submissionId);
  if (!s) return { ok: false, message: 'Konten tidak ditemukan.' };
  if (s.status === 'approved') return { ok: false, message: 'Konten sudah disetujui.' };

  const c = findBy(state.campaigns, 'id', s.campaignId);
  const app = findBy(state.applications, 'id', s.applicationId);
  if (!c || !app) return { ok: false, message: 'Data kampanye tidak ditemukan.' };

  const creatorPlan = planOf(app.creatorId).plan;
  const feeRate = creatorPlan.platformFeeRate ?? 0.15;
  const gross = c.budgetPerSlot;
  const fee = Math.round(gross * feeRate);
  const net = gross - fee;

  s.status = 'approved';
  s.updatedAt = new Date().toISOString();

  const wUmkm = walletOf(c.umkmId);
  wUmkm.held = Math.max(0, wUmkm.held - gross);
  const wCreator = walletOf(app.creatorId);
  wCreator.balance += net;

  enqueueWrite(
    updateDoc(doc(db, 'submissions', submissionId), {
      status: 'approved',
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
  );
  enqueueWrite(
    updateDoc(doc(db, 'wallets', c.umkmId), {
      held: wUmkm.held,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${c.umkmId}`))
  );
  enqueueWrite(
    updateDoc(doc(db, 'wallets', app.creatorId), {
      balance: increment(net),
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${app.creatorId}`))
  );

  const txId = genId('tx');
  state.transactions.push({
    id: txId,
    type: 'escrow_release',
    fromUserId: c.umkmId,
    toUserId: app.creatorId,
    campaignId: c.id,
    amount: net,
    fee,
    description: `Pembayaran UGC kampanye ${c.title}`,
    createdAt: new Date().toISOString(),
  });
  enqueueWrite(
    setDoc(doc(db, 'transactions', txId), {
      id: txId,
      type: 'escrow_release',
      fromUserId: c.umkmId,
      toUserId: app.creatorId,
      campaignId: c.id,
      amount: net,
      fee,
      description: `Pembayaran UGC kampanye ${c.title}`,
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
  );

  // Check if all slots approved -> mark campaign completed
  const approvedCount = state.submissions.filter((sub) => sub.campaignId === c.id && sub.status === 'approved').length;
  if (approvedCount >= c.slots) {
    c.status = 'completed';
    enqueueWrite(
      updateDoc(doc(db, 'campaigns', c.id), {
        status: 'completed',
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `campaigns/${c.id}`))
    );
  }

  return { ok: true, net, fee };
}

function setContentPerformance(submissionId: string, perf: Record<string, any>) {
  const s = findBy(state.submissions, 'id', submissionId);
  if (!s) return { ok: false, message: 'Konten tidak ditemukan.' };
  const views = Math.max(0, Math.round(Number(perf.views || 0)));
  const likes = Math.max(0, Math.round(Number(perf.likes || 0)));
  const comments = Math.max(0, Math.round(Number(perf.comments || 0)));
  const clicks = Math.max(0, Math.round(Number(perf.clicks || 0)));
  s.performance = { views, likes, comments, clicks };
  enqueueWrite(
    updateDoc(doc(db, 'submissions', submissionId), {
      perfViews: views,
      perfLikes: likes,
      perfComments: comments,
      perfClicks: clicks,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
  );
  return { ok: true };
}

function pricingOf(sub: any) {
  if (sub.licensePricing && sub.licensePricing.ads && sub.licensePricing.buyout) {
    return sub.licensePricing;
  }
  const c = findBy(state.campaigns, 'id', sub.campaignId);
  const base = c ? c.budgetPerSlot : 150000;
  return {
    ads: Math.max(50000, Math.round(base * 0.75)),
    buyout: Math.max(150000, Math.round(base * 2)),
  };
}

function licenseOptions(buyerId: string, submissionId: string) {
  const sub = findBy(state.submissions, 'id', submissionId);
  if (!sub) return { ok: false, message: 'Konten tidak ditemukan.' };
  const base = pricingOf(sub);
  const discount = buyerId ? planOf(buyerId).plan.licenseDiscount || 0 : 0;
  const adsPrice = Math.round(base.ads * (1 - discount));
  const buyoutPrice = Math.round(base.buyout * (1 - discount));

  const hasActiveAds = state.licenses.some(
    (l) =>
      l.submissionId === submissionId &&
      l.buyerId === buyerId &&
      l.type === 'ads' &&
      (!l.expiresAt || new Date(l.expiresAt).getTime() > Date.now())
  );
  const hasBuyout = state.licenses.some(
    (l) => l.submissionId === submissionId && l.buyerId === buyerId && l.type === 'buyout'
  );

  return {
    ok: true,
    discount,
    options: [
      {
        type: 'ads',
        label: 'Lisensi Iklan (6 Bulan)',
        description: 'Hak pakai konten untuk Meta Ads, TikTok Ads & materi promosi selama 6 bulan.',
        basePrice: base.ads,
        price: adsPrice,
        owned: hasActiveAds || hasBuyout,
        available: !sub.exclusiveSold && !hasActiveAds && !hasBuyout,
        reason: sub.exclusiveSold ? 'Sudah Terjual Eksklusif' : '',
      },
      {
        type: 'buyout',
        label: 'Hak Milik Penuh (Buyout)',
        description: 'Kepemilikan eksklusif selamanya; konten otomatis ditarik dari pasar.',
        basePrice: base.buyout,
        price: buyoutPrice,
        owned: hasBuyout,
        available: !sub.exclusiveSold && !hasBuyout,
        reason: sub.exclusiveSold ? 'Sudah Terjual Eksklusif' : '',
      },
    ],
  };
}

function purchaseLicense(buyerId: string, submissionId: string, type: 'ads' | 'buyout') {
  const sub = findBy(state.submissions, 'id', submissionId);
  if (!sub || sub.status !== 'approved') return { ok: false, message: 'Konten belum tersedia untuk lisensi.' };
  if (sub.exclusiveSold) return { ok: false, message: 'Konten sudah dibeli secara eksklusif.' };

  const opts = licenseOptions(buyerId, submissionId);
  const chosen = opts?.options?.find((o) => o.type === type);
  if (!chosen) return { ok: false, message: 'Pilihan lisensi tidak valid.' };

  const wBuyer = walletOf(buyerId);
  if (wBuyer.balance < chosen.price) {
    return { ok: false, needTopup: true, requiredAmount: chosen.price - wBuyer.balance, message: 'Saldo dompet tidak mencukupi.' };
  }

  const sellerId = sub.creatorId;
  const feeRate = planOf(sellerId).plan.platformFeeRate ?? 0.15;
  const platformFee = Math.round(chosen.price * feeRate);
  const netSeller = chosen.price - platformFee;

  wBuyer.balance -= chosen.price;
  enqueueWrite(
    updateDoc(doc(db, 'wallets', buyerId), { balance: wBuyer.balance, updatedAt: serverTimestamp() })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${buyerId}`))
  );

  const wSeller = walletOf(sellerId);
  wSeller.balance += netSeller;
  enqueueWrite(
    updateDoc(doc(db, 'wallets', sellerId), { balance: increment(netSeller), updatedAt: serverTimestamp() })
      .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${sellerId}`))
  );

  const licId = genId('lic');
  const now = new Date().toISOString();
  const expiresAt = type === 'ads' ? new Date(Date.now() + 180 * 86400000).toISOString() : '';
  const lic = { id: licId, submissionId, buyerId, sellerId, type, price: chosen.price, platformFee, netSeller, expiresAt, createdAt: now };
  state.licenses.push(lic);

  enqueueWrite(
    setDoc(doc(db, 'licenses', licId), {
      id: licId,
      submissionId,
      buyerId,
      sellerId,
      type,
      price: chosen.price,
      platformFee,
      netSeller,
      expiresAt,
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `licenses/${licId}`))
  );

  if (type === 'buyout') {
    sub.exclusiveSold = true;
    sub.listed = false;
    enqueueWrite(
      updateDoc(doc(db, 'submissions', submissionId), {
        exclusiveSold: true,
        listed: false,
        updatedAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
    );
  }

  const txId = genId('tx');
  state.transactions.push({
    id: txId,
    type: 'license_purchase',
    fromUserId: buyerId,
    toUserId: sellerId,
    campaignId: sub.campaignId,
    amount: chosen.price,
    fee: platformFee,
    description: `Pembelian lisensi ${type === 'buyout' ? 'Hak Milik' : 'Iklan 6 Bulan'}`,
    createdAt: now,
  });
  enqueueWrite(
    setDoc(doc(db, 'transactions', txId), {
      id: txId,
      type: 'license_purchase',
      fromUserId: buyerId,
      toUserId: sellerId,
      campaignId: sub.campaignId,
      amount: chosen.price,
      fee: platformFee,
      description: `Pembelian lisensi ${type === 'buyout' ? 'Hak Milik' : 'Iklan 6 Bulan'}`,
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
  );

  return { ok: true, license: lic };
}

function setLicensePricing(creatorId: string, submissionId: string, pricing: { ads: number; buyout: number }) {
  const s = findBy(state.submissions, 'id', submissionId);
  if (!s || s.creatorId !== creatorId || s.status !== 'approved') return { ok: false, message: 'Konten tidak ditemukan.' };
  const ads = Math.round(Number(pricing.ads));
  const buyout = Math.round(Number(pricing.buyout));
  if (!ads || ads <= 0 || !buyout || buyout <= 0) return { ok: false, message: 'Harga harus lebih dari 0.' };
  if (buyout < ads) return { ok: false, message: 'Harga buyout harus >= harga lisensi iklan.' };
  s.licensePricing = { ads, buyout };
  enqueueWrite(
    updateDoc(doc(db, 'submissions', submissionId), {
      adsPrice: ads,
      buyoutPrice: buyout,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
  );
  return { ok: true };
}

function setContentListed(creatorId: string, submissionId: string, listed: boolean) {
  const s = findBy(state.submissions, 'id', submissionId);
  if (!s || s.creatorId !== creatorId || s.status !== 'approved') return { ok: false, message: 'Konten tidak ditemukan.' };
  if (s.exclusiveSold) return { ok: false, message: 'Konten sudah terjual eksklusif.' };
  if (listed) {
    const limit = planOf(creatorId).plan.maxLibraryListings;
    const count = state.submissions.filter((x) => x.creatorId === creatorId && x.listed).length;
    if (!s.listed && count >= limit) {
      return { ok: false, needUpgrade: true, message: `Batas listing paket Anda (${limit}) tercapai.` };
    }
  }
  s.listed = Boolean(listed);
  enqueueWrite(
    updateDoc(doc(db, 'submissions', submissionId), {
      listed: s.listed,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `submissions/${submissionId}`))
  );
  return { ok: true };
}

function subscribe(userId: string, planId: string, cycle: 'monthly' | 'yearly') {
  const u = findBy(state.users, 'id', userId);
  if (!u) return { ok: false, message: 'Pengguna tidak ditemukan.' };
  const rolePlans = PLANS[u.role];
  const plan = rolePlans?.[planId];
  if (!plan) return { ok: false, message: 'Paket tidak valid.' };

  const price = cycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
  const w = walletOf(userId);
  if (price > 0 && w.balance < price) {
    return { ok: false, needTopup: true, requiredAmount: price - w.balance, message: `Saldo tidak mencukupi (${formatRupiah(price)}).` };
  }

  if (price > 0) {
    w.balance -= price;
    enqueueWrite(
      updateDoc(doc(db, 'wallets', userId), { balance: w.balance, updatedAt: serverTimestamp() })
        .catch((err) => handleFirestoreError(err, OperationType.UPDATE, `wallets/${userId}`))
    );
    const txId = genId('tx');
    state.transactions.push({
      id: txId,
      type: 'subscription',
      fromUserId: userId,
      amount: price,
      fee: 0,
      description: `Langganan ${plan.name} (${cycle === 'yearly' ? 'Tahunan' : 'Bulanan'})`,
      createdAt: new Date().toISOString(),
    });
    enqueueWrite(
      setDoc(doc(db, 'transactions', txId), {
        id: txId,
        type: 'subscription',
        fromUserId: userId,
        amount: price,
        fee: 0,
        description: `Langganan ${plan.name} (${cycle === 'yearly' ? 'Tahunan' : 'Bulanan'})`,
        createdAt: serverTimestamp(),
      }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`))
    );
  }

  const days = cycle === 'yearly' ? 365 : 30;
  const expiresAt = planId === 'free' ? '' : new Date(Date.now() + days * 86400000).toISOString();
  u.subscription = { planId, cycle, status: 'active', expiresAt };
  enqueueWrite(
    updateDoc(doc(db, 'users', userId), {
      planId,
      planCycle: cycle,
      planStatus: 'active',
      planExpiresAt: expiresAt,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`))
  );

  return { ok: true, plan };
}

function cancelSubscription(userId: string) {
  const u = findBy(state.users, 'id', userId);
  if (!u || !u.subscription) return { ok: false, message: 'Tidak ada langganan aktif.' };
  u.subscription.status = 'cancelled';
  enqueueWrite(
    updateDoc(doc(db, 'users', userId), {
      planStatus: 'cancelled',
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.UPDATE, `users/${userId}`))
  );
  return { ok: true };
}

function addReview(campaignId: string, reviewerId: string, revieweeId: string, rating: number, comment: string) {
  const rNum = Math.round(Number(rating));
  if (rNum < 1 || rNum > 5) return { ok: false, message: 'Rating harus 1-5.' };
  const exists = state.reviews.some((r) => r.campaignId === campaignId && r.reviewerId === reviewerId && r.revieweeId === revieweeId);
  if (exists) return { ok: false, message: 'Anda sudah memberikan ulasan.' };

  const id = genId('rev');
  const rev = { id, campaignId, reviewerId, revieweeId, rating: rNum, comment: String(comment || '').slice(0, 600), createdAt: new Date().toISOString() };
  state.reviews.push(rev);

  enqueueWrite(
    setDoc(doc(db, 'reviews', id), {
      id,
      campaignId,
      reviewerId,
      revieweeId,
      rating: rNum,
      comment: rev.comment,
      createdAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.CREATE, `reviews/${id}`))
  );
  return { ok: true, review: rev };
}

function canReview(campaignId: string, reviewerId: string, revieweeId: string): boolean {
  const c = findBy(state.campaigns, 'id', campaignId);
  if (!c) return false;
  const already = state.reviews.some((r) => r.campaignId === campaignId && r.reviewerId === reviewerId && r.revieweeId === revieweeId);
  if (already) return false;
  return state.submissions.some((s) => s.campaignId === campaignId && s.status === 'approved' && (s.creatorId === revieweeId || s.creatorId === reviewerId));
}

function enrichCampaign(c: any) {
  const acc = acceptedCount(c.id);
  return {
    ...c,
    accepted: acc,
    slotsFilled: acc,
    slotsLeft: Math.max(0, c.slots - acc),
    targetNiche: c.targetNiche || c.niche,
    contentType: c.contentType || c.deliverable || 'Video Review',
    platform: Array.isArray(c.platform) ? c.platform : ['TikTok', 'Instagram Reels'],
    featured: Boolean(planOf(c.umkmId).plan.featured),
  };
}

function recommendFor(campaignId: string) {
  const c = findBy(state.campaigns, 'id', campaignId);
  if (!c) return { items: [], total: 0, limit: 3 };
  const limit = planOf(c.umkmId).plan.recommendationLimit || 3;
  const creators = state.users.filter((u) => u.role === 'creator' && u.status === 'active');
  const campNiche = c.targetNiche || c.niche;
  const scored = creators.map((cr) => {
    const social = socialSummaryOf(cr.id);
    const rev = reviewsFor(cr.id);
    const boost = planOf(cr.id).plan.priorityBoost || 0;
    let score = 40 + boost;
    if (cr.niche === campNiche) score += 25;
    if (social.avgEngagementRate >= 4) score += 15;
    if (rev.average) score += rev.average * 3;
    const normScore = Number((Math.min(100, Math.round(score)) / 100).toFixed(2));
    return {
      creator: cr,
      score: normScore,
      social,
      reviews: rev,
      rating: rev.average,
      reasons: [
        cr.niche === campNiche ? `Niche cocok (${cr.niche})` : `Kreator aktif`,
        social.connectedCount > 0 ? `${social.connectedCount} platform terverifikasi` : 'Siap kolaborasi',
      ],
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return { items: scored.slice(0, limit), total: scored.length, limit };
}

function roiOf(campaignId: string) {
  const subs = state.submissions.filter((s) => s.campaignId === campaignId && s.status === 'approved');
  const c = findBy(state.campaigns, 'id', campaignId);
  let views = 0, likes = 0, comments = 0, clicks = 0;
  subs.forEach((s) => {
    if (s.performance) {
      views += Number(s.performance.views || 0);
      likes += Number(s.performance.likes || 0);
      comments += Number(s.performance.comments || 0);
      clicks += Number(s.performance.clicks || 0);
    }
  });
  const totalSpent = c ? subs.length * c.budgetPerSlot : 0;
  const totalEng = likes + comments;
  return {
    totalViews: views,
    totalLikes: likes,
    totalComments: comments,
    totalEngagement: totalEng,
    totalClicks: clicks,
    totalSpent,
    engagementRate: views > 0 ? Number(((totalEng / views) * 100).toFixed(2)) : 0,
    costPerEngagement: totalEng > 0 ? Math.round(totalSpent / totalEng) : null,
  };
}

function revenueSummary() {
  let escrow = 0, payout = 0, campaignFee = 0, licenseFee = 0, subRevenue = 0;
  state.transactions.forEach((t) => {
    if (t.type === 'escrow_hold') escrow += Number(t.amount || 0);
    if (t.type === 'escrow_release') {
      payout += Number(t.amount || 0);
      campaignFee += Number(t.fee || 0);
    }
    if (t.type === 'license_purchase') licenseFee += Number(t.fee || 0);
    if (t.type === 'subscription') subRevenue += Number(t.amount || 0);
  });
  const totalRevenue = campaignFee + licenseFee + subRevenue;
  let subscribers = 0;
  const mrr = state.users.reduce((s, u) => {
    const p = planOf(u.id);
    if (!p.active || u.subscription?.status === 'cancelled') return s;
    subscribers += 1;
    const m = u.subscription?.cycle === 'yearly' ? Math.round(p.plan.yearlyPrice / 12) : p.plan.monthlyPrice;
    return s + m;
  }, 0);
  return {
    escrow,
    payout,
    campaignFee,
    licenseFee,
    subRevenue,
    totalRevenue,
    mrr,
    subscribers,
    campaignGMV: escrow,
    totalCreators: state.users.filter((u) => u.role === 'creator').length,
    totalUmkm: state.users.filter((u) => u.role === 'umkm').length,
  };
}

function requireRole(roles?: string[]) {
  if (!currentSession) {
    window.location.href = 'login.html';
    return null;
  }
  if (roles && roles.length > 0 && !roles.includes(currentSession.role)) {
    if (currentSession.role === 'umkm') window.location.href = 'dashboard-umkm.html';
    else if (currentSession.role === 'creator') window.location.href = 'dashboard-creator.html';
    else if (currentSession.role === 'admin') window.location.href = 'dashboard-admin.html';
    else window.location.href = 'index.html';
    return null;
  }
  return currentSession;
}

const KolabDB = {
  ready,
  reload,
  flush,
  signInWithGoogle,
  completeGoogleOnboarding,
  signOut,
  getCurrentGoogleUser,
  connectYouTubeWithGoogle,
  saveConnectedSocialProfile,
  disconnectSocialAccount,
  openPaymentGateway,
  MIN_PAYOUT,
  genId,
  formatRupiah,
  getSession: () => currentSession,
  clearSession: signOut,
  requireRole,
  getUserById: (id: string) => findBy(state.users, 'id', id),
  getUsersByRole: (role: string) => state.users.filter((u) => u.role === role),
  getAllUsers: () => state.users,
  verifyUser: (id: string) => {
    const u = findBy(state.users, 'id', id);
    if (!u) return { ok: false, message: 'Pengguna tidak ditemukan.' };
    u.status = 'active';
    enqueueWrite(updateDoc(doc(db, 'users', id), { status: 'active', updatedAt: serverTimestamp() }).catch(() => {}));
    return { ok: true, user: u };
  },
  suspendUser: (id: string) => {
    const u = findBy(state.users, 'id', id);
    if (!u) return { ok: false, message: 'Pengguna tidak ditemukan.' };
    u.status = 'suspended';
    enqueueWrite(updateDoc(doc(db, 'users', id), { status: 'suspended', updatedAt: serverTimestamp() }).catch(() => {}));
    return { ok: true, user: u };
  },
  getWallet: (userId: string) => {
    const w = walletOf(userId);
    return { balance: w.balance, held: w.held, heldBalance: w.held };
  },
  topUp,
  requestPayout,
  createCampaign,
  cancelCampaign,
  applyToCampaign,
  submitContent,
  requestRevision,
  approveSubmission,
  setContentPerformance,
  getCampaignById: (id: string) => {
    const c = findBy(state.campaigns, 'id', id);
    return c ? enrichCampaign(c) : null;
  },
  getCampaignsByUmkm: (umkmId: string) =>
    state.campaigns
      .filter((c) => c.umkmId === umkmId)
      .map(enrichCampaign)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  getAllCampaigns: () => state.campaigns.map(enrichCampaign),
  getOpenCampaigns: () =>
    state.campaigns
      .filter((c) => c.status === 'open' && acceptedCount(c.id) < c.slots)
      .map(enrichCampaign)
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  getAcceptedCount: acceptedCount,
  getApplicationsByCampaign: (campaignId: string) => state.applications.filter((a) => a.campaignId === campaignId),
  getApplicationsByCreator: (creatorId: string) => state.applications.filter((a) => a.creatorId === creatorId),
  getSubmissionByApplication: (appId: string) => state.submissions.find((s) => s.applicationId === appId) || null,
  getCampaignROI: roiOf,
  getInfluencerTier,
  getSocialSummary: socialSummaryOf,
  getUmkmPerformanceSummary: (umkmId: string) => {
    const myCamps = state.campaigns.filter((c) => c.umkmId === umkmId);
    let views = 0, likes = 0, comments = 0, spent = 0;
    myCamps.forEach((c) => {
      const r = roiOf(c.id);
      views += r.totalViews;
      likes += r.totalLikes;
      comments += r.totalComments;
      spent += r.totalSpent;
    });
    const totalEng = likes + comments;
    return {
      totalCampaigns: myCamps.length,
      activeCampaigns: myCamps.filter((c) => c.status === 'open').length,
      totalViews: views,
      totalLikes: likes,
      totalComments: comments,
      totalEngagement: totalEng,
      totalSpent: spent,
      engagementRate: views > 0 ? Number(((totalEng / views) * 100).toFixed(2)) : 0,
      avgCostPerEngagement: totalEng > 0 ? Math.round(spent / totalEng) : null,
    };
  },
  getUmkmTopCreators: (umkmId: string, limit = 5) => {
    const subs = state.submissions.filter((s) => s.umkmId === umkmId && s.status === 'approved');
    const byCreator = new Map<string, { views: number; engagements: number; count: number }>();
    subs.forEach((s) => {
      const prev = byCreator.get(s.creatorId) || { views: 0, engagements: 0, count: 0 };
      prev.views += Number(s.performance?.views || 0);
      prev.engagements += Number(s.performance?.likes || 0) + Number(s.performance?.comments || 0);
      prev.count += 1;
      byCreator.set(s.creatorId, prev);
    });
    return Array.from(byCreator.entries())
      .map(([cid, st]) => ({ creator: findBy(state.users, 'id', cid), ...st }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);
  },
  getCreatorStats: (creatorId: string) => {
    const apps = state.applications.filter((a) => a.creatorId === creatorId);
    const approvedSubs = state.submissions.filter((s) => s.creatorId === creatorId && s.status === 'approved');
    const totalEarnings = state.transactions
      .filter((t) => (t.type === 'escrow_release' || t.type === 'license_purchase') && t.toUserId === creatorId)
      .reduce((s, t) => s + Number(t.amount || 0), 0);
    return {
      totalCampaigns: apps.length,
      approvedCount: approvedSubs.length,
      totalEarnings,
      social: socialSummaryOf(creatorId),
      reviews: reviewsFor(creatorId),
    };
  },
  getActivityFeed: (userId: string, limit = 8) =>
    state.transactions
      .filter((t) => t.fromUserId === userId || t.toUserId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit),
  getRevenueSummary: revenueSummary,
  getEscrowSummary: () => {
    const r = revenueSummary();
    return { totalEscrow: r.escrow, totalPayout: r.payout, totalFee: r.campaignFee + r.licenseFee };
  },
  getAllTransactions: () =>
    state.transactions.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  recommendCreatorsForCampaign: (campaignId: string) => recommendFor(campaignId).items,
  getRecommendationInfo: (campaignId: string) => {
    const r = recommendFor(campaignId);
    return { limit: r.limit, total: r.total, locked: Math.max(0, r.total - r.limit) };
  },
  addReview,
  getReviewsForUser: reviewsFor,
  canReview,
  getPlans: (role: string) => Object.values(PLANS[role] || {}),
  getPlanFeatures: (role: string, planId: string) => PLANS[role]?.[planId]?.features || [],
  getUserPlan: (userId: string) => {
    const p = planOf(userId);
    return {
      role: p.role,
      planId: p.plan.id,
      plan: p.plan,
      active: p.active,
      subscription: p.subscription,
      expiresAt: p.active ? p.subscription.expiresAt : null,
      cancelled: Boolean(p.active && p.subscription.status === 'cancelled'),
    };
  },
  subscribe,
  cancelSubscription,
  getLicenseOptions: licenseOptions,
  purchaseLicense,
  setLicensePricing,
  setContentListed,
  getLibraryListings: () => {
    const out: any[] = [];
    state.submissions.forEach((s) => {
      if (s.status !== 'approved' || !s.listed || s.exclusiveSold) return;
      const camp = findBy(state.campaigns, 'id', s.campaignId);
      if (!camp) return;
      out.push({
        submission: s,
        campaign: camp,
        creator: findBy(state.users, 'id', s.creatorId),
        umkm: findBy(state.users, 'id', camp.umkmId),
        pricing: pricingOf(s),
        performance: s.performance || null,
        tier: socialSummaryOf(s.creatorId).tier,
        rating: reviewsFor(s.creatorId).average,
      });
    });
    return out;
  },
  getCreatorContent: (creatorId: string) => {
    const items: any[] = [];
    state.submissions
      .filter((s) => s.creatorId === creatorId && s.status === 'approved')
      .forEach((s) => {
        const c = findBy(state.campaigns, 'id', s.campaignId);
        items.push({
          submission: s,
          campaign: c,
          umkm: c ? findBy(state.users, 'id', c.umkmId) : null,
          pricing: pricingOf(s),
          sales: state.licenses
            .filter((l) => l.submissionId === s.id)
            .map((l) => ({
              ...l,
              fee: l.platformFee ?? l.fee ?? 0,
              net: l.netSeller ?? l.net ?? 0,
              buyerName: findBy(state.users, 'id', l.buyerId)?.name || 'UMKM',
            })),
        });
      });
    const limit = planOf(creatorId).plan.maxLibraryListings;
    return { items, listedCount: items.filter((i) => i.submission.listed).length, limit };
  },
  getLicensesByBuyer: (userId: string) =>
    state.licenses
      .filter((l) => l.buyerId === userId)
      .map((l) => {
        const s = findBy(state.submissions, 'id', l.submissionId);
        const c = s ? findBy(state.campaigns, 'id', s.campaignId) : null;
        return {
          ...l,
          campaignTitle: c?.title || '',
          creatorName: findBy(state.users, 'id', l.sellerId)?.name || 'Creator',
          fileUrl: s?.fileUrl || '',
          active: l.type === 'buyout' || !l.expiresAt || new Date(l.expiresAt).getTime() > Date.now(),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  getLicensesBySeller: (userId: string) =>
    state.licenses
      .filter((l) => l.sellerId === userId)
      .map((l) => ({
        ...l,
        fee: l.platformFee ?? l.fee ?? 0,
        net: l.netSeller ?? l.net ?? 0,
      })),
  load: () => state,
};

(window as any).KolabDB = KolabDB;
export default KolabDB;
