import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const PAYMENT_HMAC_SECRET = process.env.PAYMENT_HMAC_SECRET || crypto.randomBytes(32).toString('hex');

const MIDTRANS_SERVER_KEY = (process.env.MIDTRANS_SERVER_KEY || '').trim();
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const XENDIT_SECRET_KEY = (process.env.XENDIT_SECRET_KEY || '').trim();
const XENDIT_CALLBACK_TOKEN = (process.env.XENDIT_CALLBACK_TOKEN || '').trim();
// Mode uji pembayaran (sandbox) hanya boleh aktif di lingkungan pengembangan,
// atau kalau ALLOW_SANDBOX_PAYMENTS=true diisi dengan sengaja (misalnya untuk staging).
// Di versi live tanpa kunci Midtrans/Xendit, pembayaran ditolak, bukan disimulasikan.
const ALLOW_SANDBOX_PAYMENTS =
  process.env.ALLOW_SANDBOX_PAYMENTS === 'true' || process.env.NODE_ENV !== 'production';

const YOUTUBE_CLIENT_ID = (process.env.YOUTUBE_CLIENT_ID || '').trim();
const YOUTUBE_CLIENT_SECRET = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
const YOUTUBE_API_KEY = (process.env.YOUTUBE_API_KEY || '').trim();
const INSTAGRAM_CLIENT_ID = (process.env.INSTAGRAM_CLIENT_ID || '').trim();
const INSTAGRAM_CLIENT_SECRET = (process.env.INSTAGRAM_CLIENT_SECRET || '').trim();
const TIKTOK_CLIENT_KEY = (process.env.TIKTOK_CLIENT_KEY || '').trim();
const TIKTOK_CLIENT_SECRET = (process.env.TIKTOK_CLIENT_SECRET || '').trim();

type PaymentMethod = 'qris' | 'bca_va' | 'mandiri_va' | 'bni_va' | 'bri_va' | 'permata_va';

interface PaymentOrderRecord {
  orderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  provider: 'midtrans' | 'xendit' | 'sandbox';
  method: PaymentMethod;
  purpose: 'topup' | 'subscription' | 'campaign' | 'license';
  amount: number;
  status: 'pending' | 'settled' | 'expired' | 'failed';
  qrString?: string;
  qrImageUrl?: string;
  vaNumber?: string;
  billerCode?: string;
  billKey?: string;
  bankLabel?: string;
  expiresAt: string;
  createdAt: string;
  settledAt?: string;
  metadata?: Record<string, unknown>;
}

const paymentStore = new Map<string, PaymentOrderRecord>();
const oauthStateStore = new Map<string, { platform: string; userId: string; createdAt: number }>();

function crc16Ccitt(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(tag: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${tag}${len}${value}`;
}

function generateEmvcoQris(amount: number, merchantName: string, orderId: string): string {
  const cleanMerchant = merchantName.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 25) || 'KOLAB INDONESIA';
  const amountStr = String(Math.round(amount));
  const merchantAccountInfo =
    tlv('00', 'ID.CO.QRIS.WWW') +
    tlv('01', '936009143188812345') +
    tlv('02', 'ID1020012345678') +
    tlv('03', 'UME');
  const additionalData = tlv('01', orderId.slice(0, 25));

  const payloadWithoutCrc =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('26', merchantAccountInfo) +
    tlv('52', '5812') +
    tlv('53', '360') +
    tlv('54', amountStr) +
    tlv('58', 'ID') +
    tlv('59', cleanMerchant) +
    tlv('60', 'JAKARTA') +
    tlv('61', '10110') +
    tlv('62', additionalData) +
    '6304';

  return payloadWithoutCrc + crc16Ccitt(payloadWithoutCrc);
}

function signSettlement(order: PaymentOrderRecord): string {
  const payload = `${order.orderId}|${order.userId}|${order.amount}|${order.purpose}|${order.status}`;
  return crypto.createHmac('sha256', PAYMENT_HMAC_SECRET).update(payload).digest('hex');
}

function getActiveGatewayProvider(): 'midtrans' | 'xendit' | 'sandbox' {
  if (MIDTRANS_SERVER_KEY) return 'midtrans';
  if (XENDIT_SECRET_KEY) return 'xendit';
  return 'sandbox';
}

function generateSandboxVa(method: PaymentMethod): { vaNumber: string; billerCode?: string; billKey?: string; bankLabel: string } {
  const suffix = String(Math.floor(1000000000 + Math.random() * 8999999999));
  switch (method) {
    case 'bca_va':
      return { vaNumber: `8808${suffix.slice(0, 10)}`, bankLabel: 'BCA Virtual Account' };
    case 'mandiri_va':
      return {
        vaNumber: `70012-${suffix.slice(0, 10)}`,
        billerCode: '70012',
        billKey: suffix.slice(0, 10),
        bankLabel: 'Mandiri Bill Payment'
      };
    case 'bni_va':
      return { vaNumber: `8277${suffix.slice(0, 10)}`, bankLabel: 'BNI Virtual Account' };
    case 'bri_va':
      return { vaNumber: `26215${suffix.slice(0, 10)}`, bankLabel: 'BRI Virtual Account (BRIVA)' };
    case 'permata_va':
      return { vaNumber: `8980${suffix.slice(0, 10)}`, bankLabel: 'Permata Virtual Account' };
    default:
      return { vaNumber: `8808${suffix.slice(0, 10)}`, bankLabel: 'Virtual Account' };
  }
}

function computeYouTubeAnalytics(channel: Record<string, unknown>, videos: Array<Record<string, unknown>>) {
  const snippet = (channel.snippet || {}) as Record<string, unknown>;
  const stats = (channel.statistics || {}) as Record<string, string>;
  const followers = Number(stats.subscriberCount || 0);
  const totalViews = Number(stats.viewCount || 0);
  const mediaCount = Number(stats.videoCount || 0);

  let sumLikes = 0;
  let sumComments = 0;
  let sumViews = 0;
  const topVideos: Array<Record<string, unknown>> = [];

  for (const v of videos) {
    const vs = (v.statistics || {}) as Record<string, string>;
    const vSnip = (v.snippet || {}) as Record<string, unknown>;
    const views = Number(vs.viewCount || 0);
    const likes = Number(vs.likeCount || 0);
    const comments = Number(vs.commentCount || 0);
    sumViews += views;
    sumLikes += likes;
    sumComments += comments;
    const thumbs = (vSnip.thumbnails || {}) as Record<string, { url?: string }>;
    topVideos.push({
      id: String(v.id || ''),
      title: String(vSnip.title || 'Video'),
      publishedAt: String(vSnip.publishedAt || ''),
      views,
      likes,
      comments,
      thumbnail: thumbs.medium?.url || thumbs.default?.url || '',
      engagementRate: views > 0 ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0
    });
  }

  topVideos.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));

  const count = videos.length || 1;
  const avgViews = Math.round(sumViews / count);
  const avgLikes = Math.round(sumLikes / count);
  const avgComments = Math.round(sumComments / count);
  const engagementRate =
    sumViews > 0
      ? Number((((sumLikes + sumComments) / sumViews) * 100).toFixed(2))
      : followers > 0
      ? Number((((avgLikes + avgComments) / followers) * 100).toFixed(2))
      : 0;

  const customUrl = String(snippet.customUrl || '').replace(/^@/, '');
  const handle = customUrl ? `@${customUrl}` : `@${String(snippet.title || 'youtube').toLowerCase().replace(/\s+/g, '')}`;
  const thumbs = (snippet.thumbnails || {}) as Record<string, { url?: string }>;

  return {
    platform: 'youtube',
    channelId: String(channel.id || ''),
    handle,
    channelTitle: String(snippet.title || 'YouTube Channel'),
    profileUrl: customUrl ? `https://www.youtube.com/@${customUrl}` : `https://www.youtube.com/channel/${channel.id}`,
    avatarUrl: thumbs.medium?.url || thumbs.default?.url || '',
    followers,
    totalViews,
    mediaCount,
    avgViews,
    avgLikes,
    avgComments,
    engagementRate,
    topVideos: topVideos.slice(0, 5),
    lastSyncedAt: new Date().toISOString()
  };
}

async function fetchYouTubeChannelAndVideos(params: { accessToken?: string; handle?: string; apiKey?: string }) {
  const headers: Record<string, string> = {};
  const qs = new URLSearchParams({ part: 'snippet,statistics,contentDetails' });

  if (params.accessToken) {
    headers['Authorization'] = `Bearer ${params.accessToken}`;
    qs.set('mine', 'true');
  } else if (params.handle && params.apiKey) {
    const cleanHandle = params.handle.trim().replace(/^@/, '');
    qs.set('forHandle', cleanHandle);
    qs.set('key', params.apiKey);
  } else {
    throw new Error('Memerlukan Google OAuth Access Token atau Channel Handle + YouTube API Key.');
  }

  const chResp = await fetch(`https://www.googleapis.com/youtube/v3/channels?${qs.toString()}`, { headers });
  const chData = (await chResp.json()) as { items?: Array<Record<string, unknown>>; error?: { message?: string } };
  if (!chResp.ok) {
    throw new Error(chData.error?.message || `YouTube API error (${chResp.status})`);
  }

  const channel = chData.items?.[0];
  if (!channel) {
    throw new Error('Channel YouTube tidak ditemukan pada akun Google ini.');
  }

  const contentDetails = (channel.contentDetails || {}) as { relatedPlaylists?: { uploads?: string } };
  const uploadsPlaylistId = contentDetails.relatedPlaylists?.uploads;
  let videos: Array<Record<string, unknown>> = [];

  if (uploadsPlaylistId) {
    const plQs = new URLSearchParams({
      part: 'contentDetails',
      playlistId: uploadsPlaylistId,
      maxResults: '10'
    });
    if (!params.accessToken && params.apiKey) plQs.set('key', params.apiKey);

    const plResp = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${plQs.toString()}`, { headers });
    if (plResp.ok) {
      const plData = (await plResp.json()) as { items?: Array<{ contentDetails?: { videoId?: string } }> };
      const videoIds = (plData.items || [])
        .map((it) => it.contentDetails?.videoId)
        .filter((id): id is string => Boolean(id));

      if (videoIds.length > 0) {
        const vidQs = new URLSearchParams({
          part: 'snippet,statistics',
          id: videoIds.join(',')
        });
        if (!params.accessToken && params.apiKey) vidQs.set('key', params.apiKey);
        const vidResp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${vidQs.toString()}`, { headers });
        if (vidResp.ok) {
          const vidData = (await vidResp.json()) as { items?: Array<Record<string, unknown>> };
          videos = vidData.items || [];
        }
      }
    }
  }

  return computeYouTubeAnalytics(channel, videos);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, appUrl: APP_URL, paymentProvider: getActiveGatewayProvider() });
  });

  // =========================================================
  // 1. PAYMENT GATEWAY API (QRIS & VIRTUAL ACCOUNT)
  // =========================================================
  app.get('/api/payments/config', (_req: Request, res: Response) => {
    const provider = getActiveGatewayProvider();
    res.json({
      provider,
      sandboxAllowed: ALLOW_SANDBOX_PAYMENTS,
      paymentsEnabled: provider !== 'sandbox' || ALLOW_SANDBOX_PAYMENTS,
      isProduction: provider === 'midtrans' ? MIDTRANS_IS_PRODUCTION : provider === 'xendit',
      webhookUrl: `${APP_URL}/api/payments/webhook`,
      channels: [
        { id: 'qris', label: 'QRIS (GoPay, OVO, DANA, ShopeePay, BCA/Mandiri Mobile)', type: 'qris', feeNote: 'Instan 24/7' },
        { id: 'bca_va', label: 'BCA Virtual Account', type: 'va', feeNote: 'Verifikasi Otomatis' },
        { id: 'mandiri_va', label: 'Mandiri Virtual Account', type: 'va', feeNote: 'Verifikasi Otomatis' },
        { id: 'bni_va', label: 'BNI Virtual Account', type: 'va', feeNote: 'Verifikasi Otomatis' },
        { id: 'bri_va', label: 'BRI Virtual Account (BRIVA)', type: 'va', feeNote: 'Verifikasi Otomatis' },
        { id: 'permata_va', label: 'Permata Virtual Account', type: 'va', feeNote: 'Verifikasi Otomatis' }
      ]
    });
  });

  app.post('/api/payments/create', async (req: Request, res: Response) => {
    try {
      const { userId, userName, userEmail, amount, method, purpose, metadata } = req.body as {
        userId?: string;
        userName?: string;
        userEmail?: string;
        amount?: number;
        method?: PaymentMethod;
        purpose?: 'topup' | 'subscription' | 'campaign' | 'license';
        metadata?: Record<string, unknown>;
      };

      const numAmount = Math.round(Number(amount || 0));
      if (!userId || numAmount < 10000) {
        res.status(400).json({ ok: false, message: 'Nominal pembayaran minimal Rp10.000.' });
        return;
      }

      const validMethods: PaymentMethod[] = ['qris', 'bca_va', 'mandiri_va', 'bni_va', 'bri_va', 'permata_va'];
      const chosenMethod: PaymentMethod = method && validMethods.includes(method) ? method : 'qris';
      const chosenPurpose = purpose || 'topup';
      const orderId = `KLP-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const provider = getActiveGatewayProvider();
      if (provider === 'sandbox' && !ALLOW_SANDBOX_PAYMENTS) {
        res.status(503).json({
          ok: false,
          message: 'Pembayaran sedang disiapkan dan belum bisa dipakai. Coba lagi nanti atau hubungi tim Kolab.'
        });
        return;
      }

      let order: PaymentOrderRecord = {
        orderId,
        userId,
        userName: userName || 'Pengguna Kolab',
        userEmail: userEmail || 'user@kolab.id',
        provider,
        method: chosenMethod,
        purpose: chosenPurpose,
        amount: numAmount,
        status: 'pending',
        expiresAt,
        createdAt: new Date().toISOString(),
        metadata
      };

      if (provider === 'midtrans') {
        const baseUrl = MIDTRANS_IS_PRODUCTION ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
        const authHeader = 'Basic ' + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64');

        const chargeBody: Record<string, unknown> = {
          transaction_details: { order_id: orderId, gross_amount: numAmount },
          customer_details: {
            first_name: order.userName,
            email: order.userEmail
          }
        };

        if (chosenMethod === 'qris') {
          chargeBody.payment_type = 'qris';
          chargeBody.qris = { acquirer: 'gopay' };
        } else if (chosenMethod === 'mandiri_va') {
          chargeBody.payment_type = 'echannel';
          chargeBody.echannel = { bill_info1: 'Kolab Payment', bill_info2: chosenPurpose };
        } else if (chosenMethod === 'permata_va') {
          chargeBody.payment_type = 'permata';
        } else {
          chargeBody.payment_type = 'bank_transfer';
          chargeBody.bank_transfer = { bank: chosenMethod.replace('_va', '') };
        }

        const midResp = await fetch(`${baseUrl}/v2/charge`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify(chargeBody)
        });
        const midData = (await midResp.json()) as Record<string, unknown>;
        if (!midResp.ok || (midData.status_code && String(midData.status_code).startsWith('4'))) {
          res.status(502).json({ ok: false, message: String(midData.status_message || 'Midtrans charge failed') });
          return;
        }

        if (chosenMethod === 'qris') {
          const qrString = String(midData.qr_string || '');
          const actions = (midData.actions || []) as Array<{ name?: string; url?: string }>;
          const qrAction = actions.find((a) => a.name === 'generate-qr-code');
          order.qrString = qrString;
          order.qrImageUrl = qrString ? await QRCode.toDataURL(qrString, { width: 280, margin: 2 }) : qrAction?.url;
        } else if (chosenMethod === 'mandiri_va') {
          order.billerCode = String(midData.biller_code || '70012');
          order.billKey = String(midData.bill_key || '');
          order.vaNumber = `${order.billerCode}-${order.billKey}`;
          order.bankLabel = 'Mandiri Bill Payment';
        } else if (chosenMethod === 'permata_va') {
          order.vaNumber = String(midData.permata_va_number || '');
          order.bankLabel = 'Permata Virtual Account';
        } else {
          const vaList = (midData.va_numbers || []) as Array<{ bank?: string; va_number?: string }>;
          order.vaNumber = vaList[0]?.va_number || '';
          order.bankLabel = `${(vaList[0]?.bank || chosenMethod.replace('_va', '')).toUpperCase()} Virtual Account`;
        }
      } else if (provider === 'xendit') {
        const authHeader = 'Basic ' + Buffer.from(`${XENDIT_SECRET_KEY}:`).toString('base64');
        if (chosenMethod === 'qris') {
          const xResp = await fetch('https://api.xendit.co/qr_codes', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
              'api-version': '2022-07-31'
            },
            body: JSON.stringify({
              reference_id: orderId,
              type: 'DYNAMIC',
              currency: 'IDR',
              amount: numAmount,
              expires_at: expiresAt
            })
          });
          const xData = (await xResp.json()) as Record<string, unknown>;
          if (!xResp.ok) {
            res.status(502).json({ ok: false, message: String(xData.message || 'Xendit QRIS failed') });
            return;
          }
          order.qrString = String(xData.qr_string || '');
          order.qrImageUrl = await QRCode.toDataURL(order.qrString, { width: 280, margin: 2 });
        } else {
          const bankCode = chosenMethod.replace('_va', '').toUpperCase();
          const xResp = await fetch('https://api.xendit.co/callback_virtual_accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
            body: JSON.stringify({
              external_id: orderId,
              bank_code: bankCode,
              name: order.userName.slice(0, 50),
              is_closed: true,
              expected_amount: numAmount,
              expiration_date: expiresAt
            })
          });
          const xData = (await xResp.json()) as Record<string, unknown>;
          if (!xResp.ok) {
            res.status(502).json({ ok: false, message: String(xData.message || 'Xendit VA failed') });
            return;
          }
          order.vaNumber = String(xData.account_number || '');
          order.bankLabel = `${bankCode} Virtual Account`;
        }
      } else {
        // Sandbox Mode: EMVCo-compliant QRIS + VA generator
        if (chosenMethod === 'qris') {
          order.qrString = generateEmvcoQris(numAmount, 'KOLAB MARKETPLACE', orderId);
          order.qrImageUrl = await QRCode.toDataURL(order.qrString, {
            width: 280,
            margin: 2,
            color: { dark: '#1c1c1c', light: '#ffffff' }
          });
        } else {
          const va = generateSandboxVa(chosenMethod);
          order.vaNumber = va.vaNumber;
          order.billerCode = va.billerCode;
          order.billKey = va.billKey;
          order.bankLabel = va.bankLabel;
        }
      }

      paymentStore.set(orderId, order);
      res.json({ ok: true, order });
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : 'Gagal membuat tagihan pembayaran.' });
    }
  });

  app.get('/api/payments/:orderId/status', async (req: Request, res: Response) => {
    const orderId = String(req.params.orderId || '');
    const order = paymentStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, message: 'Order pembayaran tidak ditemukan.' });
      return;
    }

    if (order.status === 'pending' && order.provider === 'midtrans' && MIDTRANS_SERVER_KEY) {
      try {
        const baseUrl = MIDTRANS_IS_PRODUCTION ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
        const authHeader = 'Basic ' + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64');
        const stResp = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
          headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
        });
        if (stResp.ok) {
          const stData = (await stResp.json()) as { transaction_status?: string };
          if (stData.transaction_status === 'settlement' || stData.transaction_status === 'capture') {
            order.status = 'settled';
            order.settledAt = new Date().toISOString();
          } else if (stData.transaction_status === 'expire') {
            order.status = 'expired';
          }
        }
      } catch {
        // Keep current status on transient poll error
      }
    }

    const settlementProof = order.status === 'settled' ? signSettlement(order) : null;
    res.json({ ok: true, order, settlementProof });
  });

  app.post('/api/payments/webhook', (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;

    // Midtrans Webhook verification
    if (body.order_id && body.status_code && body.gross_amount && body.signature_key && MIDTRANS_SERVER_KEY) {
      const expected = crypto
        .createHash('sha512')
        .update(`${body.order_id}${body.status_code}${body.gross_amount}${MIDTRANS_SERVER_KEY}`)
        .digest('hex');
      if (expected !== body.signature_key) {
        res.status(403).json({ ok: false, message: 'Invalid Midtrans signature' });
        return;
      }
      const order = paymentStore.get(String(body.order_id));
      if (order) {
        const txStatus = String(body.transaction_status || '');
        if (txStatus === 'settlement' || txStatus === 'capture') {
          order.status = 'settled';
          order.settledAt = new Date().toISOString();
        } else if (txStatus === 'expire') {
          order.status = 'expired';
        } else if (txStatus === 'deny' || txStatus === 'cancel') {
          order.status = 'failed';
        }
      }
      res.json({ ok: true });
      return;
    }

    // Xendit Webhook verification
    if (XENDIT_CALLBACK_TOKEN) {
      const incomingToken = req.header('x-callback-token');
      if (incomingToken !== XENDIT_CALLBACK_TOKEN) {
        res.status(403).json({ ok: false, message: 'Invalid Xendit callback token' });
        return;
      }
      const extId = String(body.external_id || body.reference_id || '');
      const order = paymentStore.get(extId);
      if (order && (body.status === 'COMPLETED' || body.status === 'SUCCEEDED' || body.payment_id)) {
        order.status = 'settled';
        order.settledAt = new Date().toISOString();
      }
      res.json({ ok: true });
      return;
    }

    res.json({ ok: true });
  });

  app.post('/api/payments/:orderId/simulate-settle', (req: Request, res: Response) => {
    const orderId = String(req.params.orderId || '');
    const order = paymentStore.get(orderId);
    if (!order) {
      res.status(404).json({ ok: false, message: 'Order tidak ditemukan.' });
      return;
    }
    if (order.provider !== 'sandbox' || !ALLOW_SANDBOX_PAYMENTS) {
      res.status(403).json({ ok: false, message: 'Simulasi hanya tersedia pada mode uji.' });
      return;
    }
    order.status = 'settled';
    order.settledAt = new Date().toISOString();
    res.json({ ok: true, order, settlementProof: signSettlement(order) });
  });

  // =========================================================
  // 2. SOCIAL MEDIA OAUTH & REAL STATS ANALYTICS API
  // =========================================================
  app.get('/api/oauth/config', (_req: Request, res: Response) => {
    res.json({
      appUrl: APP_URL,
      platforms: {
        youtube: {
          configuredServerOAuth: Boolean(YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET),
          supportsFirebaseGoogleAuth: true,
          callbackUrl: `${APP_URL}/api/oauth/youtube/callback`
        },
        instagram: {
          configuredServerOAuth: Boolean(INSTAGRAM_CLIENT_ID && INSTAGRAM_CLIENT_SECRET),
          callbackUrl: `${APP_URL}/api/oauth/instagram/callback`
        },
        tiktok: {
          configuredServerOAuth: Boolean(TIKTOK_CLIENT_KEY && TIKTOK_CLIENT_SECRET),
          callbackUrl: `${APP_URL}/api/oauth/tiktok/callback`
        }
      }
    });
  });

  app.get('/api/oauth/:platform/url', (req: Request, res: Response) => {
    const platform = String(req.params.platform || '').toLowerCase();
    const userId = String(req.query.userId || '');
    if (!userId) {
      res.status(400).json({ ok: false, message: 'userId wajib diisi.' });
      return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    oauthStateStore.set(state, { platform, userId, createdAt: Date.now() });
    const redirectUri = `${APP_URL}/api/oauth/${platform}/callback`;

    if (platform === 'youtube') {
      if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
        res.status(400).json({
          ok: false,
          needsFirebasePopup: true,
          message: 'Gunakan otorisasi Google YouTube langsung atau atur YOUTUBE_CLIENT_ID & YOUTUBE_CLIENT_SECRET.'
        });
        return;
      }
      const params = new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'offline',
        prompt: 'consent',
        state
      });
      res.json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
      return;
    }

    if (platform === 'instagram') {
      if (!INSTAGRAM_CLIENT_ID || !INSTAGRAM_CLIENT_SECRET) {
        res.status(400).json({
          ok: false,
          configured: false,
          callbackUrl: redirectUri,
          message: 'Kredensial OAuth Instagram belum dikonfigurasi (INSTAGRAM_CLIENT_ID & INSTAGRAM_CLIENT_SECRET).'
        });
        return;
      }
      const params = new URLSearchParams({
        client_id: INSTAGRAM_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'instagram_basic,instagram_manage_insights',
        response_type: 'code',
        state
      });
      res.json({ ok: true, url: `https://www.instagram.com/oauth/authorize?${params.toString()}` });
      return;
    }

    if (platform === 'tiktok') {
      if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET) {
        res.status(400).json({
          ok: false,
          configured: false,
          callbackUrl: redirectUri,
          message: 'Kredensial OAuth TikTok belum dikonfigurasi (TIKTOK_CLIENT_KEY & TIKTOK_CLIENT_SECRET).'
        });
        return;
      }
      const params = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        redirect_uri: redirectUri,
        scope: 'user.info.basic,user.info.stats,video.list',
        response_type: 'code',
        state
      });
      res.json({ ok: true, url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}` });
      return;
    }

    res.status(404).json({ ok: false, message: 'Platform tidak didukung.' });
  });

  app.get(['/api/oauth/:platform/callback', '/api/oauth/:platform/callback/'], async (req: Request, res: Response) => {
    const platform = String(req.params.platform || '').toLowerCase();
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const errorParam = String(req.query.error || '');

    const renderPopupResult = (payload: Record<string, unknown>) => {
      const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
      res.send(`<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;padding:24px;text-align:center;">
        <p>Menyelesaikan koneksi ${platform}...</p>
        <script>
          if (window.opener) {
            window.opener.postMessage(${safeJson}, '*');
            window.close();
          } else {
            window.location.href = '/creator-analytics.html';
          }
        </script>
      </body></html>`);
    };

    if (errorParam || !code) {
      renderPopupResult({ type: 'KOLAB_SOCIAL_OAUTH_ERROR', platform, message: errorParam || 'Otorisasi dibatalkan.' });
      return;
    }

    const storedState = oauthStateStore.get(state);
    if (!storedState || storedState.platform !== platform) {
      renderPopupResult({ type: 'KOLAB_SOCIAL_OAUTH_ERROR', platform, message: 'State OAuth tidak valid atau kadaluarsa.' });
      return;
    }
    oauthStateStore.delete(state);

    const redirectUri = `${APP_URL}/api/oauth/${platform}/callback`;

    try {
      if (platform === 'youtube') {
        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: YOUTUBE_CLIENT_ID,
            client_secret: YOUTUBE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          })
        });
        const tokenData = (await tokenResp.json()) as { access_token?: string; error_description?: string };
        if (!tokenResp.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || 'Gagal menukar token YouTube.');
        }
        const profile = await fetchYouTubeChannelAndVideos({ accessToken: tokenData.access_token });
        renderPopupResult({ type: 'KOLAB_SOCIAL_OAUTH_SUCCESS', platform: 'youtube', profile });
        return;
      }

      if (platform === 'instagram') {
        const tokenResp = await fetch('https://api.instagram.com/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: INSTAGRAM_CLIENT_ID,
            client_secret: INSTAGRAM_CLIENT_SECRET,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code
          })
        });
        const tokenData = (await tokenResp.json()) as { access_token?: string; error_message?: string };
        if (!tokenResp.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_message || 'Gagal menukar token Instagram.');
        }
        const meResp = await fetch(
          `https://graph.instagram.com/me?fields=id,username,account_type,media_count,followers_count&access_token=${encodeURIComponent(tokenData.access_token)}`
        );
        const me = (await meResp.json()) as Record<string, unknown>;
        const mediaResp = await fetch(
          `https://graph.instagram.com/me/media?fields=id,caption,media_type,timestamp,like_count,comments_count,permalink&limit=12&access_token=${encodeURIComponent(tokenData.access_token)}`
        );
        const mediaJson = (await mediaResp.json()) as { data?: Array<Record<string, unknown>> };
        const posts = mediaJson.data || [];
        let sumLikes = 0;
        let sumComments = 0;
        for (const p of posts) {
          sumLikes += Number(p.like_count || 0);
          sumComments += Number(p.comments_count || 0);
        }
        const followers = Number(me.followers_count || 0);
        const count = posts.length || 1;
        const avgLikes = Math.round(sumLikes / count);
        const avgComments = Math.round(sumComments / count);
        const engagementRate = followers > 0 ? Number((((avgLikes + avgComments) / followers) * 100).toFixed(2)) : 0;

        renderPopupResult({
          type: 'KOLAB_SOCIAL_OAUTH_SUCCESS',
          platform: 'instagram',
          profile: {
            platform: 'instagram',
            handle: `@${String(me.username || 'instagram')}`,
            channelTitle: String(me.username || 'Instagram'),
            profileUrl: `https://instagram.com/${me.username}`,
            followers,
            mediaCount: Number(me.media_count || posts.length),
            avgLikes,
            avgComments,
            avgViews: 0,
            totalViews: 0,
            engagementRate,
            topVideos: posts.slice(0, 5).map((p) => ({
              id: String(p.id || ''),
              title: String(p.caption || 'Instagram Post').slice(0, 80),
              likes: Number(p.like_count || 0),
              comments: Number(p.comments_count || 0),
              views: 0,
              publishedAt: String(p.timestamp || '')
            })),
            lastSyncedAt: new Date().toISOString()
          }
        });
        return;
      }

      if (platform === 'tiktok') {
        const tokenResp = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_key: TIKTOK_CLIENT_KEY,
            client_secret: TIKTOK_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
          })
        });
        const tokenData = (await tokenResp.json()) as { access_token?: string; error_description?: string };
        if (!tokenResp.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || 'Gagal menukar token TikTok.');
        }

        const userResp = await fetch(
          'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,likes_count,video_count,profile_deep_link',
          { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }
        );
        const userJson = (await userResp.json()) as { data?: { user?: Record<string, unknown> } };
        const tu = userJson.data?.user || {};

        const vidResp = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,like_count,comment_count,share_count,view_count', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_count: 10 })
        });
        const vidJson = (await vidResp.json()) as { data?: { videos?: Array<Record<string, unknown>> } };
        const vids = vidJson.data?.videos || [];
        let sumViews = 0;
        let sumLikes = 0;
        let sumComments = 0;
        for (const v of vids) {
          sumViews += Number(v.view_count || 0);
          sumLikes += Number(v.like_count || 0);
          sumComments += Number(v.comment_count || 0);
        }
        const followers = Number(tu.follower_count || 0);
        const count = vids.length || 1;
        const avgViews = Math.round(sumViews / count);
        const avgLikes = Math.round(sumLikes / count);
        const avgComments = Math.round(sumComments / count);
        const engagementRate =
          sumViews > 0
            ? Number((((sumLikes + sumComments) / sumViews) * 100).toFixed(2))
            : followers > 0
            ? Number((((avgLikes + avgComments) / followers) * 100).toFixed(2))
            : 0;

        renderPopupResult({
          type: 'KOLAB_SOCIAL_OAUTH_SUCCESS',
          platform: 'tiktok',
          profile: {
            platform: 'tiktok',
            handle: `@${String(tu.username || tu.display_name || 'tiktok')}`,
            channelTitle: String(tu.display_name || tu.username || 'TikTok'),
            profileUrl: String(tu.profile_deep_link || `https://www.tiktok.com/@${tu.username || ''}`),
            avatarUrl: String(tu.avatar_url || ''),
            followers,
            mediaCount: Number(tu.video_count || vids.length),
            totalViews: sumViews,
            avgViews,
            avgLikes,
            avgComments,
            engagementRate,
            topVideos: vids.slice(0, 5).map((v) => ({
              id: String(v.id || ''),
              title: String(v.title || 'TikTok Video').slice(0, 80),
              views: Number(v.view_count || 0),
              likes: Number(v.like_count || 0),
              comments: Number(v.comment_count || 0)
            })),
            lastSyncedAt: new Date().toISOString()
          }
        });
        return;
      }
    } catch (err) {
      renderPopupResult({
        type: 'KOLAB_SOCIAL_OAUTH_ERROR',
        platform,
        message: err instanceof Error ? err.message : 'Gagal mengambil data akun media sosial.'
      });
    }
  });

  app.post('/api/social/youtube/sync', async (req: Request, res: Response) => {
    try {
      const { accessToken, handle } = (req.body || {}) as { accessToken?: string; handle?: string };
      const profile = await fetchYouTubeChannelAndVideos({
        accessToken,
        handle,
        apiKey: YOUTUBE_API_KEY
      });
      res.json({ ok: true, profile });
    } catch (err) {
      res.status(400).json({
        ok: false,
        message: err instanceof Error ? err.message : 'Gagal menyinkronkan statistik YouTube.'
      });
    }
  });

  // =========================================================
  // 3. VITE DEV MIDDLEWARE OR STATIC PRODUCTION BUILD
  // =========================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kolab server running on http://0.0.0.0:${PORT} (APP_URL=${APP_URL})`);
  });
}

startServer();
