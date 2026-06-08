# SHIR7 — Gerenciador de Estoque de Camisetas



Sistema web para controle de estoque, vendas e investidores de loja de camisas de futebol.



## Primeiro passo: configurar o Firebase



**Ainda não criou o projeto Firebase?** Siga o guia completo:



👉 **[docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md)**



Resumo:

1. Criar projeto em [Firebase Console](https://console.firebase.google.com)

2. Registrar app Web e copiar credenciais para `src/js/config/firebase.credentials.js`

3. Ativar Authentication (E-mail/senha) e criar um usuário

4. Criar Firestore e Storage

5. Publicar regras (`firestore.rules` e `storage.rules`)



## Executar localmente



Na **raiz** do projeto:



```bash

npx serve .

```



Abra `http://localhost:3000` e faça login.



## Estrutura



- `pages/` — Páginas HTML

- `src/css/` — Estilos BEM

- `src/js/` — Lógica modular (services, utils, pages)

- `src/js/config/firebase.credentials.js` — Suas credenciais (não commitar)



## Assistente IA



O `aiService.js` usa análise baseada em regras. Para API externa, integre via Firebase Cloud Functions sem expor chaves no frontend.

