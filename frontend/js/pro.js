/* frontend/js/pro.js — BLANKUP PRO motion layer (additive over motion.js).
   - Gold scroll-progress hairline at the top of the viewport.
   - Nav "scrolled" state (glass shadow + gold hairline).
   - Auto stagger indices for reveal grids ([data-stagger] or known grids).
   No layout writes. Transform/opacity/CSS-vars only. Honors reduced motion. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. Scroll progress hairline ---------- */
  function initProgress() {
    if (reduceMotion) return;
    var bar = document.createElement('div');
    bar.className = 'pro-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    var last = -1;
    function frame() {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      if (p !== last) {
        last = p;
        bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      }
    }
    // Scroll events coalesce to frame rate; the handler is a single transform
    // write, so a direct call is cheaper than scheduling a rAF (which never
    // fires in hidden tabs and would freeze the bar in background loads).
    window.addEventListener('scroll', frame, { passive: true });
    window.addEventListener('resize', frame, { passive: true });
    frame();
  }

  /* ---------- 2. Nav scrolled state ---------- */
  function initNavScrolled() {
    if (reduceMotion) return;
    function update() {
      var on = window.scrollY > 24;
      var nav = document.querySelector('.nav');
      if (nav) nav.classList.toggle('scrolled', on);
      if (on) document.body.setAttribute('data-scrolled', 'true');
      else document.body.removeAttribute('data-scrolled');
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ---------- 3. 3D tilt — removed (reads as AI-portfolio flourish).
      Cards keep the quiet hover lift from pro.css section 5. ---------- */
  function initTilt() { /* removed — quiet design */ }

  /* ---------- 4. Stagger indices for reveal grids ---------- */
  var STAGGER_GRIDS = [
    '.steps-grid',
    '.products-grid',
    '.gallery-grid',
    '.pricing-grid',
    '.collections-grid',
    '.stats-row',
    '.hero-stats'
  ];
  function initStagger() {
    if (reduceMotion) return;
    STAGGER_GRIDS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (grid) {
        Array.prototype.forEach.call(grid.children, function (child, i) {
          child.style.setProperty('--pro-stagger-i', String(i % 8));
        });
      });
    });
  }

  function init() {
    initProgress();
    initNavScrolled();
    initTilt();
    initStagger();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
