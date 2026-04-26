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

## 📱 Instalar la app en el celular (PWA)

Una vez deployada, la app es **instalable** como aplicación nativa.

### Android (Chrome)

1. Abrí la URL de Netlify en Chrome.
2. Aparece automáticamente un botón **"Instalar"** dorado en la barra superior, al lado de Login.
3. Tocalo y confirmá. La app queda en el escritorio del celular como cualquier otra.
4. *Alternativa:* tocar el menú de Chrome (⋮) → **Instalar app**.

### iPhone / iPad (Safari)

iOS no muestra prompt automático. Hay que hacerlo manualmente:

1. Abrí la URL de Netlify en **Safari** (no funciona en Chrome de iOS).
2. Tocá el ícono de **Compartir** (cuadrado con flecha hacia arriba) en la barra inferior.
3. Bajá en el menú y tocá **Agregar a pantalla de inicio**.
4. Confirmá el nombre ("Gaceta+") y tocá **Agregar**.

Una vez instalada, la app abre **a pantalla completa**, sin barras del navegador, igual que una app nativa. El ícono dorado "G+" queda en el escritorio.

### ¿Qué cambia con la app instalada?

- Carga **instantánea** la próxima vez (el shell — HTML/CSS/JS — queda cacheado por el service worker).
- Si abrís la app sin internet, te muestra los **últimos datos guardados** en lugar de pantalla vacía.
- Modo **pantalla completa**, sin chrome del navegador.
- Respeta el área segura del notch en iPhones modernos.
- **Actualización en segundo plano** (ver abajo).

## 🔄 Actualización automática en segundo plano

La app intenta refrescar los datos cada ~15 minutos **incluso si no la tenés abierta**, vía la API **Periodic Background Sync**. Pero hay matices importantes según el dispositivo:

| Plataforma | Funciona | Notas |
|---|---|---|
| Android Chrome (PWA instalada) | ✅ Sí | Best effort: el sistema decide cuándo ejecutar realmente |
| Android Edge (PWA instalada) | ✅ Sí | Igual que Chrome |
| Desktop Chrome/Edge (PWA instalada) | ✅ Sí | Idem |
| Android Chrome (sin instalar) | ⚠️ Limitado | El navegador suele negar el permiso |
| **iPhone / iPad (Safari)** | ❌ **No** | Apple no implementa esta API |
| Firefox | ❌ No | No soportado |

**Cómo funciona en la práctica (donde sí está soportado):**

1. Tenés que **instalar la app** (paso anterior). Sin instalar, el navegador casi siempre niega el permiso.
2. Usá la app durante varios días para que el navegador acumule "site engagement" — recién ahí concede el permiso de background sync de forma estable.
3. Cuando se ejecuta, el service worker descarga las cotizaciones y los feeds frescos en background y los guarda en caché.
4. Si la app está abierta cuando ocurre, además refresca la UI automáticamente.
5. Si está cerrada, los datos frescos están listos para cuando la abras.

**Limitación importante:** vos pedís "cada 15 min", pero el navegador decide la frecuencia real según uso, batería y conexión. Puede ser cada 15 min, cada hora, o mucho menos seguido si el dispositivo está ahorrando batería. **No hay forma en la web de garantizar un intervalo exacto** — eso es una decisión deliberada de los navegadores para proteger batería y privacidad.

**En iPhone:** la app se actualiza siempre que la abrís (carga instantánea desde caché + fetch en paralelo). No hay forma de ejecutar código mientras la app está cerrada — es una limitación de iOS, no de la app.

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
