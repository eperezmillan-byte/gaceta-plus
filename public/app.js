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
  const LOGIN_URL = 'https://lagacetamercantil.com.ar/login/';

  const REFRESH_MS = 10 * 60 * 1000; // 10 minutos

  // ── Estado en memoria ──────────────────────────────────────
  const state = {
    activeTab: 'actualidad',
    data: { actualidad: null, cnv: null, yt: null, quotes: null },
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

  // ── Auth-aware fetch ──────────────────────────────────────
  // Adjunta el JWT del usuario logueado para que la función serverless
  // pueda verificar identidad. Si no hay sesión, devuelve un error explícito.
  async function authFetch(url, opts = {}) {
    const user = window.netlifyIdentity?.currentUser();
    if (!user) {
      throw new Error('No autenticado');
    }
    // jwt() refresca el token automáticamente si está por expirar.
    const token = await user.jwt();
    const headers = new Headers(opts.headers || {});
    headers.set('Authorization', `Bearer ${token}`);
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
      if (isFirstLoad) {
        container.innerHTML = `<div class="error">No se pudo cargar el feed (${escapeHtml(err.message)})</div>`;
      }
    }
  }

  function renderArticles(articles, source) {
    const container = $(`#feed-${source}`);
    if (!articles.length) {
      container.innerHTML = '<div class="empty">Sin novedades por el momento.</div>';
      return;
    }
    container.innerHTML = articles.map((a, i) => `
      <article class="article-card" data-source="${source}" data-index="${i}" tabindex="0" role="button">
        ${a.categories?.length ? `<div class="meta">${a.categories.slice(0, 2).map(escapeHtml).join(' · ')}</div>` : ''}
        <h3>${escapeHtml(a.title)}</h3>
        <div class="excerpt">${escapeHtml(stripHtml(a.description).slice(0, 220))}</div>
        <div class="footer-meta">${a.author ? escapeHtml(a.author) + ' · ' : ''}${escapeHtml(timeAgo(a.pubDate))}</div>
      </article>
    `).join('');
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
    if (isRefreshing) return;
    isRefreshing = true;
    $('#refreshBtn').classList.add('spinning');

    await Promise.all([
      loadQuotes(),
      loadFeed('actualidad'),
      loadFeed('cnv'),
      loadFeed('yt')
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
      // Solo refrescamos si la app está visible para no quemar cuota.
      if (document.visibilityState === 'visible') {
        refreshAll();
      }
    }, REFRESH_MS);
  }

  // Si la pestaña vuelve al foco después de >10 min, refrescamos al toque.
  function onVisibilityChange() {
    if (document.visibilityState !== 'visible') return;
    const last = state.data.quotes?.updated || 0;
    if (Date.now() - last > REFRESH_MS) {
      refreshAll();
    }
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    $('#year').textContent = new Date().getFullYear();

    // Botones existentes (Login/Suscribirse a sitios externos)
    $('#subscribeBtn').addEventListener('click', () => {
      window.open(SUBSCRIBE_URL, '_blank', 'noopener,noreferrer');
    });
    $('#loginBtn').addEventListener('click', () => {
      window.open(LOGIN_URL, '_blank', 'noopener,noreferrer');
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

    // Botones del gate abren el widget
    $('#authLoginBtn').addEventListener('click', () => id.open('login'));
    $('#authSignupBtn').addEventListener('click', () => id.open('signup'));
    $('#logoutBtn').addEventListener('click', () => id.logout());

    // Verifica que un objeto de usuario sea válido (tiene email, token, etc).
    // El widget a veces tiene sesiones corruptas que devuelven objetos
    // parciales — en ese caso forzamos logout para que arranquen limpio.
    const isValidUser = (u) => {
      return !!(u && u.email && u.token && u.token.access_token);
    };

    id.on('login', (user) => {
      id.close();
      if (isValidUser(user)) {
        onLoggedIn(user);
      } else {
        console.warn('Login devolvió usuario inválido, forzando logout');
        id.logout();
      }
    });

    id.on('logout', () => {
      onLoggedOut();
    });

    id.on('error', (err) => {
      console.error('Identity error:', err);
    });

    // En init, validamos el usuario antes de mostrar el contenido.
    id.on('init', (user) => {
      if (isValidUser(user)) {
        onLoggedIn(user);
      } else {
        // Usuario null, undefined, o sesión corrupta.
        // Si hay algo guardado pero está incompleto, lo limpiamos.
        if (user) {
          console.warn('Sesión guardada inválida, limpiando');
          id.logout();
        }
        showAuthGate();
      }
    });

    // Llamada explícita a init() para asegurar que se dispare el evento.
    id.init();
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
    hideAuthGate();
    // Mostrar email + botón logout (con fallback por si el objeto está incompleto)
    $('#userEmail').textContent = user?.email || user?.user_metadata?.full_name || 'Usuario';
    $('#logoutBtn').hidden = false;

    // La primera vez que el usuario entra, arrancamos la carga y el timer.
    // En logins posteriores (mismo session) nada que hacer.
    if (!initializedAfterLogin) {
      initializedAfterLogin = true;
      refreshAll();
      startAutoRefresh();
    }
  }

  function onLoggedOut() {
    initializedAfterLogin = false;
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    // Limpiar contenido sensible para que no quede a la vista.
    state.data = { actualidad: null, cnv: null, yt: null, quotes: null };
    $('#tickerTrack').innerHTML = '<div class="ticker-loading">Cargando cotizaciones…</div>';
    ['actualidad', 'cnv', 'yt'].forEach(s => {
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
