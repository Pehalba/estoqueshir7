import { observeAuth, logout, getCurrentUser } from './services/authService.js';
import { qs, qsa, showToast } from './utils/domHelpers.js';

const LOGIN_PAGE = 'login.html';
const DASHBOARD_PAGE = 'dashboard.html';
const PROTECTED_PAGES = [
  'dashboard.html',
  'inventory.html',
  'sales.html',
  'investors.html',
  'profits.html',
  'reports.html',
];

function getCurrentPage() {
  return window.location.pathname.split('/').pop() || 'index.html';
}

function isLoginPage() {
  return getCurrentPage() === LOGIN_PAGE;
}

function isProtectedPage() {
  return PROTECTED_PAGES.includes(getCurrentPage());
}

function redirectTo(path) {
  const base = window.location.pathname.replace(/[^/]*$/, '');
  window.location.href = base + path;
}

function protectPage(user) {
  if (isLoginPage() && user) {
    redirectTo(DASHBOARD_PAGE);
    return;
  }

  if (isProtectedPage() && !user) {
    redirectTo(LOGIN_PAGE);
  }
}

function initSidebar() {
  const sidebar = qs('#sidebar');
  const overlay = qs('#sidebar-overlay');
  const menuBtn = qs('#menu-btn');
  const currentPage = document.body.dataset.page;

  qsa('.sidebar__link').forEach((link) => {
    link.classList.toggle('sidebar__link--active', link.dataset.nav === currentPage);
  });

  const openSidebar = () => {
    sidebar?.classList.add('sidebar--open');
    overlay?.classList.add('sidebar__overlay--visible');
  };

  const closeSidebar = () => {
    sidebar?.classList.remove('sidebar--open');
    overlay?.classList.remove('sidebar__overlay--visible');
  };

  menuBtn?.addEventListener('click', openSidebar);
  overlay?.addEventListener('click', closeSidebar);

  qsa('.sidebar__link').forEach((link) => {
    link.addEventListener('click', closeSidebar);
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) closeSidebar();
  });
}

function initLogout() {
  const logoutBtn = qs('#logout-btn');
  logoutBtn?.addEventListener('click', async () => {
    const result = await logout();
    if (result.success) {
      redirectTo(LOGIN_PAGE);
    } else {
      showToast(result.error, 'error');
    }
  });
}

function updateUserEmail(user) {
  const emailEl = qs('#user-email');
  if (emailEl && user) {
    emailEl.textContent = user.email;
  }
}

function initApp() {
  if (!isLoginPage()) {
    initSidebar();
    initLogout();
  }

  observeAuth((user) => {
    protectPage(user);

    if (user && !isLoginPage()) {
      updateUserEmail(user);
    }
  });

  const user = getCurrentUser();
  if (user && !isLoginPage()) {
    updateUserEmail(user);
  }
}

initApp();
