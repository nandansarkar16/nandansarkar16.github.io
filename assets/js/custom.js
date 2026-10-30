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

/* ── Profile photo jigsaw puzzle: drag pieces into the frame, or Solve / Shuffle ── */
(function () {
  var box = document.getElementById("profilePhoto");
  var img = box && box.querySelector("img");
  if (!img || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var GRID = 6;         // pieces per side
  var DRIFT = 0.35;     // max floating speed, px per frame
  var SNAP = 0.4;       // a piece snaps home when dropped within this fraction of a piece of its spot
  var GAP = 12;         // px kept between floating pieces and the page content

  // Benchmark mode (?bench&seed=N): pieces don't move, the layout is the same every run, no Solve button
  var params = new URLSearchParams(location.search);
  var BENCH = params.has("bench");
  var rand = BENCH ? seeded(parseInt(params.get("seed"), 10) || 1) : Math.random;
  function seeded(s) {  // mulberry32
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var frame = document.createElement("div");  // wooden frame the photo sits in
  frame.className = "puzzle-frame";
  var controls = document.createElement("div");
  controls.className = "puzzle-controls";
  controls.innerHTML = '<button type="button" data-act="solve">Solve</button>' +
                       '<button type="button" data-act="shuffle">Shuffle</button>' +
                       '<span class="puzzle-timer"></span>';
  var timer = controls.querySelector(".puzzle-timer");
  var src = document.createElement("canvas");  // photo pre-scaled to display size, with a margin for tabs
  var pieces = [], size, cell, tab, m, dpr, zones = [], last;
  var run = null;  // the current timed attempt: { start, moves, assisted }

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

  // Draw each piece into its own canvas: photo clipped to the jigsaw outline
  function render() {
    size = img.offsetWidth;
    cell = size / GRID;
    dpr = window.devicePixelRatio || 1;
    m = Math.ceil(cell * 0.3 * dpr) / dpr;  // room for tabs around each piece
    var mp = m * dpr, cp = cell * dpr, w = Math.ceil(cp + mp * 2);
    src.width = src.height = Math.round(size * dpr + mp * 2);
    src.getContext("2d").drawImage(img, mp, mp, size * dpr, size * dpr);
    pieces.forEach(function (p) {
      var c = p.el.getContext("2d");
      p.el.width = p.el.height = w;
      p.el.style.width = p.el.style.height = w / dpr + "px";
      c.beginPath();
      c.moveTo(mp, mp);
      edge(c, mp, mp, mp + cp, mp, p.top);
      edge(c, mp + cp, mp, mp + cp, mp + cp, p.right);
      edge(c, mp + cp, mp + cp, mp, mp + cp, p.bottom);
      edge(c, mp, mp + cp, mp, mp, p.left);
      c.closePath();
      c.save();
      c.clip();
      c.drawImage(src, p.col * cp, p.row * cp, w, w, 0, 0, w, w);
      c.restore();
      c.strokeStyle = "rgba(255, 255, 255, 0.55)";
      c.lineWidth = dpr;
      c.stroke();
    });
  }

  // Where floating pieces may roam (page coordinates of a piece's top-left corner):
  // the empty side margins, or when there are none (phones) the space beside the frame
  function findZones() {
    var page = document.documentElement.clientWidth;
    var content = box.closest(".container").getBoundingClientRect();
    var text = box.parentNode.querySelector(".profile-content").getBoundingClientRect();
    var f = frame.getBoundingClientRect();
    var top = document.querySelector(".site-header").offsetHeight + GAP;
    var bottom = Math.max(top + 200, window.innerHeight - GAP) - cell;
    var g = GAP + m + (cell + m * 2) * 0.21;  // clearance for the tabs and a rotated piece's corners
    function fits(z) { return z[1] >= z[0]; }
    zones = [[g, content.left - g - cell], [content.right + g, page - g - cell]].filter(fits);
    if (!zones.length) {
      top = f.top + window.scrollY;
      bottom = f.bottom + window.scrollY - cell;
      zones = [[g, f.left - g - cell], [f.right + g, page - g - cell]].filter(function (z) {
        var tTop = text.top + window.scrollY, tBottom = text.bottom + window.scrollY;  // never over the bio text
        return fits(z) && (z[1] + cell < text.left || z[0] > text.right || bottom + cell < tTop || top > tBottom);
      });
    }
    zones = zones.map(function (z) { return { x0: z[0], x1: z[1], y0: top, y1: bottom }; });
    if (!zones.length) {  // nowhere to the side: hover just around the frame
      zones = [{ x0: f.left - cell, x1: f.right, y0: f.top + window.scrollY - cell, y1: f.bottom + window.scrollY }];
    }
  }

  function home(p) {
    var r = img.getBoundingClientRect();
    return { x: r.left + window.scrollX + p.col * cell, y: r.top + window.scrollY + p.row * cell };
  }

  // Benchmark layout: a shuffled grid of slots in the floating areas, so no piece hides another
  function benchSlots() {
    var step = cell + m * 2 + 6, slots = [];
    zones.forEach(function (z) {
      for (var y = z.y0; y <= z.y1; y += step)
        for (var x = z.x0; x <= z.x1; x += step) slots.push([x, y]);
    });
    for (var i = slots.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), t = slots[i];
      slots[i] = slots[j]; slots[j] = t;
    }
    return slots.length >= pieces.length ? slots : null;
  }

  // Send every piece flying to a random spot in its own floating area
  function shuffle() {
    var slots = BENCH && benchSlots();
    pieces.forEach(function (p, i) {
      var z = p.zone();
      p.state = "scattering";
      p.tx = z.x0 + rand() * (z.x1 - z.x0);
      p.ty = z.y0 + rand() * (z.y1 - z.y0);
      p.ta = BENCH ? 0 : (rand() * 2 - 1) * 0.5;
      if (slots) { p.tx = slots[i][0]; p.ty = slots[i][1]; }
      if (BENCH) { p.state = "floating"; p.x = p.tx; p.y = p.ty; p.a = 0; }
      p.el.classList.remove("is-placed");
    });
    run = { start: performance.now(), moves: 0, assisted: false };
    document.dispatchEvent(new CustomEvent("puzzle:start"));
  }

  function fmt(ms) {
    var sec = ms / 1000;
    return sec < 60 ? sec.toFixed(1) + "s" : Math.floor(sec / 60) + ":" + ("0" + (sec % 60).toFixed(1)).slice(-4);
  }

  function solve() {
    pieces.forEach(function (p) {
      if (p.state !== "placed") p.state = "flying";
    });
    if (run) run.assisted = true;
  }

  function tick(t) {
    var dt = Math.min(t - (last || t), 100) / 16.7;  // frames elapsed at 60fps, so speed is refresh-rate independent
    last = t;
    var k = 1 - Math.pow(0.88, dt), done = true;
    pieces.forEach(function (p) {
      var h = home(p);
      if (p.state === "placed") { p.x = h.x; p.y = h.y; p.a = 0; }
      else done = false;
      if (p.state === "flying") {  // heading home
        p.x += (h.x - p.x) * k; p.y += (h.y - p.y) * k; p.a += (0 - p.a) * k;
        if (Math.abs(h.x - p.x) + Math.abs(h.y - p.y) < 0.5) {
          p.state = "placed";
          p.el.classList.add("is-placed");
        }
      } else if (p.state === "scattering") {
        p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.a += (p.ta - p.a) * k;
        if (Math.abs(p.tx - p.x) + Math.abs(p.ty - p.y) < 0.5) p.state = "floating";
      } else if (p.state === "floating" && !BENCH) {
        var z = p.zone(), wob = Math.sin(t / 2000 + p.phase) * 0.02;
        p.x += p.vx * dt; p.y += p.vy * dt; p.a += (p.va + wob * 0.01) * dt;
        if (p.x < z.x0 || p.x > z.x1) { p.vx = Math.abs(p.vx) * (p.x < z.x0 ? 1 : -1); p.x = Math.min(Math.max(p.x, z.x0), z.x1); }
        if (p.y < z.y0 || p.y > z.y1) { p.vy = Math.abs(p.vy) * (p.y < z.y0 ? 1 : -1); p.y = Math.min(Math.max(p.y, z.y0), z.y1); }
      } else if (p.state === "dragging") {
        p.a += (0 - p.a) * k;
      }
      p.el.style.transform = "translate(" + (p.x - m) + "px," + (p.y - m) + "px) rotate(" + p.a + "rad)";
    });
    // Once every piece is home, show the real photo so no seams or outlines remain
    box.classList.toggle("is-solved", done);
    document.body.classList.toggle("puzzle-solved", done);
    if (run) {
      var ms = performance.now() - run.start;
      timer.textContent = run.assisted ? "" : fmt(ms);
      if (done) {
        document.dispatchEvent(new CustomEvent("puzzle:solved", { detail: { ms: Math.round(ms), moves: run.moves, assisted: run.assisted } }));
        run = null;
      }
    }
    requestAnimationFrame(tick);
  }

  function drag(p, e) {
    if (p.state === "placed") return;
    e.preventDefault();
    var ox = e.pageX - p.x, oy = e.pageY - p.y;
    p.state = "dragging";
    p.el.classList.add("is-dragging");
    p.el.setPointerCapture(e.pointerId);
    function move(ev) { p.x = ev.pageX - ox; p.y = ev.pageY - oy; }
    function drop() {
      p.el.removeEventListener("pointermove", move);
      p.el.removeEventListener("pointerup", drop);
      p.el.removeEventListener("pointercancel", drop);
      p.el.classList.remove("is-dragging");
      if (run) run.moves++;
      var h = home(p);
      if (Math.abs(p.x - h.x) < cell * SNAP && Math.abs(p.y - h.y) < cell * SNAP) {
        p.state = "flying";
      } else {
        p.state = "parked";  // stays where it was dropped until picked up again
      }
    }
    p.el.addEventListener("pointermove", move);
    p.el.addEventListener("pointerup", drop);
    p.el.addEventListener("pointercancel", drop);
  }

  function start() {
    img.parentNode.insertBefore(frame, img);
    frame.appendChild(img);
    if (!BENCH) frame.after(controls);
    box.classList.add("is-puzzle");

    // Each inner edge gets a random tab direction; neighbours share it with opposite sign
    var flipH = [], flipV = [];
    for (var i = 0; i < GRID * GRID; i++) {
      flipH.push(rand() < 0.5 ? 1 : -1);
      flipV.push(rand() < 0.5 ? 1 : -1);
    }
    for (var row = 0; row < GRID; row++) {
      for (var col = 0; col < GRID; col++) {
        var el = document.createElement("canvas"), a = rand() * Math.PI * 2, sp = DRIFT * (0.4 + rand() * 0.6);
        el.className = "puzzle-piece";
        el.setAttribute("aria-hidden", "true");
        var p = {
          el: el, col: col, row: row, state: "placed", x: 0, y: 0, a: 0,
          top:    row === 0 ? 0 : -flipH[(row - 1) * GRID + col],
          bottom: row === GRID - 1 ? 0 : flipH[row * GRID + col],
          left:   col === 0 ? 0 : -flipV[row * GRID + col - 1],
          right:  col === GRID - 1 ? 0 : flipV[row * GRID + col],
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, va: (rand() * 2 - 1) * 0.004,
          phase: rand() * Math.PI * 2, zi: rand()
        };
        p.zone = function () { return zones[Math.floor(this.zi * zones.length)]; };
        el.addEventListener("pointerdown", drag.bind(null, p));
        document.body.appendChild(el);
        pieces.push(p);
      }
    }
    render();
    findZones();
    pieces.forEach(function (p) { var h = home(p); p.x = h.x; p.y = h.y; });
    requestAnimationFrame(tick);
    if (BENCH) shuffle();
    else setTimeout(shuffle, 600);  // show the whole photo briefly, then break apart

    // Read-only status for the leaderboard and the agent benchmark harness
    window.puzzle = {
      status: function () {
        var placed = pieces.filter(function (p) { return p.state === "placed"; }).length;
        return { total: pieces.length, placed: placed, solved: placed === pieces.length,
                 map: pieces.map(function (p) { return p.state === "placed"; }) };  // row by row from the top-left
      }
    };
    if (BENCH) {  // piece centers in viewport coordinates, used only by the harness's scripted "oracle" solver
      window.puzzle.pieces = function () {
        return pieces.map(function (p) {
          var h = home(p);
          return { x: p.x + cell / 2 - scrollX, y: p.y + cell / 2 - scrollY,
                   hx: h.x + cell / 2 - scrollX, hy: h.y + cell / 2 - scrollY, placed: p.state === "placed" };
        });
      };
    }

    controls.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "solve") solve();
      if (act === "shuffle") shuffle();
    });
    window.addEventListener("resize", function () {
      if (img.offsetWidth !== size) render();
      findZones();
      pieces.forEach(function (p) {
        if (p.state === "floating") {
          var z = p.zone();
          p.x = Math.min(Math.max(p.x, z.x0), z.x1);
          p.y = Math.min(Math.max(p.y, z.y0), z.y1);
        }
      });
    });
  }

  if (img.complete && img.naturalWidth) start();
  else img.addEventListener("load", start);
}());
