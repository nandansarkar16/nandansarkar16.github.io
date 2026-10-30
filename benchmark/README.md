# Puzzle leaderboard and agent benchmark

The photo puzzle on the home page has a leaderboard right under the photo, with two tabs:

- **Humans**: people sign in with Google on the home page, press Shuffle, and their solve time is saved.
- **AI**: models solve the same puzzle from screenshots using one `drag` tool, run by `run.py` here.

Benchmark mode is the home page with `?bench&seed=N`: pieces don't move, they sit on a shuffled
non-overlapping grid that's the same for every model given the same seed, and the Solve/Shuffle buttons are hidden.

## 1. Set up Firebase (once)

1. Go to [console.firebase.google.com](https://console.firebase.google.com), create a project (Analytics not needed).
2. **Authentication → Sign-in method**: enable **Google**.
   **Authentication → Settings → Authorized domains**: add `nandansarkar16.github.io`.
3. **Firestore Database → Create database** (production mode, any region).
   **Rules** tab: paste the contents of `../firestore.rules` and **Publish**.
4. **Project settings → Your apps → Web (`</>`)**: register an app, copy the `firebaseConfig` object,
   and paste it into `../assets/js/firebase-config.js` in place of `null`. (This config is meant to be public;
   the rules are what protect the data.)
5. For uploading benchmark results: **Project settings → Service accounts → Generate new private key**.
   Save the file **outside this repo** (for example `~/keys/puzzle-firebase.json`). Never commit it.

Push the site, and the leaderboard goes live.

## 2. Run the benchmark

```bash
cd benchmark
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once

# Test the harness without any API key: a scripted solver that reads the answers from the page
.venv/bin/python run.py oracle

# Real models: set the keys for the providers you use
export ANTHROPIC_API_KEY=...      # Claude
export OPENAI_API_KEY=...         # GPT
export GEMINI_API_KEY=...         # Gemini
export OPENROUTER_API_KEY=...     # open models (Gemma, Llama, Kimi, Qwen, ...)

.venv/bin/python run.py claude-opus-5-5 gpt gemini gemma llama kimi

# Publish to the leaderboard
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/puzzle-firebase.json
.venv/bin/python run.py claude-opus-5-5 --upload
```

Every run is saved to `results/` as JSON. `--upload` publishes it; runs that end in an API error are never uploaded.
The leaderboard shows each model's best run: solved runs ranked by time, then unsolved runs by pieces placed.

Options: `--seed` (keep it the same across models), `--max-moves` (default 100), `--time-limit` seconds (default 1200),
`--headed` to watch the browser, `--url` to test a local copy of the site.

## Adding models

Copy an entry in `models.yaml`. The model needs image input and tool calling. Claude runs through the Anthropic SDK;
everything else goes through OpenAI's chat-completions format, which OpenAI, Google, OpenRouter and Ollama
(local models, `provider: ollama`) all accept. The non-Claude model ids in `models.yaml` are starting points:
check each provider's current model list before a run.

## What the numbers mean

Time is wall-clock from the first screenshot to the last piece snapping in, so it includes each provider's
API speed, not just how well the model plays. Each run also records moves and token counts. Cost isn't tracked:
a run is roughly one model call per turn, each with a screenshot, so expect anywhere from cents (small models)
to a few dollars (top models) per run.

## What protects the human leaderboard

Google sign-in keeps out throwaway bot accounts. The database rules stamp each run's start with the server's
clock and only accept a saved time within a few seconds of the real elapsed time, with one best time per account.
A determined person could still time a run without really solving it; stopping that needs a server-side check of the moves.
