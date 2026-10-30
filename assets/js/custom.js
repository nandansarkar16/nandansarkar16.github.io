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

  var GRID = 50;          // pieces per side
  var SPREAD = 0.2;       // how far pieces drift past the photo edge, as a fraction of its size
  var REST = 0.25;        // how scattered pieces are at rest (0 = whole photo, 1 = fully spread)
  var LEAVE_DELAY = 400;  // ms before pieces start breaking up again

  var canvas = document.createElement("canvas");
  canvas.className = "photo-mosaic";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var pieces = [], size, pad, assembled = false, leaveTimer, last;

  function setup() {
    size = box.offsetWidth;
    pad = size * SPREAD;
    var full = size + pad * 2, dpr = window.devicePixelRatio || 1;
    canvas.style.width = canvas.style.height = full + "px";
    canvas.style.left = canvas.style.top = -pad + "px";
    canvas.width = canvas.height = Math.round(full * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Average the photo down to one color per piece
    var sample = document.createElement("canvas");
    sample.width = sample.height = GRID;
    var sctx = sample.getContext("2d");
    sctx.drawImage(img, 0, 0, GRID, GRID);
    var data = sctx.getImageData(0, 0, GRID, GRID).data;

    var cell = size / GRID, old = pieces;
    pieces = [];
    for (var i = 0; i < GRID * GRID; i++) {
      var r = pad * REST * Math.pow(Math.random(), 2), a = Math.random() * Math.PI * 2;
      var p = {
        hx: pad + (i % GRID) * cell, hy: pad + Math.floor(i / GRID) * cell,
        ox: Math.cos(a) * r, oy: Math.sin(a) * r,
        phase: Math.random() * Math.PI * 2,
        speed: 0.06 + Math.random() * 0.08,
        color: "rgb(" + data[i * 4] + "," + data[i * 4 + 1] + "," + data[i * 4 + 2] + ")"
      };
      p.x = old[i] ? old[i].x * size / old[i].size : p.hx + p.ox;
      p.y = old[i] ? old[i].y * size / old[i].size : p.hy + p.oy;
      p.size = size;
      pieces.push(p);
    }
  }

  function frame(t) {
    var dt = Math.min(t - (last || t), 100) / 16.7;  // frames elapsed at 60fps, so speed is refresh-rate independent
    last = t;
    var cell = size / GRID, draw = cell - Math.max(0.6, cell * 0.15);
    ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i], tx = p.hx, ty = p.hy;
      if (!assembled) {
        tx += p.ox + Math.sin(t / 900 + p.phase) * 1.5;
        ty += p.oy + Math.cos(t / 1100 + p.phase) * 1.5;
      }
      var k = 1 - Math.pow(1 - p.speed, dt);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, draw, draw);
    }
    requestAnimationFrame(frame);
  }

  function assemble() { clearTimeout(leaveTimer); assembled = true; }
  function scatter()  { leaveTimer = setTimeout(function () { assembled = false; }, LEAVE_DELAY); }

  function start() {
    setup();
    box.appendChild(canvas);
    box.classList.add("is-mosaic");
    requestAnimationFrame(frame);

    box.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") assemble(); });
    box.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") scatter(); });
    box.addEventListener("pointerup", function (e) {
      if (e.pointerType === "mouse") return;
      clearTimeout(leaveTimer);
      assembled = !assembled;
    });
    window.addEventListener("resize", function () { if (box.offsetWidth !== size) setup(); });
  }

  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start);
}());
