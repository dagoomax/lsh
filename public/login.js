const form   = document.getElementById('login-form');
const errBox = document.getElementById('auth-error');
const errMsg = document.getElementById('auth-error-msg');
const btnEl  = document.getElementById('btn-login');

function showError(msg) {
  errMsg.textContent = msg;
  errBox.style.display = 'flex';
  errBox.classList.remove('shake');
  // force reflow so animation re-triggers on repeated errors
  void errBox.offsetWidth;
  errBox.classList.add('shake');
}

function hideError() {
  errBox.style.display = 'none';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
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
      showError(data.error || 'Login failed');
      btnEl.disabled = false;
      btnEl.textContent = 'Sign In';
    }
  } catch (err) {
    showError('Network error — ' + err.message);
    btnEl.disabled = false;
    btnEl.textContent = 'Sign In';
  }
});
