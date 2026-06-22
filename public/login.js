const form  = document.getElementById('login-form');
const errEl = document.getElementById('auth-error');
const btnEl = document.getElementById('btn-login');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.style.display = 'none';
  btnEl.disabled = true;
  btnEl.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json();
    if (data.success) {
      const next = new URLSearchParams(location.search).get('next');
      window.location.href = (next && next.startsWith('/')) ? next : '/';
    } else {
      errEl.textContent = data.error || 'Login failed';
      errEl.style.display = '';
      btnEl.disabled = false;
      btnEl.textContent = 'Sign In';
    }
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = '';
    btnEl.disabled = false;
    btnEl.textContent = 'Sign In';
  }
});
