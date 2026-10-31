"""Run models on the photo puzzle and record how fast they solve it.

    python run.py claude-opus-5-5              # one model
    python run.py claude-opus-5-5 gemma --upload  # several, then publish to the leaderboard
    python run.py oracle --url http://localhost:4000/   # test the harness, no API key needed
"""
import argparse
import datetime
import json
import pathlib
import ssl
import subprocess
import time
import urllib.request

import certifi
import yaml
from playwright.sync_api import sync_playwright

import agents
import replay

HARNESS_VERSION = 10
HERE = pathlib.Path(__file__).parent
VIEWPORT = {"width": 1280, "height": 800}
SETTLE = 0.8  # seconds for a dropped piece to finish snapping before the next screenshot


def drag(page, move):
    page.mouse.move(move["from_x"], move["from_y"])
    page.mouse.down()
    page.mouse.move(move["to_x"], move["to_y"], steps=12)
    page.mouse.up()


def run(model_id, entry, args, browser, path, recorder):
    page = browser.new_page(viewport=VIEWPORT)
    page.goto(f"{args.url}?bench&seed={args.seed}")
    page.wait_for_function("window.puzzle && window.puzzle.pieces")
    time.sleep(SETTLE)

    x0, y0 = page.evaluate("(() => { const r = document.querySelector('#profilePhoto img').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; })()")
    system = (agents.SYSTEM.replace("[[x0]]", str(x0)).replace("[[y0]]", str(y0))
              .replace("[[moves]]", str(args.max_moves)).replace("[[minutes]]", str(round(args.time_limit / 60))))
    agent = agents.make(entry, page, system)
    moves, error, turns = 0, None, []  # turns: what the model asked for each turn and the result, kept locally
    status = page.evaluate("window.puzzle.status()")
    def left():
        minutes = max(0, (args.time_limit - (time.monotonic() - start)) / 60)
        return f"{status['placed']}/{status['total']} pieces placed, {args.max_moves - moves} moves and {minutes:.0f} minutes left."
    def record(ended):
        return {
            "model": model_id, "name": entry["name"], "company": entry["company"], "logo": entry.get("logo", ""),
            "provider": entry["provider"], "api_model": entry.get("model", ""),
            "solved": status["solved"], "ms": round((time.monotonic() - start) * 1000), "placed": status["placed"], "total": status["total"],
            "placed_map": status["map"],
            "moves": moves, "input_tokens": agent.input_tokens, "output_tokens": agent.output_tokens, "replies": agent.replies, "turns": turns, "refusals": getattr(agent, "refusals", 0),
            "seed": args.seed, "ended": ended, "error": error, "harness_version": HARNESS_VERSION,
            "date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }

    def capture():
        # Replay frames are taken off the clock: moving start forward by the capture time
        nonlocal start
        t = time.monotonic()
        recorder.add(page, f"{entry['name']}  ·  move {moves}/{args.max_moves}  ·  {status['placed']}/{status['total']} placed")
        start += time.monotonic() - t

    # Ends on: solved, the move cap, the time limit, or no drag for --idle-limit seconds
    start = last_drag = time.monotonic()  # the clock includes model thinking and API time
    capture()
    note = "Here is the puzzle. " + left()
    ended = None
    try:
        while not ended:
            requested = agent.next_moves(page.screenshot(), note)
            if not requested:
                turns.append({"drags": [], "placed": status["placed"], "seconds": round(time.monotonic() - start, 1)})
                if time.monotonic() - last_drag > args.idle_limit:
                    ended = f"no drag for {args.idle_limit // 60} minutes"
                else:
                    note = (f"You didn't drag anything last turn. {left()} Use the drag tool to keep placing pieces; "
                            f"if {args.idle_limit // 60} minutes pass without a drag, the run ends.")
                    path.write_text(json.dumps(record("running"), indent=2))  # saved every turn, so an interrupted run keeps its data
                    continue
            else:
                for move in requested[:args.max_moves - moves]:  # the move cap is strict, even mid-turn
                    drag(page, move)
                    moves += 1
                    page.wait_for_timeout(150)  # a piece that snaps counts as placed right away
                    status = page.evaluate("window.puzzle.status()")
                    capture()
                last_drag = time.monotonic()
                time.sleep(SETTLE)
                status = page.evaluate("window.puzzle.status()")
                turns.append({"drags": requested, "placed": status["placed"], "seconds": round(time.monotonic() - start, 1)})
                note = left()
                print(f"  {model_id}: {moves} moves, {left()}")
            path.write_text(json.dumps(record("running"), indent=2))
            if status["solved"]:
                ended = "solved"
            elif moves >= args.max_moves:
                ended = "move limit"
            elif time.monotonic() - start >= args.time_limit:
                ended = "time limit"
    except Exception as e:  # an API failure ends the run; it's saved locally but never uploaded
        error = f"{type(e).__name__}: {e}"
        ended = "error"
        print(f"  {model_id}: stopped by {error}")
    time.sleep(SETTLE)
    capture()  # the finished board
    final = record(ended)
    path.write_text(json.dumps(final, indent=2))
    page.close()
    return final


def publish_replay(file):
    """Commit and push a replay so GitHub Pages serves it; retries if another run pushed first."""
    repo = HERE.parent
    git = ["git", "-C", str(repo), "-c", "user.name=nandansarkar16", "-c", "user.email=nandan.sarkar@yale.edu"]
    subprocess.run(git + ["add", str(file)], check=True)
    subprocess.run(git + ["commit", "-q", "-m", "update", "--", str(file)], check=True)
    for _ in range(3):
        if subprocess.run(git + ["push", "-q", "origin", "HEAD"]).returncode == 0:
            break
        subprocess.run(git + ["pull", "-q", "--rebase", "origin", "master"], check=True)
    else:
        raise RuntimeError("couldn't push the replay")


def wait_until_live(url, limit=900):
    """GitHub Pages takes a minute or more to publish; post the result only once the replay loads."""
    end = time.monotonic() + limit
    context = ssl.create_default_context(cafile=certifi.where())  # python.org's Python ships without system certificates
    while time.monotonic() < end:
        try:
            with urllib.request.urlopen(url, timeout=20, context=context) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(15)
    return False


def upload(record):
    import firebase_admin
    from firebase_admin import firestore
    if not firebase_admin._apps:
        firebase_admin.initialize_app()  # service account key from GOOGLE_APPLICATION_CREDENTIALS
    firestore.client().collection("agents").add({k: v for k, v in record.items() if k not in ("replies", "turns")})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("models", nargs="+", help="ids from models.yaml, or 'oracle'")
    parser.add_argument("--url", default="https://nandansarkar16.github.io/")
    parser.add_argument("--seed", type=int, default=1, help="puzzle layout; keep it the same across models")
    parser.add_argument("--max-moves", type=int, default=150)
    parser.add_argument("--time-limit", type=int, default=1200, help="seconds")
    parser.add_argument("--idle-limit", type=int, default=120, help="end the run after this many seconds without a drag")
    parser.add_argument("--upload", action="store_true", help="publish results to the leaderboard")
    parser.add_argument("--headed", action="store_true", help="show the browser window")
    args = parser.parse_args()

    catalog = yaml.safe_load((HERE / "models.yaml").read_text())
    catalog["oracle"] = {"name": "Oracle (harness test)", "company": "Test", "provider": "oracle"}
    unknown = [m for m in args.models if m not in catalog]
    if unknown:
        parser.error(f"not in models.yaml: {', '.join(unknown)}")

    results = HERE / "results"
    results.mkdir(exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=not args.headed)  # uses the installed Google Chrome
        for model_id in args.models:
            print(f"{model_id}: starting")
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H%M%S")
            path = results / f"{stamp}-{model_id}.json"
            recorder = replay.Recorder()
            record = run(model_id, catalog[model_id], args, browser, path, recorder)
            publish = args.upload and model_id != "oracle" and not record["error"]
            # Published replays live in the website so GitHub Pages can serve them; test runs stay in results/
            video = (HERE.parent / "assets" / "replays" if publish else results) / f"{stamp}-{model_id}.mp4"
            video.parent.mkdir(exist_ok=True)
            recorder.save(video)
            if publish:
                record["replay"] = f"/assets/replays/{video.name}"
                path.write_text(json.dumps(record, indent=2))
            verdict = f"solved in {record['ms'] / 1000:.1f}s" if record["solved"] else f"{record['placed']}/{record['total']} placed ({record['ended']})"
            print(f"{model_id}: {verdict}, {record['moves']} moves -> {path.name}")
            if publish:
                publish_replay(video)  # pushed first, so the leaderboard link works as soon as the result appears
                live = args.url.rstrip("/") + record["replay"]
                print(f"{model_id}: waiting for the replay to go live")
                if not wait_until_live(live):
                    print(f"{model_id}: replay isn't live yet; uploading anyway")
                upload(record)
                print(f"{model_id}: uploaded, replay at {record['replay']}")
        browser.close()


if __name__ == "__main__":
    main()
