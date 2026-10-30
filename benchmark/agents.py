"""Model adapters for the puzzle benchmark.

Every agent sees the same thing: a screenshot plus a short status line, and a single `drag` tool.
`next_moves(png, note)` returns the drags the model asked for (possibly several, possibly none).
The prompt's numbers match the site: a 240px photo cut 6x6 at a 1280x800 viewport, snapping within 0.4 of a cell.
"""
import base64
import json
import os
import pathlib

# The prompt lives with the website so the leaderboard can show visitors the exact text
SYSTEM = (pathlib.Path(__file__).parent.parent / "_includes" / "benchmark-prompt.txt").read_text().strip()

COORDS = ("from_x", "from_y", "to_x", "to_y")
DRAG = {
    "name": "drag",
    "description": "Press the mouse at (from_x, from_y) and release it at (to_x, to_y). Coordinates are screenshot pixels.",
    "parameters": {
        "type": "object",
        "properties": {k: {"type": "number"} for k in COORDS},
        "required": list(COORDS),
        "additionalProperties": False,
    },
}


def valid(move):
    return isinstance(move, dict) and all(isinstance(move.get(k), (int, float)) for k in COORDS)



# Each turn is a fresh, one-message request: instructions, a text recap and the current screenshot.
# No growing history, so every turn costs about the same.

class AnthropicAgent:
    def __init__(self, entry, system):
        import anthropic
        self.client = anthropic.Anthropic(max_retries=5)
        self.entry = entry
        self.system = system
        self.input_tokens = self.output_tokens = 0
        self.replies = []  # the model's text, kept in the local results file to see why a run went the way it did
        self.refusals = 0  # turns the safety filters declined and were retried

    def next_moves(self, png, note):
        # A refusal from the safety filters is usually a one-off false positive, so retry the same turn up to twice
        for attempt in range(3):
            response = self.request(png, note)
            if response.stop_reason != "refusal":
                break
            self.refusals += 1
        else:
            category = getattr(response.stop_details, "category", None) if response.stop_details else None
            raise RuntimeError(f"model refused 3 times in a row (category: {category})")
        moves = [b.input for b in response.content if b.type == "tool_use" and valid(b.input)]
        self.replies.append("\n".join(b.text for b in response.content if b.type == "text" and b.text.strip()))
        return moves

    def request(self, png, note):
        response = self.client.messages.create(
            model=self.entry["model"],
            max_tokens=16000,
            system=[{"type": "text", "text": self.system, "cache_control": {"type": "ephemeral"}}],
            tools=[{"name": DRAG["name"], "description": DRAG["description"], "input_schema": DRAG["parameters"], "strict": True}],
            messages=[{"role": "user", "content": [
                {"type": "text", "text": note},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(png).decode()}},
            ]}],
            output_config={"effort": self.entry.get("effort", "medium")},
        )
        self.input_tokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens or 0) + (response.usage.cache_creation_input_tokens or 0)
        self.output_tokens += response.usage.output_tokens
        return response


# OpenAI's chat completions API, which Google, OpenRouter (open models) and Ollama also accept
BASE_URLS = {
    "openai": (None, "OPENAI_API_KEY"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai/", "GEMINI_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/v1", "OPENROUTER_API_KEY"),
    "ollama": ("http://localhost:11434/v1", None),
}


class ChatCompletionsAgent:
    def __init__(self, entry, system):
        import openai
        base_url, key_env = BASE_URLS[entry["provider"]]
        self.client = openai.OpenAI(base_url=base_url, api_key=os.environ[key_env] if key_env else "ollama", max_retries=5)
        self.entry = entry
        self.system = system
        self.input_tokens = self.output_tokens = 0
        self.replies = []

    def next_moves(self, png, note):
        response = self.client.chat.completions.create(
            model=self.entry["model"],
            messages=[{"role": "system", "content": self.system}, {"role": "user", "content": [
                {"type": "text", "text": note},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            ]}],
            tools=[{"type": "function", "function": DRAG}],
        )
        if response.usage:
            self.input_tokens += response.usage.prompt_tokens
            self.output_tokens += response.usage.completion_tokens
        message = response.choices[0].message
        self.replies.append((message.content or "").strip())
        moves = []
        for c in message.tool_calls or []:
            try:
                move = json.loads(c.function.arguments)
            except json.JSONDecodeError:
                continue
            if valid(move):
                moves.append(move)
        return moves


class OracleAgent:
    """Not a model: reads the correct spots from the page. Used to test the harness without API keys."""

    def __init__(self, page):
        self.page = page
        self.input_tokens = self.output_tokens = 0
        self.replies = []

    def next_moves(self, png, note):
        self.replies.append("")
        for p in self.page.evaluate("window.puzzle.pieces()"):
            if not p["placed"]:
                return [{"from_x": p["x"], "from_y": p["y"], "to_x": p["hx"], "to_y": p["hy"]}]
        return []


def make(entry, page, system):
    if entry["provider"] == "oracle":
        return OracleAgent(page)
    if entry["provider"] == "anthropic":
        return AnthropicAgent(entry, system)
    return ChatCompletionsAgent(entry, system)
