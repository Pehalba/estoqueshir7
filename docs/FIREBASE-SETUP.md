# Guia Firebase — SHIR7 (do zero)

Siga na ordem. Tempo estimado: **15–20 minutos**.

---

## Passo 1 — Criar conta e projeto

1. Abra [https://console.firebase.google.com](https://console.firebase.google.com)
2. Entre com sua conta Google
3. Clique em **Adicionar projeto** (ou "Criar um projeto")
4. Nome sugerido: `shir7-estoque` (pode ser outro)
5. Desative o Google Analytics se quiser (opcional para este projeto)
6. Clique em **Criar projeto** e aguarde

---

## Passo 2 — Registrar o app Web

1. No painel do projeto, clique no ícone **Web** `</>`
2. Apelido do app: `SHIR7 Web`
3. **Não** marque Firebase Hosting por enquanto
4. Clique em **Registrar app**
5. Copie o objeto `firebaseConfig` que aparece, parecido com:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "shir7-estoque.firebaseapp.com",
  projectId: "shir7-estoque",
  storageBucket: "shir7-estoque.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

6. Cole esses valores em:

```
src/js/config/firebase.credentials.js
```

Substitua **todos** os `YOUR_...` pelos valores reais.

---

## Passo 3 — Ativar Authentication (login)

1. Menu lateral → **Authentication** (Autenticação)
2. Clique em **Começar**
3. Aba **Sign-in method** (Provedores de login)
4. Clique em **E-mail/senha** → **Ativar** → Salvar
5. Aba **Users** → **Adicionar usuário**
6. Crie seu usuário admin, ex.:
   - E-mail: `seu@email.com`
   - Senha: (mínimo 6 caracteres)

> Esse é o usuário que você usará na tela de login do SHIR7.

---

## Passo 4 — Criar Firestore (banco de dados)

1. Menu lateral → **Firestore Database**
2. Clique em **Criar banco de dados**
3. Modo: **Produção** (as regras do projeto já estão em `firestore.rules`)
4. Localização: escolha a mais próxima (ex. `southamerica-east1` — São Paulo)
5. Clique em **Ativar**

---

## Passo 5 — Criar Storage (fotos dos produtos — Fase 2)

1. Menu lateral → **Storage**
2. Clique em **Começar**
3. Aceite as regras padrão por agora
4. Mesma região do Firestore
5. Clique em **Concluir**

---

## Passo 6 — Publicar regras de segurança

### Opção A — Pelo Console (mais fácil, sem instalar nada)

**Firestore:**
1. Firestore → aba **Regras**
2. Apague o conteúdo e cole o arquivo `firestore.rules` do projeto
3. Clique em **Publicar**

**Storage:**
1. Storage → aba **Regras**
2. Cole o conteúdo de `storage.rules`
3. Clique em **Publicar**

### Opção B — Firebase CLI (terminal)

```bash
npm install -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc
# Edite .firebaserc e troque SEU_PROJECT_ID_AQUI pelo projectId real
firebase deploy --only firestore:rules,storage
```

---

## Passo 7 — Rodar o SHIR7 localmente

Na pasta raiz do projeto:

```bash
npx serve .
```

Abra no navegador: `http://localhost:3000`

1. Será redirecionado para o login
2. Use o e-mail e senha criados no Passo 3
3. Deve entrar no Dashboard

---

## Checklist rápido

- [ ] Projeto criado no Firebase Console
- [ ] App Web registrado
- [ ] `firebase.credentials.js` preenchido
- [ ] Authentication → E-mail/senha ativado
- [ ] Usuário admin criado
- [ ] Firestore criado
- [ ] Storage criado
- [ ] Regras publicadas
- [ ] Login funcionando no navegador

---

## Problemas comuns

| Erro | Solução |
|------|---------|
| `auth/invalid-api-key` | `apiKey` errada em `firebase.credentials.js` |
| `auth/invalid-credential` | E-mail/senha incorretos ou usuário não criado no Console |
| `Missing or insufficient permissions` | Publique `firestore.rules` (Passo 6) |
| Tela em branco / erro de módulo | Use `npx serve .` na **raiz**, não abra o HTML direto no disco |
| Firebase não configurado (console) | Preencha `firebase.credentials.js` — não deixe `YOUR_API_KEY` |

---

## Próximo passo

Com o login funcionando, execute a **Fase 2** (CRUD de produtos).
