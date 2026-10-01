/*
 * nav-burger.js — mobile menu toggle for pages WITHOUT home.js
 * (login/register). Mirrors the home.js behavior on index.html:
 * toggles .open on #navMenu and .active on the burger button.
 * Only include this on pages that do not load home.js, otherwise
 * the click handler would be bound twice and cancel itself out.
 */
(function () {
  "use strict";

  function init() {
    var burger = document.getElementById("navToggle");
    var menu = document.getElementById("navMenu");
    if (!burger || !menu) return;

    burger.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      burger.classList.toggle("active", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // Close the menu after choosing a nav link (mobile view)
    menu.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".nav-link")) {
        menu.classList.remove("open");
        burger.classList.remove("active");
        burger.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
