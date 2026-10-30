"""Run models on the photo puzzle and record how fast they solve it.

    python run.py claude-opus-5-5              # one model
    python run.py claude-opus-5-5 gemma --upload  # several, then publish to the leaderboard
    python run.py oracle --url http://localhost:4000/   # test the harness, no API key needed
"""
import argparse
import datetime
import json
import pathlib
import time

import yaml
from playwright.sync_api import sync_playwright

import agents

HARNESS_VERSION = 3
HERE = pathlib.Path(__file__).parent
VIEWPORT = {"width": 1280, "height": 800}
SETTLE = 0.8  # seconds for a dropped piece to finish snapping before the next screenshot


def drag(page, move):
    page.mouse.move(move["from_x"], move["from_y"])
    page.mouse.down()
    page.mouse.move(move["to_x"], move["to_y"], steps=12)
    page.mouse.up()


def run(model_id, entry, args, browser):
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
    start = time.monotonic()  # the clock includes model thinking and API time; only the move cap or time limit ends a run
    note = "Here is the puzzle. " + left()
    try:
        while not status["solved"] and moves < args.max_moves and time.monotonic() - start < args.time_limit:
            requested = agent.next_moves(page.screenshot(), note)
            if not requested:
                turns.append({"drags": [], "placed": status["placed"]})
                note = "You didn't drag anything this turn. " + left() + " Use the drag tool to keep placing pieces until all are placed."
                continue
            for move in requested[:args.max_moves - moves]:  # the move cap is strict, even mid-turn
                drag(page, move)
                moves += 1
            time.sleep(SETTLE)
            status = page.evaluate("window.puzzle.status()")
            turns.append({"drags": requested, "placed": status["placed"], "seconds": round(time.monotonic() - start, 1)})
            note = left()
            print(f"  {model_id}: {moves} moves, {note}")
    except Exception as e:  # an API failure ends the run; it's saved locally but never uploaded
        error = f"{type(e).__name__}: {e}"
        print(f"  {model_id}: stopped by {error}")
    elapsed = time.monotonic() - start
    page.close()

    return {
        "model": model_id, "name": entry["name"], "company": entry["company"], "logo": entry.get("logo", ""),
        "provider": entry["provider"], "api_model": entry.get("model", ""),
        "solved": status["solved"], "ms": round(elapsed * 1000), "placed": status["placed"], "total": status["total"],
        "placed_map": status["map"],
        "moves": moves, "input_tokens": agent.input_tokens, "output_tokens": agent.output_tokens, "replies": agent.replies, "turns": turns,
        "seed": args.seed, "error": error, "harness_version": HARNESS_VERSION,
        "date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    }


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
            record = run(model_id, catalog[model_id], args, browser)
            path = results / f"{record['date'][:19].replace(':', '')}-{model_id}.json"
            path.write_text(json.dumps(record, indent=2))
            verdict = f"solved in {record['ms'] / 1000:.1f}s" if record["solved"] else f"{record['placed']}/{record['total']} placed"
            print(f"{model_id}: {verdict}, {record['moves']} moves -> {path.name}")
            if args.upload and model_id != "oracle" and not record["error"]:
                upload(record)
                print(f"{model_id}: uploaded")
        browser.close()


if __name__ == "__main__":
    main()
