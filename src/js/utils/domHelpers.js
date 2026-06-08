export function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

export function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

export function createElement(tag, className, text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

export function show(el) {
  if (el) el.style.display = '';
}

export function hide(el) {
  if (el) el.style.display = 'none';
}

export function toggleClass(el, className, force) {
  if (el) el.classList.toggle(className, force);
}

export function setLoading(button, loading) {
  if (!button) return;
  button.disabled = loading;
  button.classList.toggle('btn--loading', loading);
}

function getToastContainer() {
  let container = qs('#toast-container');
  if (!container) {
    container = createElement('div', 'toast-container');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = getToastContainer();
  const toast = createElement('div', `toast toast--${type}`);

  const msg = createElement('span', 'toast__message', message);
  const closeBtn = createElement('button', 'toast__close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Fechar');

  toast.append(msg, closeBtn);
  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('toast--leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  closeBtn.addEventListener('click', remove);
  if (duration > 0) setTimeout(remove, duration);
}

export function openModal(modalId) {
  const modal = qs(`#${modalId}`);
  if (modal) modal.classList.add('modal--open');
}

export function closeModal(modalId) {
  const modal = qs(`#${modalId}`);
  if (modal) modal.classList.remove('modal--open');
}

export function setupModalClose(modalId) {
  const modal = qs(`#${modalId}`);
  if (!modal) return;

  const backdrop = qs('.modal__backdrop', modal);
  const closeButtons = qsa('[data-modal-close]', modal);

  backdrop?.addEventListener('click', () => closeModal(modalId));
  closeButtons.forEach((btn) => {
    btn.addEventListener('click', () => closeModal(modalId));
  });
}
