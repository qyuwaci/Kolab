declare global {
  interface Window {
    KolabDB: any;
    KolabUI: any;
  }
}

function getInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function bindMobileNavToggle(navContainer: HTMLElement): void {
  const toggleBtn = navContainer.querySelector('#navToggleBtn') as HTMLButtonElement | null;
  const navLinks = navContainer.querySelector('.nav-links') as HTMLElement | null;
  const dropdown = navContainer.querySelector('#userDropdown') as HTMLElement | null;

  if (!toggleBtn || !navLinks) return;

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = navLinks.classList.toggle('open');
    toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (dropdown) dropdown.classList.remove('show');
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', (e) => {
    if (!navContainer.contains(e.target as Node)) {
      navLinks.classList.remove('open');
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
  });
}

export function renderNavbar(activePage: string): void {
  const KolabDB = window.KolabDB;
  const session = KolabDB?.getSession();
  const navContainer = document.getElementById('navbar');
  if (!navContainer) return;

  const hamburgerSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;

  if (!session) {
    navContainer.className = 'navbar';
    navContainer.innerHTML = `
      <a href="index.html" class="nav-brand">Kolab<span class="dot">.</span></a>
      <div class="nav-links" id="navLinksDrawer">
        <a href="content-library.html" class="nav-link ${activePage === 'content-library' ? 'active' : ''}">Pasar Konten</a>
        <a href="pricing.html" class="nav-link ${activePage === 'pricing' ? 'active' : ''}">Paket Langganan</a>
        <a href="login.html" class="nav-link">Masuk Google</a>
        <a href="register.html" class="nav-link">Daftar Gratis</a>
      </div>
      <div class="nav-actions">
        <a href="login.html" class="btn-outline btn-sm nav-btn-secondary-hide-xs">Masuk Google</a>
        <a href="register.html" class="btn-primary btn-sm">Daftar Gratis</a>
        <button type="button" class="nav-toggle-btn" id="navToggleBtn" aria-label="Buka menu navigasi" aria-expanded="false">
          ${hamburgerSvg}
        </button>
      </div>
    `;
    bindMobileNavToggle(navContainer);
    return;
  }

  let dashboardUrl = 'index.html';
  if (session.role === 'umkm') dashboardUrl = 'dashboard-umkm.html';
  else if (session.role === 'creator') dashboardUrl = 'dashboard-creator.html';
  else if (session.role === 'admin') dashboardUrl = 'dashboard-admin.html';

  let linksHtml = '';
  if (session.role === 'umkm') {
    linksHtml = `
      <a href="dashboard-umkm.html" class="nav-link ${activePage === 'dashboard-umkm' ? 'active' : ''}">Dashboard</a>
      <a href="campaign-new.html" class="nav-link ${activePage === 'campaign-new' ? 'active' : ''}">+ Buat Kampanye</a>
      <a href="content-library.html" class="nav-link ${activePage === 'content-library' ? 'active' : ''}">Pasar Konten</a>
      <a href="pricing.html" class="nav-link ${activePage === 'pricing' ? 'active' : ''}">Paket & Langganan</a>
    `;
  } else if (session.role === 'creator') {
    linksHtml = `
      <a href="dashboard-creator.html" class="nav-link ${activePage === 'dashboard-creator' ? 'active' : ''}">Dashboard</a>
      <a href="campaign-browse.html" class="nav-link ${activePage === 'campaign-browse' ? 'active' : ''}">Jelajahi Kampanye</a>
      <a href="creator-analytics.html" class="nav-link ${activePage === 'creator-analytics' ? 'active' : ''}">Sosial & Analitik</a>
      <a href="creator-library.html" class="nav-link ${activePage === 'creator-library' ? 'active' : ''}">Konten & Lisensi</a>
      <a href="wallet-creator.html" class="nav-link ${activePage === 'wallet-creator' ? 'active' : ''}">Wallet</a>
    `;
  } else if (session.role === 'admin') {
    linksHtml = `
      <a href="dashboard-admin.html" class="nav-link ${activePage === 'dashboard-admin' ? 'active' : ''}">Ringkasan</a>
      <a href="admin-users.html" class="nav-link ${activePage === 'admin-users' ? 'active' : ''}">Pengguna</a>
      <a href="admin-transactions.html" class="nav-link ${activePage === 'admin-transactions' ? 'active' : ''}">Transaksi & MRR</a>
      <a href="content-library.html" class="nav-link ${activePage === 'content-library' ? 'active' : ''}">Pasar Konten</a>
    `;
  }

  const user = KolabDB.getUserById(session.id);
  const avatarUrl = user?.avatarUrl || session.avatarUrl || '';
  const initials = getInitials(session.name);
  const roleLabel = session.role ? session.role.toUpperCase() : 'USER';

  let planBadgeHtml = '';
  let planNameText = 'Paket';
  if (session.role !== 'admin') {
    try {
      const userPlan = KolabDB.getUserPlan(session.id);
      if (userPlan && userPlan.plan) {
        planNameText = userPlan.plan.name;
        const badgeClass = userPlan.planId === 'free' ? 'badge-neutral' : 'badge-completed';
        planBadgeHtml = `<span class="badge ${badgeClass}" style="font-size: 10px; padding: 2px 7px; margin-left: 6px;">${planNameText.toUpperCase()}</span>`;
      }
    } catch {
      // ignore
    }
  }

  const avatarContent = avatarUrl
    ? `<img src="${avatarUrl}" alt="${session.name || 'Profil'}" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`
    : initials;

  navContainer.className = 'navbar';
  navContainer.innerHTML = `
    <a href="${dashboardUrl}" class="nav-brand">
      Kolab<span class="dot">.</span>
    </a>
    <div class="nav-links" id="navLinksDrawer">
      ${linksHtml}
    </div>
    <div class="user-menu">
      ${
        session.role !== 'admin'
          ? `<a href="pricing.html" class="btn-outline btn-sm nav-plan-pill" style="display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 6px 12px; border-radius: 999px;">
              <span>⭐</span>
              <span id="navPlanName">${planNameText}</span>
            </a>`
          : ''
      }
      <div class="avatar-circle" id="userAvatarBtn" title="${session.name || 'Profil'}" style="overflow:hidden;padding:0;">${avatarContent}</div>
      <button type="button" class="nav-toggle-btn" id="navToggleBtn" aria-label="Buka menu navigasi" aria-expanded="false">
        ${hamburgerSvg}
      </button>
      <div class="dropdown-menu" id="userDropdown">
        <div class="dropdown-header">
          <div class="dropdown-user-name">${session.name || 'Pengguna'}</div>
          ${session.email ? `<div style="font-size:11px;color:var(--copy);margin-top:2px;word-break:break-all;">${session.email}</div>` : ''}
          <div class="dropdown-user-role" style="display: flex; align-items: center; gap: 4px; margin-top: 6px; flex-wrap: wrap;">
            <span class="badge badge-neutral" style="font-size: 10px; padding: 2px 6px;">${roleLabel}</span>
            ${planBadgeHtml}
          </div>
        </div>
        ${session.role === 'umkm' ? `<a href="umkm-profile.html?id=${encodeURIComponent(session.id)}" class="dropdown-item">Profil Usaha</a>` : ''}
        ${session.role === 'creator' ? `<a href="creator-profile.html?id=${encodeURIComponent(session.id)}" class="dropdown-item">Profil Kreator</a>` : ''}
        ${session.role === 'creator' ? `<a href="creator-analytics.html" class="dropdown-item">Sosial Media & Analitik</a>` : ''}
        ${session.role !== 'admin' ? `<a href="pricing.html" class="dropdown-item">Kelola Langganan</a>` : ''}
        <button type="button" class="dropdown-item danger" id="btnLogout">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Keluar
        </button>
      </div>
    </div>
  `;

  bindMobileNavToggle(navContainer);

  const avatarBtn = document.getElementById('userAvatarBtn');
  const dropdown = document.getElementById('userDropdown');
  const navLinks = document.getElementById('navLinksDrawer');
  const toggleBtn = document.getElementById('navToggleBtn');
  const logoutBtn = document.getElementById('btnLogout');

  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (navLinks) navLinks.classList.remove('open');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
      dropdown.classList.toggle('show');
    });
    document.addEventListener('click', () => {
      dropdown.classList.remove('show');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await KolabDB.signOut();
      window.location.href = 'index.html';
    });
  }
}

export function showToast(message: string, duration = 2800): void {
  const toast = document.createElement('div');
  toast.className = 'toast-notice';
  toast.innerHTML = `<span>✓</span><span>${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

const KolabUI = {
  renderNavbar,
  showToast,
};

window.KolabUI = KolabUI;
export default KolabUI;
