/* =============================================================
   leaderboard.js — puzzle races and the leaderboard under the photo
   ============================================================= */
import { firebaseConfig } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const LOGOS = "https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/";
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

let refreshHumans = () => {};
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
  auth.onAuthStateChanged(authApi, (u) => { user = me = u; render(); refreshHumans(); });
}

/* ── Leaderboard under the photo ── */
async function showBoard(fs, db) {
  const humans = board.querySelector('[data-panel="humans"] .lb-body');
  const agents = board.querySelector('[data-panel="agents"] .lb-body');

  refreshHumans = async () => {
    try {
      const snap = await fs.getDocs(fs.query(fs.collection(db, "scores"), fs.orderBy("ms"), fs.limit(10)));
      const admin = me && me.emailVerified && ADMINS.includes(me.email);
      const rows = snap.docs.map((d, i) => {
        const s = d.data(), name = el("td", {}, s.name);
        if (admin) {
          const del = el("button", { type: "button", class: "lb-delete", title: "Delete this entry", "aria-label": "Delete " + s.name }, "×");
          del.addEventListener("click", () => fs.deleteDoc(d.ref).then(refreshHumans, (e) => console.error("Delete failed:", e)));
          name.append(del);
        }
        return el("tr", {}, el("td", {}, String(i + 1)), name, el("td", { class: "lb-time" }, fmt(s.ms)));
      });
      humans.replaceChildren(rows.length ? table(["#", "Name", "Time"], rows) : el("p", { class: "lb-empty" }, "No times yet. Be the first!"));
    } catch (e) {
      humans.replaceChildren(el("p", { class: "lb-empty" }, "Couldn't load the leaderboard."));
    }
  };
  refreshHumans();

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
      el("td", {}, logo(r), r.name),
      el("td", { class: "lb-time" }, r.solved ? fmt(r.ms) : r.placed + "/" + r.total)));
    agents.replaceChildren(rows.length ? table(["#", "Model", "Time"], rows) : el("p", { class: "lb-empty" }, "No benchmark runs yet."));
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
