const form   = document.getElementById('setup-form');
const errBox = document.getElementById('setup-error');
const errMsg = document.getElementById('setup-error-msg');
const btnEl  = document.getElementById('btn-setup');
const pwd1   = document.getElementById('admin-password');
const pwd2   = document.getElementById('admin-password2');

function showError(msg) {
  errMsg.textContent = msg;
  errBox.style.display = 'flex';
  errBox.classList.remove('shake');
  void errBox.offsetWidth;
  errBox.classList.add('shake');
}

function hideError() {
  errBox.style.display = 'none';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  if (pwd1.value !== pwd2.value) {
    showError('Passwords do not match');
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
      showError(data.error || 'Setup failed');
      btnEl.disabled = false;
      btnEl.textContent = 'Create Account & Sign In';
    }
  } catch (err) {
    showError('Network error — ' + err.message);
    btnEl.disabled = false;
    btnEl.textContent = 'Create Account & Sign In';
  }
});
