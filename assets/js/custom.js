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
