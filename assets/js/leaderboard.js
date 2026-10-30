/* =============================================================
   leaderboard.js — puzzle races (home page) and the leaderboard page
   ============================================================= */
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const LOGOS = "https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/";
const board = document.getElementById("leaderboard");
const box = document.getElementById("profilePhoto");

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

/* ── Tabs on the leaderboard page work even before Firebase is set up ── */
if (board) {
  board.querySelectorAll("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      board.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      board.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    });
  });
}

if (!firebaseConfig) {
  if (board) board.querySelectorAll(".lb-body").forEach((b) => b.replaceChildren(el("p", { class: "lb-empty" }, "The leaderboard is coming soon.")));
} else {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);
  const authApi = auth.getAuth(app);
  if (box) race(auth, authApi, fs, db);
  if (board) showBoard(fs, db);
}

/* ── Home page: sign in, time a run from Shuffle to solved, save the best time ── */
function race(auth, authApi, fs, db) {
  const panel = el("div", { class: "puzzle-race" });
  let user = null, timed = false, solved = null;

  function render() {
    const lb = el("a", { href: "/leaderboard/" }, "leaderboard");
    if (solved && user && timed && !solved.assisted) {
      const input = el("input", { type: "text", maxlength: "30", placeholder: "Your name", "aria-label": "Name for the leaderboard" });
      input.value = localStorage.getItem("puzzleName") || (user.displayName || "").split(" ")[0];
      const save = el("button", { type: "button" }, "Save");
      save.addEventListener("click", () => saveScore(input.value.trim(), solved.ms, save));
      panel.replaceChildren(el("p", {}, "Solved in " + fmt(solved.ms) + "!"), el("div", { class: "puzzle-race-save" }, input, save));
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

  async function saveScore(name, ms, button) {
    if (!name) return;
    localStorage.setItem("puzzleName", name);
    button.disabled = true;
    const ref = fs.doc(db, "scores", user.uid);
    try {
      const best = await fs.getDoc(ref);
      if (best.exists() && best.data().ms <= ms) {
        panel.replaceChildren(el("p", {}, "Your best is still " + fmt(best.data().ms) + ". Shuffle to try again."));
        return;
      }
      await fs.setDoc(ref, { name, ms, at: fs.serverTimestamp() });
      panel.replaceChildren(el("p", {}, "Saved! See where you rank on the ", el("a", { href: "/leaderboard/" }, "leaderboard"), "."));
    } catch (e) {
      panel.replaceChildren(el("p", {}, "Couldn't save that time. Shuffle and try another run."));
    }
  }

  document.addEventListener("puzzle:start", () => {
    if (!panel.isConnected) box.append(panel);
    solved = null;
    timed = false;
    // The server clock stamps the start; the database rules check the saved time against it
    if (user) fs.setDoc(fs.doc(db, "sessions", user.uid), { startedAt: fs.serverTimestamp() }).then(() => { timed = true; }, () => {});
    render();
  });
  document.addEventListener("puzzle:solved", (e) => { solved = e.detail; render(); });
  auth.onAuthStateChanged(authApi, (u) => { user = u; render(); });
}

/* ── Leaderboard page ── */
async function showBoard(fs, db) {
  const humans = board.querySelector('[data-panel="humans"] .lb-body');
  const agents = board.querySelector('[data-panel="agents"] .lb-body');

  try {
    const snap = await fs.getDocs(fs.query(fs.collection(db, "scores"), fs.orderBy("ms"), fs.limit(100)));
    const rows = snap.docs.map((d, i) => {
      const s = d.data();
      return el("tr", {}, el("td", {}, String(i + 1)), el("td", {}, s.name), el("td", { class: "lb-time" }, fmt(s.ms)));
    });
    humans.replaceChildren(rows.length ? table(["#", "Name", "Time"], rows) : el("p", { class: "lb-empty" }, "No times yet. Be the first!"));
  } catch (e) {
    humans.replaceChildren(el("p", { class: "lb-empty" }, "Couldn't load the leaderboard."));
  }

  try {
    // Every benchmark run is stored; show each model's best: solved runs by time, then unsolved by pieces placed
    const best = new Map();
    (await fs.getDocs(fs.collection(db, "agents"))).forEach((d) => {
      const r = d.data(), cur = best.get(r.model);
      const better = !cur || (r.solved && (!cur.solved || r.ms < cur.ms)) || (!r.solved && !cur.solved && r.placed > cur.placed);
      if (better) best.set(r.model, r);
    });
    const runs = [...best.values()].sort((a, b) => (b.solved - a.solved) || (a.solved ? a.ms - b.ms : b.placed - a.placed));
    const rows = runs.map((r, i) => el("tr", {},
      el("td", {}, r.solved ? String(i + 1) : "–"),
      el("td", {}, logo(r), r.company),
      el("td", {}, r.name),
      el("td", { class: "lb-time" }, r.solved ? fmt(r.ms) : r.placed + "/" + r.total + " placed"),
      el("td", {}, String(r.moves))));
    agents.replaceChildren(rows.length ? table(["#", "Company", "Model", "Time", "Moves"], rows) : el("p", { class: "lb-empty" }, "No benchmark runs yet."));
  } catch (e) {
    agents.replaceChildren(el("p", { class: "lb-empty" }, "Couldn't load the benchmark."));
  }
}

function logo(r) {
  const badge = el("span", { class: "lb-logo lb-logo-text", "aria-hidden": "true" }, (r.company || "?").charAt(0));
  if (!/^[a-z0-9]+$/.test(r.logo || "")) return badge;
  const img = el("img", { class: "lb-logo", src: LOGOS + r.logo + ".svg", alt: "" });
  img.addEventListener("error", () => img.replaceWith(badge));
  return img;
}

function table(headers, rows) {
  return el("table", { class: "lb-table" },
    el("thead", {}, el("tr", {}, ...headers.map((h) => el("th", {}, h)))),
    el("tbody", {}, ...rows));
}
