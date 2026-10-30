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

HARNESS_VERSION = 5
HERE = pathlib.Path(__file__).parent
VIEWPORT = {"width": 1280, "height": 800}
SETTLE = 0.8  # seconds for a dropped piece to finish snapping before the next screenshot


def drag(page, move):
    page.mouse.move(move["from_x"], move["from_y"])
    page.mouse.down()
    page.mouse.move(move["to_x"], move["to_y"], steps=12)
    page.mouse.up()


def run(model_id, entry, args, browser, path):
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
            "moves": moves, "input_tokens": agent.input_tokens, "output_tokens": agent.output_tokens, "replies": agent.replies, "turns": turns,
            "seed": args.seed, "ended": ended, "error": error, "harness_version": HARNESS_VERSION,
            "date": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }

    recent = []  # (drag, locked in?) for the recap each turn

    def recap(opening):
        lines = [opening + " " + left()]
        if recent:
            lines.append("Your most recent drags, oldest first:")
            lines += [f"- ({m['from_x']:.0f}, {m['from_y']:.0f}) to ({m['to_x']:.0f}, {m['to_y']:.0f}): {'locked in' if ok else 'did not lock in'}"
                      for m, ok in recent[-10:]]
        last_note = next((r for r in reversed(agent.replies) if r), "")
        if last_note:
            lines.append("Your note from last turn: " + last_note[-800:])
        return "\n".join(lines)

    # Ends on: solved, the move cap, the time limit, or no drag for --idle-limit seconds
    start = last_drag = time.monotonic()  # the clock includes model thinking and API time
    note = recap("Here is the puzzle.")
    ended = None
    try:
        while not ended:
            requested = agent.next_moves(page.screenshot(), note)
            if not requested:
                turns.append({"drags": [], "placed": status["placed"], "seconds": round(time.monotonic() - start, 1)})
                if time.monotonic() - last_drag > args.idle_limit:
                    ended = f"no drag for {args.idle_limit // 60} minutes"
                else:
                    note = recap(f"You didn't drag anything last turn. Use the drag tool to keep placing pieces; "
                                 f"if {args.idle_limit // 60} minutes pass without a drag, the run ends.")
                    path.write_text(json.dumps(record("running"), indent=2))  # saved every turn, so an interrupted run keeps its data
                    continue
            else:
                for move in requested[:args.max_moves - moves]:  # the move cap is strict, even mid-turn
                    before = status["placed"]
                    drag(page, move)
                    moves += 1
                    page.wait_for_timeout(150)  # a piece that snaps counts as placed right away
                    status = page.evaluate("window.puzzle.status()")
                    recent.append((move, status["placed"] > before))
                last_drag = time.monotonic()
                time.sleep(SETTLE)
                status = page.evaluate("window.puzzle.status()")
                turns.append({"drags": requested, "placed": status["placed"], "seconds": round(time.monotonic() - start, 1)})
                note = recap(f"Turn {len(turns) + 1}.")
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
    final = record(ended)
    path.write_text(json.dumps(final, indent=2))
    page.close()
    return final


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
            record = run(model_id, catalog[model_id], args, browser, path)
            verdict = f"solved in {record['ms'] / 1000:.1f}s" if record["solved"] else f"{record['placed']}/{record['total']} placed ({record['ended']})"
            print(f"{model_id}: {verdict}, {record['moves']} moves -> {path.name}")
            if args.upload and model_id != "oracle" and not record["error"]:
                upload(record)
                print(f"{model_id}: uploaded")
        browser.close()


if __name__ == "__main__":
    main()
