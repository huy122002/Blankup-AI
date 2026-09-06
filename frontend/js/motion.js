/* frontend/js/motion.js — shared cinematic motion layer (additive only).
   - Gold trailing ring (desktop + fine pointer + no reduced-motion only).
     Never hides the native cursor; pointer-events none; transform-only rAF.
   - IntersectionObserver reveals for `.rv` (adds .in-view once).
   - Magnetic pull for `.magnetic` (transform only, spring release).
   - Char split for `[data-split]` headlines (spans animate via CSS var --i).
   No scroll listeners. No interference with page scripts. */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var desktop = window.matchMedia('(min-width: 768px)').matches;

  /* ---------- Cursor ring ---------- */
  function initCursorRing() {
    if (reduceMotion || !finePointer || !desktop) return;
    if (document.querySelector('.bk-cursor-ring')) return;
    var ring = document.createElement('div');
    ring.className = 'bk-cursor-ring';
    ring.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ring);

    var mx = -100, my = -100, cx = -100, cy = -100, on = false, raf = 0, primed = false;
    function frame() {
      cx += (mx - cx) * 0.2;
      cy += (my - cy) * 0.2;
      var half = ring.classList.contains('is-hot') ? 26 : 7;
      ring.style.transform = 'translate3d(' + (cx - half) + 'px,' + (cy - half) + 'px,0)';
      if (on && (Math.abs(mx - cx) > 0.3 || Math.abs(my - cy) > 0.3)) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = 0;
      }
    }
    function kick() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    document.addEventListener('mousemove', function (e) {
      mx = e.clientX; my = e.clientY;
      if (!primed) { primed = true; cx = mx; cy = my; }
      if (!on) { on = true; ring.classList.add('is-on'); }
      kick();
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
      on = false; ring.classList.remove('is-on');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && raf) { cancelAnimationFrame(raf); raf = 0; }
    });
    // Grow over interactive elements (event delegation — works for dynamic DOM)
    document.addEventListener('mouseover', function (e) {
      var hot = e.target.closest
        ? e.target.closest('a, button, summary, input, textarea, select, .gallery-card, .collection-card, .feature-card')
        : null;
      ring.classList.toggle('is-hot', !!hot);
    });
  }

  /* ---------- Scroll reveals ---------- */
  var revealObserver = null;
  function initReveals() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.rv').forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    observeReveals(document);
    // Pick up dynamically injected .rv nodes (gallery cards, etc.)
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType !== 1) return;
            if (node.matches && node.matches('.rv:not(.in-view)')) revealObserver.observe(node);
            if (node.querySelectorAll) observeReveals(node);
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }
  function observeReveals(root) {
    root.querySelectorAll('.rv:not(.in-view)').forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /* ---------- Magnetic pull (single delegated listener — also covers
     dynamically injected .magnetic nodes, no per-element bindings) ---------- */
  function initMagnetic() {
    if (reduceMotion || !finePointer) return;
    var current = null;
    document.addEventListener('mousemove', function (e) {
      var el = e.target.closest ? e.target.closest('.magnetic') : null;
      if (el !== current) {
        if (current) current.style.transform = '';
        current = el;
      }
      if (!el) return;
      var r = el.getBoundingClientRect();
      var dx = (e.clientX - r.left - r.width / 2) * 0.14;
      var dy = (e.clientY - r.top - r.height / 2) * 0.14;
      el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }, { passive: true });
    document.addEventListener('mouseleave', function () {
      if (current) { current.style.transform = ''; current = null; }
    });
    // Touch safety: never leave a stuck transform after tap
    document.addEventListener('touchend', function () {
      if (current) { current.style.transform = ''; current = null; }
    }, { passive: true });
  }

  /* ---------- Card pointer spotlight (one delegated listener; desktop only).
     Cards opt in by matching .gallery-card / .pricing-card / .stat-card.
     Transform-free: only CSS vars + opacity. Mobile untouched. ---------- */
  function initSpotlight() {
    if (reduceMotion || !finePointer) return;
    var current = null;
    document.addEventListener('mousemove', function (e) {
      var el = e.target.closest
        ? e.target.closest('.gallery-card, .pricing-card, .stat-card')
        : null;
      if (el !== current) {
        if (current) {
          current.style.removeProperty('--spot-x');
          current.style.removeProperty('--spot-y');
        }
        current = el;
      }
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', ((e.clientX - r.left)).toFixed(1) + 'px');
      el.style.setProperty('--spot-y', ((e.clientY - r.top)).toFixed(1) + 'px');
    }, { passive: true });
    document.addEventListener('mouseleave', function () { current = null; });
  }

  /* ---------- Char split for display headlines ---------- */
  function initSplit() {
    if (reduceMotion) return;
    var els = document.querySelectorAll('[data-split]');
    if (!els.length) return;
    els.forEach(function (el) {
      if (el.dataset.splitDone) return;
      el.dataset.splitDone = '1';
      var text = el.textContent;
      el.textContent = '';
      el.setAttribute('aria-label', text);
      var idx = 0;
      // Group chars into nowrap words so lines break at spaces, never mid-word
      // (critical for Vietnamese multi-syllable words).
      text.split(' ').forEach(function (word, wi, arr) {
        var w = document.createElement('span');
        w.className = 'bk-word';
        w.setAttribute('aria-hidden', 'true');
        Array.from(word).forEach(function (ch) {
          var s = document.createElement('span');
          s.className = 'bk-char';
          s.style.setProperty('--i', idx++);
          s.textContent = ch;
          w.appendChild(s);
        });
        el.appendChild(w);
        if (wi < arr.length - 1) el.appendChild(document.createTextNode(' '));
      });
    });
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in-view'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    els.forEach(function (el) { io.observe(el); });
  }

  function init() {
    initCursorRing();
    initReveals();
    initMagnetic();
    initSpotlight();
    initSplit();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
