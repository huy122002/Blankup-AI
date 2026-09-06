// frontend/js/home.js — v4 Premium Interactions
const API_BASE = window.location.origin + '/api';

/* ============================================================
   TYPING ANIMATION
   ============================================================ */
function initTypingAnimation() {
  const el = document.getElementById('heroTyping');
  if (!el) return;

  const phrases = [
    'Một con rồng Việt Nam phong cách cyberpunk',
    'Hoa sen kết hợp sóng nước nghệ thuật',
    'Phượng hoàng lửa vintage anime style',
    'Geometric abstract neon pattern',
    'Bức tranh phố cổ Hội An',
    'Chữ thư pháp kết hợp minimal',
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let isPaused = false;

  function type() {
    if (isPaused) {
      setTimeout(type, 3000);
      isPaused = false;
      return;
    }

    const current = phrases[phraseIndex];
    if (!isDeleting) {
      charIndex++;
      el.textContent = current.substring(0, charIndex);
      if (charIndex === current.length) {
        isPaused = true;
        isDeleting = true;
        setTimeout(type, 2000);
        return;
      }
      setTimeout(type, 50 + Math.random() * 60);
    } else {
      charIndex--;
      el.textContent = current.substring(0, charIndex);
      if (charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        setTimeout(type, 400);
        return;
      }
      setTimeout(type, 25 + Math.random() * 30);
    }
  }

  type();
}

/* ============================================================
   3D TILT ON HERO MOCKUP
   ============================================================ */
function initHeroTilt() {
  const card = document.getElementById('heroMockup');
  if (!card) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const tiltX = (y - 0.5) * 8;
    const tiltY = (0.5 - x) * 8;
    card.style.transform = `perspective(800px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale3d(1.03,1.03,1.03)`;
    card.style.transition = 'transform 0.1s ease-out';
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)';
    card.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
  });
}

/* ============================================================
   HERO SPOTLIGHT — soft print-light follows the pointer
   ============================================================ */
function initHeroSpotlight() {
  const spotlight = document.querySelector('.hero-spotlight');
  if (!spotlight) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.innerWidth <= 1024) return;

  const area = spotlight.parentElement;
  let raf = null;
  area.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      const r = area.getBoundingClientRect();
      spotlight.style.setProperty('--sx', (e.clientX - r.left) + 'px');
      spotlight.style.setProperty('--sy', (e.clientY - r.top) + 'px');
      raf = null;
    });
  });
}

/* ============================================================
   MAGNETIC BUTTONS — consolidated into shared motion.js (delegated,
   dynamic-safe). Homepage CTAs carry .magnetic in markup; motion.js
   owns the pull physics. This stub remains as a no-op for safety.
   ============================================================ */
function initMagneticButtons() {
  // Handled by js/motion.js — see tokens.css .magnetic for easing.
}

/* ============================================================
   SCROLL ANIMATIONS (Intersection Observer + MutationObserver)
   ============================================================ */
let _scrollObserver = null;
let _mutationObserver = null;
function initScrollAnimations() {
  if (!_scrollObserver) {
    _scrollObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });
  }
  document.querySelectorAll('.anim-on-scroll:not(.visible)').forEach(el => _scrollObserver.observe(el));

  if (!_mutationObserver) {
    _mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (node.matches?.('.anim-on-scroll:not(.visible)')) _scrollObserver.observe(node);
          node.querySelectorAll?.('.anim-on-scroll:not(.visible)').forEach(el => _scrollObserver.observe(el));
        });
      });
    });
    _mutationObserver.observe(document.body, { childList: true, subtree: true });
  }
}

/* ============================================================
   HERO LOAD CHOREOGRAPHY — staggered reveal on page load
   ============================================================ */
function initHeroLoad() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.hero-load-hidden').forEach(el => el.classList.remove('hero-load-hidden'));
    return;
  }

  const beats = [
    { sel: '.hero-badge', delay: 100 },
    { sel: '.hero-title', delay: 220 },
    { sel: '.hero-subtitle', delay: 380 },
    { sel: '.hero-cta', delay: 500 },
    { sel: '.live-prompt', delay: 620 },
    { sel: '.hero-trust', delay: 720 },
    { sel: '.hero-visual', delay: 300 },
  ];

  requestAnimationFrame(() => {
    document.fonts.ready.then(() => {
      beats.forEach(({ sel, delay }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        setTimeout(() => {
          el.style.animation = `heroEnter 0.8s var(--ease-out-expo) forwards`;
          el.classList.remove('hero-load-hidden');
        }, delay);
      });
    });
  });
}

/* ============================================================
   NAVBAR SCROLL EFFECT
   ============================================================ */
function initNavbar() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 50);
  }, { passive: true });

  // Mobile menu
  const burger = document.getElementById('navToggle');
  const menu = document.getElementById('navMenu');
  if (burger && menu) {
    burger.addEventListener('click', () => {
      menu.classList.toggle('open');
      burger.classList.toggle('active');
    });
  }

  // Smooth scroll for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        menu?.classList.remove('open');
      }
    });
  });
}

/* ============================================================
   COUNTER ANIMATION
   ============================================================ */
function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        if (el.dataset.animated === 'true') return;
        const target = parseInt(el.dataset.count);
        animateCounter(el, target);
        el.dataset.animated = 'true';
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(c => observer.observe(c));
}

function animateCounter(el, target) {
  const duration = 2500;
  const start = performance.now();
  const format = (v) => v.toLocaleString('vi-VN');

  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(eased * target);
    el.textContent = format(current);
    if (progress < 1) requestAnimationFrame(update);
    else el.textContent = format(target);
  }

  requestAnimationFrame(update);
}

/* ============================================================
   SCROLL PROGRESS BAR
   ============================================================ */
function initScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;

  function update() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = `scaleX(${progress})`;
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => { update(); ticking = false; });
      ticking = true;
    }
  }, { passive: true });
  update();
}

/* ============================================================
   HERO ARTWORK — auto-rotate through community designs
   ============================================================ */
let _artworkInterval = null;

async function initHeroArtworkCycle() {
  const img = document.getElementById('heroArtImg');
  if (!img) return;
  const motionOK = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let pool = [];
  try {
    const resp = await fetch(`${API_BASE}/ai-design/gallery`);
    if (resp.ok) {
      const result = await resp.json();
      pool = (result.data || []).map(d => d.frontDesignUrl || d.designUrl).filter(Boolean);
    }
  } catch (e) { console.warn('[Blankup] Gallery fetch failed:', e); }

  if (!pool.length) {
    return;
  }

  const fallback = document.getElementById('heroArtFallback');
  if (fallback) fallback.style.display = 'none';
  img.src = pool[0];
  if (!motionOK) return;

  let i = 1;
  _artworkInterval = setInterval(() => {
    img.classList.add('crossfade-out');
    setTimeout(() => {
      img.src = pool[i % pool.length];
      img.classList.remove('crossfade-out');
    }, 500);
    i++;
  }, 4500);
}

/* ============================================================
   HERO PARALLAX (scroll-based, desktop only)
   ============================================================ */
function initHeroParallax() {
  const visual = document.querySelector('.hero-visual');
  if (!visual) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.innerWidth <= 1024) return;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < window.innerHeight) {
          visual.style.marginTop = (y * 0.1) + 'px';
        }
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
}

/* ============================================================
   GALLERY CARD — 3D tilt on hover (desktop only)
   ============================================================ */
function initGalleryTilt() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('.gallery-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateY = (x - 0.5) * 8;
      const rotateX = (0.5 - y) * 8;
      card.style.transform = `perspective(800px) translateY(-6px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

/* ============================================================
   LIVE STATS — real numbers from backend, zeros if unavailable
   ============================================================ */
async function loadStats() {
  let stats = null;
  try {
    const resp = await fetch(`${API_BASE}/stats`);
    if (!resp.ok) throw new Error('Failed');
    const result = await resp.json();
    if (!result.success) throw new Error('Failed');
    stats = result;
  } catch (e) { console.warn('[Blankup] Stats fetch failed:', e); }

  const counters = {
    designs: document.querySelector('.stat-item [data-count="designs"]'),
    customers: document.querySelector('.stat-item [data-count="customers"]'),
    orders: document.querySelector('.stat-item [data-count="orders"]'),
  };

  const statsBar = document.querySelector('.stats-bar');

  if (stats) {
    if (counters.designs) counters.designs.dataset.count = String(stats.totalDesigns || 0);
    if (counters.customers) counters.customers.dataset.count = String(stats.totalCustomers || 0);
    if (counters.orders) counters.orders.dataset.count = String(stats.totalOrders || 0);
  }

  if (statsBar) statsBar.classList.add('stats-loaded');

  const floatDesigns = document.getElementById('heroFloatDesigns');
  if (floatDesigns) floatDesigns.textContent = (stats?.totalDesigns || 0).toLocaleString('vi-VN');

  document.querySelectorAll('.marquee-count').forEach(el => {
    const n = stats?.[el.dataset.count === 'orders' ? 'totalOrders' : 'totalDesigns'] || 0;
    el.textContent = `${Number(n).toLocaleString('vi-VN')}+ ${el.dataset.count === 'orders' ? 'ĐƠN HÀNG' : 'THIẾT KẾ'}`;
  });

  initCounters();
  renderHeroTrust(stats?.recentOrders || [], stats?.totalOrders || 0);
}

/* ============================================================
   HERO TRUST — real customer initials from recent orders
   ============================================================ */
function renderHeroTrust(recentOrders, totalOrders) {
  const trust = document.getElementById('heroTrust');
  if (!trust) return;

  if (!Array.isArray(recentOrders) || !recentOrders.length) {
    trust.style.display = 'none';
    return;
  }

  const colors = ['#ff6b00', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b'];
  const avatars = document.getElementById('heroTrustAvatars');
  if (avatars) {
    avatars.innerHTML = recentOrders.slice(0, 4).map(o => {
      const name = String(o.name || 'K').trim();
      const initial = (name.split(/\s+/).pop() || 'K').charAt(0).toUpperCase();
      let hue = 0;
      for (const ch of name) hue = (hue + ch.charCodeAt(0)) % colors.length;
      return `<div class="hero-trust-avatar" title="${escapeAttr(name)}" style="background:${colors[hue]};">${escapeHtml(initial)}</div>`;
    }).join('');
  }

  const text = document.getElementById('heroTrustText');
  if (text) {
    text.innerHTML = `<strong>${Number(totalOrders || 0).toLocaleString('vi-VN')}</strong> đơn hàng đã được đặt`;
  }
}

/* ============================================================
   GALLERY
   ============================================================ */
const STYLE_LABELS = {
  minimalist: 'Minimalist',
  streetwear: 'Streetwear',
  vintage: 'Vintage',
  abstract: 'Abstract',
  anime: 'Anime',
  ai3d: 'AI 3D',
  watercolor: 'Watercolor',
  geometric: 'Geometric',
  typography: 'Typography',
  'reference remix': 'Remix ảnh',
};

function renderGallerySkeleton(count = 6) {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  // Match .gallery-card dimensions, no layout shift, responsive grid already handles it
  grid.innerHTML = Array.from({length: count}, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-media"></div>
      <div class="skeleton-body">
        <div class="skeleton-line mid"></div>
        <div class="skeleton-line short"></div>
      </div>
    </div>
  `).join('');
}

function revealStagger(container, selector) {
  const els = container.querySelectorAll(selector);
  if (!els.length) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    els.forEach(el => {
      el.classList.remove('reveal-ready');
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    return;
  }
  // Cap stagger so last card not too late: max 300ms total
  const maxDelay = 300;
  const step = Math.min(42, maxDelay / Math.max(1, els.length));
  els.forEach((el, i) => {
    el.classList.add('reveal-ready');
    // Use WAAPI, transform/opacity only
    const delay = Math.min(i * step, maxDelay);
    el.animate(
      [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 420, delay, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'forwards' }
    );
    // Clean class after animation
    setTimeout(() => el.classList.remove('reveal-ready'), 600 + delay);
  });
}

async function loadGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  // Sprint 1: skeleton → gallery (no spinner + skeleton together, no flash)
  renderGallerySkeleton(6);

  let designs = [];
  let error = null;
  try {
    const resp = await fetch(`${API_BASE}/ai-design/gallery`);
    if (!resp.ok) throw new Error('Failed');
    const result = await resp.json();
    designs = (result.data || []).slice(0, 24);
  } catch (e) { console.warn('[Blankup] Gallery fetch failed:', e); error = e; }

  applyCollectionArtwork(designs);

  const userId = (typeof auth !== 'undefined' && auth.user?.id) || localStorage.getItem('guest_id') || '';

  if (error && !designs.length) {
    // Skeleton → Error state with retry (no infinite skeleton)
    grid.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon" aria-hidden="true">!</div>
        <h3>Không tải được gallery</h3>
        <p>Vui lòng kiểm tra kết nối và thử lại.</p>
        <button class="hero-btn-primary" id="galleryRetryBtn">Thử lại</button>
      </div>`;
    document.getElementById('galleryRetryBtn')?.addEventListener('click', loadGallery);
    return;
  }

  if (!designs.length) {
    renderGalleryEmpty();
    return;
  }

  renderGalleryFilters(designs);
  renderGalleryGrid(designs, userId);
  initGalleryEvents(designs, userId);
  initGalleryTilt();
  initScrollAnimations();
  // Stagger reveal: gallery-card
  revealStagger(grid, '.gallery-card');
}

/* ============================================================
   COLLECTIONS — real community artwork behind each card
   (falls back to the themed gradient when no design exists yet)
   ============================================================ */
function applyCollectionArtwork(designs) {
  const cards = document.querySelectorAll('.collection-card[data-collection-style]');
  if (!cards.length || !designs.length) return;

  const pool = designs.map(d => ({
    style: (d.style || '').toLowerCase(),
    url: d.frontDesignUrl || d.designUrl || '',
  })).filter(d => d.url);

  if (!pool.length) return;

  const used = new Set();
  cards.forEach(card => {
    const wanted = card.dataset.collectionStyle;
    const match = pool.find(d => d.style === wanted && !used.has(d.url))
      || pool.find(d => !used.has(d.url));
    if (!match) return;
    used.add(match.url);
    const art = card.querySelector('.collection-art');
    if (art) art.style.backgroundImage = `url("${match.url}")`;
  });
}

function renderGalleryEmpty() {
  const grid = document.getElementById('galleryGrid');
  const filters = document.getElementById('galleryFilters');
  if (!grid) return;
  if (filters) filters.innerHTML = '';
  grid.innerHTML = `
    <div class="gallery-empty">
      <div class="gallery-empty-icon">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <h3>Chưa có thiết kế nào được chia sẻ</h3>
      <p>Hãy là người đầu tiên tạo một tác phẩm và chia sẻ lên cộng đồng Blankup.</p>
      <a class="hero-btn-primary" href="studio.html">Tạo thiết kế đầu tiên</a>
    </div>`;
}

function renderGalleryFilters(designs) {
  const filters = document.getElementById('galleryFilters');
  if (!filters) return;

  const styles = ['all', ...new Set(designs.map(d => (d.style || '').toLowerCase()).filter(Boolean))];
  filters.innerHTML = styles.map(s => `
    <button class="gallery-filter-chip ${s === 'all' ? 'active' : ''}" data-style="${escapeAttr(s)}">
      ${s === 'all' ? 'Tất cả' : (STYLE_LABELS[s] || s)}
    </button>
  `).join('');
}

function renderGalleryGrid(designs, userId) {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  grid.innerHTML = designs.map((d) => {
    const url = d.frontDesignUrl || d.designUrl || '';
    const prompt = d.prompt || 'AI Design';
    const author = d.author || 'Community';
    const did = d.designId || '';
    const liked = d.likedBy?.includes(userId);
    const style = (d.style || '').toLowerCase();
    const useUrl = `studio.html?designUrl=${encodeURIComponent(url)}&prompt=${encodeURIComponent(prompt)}&style=${encodeURIComponent(style || 'abstract')}&author=${encodeURIComponent(author)}`;
    const authorHtml = d.authorUsername
      ? `<a href="creator.html?user=${encodeURIComponent(d.authorUsername)}" class="gallery-card-author" title="Xem hồ sơ ${escapeAttr(author)}">${escapeHtml(author)}</a>`
      : `<span>${escapeHtml(author)}</span>`;
    return `<div class="gallery-card anim-on-scroll" data-style="${escapeAttr(style)}">
      <div class="gallery-card-media">
        <a href="${escapeAttr(useUrl)}" class="gallery-card-link" title="Dùng thiết kế này">
          <img class="gallery-card-img" src="${escapeAttr(url)}" alt="${escapeAttr(prompt)}" loading="lazy">
        </a>
        <a href="${escapeAttr(useUrl)}" class="gallery-card-use">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Dùng thiết kế này
        </a>
      </div>
      <div class="gallery-card-info">
        <div class="gallery-card-prompt">"${escapeHtml(prompt)}"</div>
        <div class="gallery-card-meta">
          <span class="gallery-card-meta-left">${authorHtml}</span>
          <span class="gallery-card-meta-actions">
            <button class="gallery-card-comment" data-id="${escapeAttr(did)}" data-count="${d.commentCount || 0}" title="Bình luận">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <span>${d.commentCount || 0}</span>
            </button>
            <button class="gallery-card-like ${liked ? 'liked' : ''}" data-id="${escapeAttr(did)}" data-likes="${d.likes || 0}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>${d.likes || 0}</span>
            </button>
          </span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function initGalleryEvents(designs, userId) {
  const filters = document.getElementById('galleryFilters');
  const grid = document.getElementById('galleryGrid');
  if (!filters || !grid) return;

  // Sprint 1: FLIP filter — transform/opacity only, cancel previous, reduced-motion
  let flipAnims = [];
  let flipFrame = null;
  function applyGalleryFilter(style) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cards = Array.from(grid.querySelectorAll('.gallery-card'));
    if (!cards.length) return;
    // No change → no animation
    const active = filters.querySelector('.gallery-filter-chip.active');
    if (active && active.dataset.style === style) return;

    // Cancel previous
    flipAnims.forEach(a => { try{ a.cancel(); }catch{} });
    flipAnims = [];
    if (flipFrame) cancelAnimationFrame(flipFrame);

    if (reduce) {
      cards.forEach(card => {
        const match = style === 'all' || card.dataset.style === style;
        card.style.display = match ? '' : 'none';
        card.style.opacity = '';
        card.style.transform = '';
      });
      return;
    }

    // First: capture
    const firstRects = new Map();
    cards.forEach(card => {
      // Ensure card is in layout for measurement (display '' if hidden previously)
      const wasHidden = card.style.display === 'none';
      if (wasHidden) {
        card.style.display = '';
        card.style.visibility = 'hidden';
      }
      firstRects.set(card, card.getBoundingClientRect());
      if (wasHidden) {
        card.style.display = 'none';
        card.style.visibility = '';
      }
    });

    // Update display
    cards.forEach(card => {
      const match = style === 'all' || card.dataset.style === style;
      card.style.display = match ? '' : 'none';
    });

    // Force layout
    grid.offsetHeight;

    // Last
    const lastRects = new Map();
    cards.forEach(card => {
      if (card.style.display !== 'none') {
        lastRects.set(card, card.getBoundingClientRect());
      }
    });

    // Invert & Play for visible cards
    cards.forEach(card => {
      if (card.style.display === 'none') {
        // Hidden: fade out already (display none, so just ensure no transform)
        card.style.willChange = '';
        return;
      }
      const first = firstRects.get(card);
      const last = lastRects.get(card);
      if (!first || !last) return;
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (dx === 0 && dy === 0) return;
      card.style.willChange = 'transform';
      const anim = card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
        { duration: 360, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'both' }
      );
      flipAnims.push(anim);
      anim.onfinish = () => { card.style.willChange = ''; };
    });

    // Hidden cards fade (optional, already display none, but we can animate opacity before hiding)
    // We handled via display none directly for simplicity; to avoid flash we already measured hidden -> visible
  }

  filters.querySelectorAll('.gallery-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      filters.querySelectorAll('.gallery-filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      applyGalleryFilter(chip.dataset.style);
    });
  });

  const likeBusy = new Set();
  grid.querySelectorAll('.gallery-card-like').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const designId = btn.dataset.id;
      if (!designId) return;
      if (likeBusy.has(designId)) return;
      likeBusy.add(designId);
      const prevDisabled = btn.disabled;
      btn.disabled = true;
      try {
        const resp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(designId)}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.success) {
          const msg = data.error || (resp.status===429 ? 'Bạn thao tác quá nhanh, thử lại sau.' : 'Không thể cập nhật lượt thích.');
          if (window.showToast) window.showToast(msg, resp.status===429 ? 'warning' : 'error');
          else console.warn('[Blankup] Like failed:', msg);
          return;
        }
        btn.classList.toggle('liked', data.liked);
        const heart = btn.querySelector('svg');
        if (heart) heart.setAttribute('fill', data.liked ? 'currentColor' : 'none');
        const label = btn.querySelector('span');
        if (label) label.textContent = data.likes;
      } catch (e) {
        console.warn('[Blankup] Like failed:', e);
        if (window.showToast) window.showToast('Không thể kết nối máy chủ. Vui lòng thử lại.', 'error');
      } finally {
        btn.disabled = prevDisabled;
        likeBusy.delete(designId);
      }
    });
  });

  grid.querySelectorAll('.gallery-card-comment').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const designId = btn.dataset.id;
      if (designId) openCommentsModal(designId, btn.dataset.count);
    });
  });
}

/* ============================================================
   COMMENTS MODAL
   ============================================================ */
const commentsState = { designId: null, list: [] };

async function openCommentsModal(designId, count) {
  const overlay = document.getElementById('commentsModal');
  const list = document.getElementById('commentsList');
  if (!overlay || !list) return;

  commentsState.designId = designId;
  const title = document.getElementById('commentsModalTitle');
  if (title) title.textContent = `Bình luận (${count || 0})`;

  const isLoggedIn = typeof auth !== 'undefined' && auth.token && auth.user?.id;
  const form = document.getElementById('commentsForm');
  const prompt = document.getElementById('commentsLoginPrompt');
  if (form) form.style.display = isLoggedIn ? '' : 'none';
  if (prompt) prompt.style.display = isLoggedIn ? 'none' : '';

  list.innerHTML = '<div class="comments-loading">Đang tải bình luận…</div>';
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const resp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(designId)}/comments`);
    const data = await resp.json();
    commentsState.list = data.data || [];
    renderCommentsList(list);
  } catch (e) {
    console.warn('[Blankup] Comments fetch failed:', e);
    list.innerHTML = '<div class="comments-empty">Không thể tải bình luận.</div>';
  }
}

function renderCommentsList(list) {
  if (!list) return;
  if (!commentsState.list.length) {
    list.innerHTML = '<div class="comments-empty">Chưa có bình luận nào. Hãy là người đầu tiên!</div>';
    return;
  }
  list.innerHTML = commentsState.list.map(c => {
    const avatar = (c.authorName || '?').charAt(0).toUpperCase();
    return `<div class="comment-item">
      <div class="comment-avatar">${escapeHtml(avatar)}</div>
      <div class="comment-body">
        <div class="comment-meta">
          ${c.authorUsername ? `<a class="comment-author" href="creator.html?user=${encodeURIComponent(c.authorUsername)}">${escapeHtml(c.authorName)}</a>` : `<span class="comment-author">${escapeHtml(c.authorName)}</span>`}
          <span class="comment-date">${formatCommentDate(c.createdAt)}</span>
        </div>
        <div class="comment-text">${escapeHtml(c.text)}</div>
      </div>
    </div>`;
  }).join('');
}

function formatCommentDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const diff = Math.floor((now - d) / 60000);
  if (diff < 1) return 'Vừa xong';
  if (diff < 60) return `${diff} phút trước`;
  if (diff < 1440) return `${Math.floor(diff / 60)} giờ trước`;
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function initCommentsModal() {
  const overlay = document.getElementById('commentsModal');
  if (!overlay) return;

  const close = () => {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };
  document.getElementById('commentsModalClose')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) close(); });

  let commentSubmitting = false;
  document.getElementById('commentsSubmitBtn')?.addEventListener('click', async () => {
    if (commentSubmitting) return;
    const btn = document.getElementById('commentsSubmitBtn');
    const input = document.getElementById('commentsInput');
    const text = (input?.value || '').trim();
    if (!text || !commentsState.designId) {
      if (window.showToast) window.showToast('Vui lòng nhập nội dung bình luận.', 'warning');
      return;
    }
    if (text.length > 500) {
      if (window.showToast) window.showToast('Bình luận tối đa 500 ký tự.', 'warning');
      return;
    }
    commentSubmitting = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi…'; }
    const headers = { 'Content-Type': 'application/json' };
    if (typeof auth !== 'undefined' && auth.token) headers.Authorization = `Bearer ${auth.token}`;

    try {
      const resp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(commentsState.designId)}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.success) throw new Error(data.error || (resp.status===429 ? 'Bạn bình luận quá nhanh, thử lại sau.' : 'Gửi bình luận thất bại'));
      commentsState.list.push(data.data);
      const list = document.getElementById('commentsList');
      renderCommentsList(list);
      if (input) input.value = '';
      const title = document.getElementById('commentsModalTitle');
      if (title) title.textContent = `Bình luận (${commentsState.list.length})`;
      document.querySelectorAll('.gallery-card-comment').forEach(b => {
        if (b.dataset.id === commentsState.designId) {
          b.dataset.count = commentsState.list.length;
          const label = b.querySelector('span');
          if (label) label.textContent = commentsState.list.length;
        }
      });
      if (window.showToast) window.showToast('Đã gửi bình luận.', 'success');
    } catch (e) {
      const list = document.getElementById('commentsList');
      if (list) list.insertAdjacentHTML('afterbegin', `<div class="comments-error">${escapeHtml(e.message)}</div>`);
      if (window.showToast) window.showToast(e.message || 'Gửi bình luận thất bại.', 'error');
    } finally {
      commentSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Gửi bình luận'; }
    }
  });
}

/* ============================================================
   COMMUNITY COMMENTS — real comments from gallery designs
   ============================================================ */
async function loadReviews() {
  const track = document.getElementById('reviewsTrack');
  const section = document.getElementById('reviews');
  if (!track || !section) return;

  let reviews = [];
  try {
    const resp = await fetch(`${API_BASE}/ai-design/gallery`);
    if (!resp.ok) throw new Error('Failed');
    const result = await resp.json();
    const designs = (result.data || []).slice(0, 8);

    for (const d of designs) {
      if (!d.commentCount) continue;
      try {
        const cResp = await fetch(`${API_BASE}/ai-design/${encodeURIComponent(d.designId)}/comments`);
        if (!cResp.ok) continue;
        const cData = await cResp.json();
        (cData.data || []).forEach(c => {
          reviews.push({
            name: c.authorName || 'Khách hàng',
            date: c.createdAt,
            text: c.text,
          });
        });
      } catch { /* */ }
      if (reviews.length >= 6) break;
    }
  } catch (e) { console.warn('[Blankup] Reviews fetch failed:', e); }

  if (!reviews.length) {
    track.innerHTML = `
      <div class="gallery-empty">
        <div class="gallery-empty-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h3>Chưa có đánh giá nào</h3>
        <p>Hãy là người đầu tiên chia sẻ cảm nhận về thiết kế của bạn.</p>
      </div>`;
    return;
  }

  const colors = ['#ff6b00', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444'];
  track.innerHTML = reviews.slice(0, 6).map((r, i) => {
    const initial = (r.name.charAt(0) || 'K').toUpperCase();
    let hue = 0;
    for (const ch of r.name) hue = (hue + ch.charCodeAt(0)) % colors.length;
    return `<div class="review-card anim-on-scroll" style="animation-delay:${i * 0.08}s">
      <p>"${escapeHtml(r.text)}"</p>
      <div class="review-author">
        <div class="review-avatar" style="background:${colors[hue]};">${escapeHtml(initial)}</div>
        <div>
          <div class="review-name">${escapeHtml(r.name)}</div>
          <div class="review-role">${formatCommentDate(r.date)}</div>
        </div>
      </div>
    </div>`;
  }).join('');
  initScrollAnimations();
}

/* ============================================================
   UTILITIES
   ============================================================ */
function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ============================================================
   i18n
   ============================================================ */
function initLang() {
  // Language switching is handled globally by i18n.js (window.i18n.init via auth.js)
  // Migrate old localStorage key used by previous versions
  const oldLang = localStorage.getItem('lang');
  if (oldLang && !localStorage.getItem('blankup_lang')) {
    localStorage.setItem('blankup_lang', oldLang === 'en' ? 'en' : 'vi');
  }
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initHeroLoad();
  initTypingAnimation();
  initHeroTilt();
  initHeroSpotlight();
  initMagneticButtons();
  initNavbar();
  initScrollAnimations();
  initLang();
  initScrollProgress();
  initHeroParallax();
  initHeroArtworkCycle();
  initCommentsModal();
  loadStats();
  loadGallery();
  loadReviews();
});
