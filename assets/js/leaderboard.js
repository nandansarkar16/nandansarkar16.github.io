/* =============================================================
   leaderboard.js — puzzle races and the leaderboard under the photo
   ============================================================= */
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
// Brand-colored logos, falling back to an older Simple Icons release (it still has OpenAI's), then a letter
const LOGOS = ["https://cdn.simpleicons.org/", "https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/"];
const PHOTO = "/images/profile.png";
const board = document.getElementById("leaderboard");
const box = document.getElementById("profilePhoto");
// Accounts that can delete leaderboard entries; firestore.rules has the same list
const ADMINS = ["ns7143@nyu.edu", "nandan.sarkar@yale.edu", "nsarkar616@gmail.com"];

function fmt(ms) {
  const sec = ms / 1000;
  return sec < 60 ? sec.toFixed(1) + "s" : Math.floor(sec / 60) + ":" + ("0" + (sec % 60).toFixed(1)).slice(-4);
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, v));
  children.forEach((c) => node.append(c));
  return node;
}

/* ── Leaderboard tabs ── */
if (board) {
  board.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      board.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      board.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });
}

let refreshHumans = () => {}, refreshAgents = () => {};
let me = null;  // the signed-in user, if any

if (firebaseConfig) {  // without a config the leaderboard stays hidden
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const authApi = auth.getAuth(app);
  if (box) race(auth, authApi, fs, db);
  if (board) { board.hidden = false; showBoard(fs, db); }
}

/* ── Home page: sign in, time a run from Shuffle to solved, save the best time ── */
function race(auth, authApi, fs, db) {
  const panel = el("div", { class: "puzzle-race" });
  let user = null, timed = false, solved = null;

  function render() {
    const lb = el("a", { href: "#leaderboard" }, "leaderboard");
    if (solved && user && timed && !solved.assisted) {
      panel.replaceChildren(el("p", {}, "Solved in " + fmt(solved.ms) + "! Saving…"));
    } else if (solved && user) {
      panel.replaceChildren(el("p", {}, solved.assisted ? "Solved with help. " : "Solved! ", "Press Shuffle to start a timed run for the ", lb, "."));
    } else if (solved) {
      panel.replaceChildren(el("p", {}, "Solved in " + fmt(solved.ms) + "! Sign in and press Shuffle to race for the ", lb, "."), signInButton());
    } else if (user) {
      const out = el("button", { type: "button", class: "link-button" }, "sign out");
      out.addEventListener("click", () => auth.signOut(authApi));
      panel.replaceChildren(el("p", {}, "Racing as " + (user.displayName || "you") + " · ", lb, " · ", out));
    } else {
      panel.replaceChildren(el("p", {}, "Sign in to race for the ", lb, "."), signInButton());
    }
  }

  function signInButton() {
    const b = el("button", { type: "button" }, "Sign in with Google");
    b.addEventListener("click", () => auth.signInWithPopup(authApi, new auth.GoogleAuthProvider()).catch(() => {}));
    return b;
  }

  // Saved right away under the Google account name: the rules compare the time with the server clock at save time
  async function saveScore(ms) {
    const ref = fs.doc(db, "scores", user.uid);
    try {
      const best = await fs.getDoc(ref);
      if (best.exists() && best.data().ms <= ms) {
        panel.replaceChildren(el("p", {}, "Solved in " + fmt(ms) + ". Your best is still " + fmt(best.data().ms) + "."));
        return;
      }
      const name = (user.displayName || "Anonymous").slice(0, 30);
      await fs.setDoc(ref, { name, ms, at: fs.serverTimestamp() });
      panel.replaceChildren(el("p", {}, "Solved in " + fmt(ms) + "! Saved to the leaderboard below."));
      refreshHumans();
    } catch (e) {
      console.error("Leaderboard save failed:", e);
      panel.replaceChildren(el("p", {}, "Solved in " + fmt(ms) + ", but couldn't save it. Shuffle and try another run."));
    }
  }

  document.addEventListener("puzzle:start", () => {
    if (!panel.isConnected) (board ? board.before(panel) : box.append(panel));
    solved = null;
    timed = false;
    // The server clock stamps the start; the database rules check the saved time against it
    if (user) fs.setDoc(fs.doc(db, "sessions", user.uid), { startedAt: fs.serverTimestamp() }).then(() => { timed = true; }, () => {});
    render();
  });
  document.addEventListener("puzzle:solved", (e) => {
    solved = e.detail;
    render();
    if (user && timed && !solved.assisted) saveScore(solved.ms);
  });
  auth.onAuthStateChanged(authApi, (u) => { user = me = u; render(); refreshHumans(); refreshAgents(); });
}

/* ── Leaderboard under the photo ── */
async function showBoard(fs, db) {
  const humans = board.querySelector('[data-panel="humans"] .lb-body');
  const agents = board.querySelector('[data-panel="agents"] .lb-body');

  refreshHumans = async () => {
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, "scores"), fs.orderBy("ms"), fs.limit(10)));
      const rows = snap.docs.map((d, i) => {
        const s = d.data(), name = el("td", {}, s.name);
        if (isAdmin()) name.append(deleteButton(fs, d.ref, s.name, refreshHumans));
        return el("tr", {}, el("td", {}, String(i + 1)), name, el("td", { class: "lb-time" }, fmt(s.ms)));
      });
      humans.replaceChildren(rows.length ? table(["#", "Name", "Time"], rows) : el("p", { class: "lb-empty" }, "No times yet. Be the first!"));
    } catch (e) {
      humans.replaceChildren(el("p", { class: "lb-empty" }, "Couldn't load the leaderboard."));
    }
  };
  refreshHumans();

  refreshAgents = async () => {
    try {
      // Every benchmark run is stored; show each model's best: solved runs by time, then unsolved by pieces placed
      const best = new Map();
      (await fs.getDocs(fs.collection(db, "agents"))).forEach((d) => {
        const r = { ...d.data(), ref: d.ref }, cur = best.get(r.model);
        const better = !cur || (r.solved && (!cur.solved || r.ms < cur.ms)) || (!r.solved && !cur.solved && r.placed > cur.placed);
        if (better) best.set(r.model, r);
      });
      const runs = [...best.values()].sort((a, b) => (b.solved - a.solved) || (a.solved ? a.ms - b.ms : b.placed - a.placed));
      const rows = runs.flatMap((r, i) => {
        const name = el("td", {}, logo(r), r.name, el("span", { class: "lb-caret", "aria-hidden": "true" }, "▾"));
        if (isAdmin()) name.append(deleteButton(fs, r.ref, r.name, refreshAgents));
        const row = el("tr", { class: "lb-run", tabindex: "0", "aria-expanded": "false" },
          el("td", {}, r.solved ? String(i + 1) : "–"), name,
          el("td", { class: "lb-time" }, r.solved ? fmt(r.ms) : r.placed + "/" + r.total));
        // Click a model to see which pieces it placed
        const detail = el("tr", { class: "lb-detail", hidden: "" }, el("td", { colspan: "3" }, runDetail(r)));
        const toggle = (e) => {
          if (e.target.closest(".lb-delete") || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          detail.hidden = !detail.hidden;
          row.setAttribute("aria-expanded", String(!detail.hidden));
        };
        row.addEventListener("click", toggle);
        row.addEventListener("keydown", toggle);
        return [row, detail];
      });
      agents.replaceChildren(rows.length ? table(["#", "Model", "Time"], rows) : el("p", { class: "lb-empty" }, "No benchmark runs yet."));
    } catch (e) {
      agents.replaceChildren(el("p", { class: "lb-empty" }, "Couldn't load the benchmark."));
    }
  };
  refreshAgents();
}

function isAdmin() {
  return !!(me && me.emailVerified && ADMINS.includes(me.email));
}

function deleteButton(fs, ref, label, refresh) {
  const del = el("button", { type: "button", class: "lb-delete", title: "Delete this entry", "aria-label": "Delete " + label }, "×");
  del.addEventListener("click", () => fs.deleteDoc(ref).then(refresh, (e) => console.error("Delete failed:", e)));
  return del;
}

// A small copy of the photo with the pieces the model placed filled in, plus its replay if it has one
function runDetail(r) {
  const summary = el("p", {}, r.placed + "/" + r.total + " pieces · " + r.moves + " moves · " + fmt(r.ms));
  if (/^\/assets\/replays\/[\w.-]+\.mp4$/.test(r.replay || "")) {
    const watch = el("button", { type: "button", class: "lb-watch" }, "▶ Watch replay");
    watch.addEventListener("click", () => openReplay(r));
    summary.append(el("br"), watch);
  }
  if (!Array.isArray(r.placed_map)) return el("div", { class: "lb-run-detail" }, summary);
  const grid = el("div", { class: "lb-mini", role: "img", "aria-label": r.placed + " of " + r.total + " pieces placed" });
  const n = Math.round(Math.sqrt(r.placed_map.length));
  r.placed_map.forEach((on, i) => {
    const cell = el("span", { class: on ? "" : "is-off" });
    cell.style.backgroundImage = "url(" + PHOTO + ")";
    cell.style.backgroundSize = n * 100 + "%";
    cell.style.backgroundPosition = (i % n) * 100 / (n - 1) + "% " + Math.floor(i / n) * 100 / (n - 1) + "%";
    grid.append(cell);
  });
  return el("div", { class: "lb-run-detail" }, grid, summary);
}

// Full-size player over the page; click outside the video or press Esc to close
function openReplay(r) {
  const video = el("video", { src: r.replay, autoplay: "", loop: "", muted: "", playsinline: "", controls: "" });
  video.muted = true;
  const close = el("button", { type: "button", class: "lb-modal-close", "aria-label": "Close replay" }, "×");
  const modal = el("div", { class: "lb-modal", role: "dialog", "aria-modal": "true", "aria-label": r.name + " replay" },
    el("div", { class: "lb-modal-box" }, el("p", {}, r.name + " · " + r.placed + "/" + r.total + " pieces · " + r.moves + " moves"), video, close));
  const shut = () => { modal.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") shut(); };
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target === close) shut(); });
  document.addEventListener("keydown", onKey);
  document.body.append(modal);
  close.focus();
}

function logo(r) {
  const badge = el("span", { class: "lb-logo lb-logo-text", "aria-hidden": "true" }, (r.company || "?").charAt(0));
  if (!/^[a-z0-9]+$/.test(r.logo || "")) return badge;
  let tries = 0;
  const img = el("img", { class: "lb-logo", src: LOGOS[0] + r.logo, alt: "" });
  img.addEventListener("error", () => {
    tries++;
    if (tries < LOGOS.length) img.src = LOGOS[tries] + r.logo + ".svg";
    else img.replaceWith(badge);
  });
  return img;
}

function table(headers, rows) {
  return el("table", { class: "lb-table" },
    el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", {}, h)))),
    el("tbody", {}, ...rows));
}
