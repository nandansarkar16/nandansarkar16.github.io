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

  links.querySelectorAll(".nav-link").forEach(function (link) {
    link.addEventListener("click", function () {
      links.classList.remove("is-open");
      toggle.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

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

  var now   = new Date();
  var year  = now.getFullYear();
  var month = now.getMonth();
  var months = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December"
  ];

  var key = "nandansarkar16-" + year + "-" + String(month + 1).padStart(2, "0");

  if (monthEl) monthEl.textContent = months[month] + " " + year;

  fetch("https://api.counterapi.dev/v1/nandansarkar16-github-io/" + key + "/up")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      countEl.textContent = (data && typeof data.count === "number")
        ? data.count.toLocaleString()
        : "—";
    })
    .catch(function () { countEl.textContent = "—"; });
}());

/* ── Profile photo mosaic: pieces assemble on hover (tap on touch) ── */
(function () {
  var box = document.getElementById("profilePhoto");
  var img = box && box.querySelector("img");
  if (!img || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var BLOCKS = 8;       // photo is first cut into BLOCKS x BLOCKS squares...
  var MAX_SPLITS = 3;   // ...then each is randomly quartered up to this many times, giving mixed piece sizes
  var SPREAD = 0.2;     // canvas margin past the photo edge, as a fraction of its size
  var REST = 0.25;      // how scattered pieces are at rest (0 = whole photo, 1 = fully spread)
  var HOLD = 3500;      // ms the photo stays whole after the cursor leaves (or after a tap)

  var canvas = document.createElement("canvas");
  canvas.className = "photo-mosaic";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var src = document.createElement("canvas");  // photo pre-scaled to display size
  var pieces = [], size, pad, dpr, assembled = false, holdTimer, last;

  // Positions are fractions of the photo size, so a resize only rescales the canvases
  function cut(x, y, s, depth) {
    if (depth < MAX_SPLITS && Math.random() < 0.75 - depth * 0.15) {
      var h = s / 2;
      cut(x, y, h, depth + 1); cut(x + h, y, h, depth + 1);
      cut(x, y + h, h, depth + 1); cut(x + h, y + h, h, depth + 1);
      return;
    }
    var r = SPREAD * REST * Math.pow(Math.random(), 2), a = Math.random() * Math.PI * 2;
    var ox = Math.cos(a) * r, oy = Math.sin(a) * r;
    pieces.push({
      hx: x, hy: y, s: s, ox: ox, oy: oy, x: x + ox, y: y + oy,
      phase: Math.random() * Math.PI * 2,
      speed: 0.05 + Math.random() * 0.07
    });
  }

  function resize() {
    size = box.offsetWidth;
    pad = size * SPREAD;
    dpr = window.devicePixelRatio || 1;
    var full = size + pad * 2;
    canvas.style.width = canvas.style.height = full + "px";
    canvas.style.left = canvas.style.top = -pad + "px";
    canvas.width = canvas.height = Math.round(full * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    src.width = src.height = Math.round(size * dpr);
    src.getContext("2d").drawImage(img, 0, 0, src.width, src.height);
  }

  function frame(t) {
    var dt = Math.min(t - (last || t), 100) / 16.7;  // frames elapsed at 60fps, so speed is refresh-rate independent
    last = t;
    var S = src.width, settled = assembled;
    ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i], tx = p.hx, ty = p.hy;
      if (!assembled) {
        tx += p.ox + Math.sin(t / 900 + p.phase) * 0.008;
        ty += p.oy + Math.cos(t / 1100 + p.phase) * 0.008;
      }
      var k = 1 - Math.pow(1 - p.speed, dt);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      if (Math.abs(p.x - p.hx) + Math.abs(p.y - p.hy) > 0.002) settled = false;
      ctx.drawImage(src, p.hx * S, p.hy * S, p.s * S, p.s * S,
                    pad + p.x * size, pad + p.y * size, p.s * size, p.s * size);
    }
    // Once every piece is home, draw the photo whole so no seams show between pieces
    if (settled) {
      ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
      ctx.drawImage(src, pad, pad, size, size);
    }
    requestAnimationFrame(frame);
  }

  function assemble() { clearTimeout(holdTimer); assembled = true; }
  function scatterLater() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { assembled = false; }, HOLD);
  }

  function start() {
    for (var y = 0; y < BLOCKS; y++)
      for (var x = 0; x < BLOCKS; x++) cut(x / BLOCKS, y / BLOCKS, 1 / BLOCKS, 0);
    resize();
    box.appendChild(canvas);
    box.classList.add("is-mosaic");
    requestAnimationFrame(frame);

    box.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") assemble(); });
    box.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") scatterLater(); });
    box.addEventListener("pointerup", function (e) {
      if (e.pointerType === "mouse") return;
      assemble();
      scatterLater();
    });
    window.addEventListener("resize", function () { if (box.offsetWidth !== size) resize(); });
  }

  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start);
}());
