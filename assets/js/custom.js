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

/* ── Profile photo jigsaw: pieces assemble on hover (tap on touch) ── */
(function () {
  var box = document.getElementById("profilePhoto");
  var img = box && box.querySelector("img");
  if (!img || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var GRID = 6;         // pieces per side
  var SPREAD = 0.2;     // canvas margin past the photo edge, as a fraction of its size
  var REST = 0.5;       // how scattered pieces are at rest (0 = whole photo, 1 = fully spread)
  var TILT = 0.4;       // max rotation of a piece at rest, in radians
  var HOLD = 3500;      // ms the photo stays whole after the cursor leaves (or after a tap)

  var canvas = document.createElement("canvas");
  canvas.className = "photo-mosaic";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d");
  var src = document.createElement("canvas");  // photo pre-scaled to display size, with a margin for tabs
  var pieces = [], size, pad, tab, dpr, assembled = false, holdTimer, last;

  // One side of a piece from (x0,y0) to (x1,y1); sign 1 = tab out, -1 = tab in, 0 = flat border
  var CURVE = [[0.35, 0, 0.40, 0, 0.42, 0.05, 0.38, 0.12], [0.33, 0.22, 0.42, 0.28, 0.50, 0.28],
               [0.58, 0.28, 0.67, 0.22, 0.62, 0.12], [0.58, 0.05, 0.60, 0, 0.65, 0]];
  function edge(c, x0, y0, x1, y1, sign) {
    var dx = x1 - x0, dy = y1 - y0;
    function pt(u, v) { return [x0 + dx * u + dy * v * sign, y0 + dy * u - dx * v * sign]; }
    if (sign) {
      var a = pt(CURVE[0][0], CURVE[0][1]);
      c.lineTo(a[0], a[1]);
      for (var i = 0; i < 4; i++) {
        var q = CURVE[i], o = i ? 0 : 2, p1 = pt(q[o], q[o + 1]), p2 = pt(q[o + 2], q[o + 3]), p3 = pt(q[o + 4], q[o + 5]);
        c.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
      }
    }
    c.lineTo(x1, y1);
  }

  // Render each piece once into its own small canvas: photo clipped to the jigsaw outline
  function renderPieces() {
    var cell = size / GRID * dpr, m = Math.ceil(tab * dpr), w = Math.ceil(cell + m * 2);
    pieces.forEach(function (p) {
      var pc = p.canvas || (p.canvas = document.createElement("canvas")), c = pc.getContext("2d");
      pc.width = pc.height = w;
      c.beginPath();
      c.moveTo(m, m);
      edge(c, m, m, m + cell, m, p.top);
      edge(c, m + cell, m, m + cell, m + cell, p.right);
      edge(c, m + cell, m + cell, m, m + cell, p.bottom);
      edge(c, m, m + cell, m, m, p.left);
      c.closePath();
      c.save();
      c.clip();
      c.drawImage(src, p.col * cell, p.row * cell, w, w, 0, 0, w, w);
      c.restore();
      c.strokeStyle = "rgba(255, 255, 255, 0.55)";
      c.lineWidth = dpr;
      c.stroke();
    });
  }

  function resize() {
    size = box.offsetWidth;
    pad = size * SPREAD;
    tab = size / GRID * 0.3;
    dpr = window.devicePixelRatio || 1;
    var full = size + pad * 2;
    canvas.style.width = canvas.style.height = full + "px";
    canvas.style.left = canvas.style.top = -pad + "px";
    canvas.width = canvas.height = Math.round(full * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var m = Math.ceil(tab * dpr);
    src.width = src.height = Math.round(size * dpr) + m * 2;
    src.getContext("2d").drawImage(img, m, m, Math.round(size * dpr), Math.round(size * dpr));
    renderPieces();
  }

  function frame(t) {
    var dt = Math.min(t - (last || t), 100) / 16.7;  // frames elapsed at 60fps, so speed is refresh-rate independent
    last = t;
    var cell = size / GRID, m = Math.ceil(tab * dpr) / dpr, settled = assembled;
    ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i], tx = 0, ty = 0, ta = 0;
      if (!assembled) {
        tx = p.ox + Math.sin(t / 900 + p.phase) * 0.008;
        ty = p.oy + Math.cos(t / 1100 + p.phase) * 0.008;
        ta = p.oa;
      }
      var k = 1 - Math.pow(1 - p.speed, dt);
      p.x += (tx - p.x) * k;
      p.y += (ty - p.y) * k;
      p.a += (ta - p.a) * k;
      if (Math.abs(p.x) + Math.abs(p.y) > 0.002 || Math.abs(p.a) > 0.005) settled = false;
      ctx.save();
      ctx.translate(pad + (p.col / GRID + p.x) * size + cell / 2, pad + (p.row / GRID + p.y) * size + cell / 2);
      ctx.rotate(p.a);
      ctx.drawImage(p.canvas, -cell / 2 - m, -cell / 2 - m, p.canvas.width / dpr, p.canvas.height / dpr);
      ctx.restore();
    }
    // Once every piece is home, draw the photo whole so no seams or outlines show
    if (settled) {
      ctx.clearRect(0, 0, size + pad * 2, size + pad * 2);
      ctx.drawImage(src, Math.ceil(tab * dpr), Math.ceil(tab * dpr), Math.round(size * dpr), Math.round(size * dpr),
                    pad, pad, size, size);
    }
    requestAnimationFrame(frame);
  }

  function assemble() { clearTimeout(holdTimer); assembled = true; }
  function scatterLater() {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () { assembled = false; }, HOLD);
  }

  function start() {
    // Each inner edge gets a random tab direction; neighbours share it with opposite sign
    var flipH = [], flipV = [];
    for (var i = 0; i < GRID * GRID; i++) {
      flipH.push(Math.random() < 0.5 ? 1 : -1);
      flipV.push(Math.random() < 0.5 ? 1 : -1);
    }
    for (var row = 0; row < GRID; row++) {
      for (var col = 0; col < GRID; col++) {
        var r = SPREAD * REST * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
        var ox = Math.cos(a) * r, oy = Math.sin(a) * r, oa = (Math.random() * 2 - 1) * TILT;
        pieces.push({
          col: col, row: row,
          top:    row === 0 ? 0 : -flipH[(row - 1) * GRID + col],
          bottom: row === GRID - 1 ? 0 : flipH[row * GRID + col],
          left:   col === 0 ? 0 : -flipV[row * GRID + col - 1],
          right:  col === GRID - 1 ? 0 : flipV[row * GRID + col],
          ox: ox, oy: oy, oa: oa, x: ox, y: oy, a: oa,
          phase: Math.random() * Math.PI * 2,
          speed: 0.05 + Math.random() * 0.07
        });
      }
    }
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
