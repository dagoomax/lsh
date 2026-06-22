const form  = document.getElementById('setup-form');
const errEl = document.getElementById('setup-error');
const btnEl = document.getElementById('btn-setup');
const pwd1  = document.getElementById('admin-password');
const pwd2  = document.getElementById('admin-password2');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.style.display = 'none';

  if (pwd1.value !== pwd2.value) {
    errEl.textContent = 'Passwords do not match';
    errEl.style.display = '';
    return;
  }

  btnEl.disabled = true;
  btnEl.textContent = 'Creating account…';

  try {
    const res  = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminUsername: document.getElementById('admin-username').value,
        adminPassword: pwd1.value,
      }),
    });
    const data = await res.json();
    if (data.success) {
      window.location.href = '/';
    } else {
      errEl.textContent = data.error || 'Setup failed';
      errEl.style.display = '';
      btnEl.disabled = false;
      btnEl.textContent = 'Create Account & Sign In';
    }
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = '';
    btnEl.disabled = false;
    btnEl.textContent = 'Create Account & Sign In';
  }
});
