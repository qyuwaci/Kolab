const KolabDB = (function() {
  const KEY = 'kolab_db_v1';
  const SESSION_KEY = 'kolab_session_v1';
  const TAKE_RATE = 0.15;
  const TIER_THRESHOLDS = { mega: 1000000, makro: 100000, mikro: 10000 };

  function seed() {
    return {
      users: [
        { id: 'u-umkm-1', role: 'umkm', name: 'Warung Kopi Senja', email: 'umkm1@kolab.test', city: 'Bandung', category: 'Kuliner', status: 'active' },
        { id: 'u-creator-1', role: 'creator', name: 'Dinda Kreator', email: 'creator1@kolab.test', niche: 'food', followers: 12000, reputation: 4.6, status: 'active', socialAccounts: {} },
        { id: 'u-creator-2', role: 'creator', name: 'Bagas Konten', email: 'creator2@kolab.test', niche: 'lifestyle', followers: 8000, reputation: 4.2, status: 'active', socialAccounts: {} },
        { id: 'u-admin-1', role: 'admin', name: 'Admin Kolab', email: 'admin@kolab.test', status: 'active' }
      ],
      campaigns: [
        { id: 'c-1', umkmId: 'u-umkm-1', title: 'Review Kopi Susu Gula Aren', brief: 'Buat video review rasa dan suasana kedai', platform: ['TikTok','Instagram Reels'], contentType: 'Video Review', slots: 3, slotsFilled: 0, budgetPerSlot: 200000, paymentModel: 'fixed', deadline: '2026-10-15', targetNiche: 'food', status: 'open', createdAt: '2026-09-20T00:00:00Z' }
      ],
      applications: [
        { id: 'a-1', campaignId: 'c-1', creatorId: 'u-creator-1', status: 'accepted', appliedAt: '2026-09-21T00:00:00Z' }
      ],
      submissions: [
        { id: 's-1', applicationId: 'a-1', fileUrl: 'https://tiktok.com/@dindakreator/video/review-kopi-senja', status: 'submitted', revisionCount: 0, submittedAt: '2026-09-25T00:00:00Z' }
      ],
      wallets: {
        'u-umkm-1': { balance: 3000000, heldBalance: 600000 },
        'u-creator-1': { balance: 450000, heldBalance: 0 },
        'u-creator-2': { balance: 0, heldBalance: 0 }
      },
      transactions: [
        { id: 't-1', type: 'topup', toUserId: 'u-umkm-1', amount: 3000000, status: 'success', createdAt: '2026-09-18T00:00:00Z' },
        { id: 't-2', type: 'escrow_hold', fromUserId: 'u-umkm-1', campaignId: 'c-1', amount: 600000, status: 'success', createdAt: '2026-09-20T00:00:00Z' }
      ],
      payouts: [],
      reviews: [
        { id: 'r-1', campaignId: 'c-1', reviewerId: 'u-umkm-1', revieweeId: 'u-creator-1', rating: 5, comment: 'Konten sangat sesuai brief, komunikasi lancar', createdAt: '2026-09-26T00:00:00Z' },
        { id: 'r-2', campaignId: 'c-1', reviewerId: 'u-creator-1', revieweeId: 'u-umkm-1', rating: 5, comment: 'Brand sangat kooperatif dan pembayaran escrow tepat waktu', createdAt: '2026-09-26T00:00:00Z' }
      ]
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.users || !parsed.campaigns || !parsed.wallets) { const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
      if (!parsed.reviews) {
        parsed.reviews = seed().reviews;
      }
      parsed.users.forEach(function(u) {
        if (u.role === 'creator') {
          if (!u.socialAccounts) u.socialAccounts = {};
          if (!u.niche) u.niche = 'general';
        }
      });
      parsed.campaigns.forEach(function(c) {
        if (c.targetNiche === undefined) c.targetNiche = null;
      });
      return parsed;
    } catch (e) {
      const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s;
    }
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function genId(prefix) { return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function formatRupiah(n) { n = Number(n) || 0; return 'Rp' + n.toLocaleString('id-ID'); }

  function setSession(session) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {} }
  function getSession() { try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function requireRole(allowed) {
    const s = getSession();
    if (!s || !allowed.includes(s.role)) { window.location.href = 'login.html'; return null; }
    return s;
  }

  function getWallet(db, userId) {
    if (!db.wallets[userId]) db.wallets[userId] = { balance: 0, heldBalance: 0 };
    return db.wallets[userId];
  }

  function createUser(role, data) {
    const db = load();
    const id = genId('u');
    const user = Object.assign({ id: id, role: role, status: 'active' }, data);
    if (role === 'creator' && !user.socialAccounts) {
      user.socialAccounts = {};
    }
    db.users.push(user);
    db.wallets[id] = { balance: 0, heldBalance: 0 };
    save(db);
    return user;
  }

  function topUp(userId, amount) {
    const db = load();
    amount = Number(amount);
    if (!amount || amount <= 0) return { ok: false, message: 'Nominal tidak valid' };
    const w = getWallet(db, userId);
    w.balance += amount;
    db.transactions.push({ id: genId('t'), type: 'topup', toUserId: userId, amount: amount, status: 'success', createdAt: new Date().toISOString() });
    save(db);
    return { ok: true, wallet: w };
  }

  function createCampaign(umkmId, data) {
    const db = load();
    const slots = Number(data.slots) || 0;
    const budgetPerSlot = Number(data.budgetPerSlot) || 0;
    const total = slots * budgetPerSlot;
    if (slots <= 0 || budgetPerSlot <= 0) return { ok: false, message: 'Slot dan budget harus lebih dari 0' };
    const w = getWallet(db, umkmId);
    if (w.balance < total) return { ok: false, message: 'Saldo tidak cukup, silakan top up dulu' };
    w.balance -= total;
    w.heldBalance += total;
    const campaign = {
      id: genId('c'), umkmId: umkmId, title: data.title || '(Tanpa judul)', brief: data.brief || '',
      platform: data.platform || [], contentType: data.contentType || '',
      slots: slots, slotsFilled: 0, budgetPerSlot: budgetPerSlot, paymentModel: data.paymentModel || 'fixed',
      deadline: data.deadline || '', targetNiche: data.targetNiche || null, status: 'open', createdAt: new Date().toISOString()
    };
    db.campaigns.push(campaign);
    db.transactions.push({ id: genId('t'), type: 'escrow_hold', fromUserId: umkmId, campaignId: campaign.id, amount: total, status: 'success', createdAt: new Date().toISOString() });
    save(db);
    return { ok: true, campaign: campaign };
  }

  function applyToCampaign(campaignId, creatorId) {
    const db = load();
    const exists = db.applications.find(function(a) { return a.campaignId === campaignId && a.creatorId === creatorId; });
    if (exists) return { ok: false, message: 'Kamu sudah mengajukan diri ke kampanye ini' };
    const application = { id: genId('a'), campaignId: campaignId, creatorId: creatorId, status: 'applied', appliedAt: new Date().toISOString() };
    db.applications.push(application);
    save(db);
    return { ok: true, application: application };
  }

  function acceptApplication(applicationId) {
    const db = load();
    const app = db.applications.find(function(a) { return a.id === applicationId; });
    if (!app) return { ok: false, message: 'Pengajuan tidak ditemukan' };
    app.status = 'accepted';
    save(db);
    return { ok: true, application: app };
  }

  function rejectApplication(applicationId) {
    const db = load();
    const app = db.applications.find(function(a) { return a.id === applicationId; });
    if (!app) return { ok: false, message: 'Pengajuan tidak ditemukan' };
    app.status = 'rejected';
    save(db);
    return { ok: true, application: app };
  }

  function submitContent(applicationId, fileUrl) {
    const db = load();
    const app = db.applications.find(function(a) { return a.id === applicationId; });
    if (!app || app.status !== 'accepted') return { ok: false, message: 'Pengajuan belum diterima UMKM' };
    let sub = db.submissions.find(function(s) { return s.applicationId === applicationId; });
    if (sub) { sub.fileUrl = fileUrl || sub.fileUrl; sub.status = 'submitted'; sub.revisionCount = (sub.revisionCount || 0) + 1; }
    else { sub = { id: genId('s'), applicationId: applicationId, fileUrl: fileUrl || '', status: 'submitted', revisionCount: 0, submittedAt: new Date().toISOString() }; db.submissions.push(sub); }
    save(db);
    return { ok: true, submission: sub };
  }

  function requestRevision(submissionId) {
    const db = load();
    const sub = db.submissions.find(function(s) { return s.id === submissionId; });
    if (!sub) return { ok: false, message: 'Konten tidak ditemukan' };
    sub.status = 'revision_requested';
    save(db);
    return { ok: true, submission: sub };
  }

  function approveSubmission(submissionId) {
    const db = load();
    const sub = db.submissions.find(function(s) { return s.id === submissionId; });
    if (!sub) return { ok: false, message: 'Konten tidak ditemukan' };
    const app = db.applications.find(function(a) { return a.id === sub.applicationId; });
    if (!app) return { ok: false, message: 'Pengajuan terkait tidak ditemukan' };
    const campaign = db.campaigns.find(function(c) { return c.id === app.campaignId; });
    if (!campaign) return { ok: false, message: 'Kampanye tidak ditemukan' };

    sub.status = 'approved';
    sub.approvedAt = new Date().toISOString();

    const gross = campaign.budgetPerSlot;
    const platformFee = Math.round(gross * TAKE_RATE);
    const netToCreator = gross - platformFee;

    const umkmWallet = getWallet(db, campaign.umkmId);
    umkmWallet.heldBalance = Math.max(0, umkmWallet.heldBalance - gross);

    const creatorWallet = getWallet(db, app.creatorId);
    creatorWallet.balance += netToCreator;

    campaign.slotsFilled = (campaign.slotsFilled || 0) + 1;
    if (campaign.slotsFilled >= campaign.slots) campaign.status = 'completed';

    db.transactions.push({ id: genId('t'), type: 'escrow_release', toUserId: app.creatorId, campaignId: campaign.id, amount: netToCreator, status: 'success', createdAt: new Date().toISOString() });
    db.transactions.push({ id: genId('t'), type: 'platform_fee', campaignId: campaign.id, amount: platformFee, status: 'success', createdAt: new Date().toISOString() });

    save(db);
    return { ok: true, submission: sub, netToCreator: netToCreator, platformFee: platformFee };
  }

  function requestPayout(creatorId, amount) {
    const db = load();
    amount = Number(amount);
    const w = getWallet(db, creatorId);
    if (!amount || amount <= 0) return { ok: false, message: 'Nominal tidak valid' };
    if (amount > w.balance) return { ok: false, message: 'Saldo tidak cukup' };
    w.balance -= amount;
    const payout = { id: genId('p'), creatorId: creatorId, amount: amount, status: 'completed', requestedAt: new Date().toISOString() };
    db.payouts.push(payout);
    db.transactions.push({ id: genId('t'), type: 'payout', fromUserId: creatorId, amount: amount, status: 'success', createdAt: new Date().toISOString() });
    save(db);
    return { ok: true, payout: payout };
  }

  function verifyUser(userId) {
    const db = load();
    const u = db.users.find(function(x) { return x.id === userId; });
    if (!u) return { ok: false, message: 'Pengguna tidak ditemukan' };
    u.status = 'active';
    save(db);
    return { ok: true, user: u };
  }

  function suspendUser(userId) {
    const db = load();
    const u = db.users.find(function(x) { return x.id === userId; });
    if (!u) return { ok: false, message: 'Pengguna tidak ditemukan' };
    u.status = 'suspended';
    save(db);
    return { ok: true, user: u };
  }

  function getCampaignsByUmkm(umkmId) { return load().campaigns.filter(function(c) { return c.umkmId === umkmId; }); }
  function getOpenCampaigns() { return load().campaigns.filter(function(c) { return c.status === 'open'; }); }
  function getCampaignById(id) { const f = load().campaigns.find(function(c) { return c.id === id; }); return f || null; }
  function getApplicationsByCampaign(campaignId) { return load().applications.filter(function(a) { return a.campaignId === campaignId; }); }
  function getApplicationsByCreator(creatorId) { return load().applications.filter(function(a) { return a.creatorId === creatorId; }); }
  function getSubmissionByApplication(applicationId) { const f = load().submissions.find(function(s) { return s.applicationId === applicationId; }); return f || null; }
  function getUserById(id) { const f = load().users.find(function(u) { return u.id === id; }); return f || null; }
  function getUsersByRole(role) { return load().users.filter(function(u) { return u.role === role; }); }
  function getAllTransactions() { return load().transactions; }
  function getEscrowSummary() {
    const db = load();
    let totalEscrow = 0, totalPayout = 0, totalFee = 0;
    db.transactions.forEach(function(t) {
      if (t.type === 'escrow_hold') totalEscrow += t.amount;
      if (t.type === 'escrow_release') totalEscrow -= t.amount;
      if (t.type === 'payout') totalPayout += t.amount;
      if (t.type === 'platform_fee') totalFee += t.amount;
    });
    return { totalEscrow: Math.max(0, totalEscrow), totalPayout: totalPayout, totalFee: totalFee };
  }

  /* ==============================================================
     EKSTENSI FUNGSI-FUNGSI BARU (SOCIAL, ROI, RECOMMENDATION, REVIEWS)
     ============================================================== */

  function getInfluencerTier(totalFollowers) {
    totalFollowers = Number(totalFollowers) || 0;
    if (totalFollowers >= TIER_THRESHOLDS.mega) return 'Mega';
    if (totalFollowers >= TIER_THRESHOLDS.makro) return 'Makro';
    if (totalFollowers >= TIER_THRESHOLDS.mikro) return 'Mikro';
    return 'Nano';
  }

  function connectSocialAccount(userId, platform) {
    const db = load();
    const user = db.users.find(function(u) { return u.id === userId; });
    if (!user) return { ok: false, message: 'Pengguna tidak ditemukan' };
    if (!user.socialAccounts) user.socialAccounts = {};
    const baseFollowers = platform === 'instagram' ? 14500 : 21000;
    const months = ['Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep'];
    const growth = [];
    let f = Math.round(baseFollowers * 0.62);
    for (let i = 0; i < months.length; i++) {
      f = Math.round(f * (1.04 + Math.random() * 0.03));
      growth.push({ month: months[i], followers: f });
    }
    const followers = growth[growth.length - 1].followers;
    const avgLikes = Math.round(followers * (0.03 + Math.random() * 0.02));
    const avgComments = Math.round(avgLikes * 0.05);
    const handle = '@' + String(user.name || 'creator').toLowerCase().replace(/\s+/g, '');
    user.socialAccounts[platform] = {
      connected: true, handle: handle, followers: followers,
      avgLikes: avgLikes, avgComments: avgComments,
      engagementRate: Number((((avgLikes + avgComments) / followers) * 100).toFixed(2)),
      growthHistory: growth
    };
    save(db);
    return { ok: true, account: user.socialAccounts[platform] };
  }

  function disconnectSocialAccount(userId, platform) {
    const db = load();
    const user = db.users.find(function(u) { return u.id === userId; });
    if (!user || !user.socialAccounts || !user.socialAccounts[platform]) return { ok: false, message: 'Akun belum terhubung' };
    user.socialAccounts[platform].connected = false;
    save(db);
    return { ok: true };
  }

  function getSocialSummary(userId) {
    const db = load();
    const user = db.users.find(function(u) { return u.id === userId; });
    if (!user || !user.socialAccounts) return { totalFollowers: 0, tier: getInfluencerTier(0), avgEngagement: 0, platforms: [], accounts: {} };
    const platforms = Object.keys(user.socialAccounts).filter(function(p) { return user.socialAccounts[p] && user.socialAccounts[p].connected; });
    let totalFollowers = 0, weighted = 0;
    platforms.forEach(function(p) {
      totalFollowers += user.socialAccounts[p].followers;
      weighted += user.socialAccounts[p].engagementRate * user.socialAccounts[p].followers;
    });
    const avgEngagement = totalFollowers > 0 ? Number((weighted / totalFollowers).toFixed(2)) : 0;
    return { totalFollowers: totalFollowers, tier: getInfluencerTier(totalFollowers), avgEngagement: avgEngagement, platforms: platforms, accounts: user.socialAccounts };
  }

  function setContentPerformance(submissionId, perf) {
    const db = load();
    const sub = db.submissions.find(function(s) { return s.id === submissionId; });
    if (!sub) return { ok: false, message: 'Konten tidak ditemukan' };
    const views = Number(perf.views) || 0, likes = Number(perf.likes) || 0, comments = Number(perf.comments) || 0, clicks = Number(perf.clicks) || 0;
    if (views < 0 || likes < 0 || comments < 0 || clicks < 0) return { ok: false, message: 'Angka tidak boleh negatif' };
    sub.performance = { views: views, likes: likes, comments: comments, clicks: clicks };
    save(db);
    return { ok: true, submission: sub };
  }

  function getCampaignROI(campaignId) {
    const db = load();
    const campaign = db.campaigns.find(function(c) { return c.id === campaignId; });
    if (!campaign) return null;
    const apps = db.applications.filter(function(a) { return a.campaignId === campaignId; });
    let totalSpent = 0, totalViews = 0, totalLikes = 0, totalComments = 0, totalClicks = 0;
    apps.forEach(function(a) {
      const sub = db.submissions.find(function(s) { return s.applicationId === a.id; });
      if (sub && sub.status === 'approved') {
        totalSpent += campaign.budgetPerSlot;
        if (sub.performance) {
          totalViews += sub.performance.views || 0;
          totalLikes += sub.performance.likes || 0;
          totalComments += sub.performance.comments || 0;
          totalClicks += sub.performance.clicks || 0;
        }
      }
    });
    const totalEngagement = totalLikes + totalComments;
    return {
      totalSpent: totalSpent, totalViews: totalViews, totalEngagement: totalEngagement, totalClicks: totalClicks,
      costPerView: totalViews > 0 ? Math.round(totalSpent / totalViews) : null,
      costPerEngagement: totalEngagement > 0 ? Math.round(totalSpent / totalEngagement) : null
    };
  }

  function getUmkmPerformanceSummary(umkmId) {
    const db = load();
    const campaigns = db.campaigns.filter(function(c) { return c.umkmId === umkmId; });
    let totalSpent = 0, totalViews = 0, totalEngagement = 0;
    campaigns.forEach(function(c) {
      const roi = getCampaignROI(c.id);
      if (roi) { totalSpent += roi.totalSpent; totalViews += roi.totalViews; totalEngagement += roi.totalEngagement; }
    });
    return {
      totalCampaigns: campaigns.length, totalSpent: totalSpent, totalViews: totalViews, totalEngagement: totalEngagement,
      avgCostPerEngagement: totalEngagement > 0 ? Math.round(totalSpent / totalEngagement) : null
    };
  }

  function recommendCreatorsForCampaign(campaignId, limit) {
    limit = limit || 5;
    const db = load();
    const campaign = db.campaigns.find(function(c) { return c.id === campaignId; });
    if (!campaign) return [];
    const creators = db.users.filter(function(u) { return u.role === 'creator' && u.status === 'active'; });
    const scored = creators.map(function(cr) {
      const social = getSocialSummary(cr.id);
      const reviews = getReviewsForUser(cr.id);
      const nicheScore = (campaign.targetNiche && cr.niche === campaign.targetNiche) ? 1 : 0.3;
      const reputationScore = reviews.average ? (reviews.average / 5) : 0.5;
      const engagementScore = Math.min(social.avgEngagement / 10, 1);
      const total = (nicheScore * 0.3) + (reputationScore * 0.4) + (engagementScore * 0.3);
      return { creator: cr, social: social, reviews: reviews, score: Number(total.toFixed(2)) };
    });
    scored.sort(function(a, b) { return b.score - a.score; });
    return scored.slice(0, limit);
  }

  function addReview(campaignId, reviewerId, revieweeId, rating, comment) {
    const db = load();
    rating = Number(rating);
    if (!rating || rating < 1 || rating > 5) return { ok: false, message: 'Rating harus antara 1 sampai 5' };
    const exists = db.reviews.find(function(r) { return r.campaignId === campaignId && r.reviewerId === reviewerId && r.revieweeId === revieweeId; });
    if (exists) return { ok: false, message: 'Kamu sudah memberi ulasan untuk kampanye ini' };
    const review = { id: genId('r'), campaignId: campaignId, reviewerId: reviewerId, revieweeId: revieweeId, rating: rating, comment: comment || '', createdAt: new Date().toISOString() };
    db.reviews.push(review);
    save(db);
    return { ok: true, review: review };
  }

  function getReviewsForUser(userId) {
    const db = load();
    const list = db.reviews.filter(function(r) { return r.revieweeId === userId; });
    if (list.length === 0) return { average: null, count: 0, list: [] };
    const sum = list.reduce(function(acc, r) { return acc + r.rating; }, 0);
    return { average: Number((sum / list.length).toFixed(1)), count: list.length, list: list };
  }

  return {
    load: load, save: save, genId: genId, formatRupiah: formatRupiah,
    setSession: setSession, getSession: getSession, clearSession: clearSession, requireRole: requireRole,
    getWallet: function(userId) { const db = load(); return getWallet(db, userId); },
    createUser: createUser, topUp: topUp, createCampaign: createCampaign,
    applyToCampaign: applyToCampaign, acceptApplication: acceptApplication, rejectApplication: rejectApplication,
    submitContent: submitContent, requestRevision: requestRevision, approveSubmission: approveSubmission,
    requestPayout: requestPayout, verifyUser: verifyUser, suspendUser: suspendUser,
    getCampaignsByUmkm: getCampaignsByUmkm, getOpenCampaigns: getOpenCampaigns, getCampaignById: getCampaignById,
    getApplicationsByCampaign: getApplicationsByCampaign, getApplicationsByCreator: getApplicationsByCreator,
    getSubmissionByApplication: getSubmissionByApplication, getUserById: getUserById, getUsersByRole: getUsersByRole,
    getAllTransactions: getAllTransactions, getEscrowSummary: getEscrowSummary,
    getInfluencerTier: getInfluencerTier, connectSocialAccount: connectSocialAccount, disconnectSocialAccount: disconnectSocialAccount,
    getSocialSummary: getSocialSummary, setContentPerformance: setContentPerformance, getCampaignROI: getCampaignROI,
    getUmkmPerformanceSummary: getUmkmPerformanceSummary, recommendCreatorsForCampaign: recommendCreatorsForCampaign,
    addReview: addReview, getReviewsForUser: getReviewsForUser
  };
})();
