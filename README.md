# Gaceta+

Portal financiero con cotizaciones de Nueva York en vivo y feeds editoriales integrados de **La Gaceta Mercantil** + playlist de YouTube. Para desplegar en **Netlify** como sitio estático con funciones serverless.

---

## ⚠️ Importante: cómo deployar

Esta app usa **funciones serverless** para traer datos (cotizaciones, RSS, YouTube). Tenés **dos métodos** que funcionan:

### ✅ Método 1 · GitHub + Netlify (más simple)

1. Subí esta carpeta entera a un repo de GitHub.
2. Andá a [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
3. Elegí GitHub, autorizá, seleccioná el repo.
4. Netlify lee el `netlify.toml` y configura todo solo. **No toques nada.** Si te muestra campos para llenar:
   - **Build command:** (vacío)
   - **Publish directory:** `public`
   - **Functions directory:** `netlify/functions`
5. **Deploy site**. En 30-60 segundos está online.

### ✅ Método 2 · Netlify CLI

```bash
cd gaceta-plus
npm install
npx netlify login         # te abre el navegador para autorizar
npx netlify deploy --prod
```

La CLI te pregunta si crear un sitio nuevo, y a qué carpeta publicar. Aceptá los defaults (lee del `netlify.toml`).

### ❌ Método que NO funciona: Netlify Drop (drag & drop)

Aunque es tentador por lo simple, **Netlify Drop ignora `netlify.toml` y no despliega funciones serverless**. Si arrastrás el ZIP, vas a ver la página pero el ticker dirá "Sin datos de cotizaciones" y los feeds darán error.

---

## Estructura del proyecto

```
gaceta-plus/
├── public/                 ← Lo que se publica
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── netlify/
│   └── functions/          ← Funciones serverless
│       ├── quotes.js       ← Cotizaciones desde Yahoo Finance
│       ├── feed.js         ← RSS de Actualidad y CNV
│       └── youtube.js      ← Playlist de YouTube
├── netlify.toml            ← Config (publish, redirects)
├── package.json            ← Una dependencia: fast-xml-parser
└── README.md
```

## Comportamiento

- **Al abrir la app:** carga cotizaciones, Actualidad, CNV y YT en paralelo.
- **Cada 10 minutos:** auto-refresh, solo si la pestaña está visible (no consume cuota cuando está en background).
- **Botón circular ↻:** refresh manual on-demand.
- **Volver al foco después de >10 min:** dispara un refresh inmediato.
- **Lectura in-app:** los artículos se abren en un modal con tipografía editorial; los videos en iframe embebido.

## Desarrollo local

```bash
npm install
npx netlify dev
```

`netlify dev` levanta el sitio + funciones en `http://localhost:8888` con los redirects activos (`/api/quotes`, `/api/feed?source=...`, `/api/youtube`).

## Personalización rápida

| Querés cambiar… | Editar en |
|---|---|
| Lista de tickers | `netlify/functions/quotes.js` (constante `SYMBOLS`) |
| Feeds RSS | `netlify/functions/feed.js` (objeto `SOURCES`) |
| Playlist de YouTube | `netlify/functions/youtube.js` (constante `PLAYLIST_ID`) |
| URLs de Suscripción/Login | `public/app.js` (constantes `SUBSCRIBE_URL`/`LOGIN_URL`) |
| Intervalo de auto-refresh | `public/app.js` (constante `REFRESH_MS`) |
| Paleta y tipografía | variables CSS al inicio de `public/styles.css` |

## Notas sobre los tickers

- **INTL** original (INTL FCStone) dejó de cotizar en 2020. Se reemplazó por **INTC (Intel)**. Si querés otro símbolo, cambialo en `quotes.js`.
- Si Yahoo Finance no devuelve un ticker, queda registrado en el campo `failed` de la respuesta y simplemente no aparece en el ticker; los demás siguen funcionando normalmente.

## Si seguís viendo 404 después de deployar

1. Andá a Netlify → tu sitio → **Deploys** → click en el deploy más reciente → **Deploy log**. Si dice `No build command specified` y termina en `Site is live`, está OK.
2. **Site settings → Build & deploy → Build settings**: confirmá que **Publish directory** dice `public`. Si dice otra cosa, editalo y andá a Deploys → **Trigger deploy → Clear cache and deploy site**.
3. **Functions tab**: deberías ver listadas `quotes`, `feed` y `youtube`. Si no aparecen, las funciones no se deployaron — andá a **Site settings → Build & deploy → Functions** y confirmá que **Functions directory** dice `netlify/functions`.
