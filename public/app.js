/* ============================================================
   GACETA+ · Lógica de la app
   - Carga inicial de cotizaciones + 3 feeds.
   - Refresco automático cada 10 minutos (solo si la pestaña
     está visible, para no consumir cuota innecesaria).
   - Tabs, modal de lectura, embebido de YouTube in-app.
============================================================ */

(() => {
  'use strict';

  // ── Constantes ─────────────────────────────────────────────
  const SUBSCRIBE_URL =
    'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=eece22afc13d4b0c9720eadfdf37082f';

  const REFRESH_MS = 10 * 60 * 1000; // 10 minutos

  // ── Estado en memoria ──────────────────────────────────────
  const state = {
    activeTab: 'actualidad',
    data: { actualidad: null, cnv: null, yt: null, yf: null, quotes: null },
    refreshTimer: null
  };

  // ── Utils ──────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmt = (n, d = 2) => {
    if (n == null || Number.isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  };

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (diff < 60) return 'recién';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `hace ${Math.floor(diff / 86400)} d`;
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  // Limpia HTML potencialmente inseguro antes de inyectarlo en el modal.
  function sanitizeContent(html) {
    if (!html) return '';
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/javascript:/gi, '');
  }

  // ── Tracking de artículos leídos (localStorage) ──────────────
  // Guardamos las URLs de artículos abiertos por feed.
  // Se acotan a los 200 más recientes para no crecer indefinidamente.
  const READ_KEY = 'gaceta:read';
  const READ_LIMIT = 200;

  function loadReadSet() {
    try {
      const raw = localStorage.getItem(READ_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveReadSet(map) {
    try {
      localStorage.setItem(READ_KEY, JSON.stringify(map));
    } catch (err) {
      console.warn('No se pudo guardar leídos:', err);
    }
  }

  function markAsRead(source, link) {
    if (!link) return;
    const map = loadReadSet();
    if (!map[source]) map[source] = [];
    if (map[source].includes(link)) return;
    map[source].push(link);
    // Trim para no crecer infinito.
    if (map[source].length > READ_LIMIT) {
      map[source] = map[source].slice(-READ_LIMIT);
    }
    saveReadSet(map);
  }

  function countUnread(source, articles) {
    if (!articles?.length) return 0;
    const map = loadReadSet();
    const readSet = new Set(map[source] || []);
    return articles.filter(a => a.link && !readSet.has(a.link)).length;
  }

  function updateUnreadBadge(source) {
    const badge = $(`#count-${source}`);
    if (!badge) return; // YT y YF no tienen badge
    const articles = state.data[source]?.articles;
    const n = countUnread(source, articles);
    if (n > 0) {
      badge.textContent = n;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // ── Auth-aware fetch ──────────────────────────────────────
  // Adjunta el JWT del usuario logueado para que la función serverless
  // pueda verificar identidad. Si no hay sesión o el token no se puede
  // refrescar, registramos el problema en consola y dejamos que el fetch
  // proceda — la función serverless devolverá 401 y la UI lo manejará.
  async function authFetch(url, opts = {}) {
    const id = window.netlifyIdentity;
    const user = id?.currentUser();
    if (!user) {
      throw new Error('No autenticado');
    }
    const headers = new Headers(opts.headers || {});
    try {
      // jwt() refresca el token automáticamente si está por expirar.
      const token = await user.jwt();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch (err) {
      // Si falla el refresh (token expirado y refresh_token inválido),
      // forzamos logout para que el usuario reautentique.
      console.warn('Token refresh falló, forzando logout:', err);
      id.logout();
      throw new Error('Sesión expirada');
    }
    return fetch(url, { ...opts, headers });
  }

  // ── Ticker ─────────────────────────────────────────────────
  async function loadQuotes() {
    try {
      const res = await authFetch('/api/quotes', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.data.quotes = data;
      renderTicker(data.quotes || []);
    } catch (err) {
      console.error('quotes error', err);
      const track = $('#tickerTrack');
      if (track && !track.querySelector('.ticker-item')) {
        track.innerHTML = '<div class="ticker-loading">Sin datos de cotizaciones</div>';
      }
    }
  }

  function renderTicker(quotes) {
    if (!quotes.length) return;
    const itemsHtml = quotes.map(q => {
      const up = q.changePct >= 0;
      return `
        <div class="ticker-item">
          <span class="sym">${escapeHtml(q.symbol)}</span>
          <span class="price">$${fmt(q.price)}</span>
          <span class="chg ${up ? 'up' : 'down'}">
            <span class="arrow">${up ? '▲' : '▼'}</span>${fmt(Math.abs(q.changePct))}%
          </span>
        </div>
      `;
    }).join('');
    // Duplicamos el contenido para que el marquee sea continuo
    $('#tickerTrack').innerHTML = itemsHtml + itemsHtml;
  }

  // ── Feeds ──────────────────────────────────────────────────
  function skeletonHtml(count, isVideo) {
    let html = '';
    for (let i = 0; i < count; i++) {
      if (isVideo) {
        html += `
          <div class="skeleton" style="padding:0;">
            <div class="skeleton-line huge" style="border-radius:0;"></div>
            <div style="padding: 16px 18px;">
              <div class="skeleton-line tall w-90" style="margin-bottom:10px;"></div>
              <div class="skeleton-line w-60"></div>
            </div>
          </div>`;
      } else {
        html += `
          <div class="skeleton">
            <div class="skeleton-line w-30"></div>
            <div class="skeleton-line tall w-90"></div>
            <div class="skeleton-line tall w-80"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line w-60"></div>
          </div>`;
      }
    }
    return html;
  }

  async function loadFeed(source) {
    const container = $(`#feed-${source}`);
    if (!container) return;

    // Skeleton sólo si no hay contenido aún (evitamos parpadeo en re-fetch)
    const isFirstLoad = !state.data[source];
    if (isFirstLoad) {
      container.innerHTML = skeletonHtml(6, source === 'yt');
    }

    try {
      const url = source === 'yt' ? '/api/youtube' : `/api/feed?source=${source}`;
      const res = await authFetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      state.data[source] = data;

      if (source === 'yt') renderVideos(data.videos || []);
      else renderArticles(data.articles || [], source);
    } catch (err) {
      console.error(`feed ${source} error`, err);
      // Mostramos el error siempre que no haya contenido bueno —
      // antes solo se mostraba la primera vez, lo que ocultaba el problema.
      if (!state.data[source]?.articles?.length) {
        container.innerHTML = `<div class="error">No se pudo cargar el feed (${escapeHtml(err.message)})</div>`;
      }
    }
  }

  function renderArticles(articles, source) {
    const container = $(`#feed-${source}`);
    if (!articles.length) {
      container.innerHTML = '<div class="empty">Sin novedades por el momento.</div>';
      updateUnreadBadge(source);
      return;
    }
    const readSet = new Set((loadReadSet()[source]) || []);
    container.innerHTML = articles.map((a, i) => {
      const isRead = a.link && readSet.has(a.link);
      return `
      <article class="article-card${isRead ? ' is-read' : ''}" data-source="${source}" data-index="${i}" tabindex="0" role="button">
        ${a.categories?.length ? `<div class="meta">${a.categories.slice(0, 2).map(escapeHtml).join(' · ')}</div>` : ''}
        <h3>${escapeHtml(a.title)}</h3>
        <div class="excerpt">${escapeHtml(stripHtml(a.description).slice(0, 220))}</div>
        <div class="footer-meta">${a.author ? escapeHtml(a.author) + ' · ' : ''}${escapeHtml(timeAgo(a.pubDate))}</div>
      </article>
    `;
    }).join('');
    updateUnreadBadge(source);
  }

  function renderVideos(videos) {
    const container = $('#feed-yt');
    if (!videos.length) {
      container.innerHTML = '<div class="empty">Sin videos por el momento.</div>';
      return;
    }
    container.innerHTML = videos.map((v, i) => `
      <article class="video-card" data-index="${i}" tabindex="0" role="button">
        <div class="thumb" style="background-image: url('${escapeHtml(v.thumbnail)}')">
          <div class="play"></div>
        </div>
        <div class="body">
          <h3>${escapeHtml(v.title)}</h3>
          <div class="footer-meta">${v.author ? escapeHtml(v.author) + ' · ' : ''}${escapeHtml(timeAgo(v.published))}</div>
        </div>
      </article>
    `).join('');
  }

  // ── Modal ──────────────────────────────────────────────────
  function openArticle(source, idx) {
    const a = state.data[source]?.articles?.[idx];
    if (!a) return;

    // Marcar como leído (solo para feeds que tienen contador)
    if (source === 'actualidad' || source === 'cnv') {
      markAsRead(source, a.link);
      updateUnreadBadge(source);
      // Actualizar visualmente la card sin re-renderizar todo
      const card = document.querySelector(
        `.article-card[data-source="${source}"][data-index="${idx}"]`
      );
      if (card) card.classList.add('is-read');
    }

    const dateStr = a.pubDate
      ? new Date(a.pubDate).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '';

    $('#modalBody').innerHTML = `
      <div class="article-content">
        <div class="article-meta">
          ${a.categories?.length ? a.categories.map(escapeHtml).join(' · ') : 'Gaceta+'}
          ${dateStr ? ' · ' + escapeHtml(dateStr) : ''}
        </div>
        <h1 id="modalTitle">${escapeHtml(a.title)}</h1>
        ${a.author ? `<div class="byline">Por ${escapeHtml(a.author)}</div>` : '<div class="byline"></div>'}
        <div class="article-body">${sanitizeContent(a.content || a.description || '')}</div>
        <div class="modal-actions">
          <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener" class="btn btn-ghost">Ver original ↗</a>
        </div>
      </div>
    `;
    $('#modalBody').scrollTop = 0;
    showModal();
  }

  function openVideo(idx) {
    const v = state.data.yt?.videos?.[idx];
    if (!v) return;

    $('#modalBody').innerHTML = `
      <div class="video-embed">
        <iframe
          src="https://www.youtube.com/embed/${encodeURIComponent(v.videoId)}?autoplay=1&rel=0&modestbranding=1"
          title="${escapeHtml(v.title)}"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          loading="lazy"
        ></iframe>
        <div class="video-info">
          <h2 id="modalTitle">${escapeHtml(v.title)}</h2>
          <div class="byline">${escapeHtml(v.author || '')}${v.published ? ' · ' + escapeHtml(timeAgo(v.published)) : ''}</div>
          ${v.description ? `<div class="description">${escapeHtml(v.description)}</div>` : ''}
        </div>
      </div>
    `;
    $('#modalBody').scrollTop = 0;
    showModal();
  }

  function showModal() {
    const m = $('#modal');
    m.classList.add('open');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const m = $('#modal');
    m.classList.remove('open');
    m.setAttribute('aria-hidden', 'true');
    // Limpiar contenido frena cualquier video en reproducción
    $('#modalBody').innerHTML = '';
    document.body.style.overflow = '';
  }

  // ── Tabs ───────────────────────────────────────────────────
  function switchTab(name) {
    if (state.activeTab === name) return;
    state.activeTab = name;
    $$('.tab').forEach(t => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  }

  // ── Refresh orchestration ──────────────────────────────────
  let isRefreshing = false;
  async function refreshAll() {
    // Guard: nunca refrescar sin sesión activa, evita "No autenticado".
    const user = window.netlifyIdentity?.currentUser();
    if (!user) {
      console.info('[Refresh] sin sesión, salteando');
      return;
    }
    if (isRefreshing) return;
    isRefreshing = true;
    $('#refreshBtn').classList.add('spinning');

    await Promise.all([
      loadQuotes(),
      loadFeed('actualidad'),
      loadFeed('cnv'),
      loadFeed('yt'),
      loadFeed('yf')
    ]);

    $('#refreshBtn').classList.remove('spinning');
    updateTimestamp();
    isRefreshing = false;
  }

  function updateTimestamp() {
    const now = new Date();
    const t = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    $('#lastUpdated').textContent = `Actualizado ${t}`;
  }

  function startAutoRefresh() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = setInterval(() => {
      // Solo refrescamos si la app está visible Y hay sesión.
      if (document.visibilityState === 'visible' && window.netlifyIdentity?.currentUser()) {
        refreshAll();
      }
    }, REFRESH_MS);
  }

  // Si la pestaña vuelve al foco después de >10 min, refrescamos al toque.
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    // Sin sesión, no refrescamos (evita errores "No autenticado").
    if (!window.netlifyIdentity?.currentUser()) return;
    const last = state.data.quotes?.updated || 0;
    if (Date.now() - last > REFRESH_MS) {
      refreshAll();
    }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    $('#year').textContent = new Date().getFullYear();

    // Botón Suscribirse (sale al checkout de MercadoPago)
    $('#subscribeBtn').addEventListener('click', () => {
      window.open(SUBSCRIBE_URL, '_blank', 'noopener,noreferrer');
    });

    $$('.tab').forEach(t => {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    $('#refreshBtn').addEventListener('click', refreshAll);

    // Modal
    $('#modal').addEventListener('click', (e) => {
      if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Click + teclado en cards
    document.addEventListener('click', (e) => {
      const article = e.target.closest('.article-card');
      if (article) {
        openArticle(article.dataset.source, parseInt(article.dataset.index, 10));
        return;
      }
      const video = e.target.closest('.video-card');
      if (video) {
        openVideo(parseInt(video.dataset.index, 10));
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const target = e.target;
      if (target.classList?.contains('article-card')) {
        e.preventDefault();
        openArticle(target.dataset.source, parseInt(target.dataset.index, 10));
      } else if (target.classList?.contains('video-card')) {
        e.preventDefault();
        openVideo(parseInt(target.dataset.index, 10));
      }
    });

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Mide el header fijo y lo aplica como padding-top en body.
    setupHeaderHeight();

    // Auth gate · Netlify Identity
    setupAuth();

    // PWA: registrar service worker e interceptar prompt de instalación
    setupPWA();

    // No arrancamos refresh ni timer aquí — eso se hace después del login.
  }

  // ── Netlify Identity · auth gate ──────────────────────────
  function setupAuth() {
    const id = window.netlifyIdentity;

    if (!id) {
      console.error('Netlify Identity no disponible. Revisá adblockers o conexión.');
      $('#authGate').innerHTML = `
        <div class="auth-card">
          <div class="auth-brand"><span class="brand-mark">Gaceta</span><span class="brand-plus">+</span></div>
          <p class="auth-tagline" style="color: var(--red);">Error al cargar autenticación</p>
          <p class="auth-hint">Revisá tu conexión o desactivá bloqueadores de scripts y recargá la página.</p>
        </div>`;
      showAuthGate();
      return;
    }

    // Botones del gate abren el widget (con logging para diagnosticar)
    $('#authLoginBtn').addEventListener('click', (e) => {
      console.info('[Auth] Click en Iniciar sesión');
      try {
        id.open('login');
        console.info('[Auth] open(login) llamado sin error');
      } catch (err) {
        console.error('[Auth] open(login) falló:', err);
      }
    });
    $('#authSignupBtn').addEventListener('click', (e) => {
      console.info('[Auth] Click en Crear cuenta');
      try {
        id.open('signup');
        console.info('[Auth] open(signup) llamado sin error');
      } catch (err) {
        console.error('[Auth] open(signup) falló:', err);
      }
    });
    $('#logoutBtn').addEventListener('click', () => id.logout());

    const isValidUser = (u) => !!(u && u.email);

    id.on('login', (user) => {
      id.close();
      if (isValidUser(user)) {
        onLoggedIn(user);
      } else {
        console.warn('[Auth] Login devolvió usuario inválido, forzando logout');
        id.logout();
      }
    });

    id.on('logout', () => {
      onLoggedOut();
    });

    id.on('error', (err) => {
      console.error('[Auth] Identity error:', err);
    });

    // Flag para evitar doble procesamiento del init.
    let initProcessed = false;
    const handleInit = (user) => {
      if (initProcessed) return;
      initProcessed = true;
      console.info('[Auth] init disparado. Usuario:', user?.email || 'ninguno');
      if (isValidUser(user)) {
        console.info('[Auth] Usuario válido, mostrando contenido');
        onLoggedIn(user);
      } else {
        if (user) {
          console.warn('[Auth] Sesión guardada inválida, limpiando');
          id.logout();
        } else {
          console.info('[Auth] Sin sesión, mostrando login');
        }
        showAuthGate();
      }
    };

    id.on('init', handleInit);

    // El widget puede haber inicializado solo (auto-init) antes de que llegáramos
    // a registrar el listener. Si ya hay un currentUser conocido, procesamos.
    const cu = id.currentUser();
    if (cu !== undefined) {
      handleInit(cu);
    }
  }

  function showAuthGate() {
    $('#authGate').classList.add('show');
    $('#authGate').setAttribute('aria-hidden', 'false');
    document.body.classList.add('auth-locked');
  }

  function hideAuthGate() {
    $('#authGate').classList.remove('show');
    $('#authGate').setAttribute('aria-hidden', 'true');
    document.body.classList.remove('auth-locked');
  }

  let initializedAfterLogin = false;

  function onLoggedIn(user) {
    try {
      hideAuthGate();
      // Mostrar email + botón logout (con fallback por si el objeto está incompleto)
      $('#userEmail').textContent = user?.email || user?.user_metadata?.full_name || 'Usuario';
      $('#logoutBtn').hidden = false;

      // La primera vez que el usuario entra, arrancamos la carga y el timer.
      // En logins posteriores (mismo session) nada que hacer.
      if (!initializedAfterLogin) {
        initializedAfterLogin = true;
        // Esperamos a que el JWT esté disponible antes de la primera carga.
        // Sin esto hay race condition: el evento `login` dispara antes de
        // que el widget guarde el token, y authFetch falla con "No autenticado".
        waitForToken(user).then(() => {
          refreshAll().catch(err => console.error('refreshAll inicial falló:', err));
          try {
            startAutoRefresh();
          } catch (err) {
            console.error('startAutoRefresh falló:', err);
          }
        }).catch(err => {
          console.error('No se pudo obtener token inicial:', err);
        });
      }
    } catch (err) {
      console.error('Error en onLoggedIn:', err);
    }
  }

  // Espera a que el usuario tenga un JWT recuperable (con reintentos cortos).
  // Necesario para evitar la primera carga antes de que el widget guarde el token.
  async function waitForToken(user, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const token = await user.jwt();
        if (token) return token;
      } catch (err) {
        // Sigue intentando.
      }
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error('Timeout esperando JWT');
  }

  function onLoggedOut() {
    initializedAfterLogin = false;
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    // Limpiar contenido sensible para que no quede a la vista.
    state.data = { actualidad: null, cnv: null, yt: null, yf: null, quotes: null };
    $('#tickerTrack').innerHTML = '<div class="ticker-loading">Cargando cotizaciones…</div>';
    ['actualidad', 'cnv', 'yt', 'yf'].forEach(s => {
      const c = $(`#feed-${s}`);
      if (c) c.innerHTML = '';
    });
    $('#userEmail').textContent = '';
    $('#logoutBtn').hidden = true;
    showAuthGate();
  }

  // ── Compensación de altura del header fijo ────────────────
  function setupHeaderHeight() {
    const header = $('.app-header');
    if (!header) return;
    const update = () => {
      document.documentElement.style.setProperty(
        '--header-height',
        header.offsetHeight + 'px'
      );
    };
    update();
    // Re-medir cuando cambian fuentes, tamaño de ventana o rotación.
    if (window.ResizeObserver) {
      new ResizeObserver(update).observe(header);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(update);
    }
  }

  // ── PWA · service worker + install prompt ──────────────────
  let deferredInstallPrompt = null;

  function setupPWA() {
    // Registramos el service worker (requisito para instalación)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          await navigator.serviceWorker.register('/sw.js');
        } catch (err) {
          console.warn('SW register failed', err);
        }
      });
    }

    // Chrome/Android: capturar el evento de instalación para mostrar UI propia
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      showInstallButton();
    });

    // Si la app ya fue instalada, escondemos el botón
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      hideInstallButton();
    });
  }

  function showInstallButton() {
    if ($('#installBtn')) return; // ya existe
    const btn = document.createElement('button');
    btn.id = 'installBtn';
    btn.className = 'btn btn-ghost install-btn';
    btn.type = 'button';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; vertical-align: -2px;">
        <path d="M12 3v12M6 9l6 6 6-6M5 21h14"/>
      </svg>Instalar`;
    btn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        hideInstallButton();
      }
      deferredInstallPrompt = null;
    });
    // Insertamos antes del Login en la barra de acciones
    const actions = document.querySelector('.actions');
    actions.insertBefore(btn, actions.firstChild);
  }

  function hideInstallButton() {
    const btn = $('#installBtn');
    if (btn) btn.remove();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
