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

function prefillFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email');
  const password = params.get('password');
  if (email) qs('#email').value = email;
  if (password) qs('#password').value = password;
}

if (!isFirebaseConfigured()) {
  showAlert(
    'Firebase não configurado. Abra docs/FIREBASE-SETUP.md e preencha firebase.credentials.deploy.js',
    'error'
  );
}

prefillFromQuery();

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
    showAlert('Configure o Firebase antes de fazer login. Veja docs/FIREBASE-SETUP.md (Passo 8 para GitHub Pages).');
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
