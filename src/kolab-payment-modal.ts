export type PaymentPurpose = 'topup' | 'subscription' | 'campaign' | 'license';
export type PaymentChannel = 'qris' | 'bca_va' | 'mandiri_va' | 'bni_va' | 'bri_va' | 'permata_va';

export interface OpenPaymentOptions {
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  purpose: PaymentPurpose;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown>;
  onCreateOrderRecord?: (order: any) => Promise<void>;
  onSettled: (order: any, settlementProof: string) => Promise<void> | void;
}

const CHANNEL_OPTIONS: Array<{ id: PaymentChannel; label: string; group: 'qris' | 'va'; badge: string }> = [
  { id: 'qris', label: 'QRIS (GoPay, OVO, DANA, ShopeePay, Mobile Banking)', group: 'qris', badge: 'INSTAN' },
  { id: 'bca_va', label: 'BCA Virtual Account', group: 'va', badge: 'OTOMATIS' },
  { id: 'mandiri_va', label: 'Mandiri Virtual Account', group: 'va', badge: 'OTOMATIS' },
  { id: 'bni_va', label: 'BNI Virtual Account', group: 'va', badge: 'OTOMATIS' },
  { id: 'bri_va', label: 'BRI Virtual Account (BRIVA)', group: 'va', badge: 'OTOMATIS' },
  { id: 'permata_va', label: 'Permata Virtual Account', group: 'va', badge: 'OTOMATIS' },
];

function formatRupiah(n: number): string {
  return 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
}

export function openPaymentGatewayModal(opts: OpenPaymentOptions): void {
  const existing = document.getElementById('kolabGatewayModal');
  if (existing) existing.remove();

  let selectedChannel: PaymentChannel = 'qris';
  let activeOrder: any = null;
  let pollTimer: number | null = null;
  let countdownTimer: number | null = null;
  let settledHandled = false;

  const overlay = document.createElement('div');
  overlay.id = 'kolabGatewayModal';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '9999';

  function cleanup() {
    if (pollTimer) window.clearInterval(pollTimer);
    if (countdownTimer) window.clearInterval(countdownTimer);
    overlay.remove();
  }

  function renderSelectStep(errorMsg?: string) {
    const channelCards = CHANNEL_OPTIONS.map((ch) => {
      const isSelected = ch.id === selectedChannel;
      return `
        <button type="button" data-channel="${ch.id}" class="kolab-pay-channel" style="
          width: 100%; text-align: left; padding: 12px 14px; border-radius: 10px;
          border: 2px solid ${isSelected ? 'var(--accent)' : 'var(--line)'};
          background: ${isSelected ? 'rgba(211, 84, 47, 0.05)' : '#fff'};
          display: flex; justify-content: space-between; align-items: center; cursor: pointer;
          margin-bottom: 8px; font-family: inherit;
        ">
          <div>
            <div style="font-weight: 600; font-size: 13px; color: var(--ink);">
              ${ch.group === 'qris' ? '📱 ' : '🏦 '}${ch.label}
            </div>
          </div>
          <span class="badge ${isSelected ? 'badge-active' : 'badge-neutral'}" style="font-size: 10px;">${ch.badge}</span>
        </button>
      `;
    }).join('');

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 480px; width: 95%; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0 0 4px; font-size: 18px; font-weight: 700;">${opts.title}</h3>
            ${opts.subtitle ? `<p style="margin: 0; font-size: 13px; color: var(--copy);">${opts.subtitle}</p>` : ''}
          </div>
          <button type="button" id="gwCloseBtn" class="btn-outline btn-sm">✕</button>
        </div>

        <div style="background: var(--paper); padding: 14px 16px; border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <span style="font-size: 13px; color: var(--copy);">Total Pembayaran</span>
          <strong class="tabular-nums" style="font-size: 20px; color: var(--accent);">${formatRupiah(opts.amount)}</strong>
        </div>

        <div style="margin-bottom: 16px;">
          <label class="form-label" style="margin-bottom: 8px;">Pilih Metode Pembayaran (QRIS / Virtual Account)</label>
          ${channelCards}
        </div>

        ${errorMsg ? `<div class="error-text" style="margin-bottom: 12px;">${errorMsg}</div>` : ''}

        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap;">
          <button type="button" id="gwCancelBtn" class="btn-outline">Batal</button>
          <button type="button" id="gwCreateBtn" class="btn-primary">Buat Tagihan Pembayaran</button>
        </div>
      </div>
    `;

    overlay.querySelector('#gwCloseBtn')?.addEventListener('click', cleanup);
    overlay.querySelector('#gwCancelBtn')?.addEventListener('click', cleanup);
    overlay.querySelectorAll('.kolab-pay-channel').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedChannel = (btn as HTMLElement).dataset.channel as PaymentChannel;
        renderSelectStep();
      });
    });
    overlay.querySelector('#gwCreateBtn')?.addEventListener('click', createCharge);
  }

  async function createCharge() {
    const btn = overlay.querySelector('#gwCreateBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Memproses tagihan...';
    }
    try {
      const resp = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: opts.userId,
          userName: opts.userName,
          userEmail: opts.userEmail,
          amount: opts.amount,
          method: selectedChannel,
          purpose: opts.purpose,
          metadata: opts.metadata || {}
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        renderSelectStep(data.message || 'Gagal membuat tagihan pembayaran.');
        return;
      }
      activeOrder = data.order;
      if (opts.onCreateOrderRecord) {
        await opts.onCreateOrderRecord(activeOrder);
      }
      renderPaymentInstructionStep();
      startPolling();
    } catch (err) {
      renderSelectStep(err instanceof Error ? err.message : 'Koneksi server pembayaran gagal.');
    }
  }

  function renderPaymentInstructionStep() {
    const isQris = activeOrder.method === 'qris';
    const isSandbox = activeOrder.provider === 'sandbox';

    const providerBanner = isSandbox
      ? `<div style="background: var(--bg-warning); color: var(--text-warning); padding: 10px 12px; border-radius: 8px; font-size: 12px; margin-bottom: 14px;">
           <strong>Mode uji:</strong> pembayaran ini tidak sungguhan dan tidak memotong uang apa pun.
         </div>`
      : `<div style="background: var(--bg-success); color: var(--text-success); padding: 10px 12px; border-radius: 8px; font-size: 12px; margin-bottom: 14px;">
           Terhubung ke Payment Gateway: <strong>${String(activeOrder.provider).toUpperCase()}</strong>
         </div>`;

    const paymentBody = isQris
      ? `
        <div style="text-align: center; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: #fff; margin-bottom: 16px;">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px;">Scan QRIS untuk Membayar</div>
          ${activeOrder.qrImageUrl ? `<img src="${activeOrder.qrImageUrl}" alt="QRIS Code" style="width: 220px; height: 220px; border-radius: 8px; border: 1px solid var(--line); display: block; margin: 0 auto 12px;">` : ''}
          <div style="font-size: 12px; color: var(--copy); margin-bottom: 8px;">Mendukung GoPay, OVO, DANA, ShopeePay, LinkAja, & seluruh Mobile Banking</div>
          <button type="button" id="gwCopyQrBtn" class="btn-outline btn-sm" style="font-size: 11px;">Salin String QRIS</button>
        </div>
      `
      : `
        <div style="padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: #fff; margin-bottom: 16px;">
          <div style="font-size: 12px; color: var(--copy); margin-bottom: 4px;">${activeOrder.bankLabel || 'Virtual Account'}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--paper); padding: 12px 14px; border-radius: 8px; margin-bottom: 12px;">
            <strong class="tabular-nums" style="font-size: clamp(16px, 4.5vw, 20px); letter-spacing: 0.03em; word-break: break-all;">${activeOrder.vaNumber || '-'}</strong>
            <button type="button" id="gwCopyVaBtn" class="btn-outline btn-sm">Salin VA</button>
          </div>
          ${activeOrder.billerCode ? `<div style="font-size: 12px; color: var(--copy); margin-bottom: 8px;">Kode Perusahaan: <strong>${activeOrder.billerCode}</strong> · Kode Bayar: <strong>${activeOrder.billKey}</strong></div>` : ''}
          <ol style="margin: 0; padding-left: 18px; font-size: 12px; color: var(--copy); line-height: 1.6;">
            <li>Buka aplikasi Mobile Banking / ATM bank terkait.</li>
            <li>Pilih menu <strong>Transfer &gt; Virtual Account</strong>.</li>
            <li>Masukkan nomor Virtual Account di atas dan pastikan nominal sesuai (<strong>${formatRupiah(activeOrder.amount)}</strong>).</li>
            <li>Konfirmasi pembayaran. Status akan terverifikasi otomatis.</li>
          </ol>
        </div>
      `;

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 480px; width: 95%; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <span class="badge badge-neutral" style="font-size: 10px;">ORDER #${activeOrder.orderId}</span>
            <h3 style="margin: 4px 0 0; font-size: 17px; font-weight: 700;">Menunggu Pembayaran</h3>
          </div>
          <button type="button" id="gwCloseBtn" class="btn-outline btn-sm">✕</button>
        </div>

        ${providerBanner}

        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--paper); padding: 12px 14px; border-radius: 8px; margin-bottom: 14px;">
          <div>
            <div style="font-size: 11px; color: var(--copy);">Nominal Tagihan</div>
            <strong class="tabular-nums" style="font-size: 18px; color: var(--accent);">${formatRupiah(activeOrder.amount)}</strong>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 11px; color: var(--copy);">Batas Waktu</div>
            <strong class="tabular-nums" id="gwCountdown" style="font-size: 14px;">15:00</strong>
          </div>
        </div>

        ${paymentBody}

        <div id="gwStatusLine" style="text-align: center; font-size: 12px; color: var(--copy); margin-bottom: 14px;">
          ⏳ Memeriksa status pembayaran otomatis...
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
          <button type="button" id="gwCheckStatusBtn" class="btn-outline btn-sm">Cek Status Sekarang</button>
          ${isSandbox ? `<button type="button" id="gwSimSettleBtn" class="btn-primary btn-sm">Simulasikan pembayaran berhasil (mode uji)</button>` : ''}
        </div>
      </div>
    `;

    overlay.querySelector('#gwCloseBtn')?.addEventListener('click', cleanup);
    overlay.querySelector('#gwCopyQrBtn')?.addEventListener('click', () => {
      if (activeOrder.qrString && navigator.clipboard) {
        navigator.clipboard.writeText(activeOrder.qrString);
        const btn = overlay.querySelector('#gwCopyQrBtn');
        if (btn) btn.textContent = '✓ Tersalin';
      }
    });
    overlay.querySelector('#gwCopyVaBtn')?.addEventListener('click', () => {
      if (activeOrder.vaNumber && navigator.clipboard) {
        navigator.clipboard.writeText(activeOrder.vaNumber);
        const btn = overlay.querySelector('#gwCopyVaBtn');
        if (btn) btn.textContent = '✓ Tersalin';
      }
    });
    overlay.querySelector('#gwCheckStatusBtn')?.addEventListener('click', checkStatusNow);
    overlay.querySelector('#gwSimSettleBtn')?.addEventListener('click', simulateSandboxSettle);

    startCountdown();
  }

  function startCountdown() {
    if (countdownTimer) window.clearInterval(countdownTimer);
    const expiryMs = new Date(activeOrder.expiresAt).getTime();
    const update = () => {
      const el = overlay.querySelector('#gwCountdown');
      if (!el) return;
      const diff = Math.max(0, Math.floor((expiryMs - Date.now()) / 1000));
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      el.textContent = `${m}:${s}`;
    };
    update();
    countdownTimer = window.setInterval(update, 1000);
  }

  async function handleSettled(order: any, proof: string) {
    if (settledHandled) return;
    settledHandled = true;
    if (pollTimer) window.clearInterval(pollTimer);
    if (countdownTimer) window.clearInterval(countdownTimer);

    const statusLine = overlay.querySelector('#gwStatusLine');
    if (statusLine) {
      statusLine.innerHTML = `<span style="color: var(--text-success); font-weight: 700;">✓ Pembayaran Diterima! Memperbarui akun Anda...</span>`;
    }
    await opts.onSettled(order, proof);
    cleanup();
  }

  async function checkStatusNow() {
    if (!activeOrder) return;
    try {
      const resp = await fetch(`/api/payments/${encodeURIComponent(activeOrder.orderId)}/status`);
      const data = await resp.json();
      if (data.ok && data.order?.status === 'settled') {
        await handleSettled(data.order, data.settlementProof);
      }
    } catch {
      // ignore transient error
    }
  }

  async function simulateSandboxSettle() {
    const btn = overlay.querySelector('#gwSimSettleBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Memverifikasi...';
    }
    try {
      const resp = await fetch(`/api/payments/${encodeURIComponent(activeOrder.orderId)}/simulate-settle`, {
        method: 'POST',
      });
      const data = await resp.json();
      if (data.ok && data.order?.status === 'settled') {
        await handleSettled(data.order, data.settlementProof);
      }
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Simulasikan pembayaran berhasil (mode uji)';
      }
    }
  }

  function startPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(checkStatusNow, 3000);
  }

  renderSelectStep();
  document.body.appendChild(overlay);
}
