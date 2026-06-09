/**
 * Inicialização Firebase — SHIR7
 * Credenciais em firebase.credentials.js (não commitar em repo público)
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase.credentials.deploy.js';

export function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
  );
}

if (!isFirebaseConfigured()) {
  console.warn(
    '[SHIR7] Firebase não configurado. Siga o guia em docs/FIREBASE-SETUP.md e preencha firebase.credentials.deploy.js'
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
