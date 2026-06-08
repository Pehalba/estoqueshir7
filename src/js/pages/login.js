import { login, observeAuth } from '../services/authService.js';
import { isFirebaseConfigured } from '../config/firebase.js';
import { qs, setLoading, showToast } from '../utils/domHelpers.js';

const form = qs('#login-form');
const alertEl = qs('#login-alert');
const loginBtn = qs('#login-btn');

function showAlert(message, type = 'error') {
  if (!alertEl) return;
  alertEl.textContent = message;
  alertEl.className = `login-card__alert login-card__alert--${type}`;
}

function hideAlert() {
  if (!alertEl) return;
  alertEl.textContent = '';
  alertEl.className = 'login-card__alert';
}

if (!isFirebaseConfigured()) {
  showAlert(
    'Firebase não configurado. Abra docs/FIREBASE-SETUP.md e preencha src/js/config/firebase.credentials.js',
    'error'
  );
}

observeAuth((user) => {
  if (user) {
    const base = window.location.pathname.replace(/[^/]*$/, '');
    window.location.href = base + 'dashboard.html';
  }
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();

  const email = qs('#email')?.value.trim();
  const password = qs('#password')?.value;

  if (!isFirebaseConfigured()) {
    showAlert('Configure o Firebase antes de fazer login. Veja docs/FIREBASE-SETUP.md');
    return;
  }

  if (!email || !password) {
    showAlert('Preencha e-mail e senha.');
    return;
  }

  setLoading(loginBtn, true);

  const result = await login(email, password);

  setLoading(loginBtn, false);

  if (result.success) {
    showToast('Login realizado com sucesso!', 'success');
    const base = window.location.pathname.replace(/[^/]*$/, '');
    window.location.href = base + 'dashboard.html';
  } else {
    showAlert(result.error);
  }
});
