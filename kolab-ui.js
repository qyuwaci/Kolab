const KolabUI = (function() {
  function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderNavbar(activePage) {
    const session = KolabDB.getSession();
    if (!session) return;

    let dashboardUrl = 'index.html';
    if (session.role === 'umkm') dashboardUrl = 'dashboard-umkm.html';
    else if (session.role === 'creator') dashboardUrl = 'dashboard-creator.html';
    else if (session.role === 'admin') dashboardUrl = 'dashboard-admin.html';

    let linksHtml = '';
    if (session.role === 'umkm') {
      linksHtml = `
        <a href="dashboard-umkm.html" class="nav-link ${activePage === 'dashboard-umkm' ? 'active' : ''}">Dashboard</a>
        <a href="campaign-new.html" class="nav-link ${activePage === 'campaign-new' ? 'active' : ''}">+ Buat Kampanye</a>
      `;
    } else if (session.role === 'creator') {
      linksHtml = `
        <a href="dashboard-creator.html" class="nav-link ${activePage === 'dashboard-creator' ? 'active' : ''}">Dashboard</a>
        <a href="campaign-browse.html" class="nav-link ${activePage === 'campaign-browse' ? 'active' : ''}">Jelajahi Kampanye</a>
        <a href="wallet-creator.html" class="nav-link ${activePage === 'wallet-creator' ? 'active' : ''}">Wallet</a>
      `;
    } else if (session.role === 'admin') {
      linksHtml = `
        <a href="dashboard-admin.html" class="nav-link ${activePage === 'dashboard-admin' ? 'active' : ''}">Ringkasan</a>
        <a href="admin-users.html" class="nav-link ${activePage === 'admin-users' ? 'active' : ''}">Pengguna</a>
        <a href="admin-transactions.html" class="nav-link ${activePage === 'admin-transactions' ? 'active' : ''}">Transaksi</a>
      `;
    }

    const initials = getInitials(session.name);
    const roleLabel = session.role ? session.role.toUpperCase() : 'USER';

    const navContainer = document.getElementById('navbar');
    if (!navContainer) return;

    navContainer.className = 'navbar';
    navContainer.innerHTML = `
      <a href="${dashboardUrl}" class="nav-brand">
        Kolab<span class="dot">.</span>
      </a>
      <div class="nav-links">
        ${linksHtml}
      </div>
      <div class="user-menu">
        <div class="avatar-circle" id="userAvatarBtn" title="${session.name || 'Profil'}">${initials}</div>
        <div class="dropdown-menu" id="userDropdown">
          <div class="dropdown-header">
            <div class="dropdown-user-name">${session.name || 'Pengguna'}</div>
            <div class="dropdown-user-role"><span class="badge badge-neutral" style="font-size: 10px; padding: 2px 6px;">${roleLabel}</span></div>
          </div>
          <button type="button" class="dropdown-item danger" id="btnLogout">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Keluar
          </button>
        </div>
      </div>
    `;

    const avatarBtn = document.getElementById('userAvatarBtn');
    const dropdown = document.getElementById('userDropdown');
    const logoutBtn = document.getElementById('btnLogout');

    if (avatarBtn && dropdown) {
      avatarBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdown.classList.toggle('show');
      });

      document.addEventListener('click', function() {
        dropdown.classList.remove('show');
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function() {
        KolabDB.clearSession();
        window.location.href = 'index.html';
      });
    }
  }

  function showToast(message, duration) {
    duration = duration || 2500;
    const toast = document.createElement('div');
    toast.className = 'toast-notice';
    toast.innerHTML = `<span>✓</span><span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, duration);
  }

  return {
    renderNavbar: renderNavbar,
    showToast: showToast
  };
})();
