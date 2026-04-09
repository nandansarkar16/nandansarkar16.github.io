/* =============================================================
   custom.js — nandansarkar16.github.io
   ============================================================= */

/* ── Mobile navigation ── */
(function () {
  var toggle = document.getElementById("navToggle");
  var links  = document.getElementById("navLinks");
  if (!toggle || !links) return;

  toggle.addEventListener("click", function () {
    var isOpen = links.classList.toggle("is-open");
    toggle.classList.toggle("open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  /* Close drawer when a link is tapped */
  links.querySelectorAll(".nav-link").forEach(function (link) {
    link.addEventListener("click", function () {
      links.classList.remove("is-open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  /* Close drawer on outside click */
  document.addEventListener("click", function (e) {
    if (!toggle.contains(e.target) && !links.contains(e.target)) {
      links.classList.remove("is-open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}());

/* ── Footer year ── */
(function () {
  var el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}());

/* ── Monthly visitor counter via CounterAPI ── */
(function () {
  var countEl = document.getElementById("visitor-count");
  var monthEl = document.getElementById("visitor-month-label");
  if (!countEl) return;

  var now    = new Date();
  var year   = now.getFullYear();
  var month  = now.getMonth();
  var months = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December"
  ];

  /* One distinct counter key per calendar month */
  var key = "nandansarkar16-" + year + "-" + String(month + 1).padStart(2, "0");

  if (monthEl) {
    monthEl.textContent = months[month] + " " + year;
  }

  /*
   * counterapi.dev — free, no sign-up, increments on every call.
   * Namespace: "nandansarkar16-github-io" (unique to this site).
   */
  fetch("https://api.counterapi.dev/v1/nandansarkar16-github-io/" + key + "/up")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data && typeof data.count === "number") {
        countEl.textContent = data.count.toLocaleString();
      } else {
        countEl.textContent = "—";
      }
    })
    .catch(function () {
      countEl.textContent = "—";
    });
}());

/* ── X / Twitter timeline (widgets.js must load after DOM; async tag was racing) ── */
(function () {
  var wrap = document.getElementById("twitterTimelineWrap");
  if (!wrap) return;

  var failEl = document.getElementById("twitterEmbedFail");
  var shownFail = false;

  function showFail() {
    if (shownFail || !failEl) return;
    shownFail = true;
    failEl.hidden = false;
  }

  var s = document.createElement("script");
  s.src = "https://platform.twitter.com/widgets.js";
  s.charset = "utf-8";
  s.async = true;
  s.onerror = showFail;

  s.onload = function () {
    var n = 0;
    function boot() {
      if (window.twttr && typeof window.twttr.ready === "function") {
        window.twttr.ready(function (twttr) {
          try {
            twttr.widgets.load(wrap);
          } catch (e) {
            showFail();
          }
        });
        return;
      }
      n += 1;
      if (n < 200) setTimeout(boot, 25);
      else showFail();
    }
    boot();
  };

  document.body.appendChild(s);

  var obs = new MutationObserver(function () {
    if (wrap.querySelector("iframe") && failEl) {
      failEl.hidden = true;
      obs.disconnect();
    }
  });
  obs.observe(wrap, { childList: true, subtree: true });

  /* If X never injects an iframe (API / network / “login to view” in some regions), show fallback */
  setTimeout(function () {
    if (!wrap.querySelector("iframe")) showFail();
    obs.disconnect();
  }, 18000);
}());
