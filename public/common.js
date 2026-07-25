// Shared across all dashboard pages: logout button + global 401 redirect
(function () {
  // Inject "Sign out" into the header nav
  function addLogout() {
    const nav = document.querySelector('.header-nav');
    if (!nav) return;
    const btn = document.createElement('button');
    btn.className = 'nav-logout';
    btn.dataset.i18n = 'common.sign_out';
    btn.textContent = (window.t && window.t('common.sign_out') !== 'common.sign_out')
      ? window.t('common.sign_out') : 'Sign out';
    btn.addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
      window.location.href = '/login.html';
    });
    // Insert after the last nav link
    nav.appendChild(btn);
  }

  // Redirect to login on 401
  const _origFetch = window.fetch;
  window.fetch = function (...args) {
    return _origFetch.apply(this, args).then((res) => {
      if (res.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : '';
        if (!url.includes('/api/auth/')) {
          window.location.href = '/login.html';
          throw new Error('Session expired');
        }
      }
      return res;
    });
  };

  addLogout();

  // Hide nav links the user has opted out of (Settings → Interface)
  function applyNavPrefs() {
    const nav = document.querySelector('.header-nav');
    if (!nav) return;
    _origFetch('/api/ui-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const p = j && j.data;
        if (!p) return;
        if (p.hideMqtt) nav.querySelector('a[href="/mqtt.html"]')?.remove();
        if (p.hideLogs) nav.querySelector('a[href="/logs.html"]')?.remove();
      })
      .catch(() => {});
  }

  applyNavPrefs();
})();
