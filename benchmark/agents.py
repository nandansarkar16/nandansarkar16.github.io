"""Model adapters for the puzzle benchmark.

Every agent sees the same thing: a screenshot plus a short status line, and a single `drag` tool.
`next_moves(png, note)` returns the drags the model asked for (possibly several, possibly none).
The prompt's numbers match the site: a 240px photo cut 6x6 at a 1280x800 viewport, snapping within 0.4 of a cell.
"""
import base64
import json
import os

SYSTEM = """You are solving a jigsaw puzzle on a web page. You see it as a 1280x800 screenshot, and screenshot pixels are exactly the coordinates the drag tool uses.

The goal: a 6x6 photo puzzle of 36 pieces. Its empty spot is the wooden frame on the right side of the page, which shows a faint ghost of the finished photo to guide you. The photo area is 240x240 pixels with its top-left corner at ({x0}, {y0}). It's a grid of 40x40 cells, so the cell in column c and row r (both counted 0-5 from the top-left) has its center at ({x0}+20+40c, {y0}+20+40r).

The pieces: the 36 loose pieces sit in rows in the blank margins at the left and right edges of the page. All of them are already the right way up; you never need to rotate anything. Each piece has a 40x40 square body, plus tabs that stick out up to about 12 pixels on some sides. Pieces from the edges of the photo have a flat side, and the four corner pieces have two.

How dragging works: drag(from_x, from_y, to_x, to_y) presses the mouse at the first point and releases it at the second. The piece moves by exactly that distance, so press on the center of the piece's square body (not on a tab) and release on the center of the cell where it belongs.

Snapping: a piece locks into place if you drop its center within 16 pixels of its correct cell center, horizontally and vertically. A locked piece loses its drop shadow and can't be moved again. A piece dropped anywhere else just stays there and may cover other pieces or the ghost image, so don't drop pieces in the frame unless you're fairly confident. Moving a misplaced piece costs another move.

Budget: you have {moves} drags and {minutes} minutes in total. After each turn you get a new screenshot, the number of pieces placed, and the moves left. You can make several drags per turn. Keep going until all 36 pieces are placed."""

DRAG = {
    "name": "drag",
    "description": "Press the mouse at (from_x, from_y) and release it at (to_x, to_y). Coordinates are screenshot pixels.",
    "parameters": {
        "type": "object",
        "properties": {k: {"type": "number"} for k in ("from_x", "from_y", "to_x", "to_y")},
        "required": ["from_x", "from_y", "to_x", "to_y"],
        "additionalProperties": False,
    },
}


def valid(move):
    return isinstance(move, dict) and all(isinstance(move.get(k), (int, float)) for k in DRAG["parameters"]["required"])


class AnthropicAgent:
    def __init__(self, entry, system):
        import anthropic
        self.client = anthropic.Anthropic(max_retries=5)
        self.entry = entry
        self.system = system
        self.messages = []
        self.pending = []  # tool_use ids from the last turn, answered with the next screenshot
        self.input_tokens = self.output_tokens = 0

    def next_moves(self, png, note):
        shot = [{"type": "text", "text": note},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(png).decode()}}]
        if self.pending:
            content = [{"type": "tool_result", "tool_use_id": i, "content": "Done."} for i in self.pending[:-1]]
            content.append({"type": "tool_result", "tool_use_id": self.pending[-1], "content": shot})
        else:
            content = shot
        self.messages.append({"role": "user", "content": content})

        response = self.client.messages.create(
            model=self.entry["model"],
            max_tokens=16000,
            system=self.system,
            tools=[{"name": DRAG["name"], "description": DRAG["description"], "input_schema": DRAG["parameters"], "strict": True}],
            messages=self.messages,
            output_config={"effort": self.entry.get("effort", "medium")},
            cache_control={"type": "ephemeral"},  # the history only grows, so each turn re-reads the cached prefix
        )
        self.input_tokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens or 0) + (response.usage.cache_creation_input_tokens or 0)
        self.output_tokens += response.usage.output_tokens
        if response.stop_reason == "refusal":
            raise RuntimeError("model refused")
        self.messages.append({"role": "assistant", "content": response.content})
        calls = [b for b in response.content if b.type == "tool_use"]
        self.pending = [b.id for b in calls]
        return [b.input for b in calls if valid(b.input)]


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
        self.messages = [{"role": "system", "content": system}]
        self.pending = []
        self.input_tokens = self.output_tokens = 0

    def next_moves(self, png, note):
        # Tool results are text-only in this API, so the screenshot follows as a user message
        for call_id in self.pending:
            self.messages.append({"role": "tool", "tool_call_id": call_id, "content": "Done."})
        self.messages.append({"role": "user", "content": [
            {"type": "text", "text": note},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
        ]})

        response = self.client.chat.completions.create(
            model=self.entry["model"],
            messages=self.messages,
            tools=[{"type": "function", "function": DRAG}],
        )
        if response.usage:
            self.input_tokens += response.usage.prompt_tokens
            self.output_tokens += response.usage.completion_tokens
        message = response.choices[0].message
        self.messages.append(message.model_dump(exclude_none=True))
        calls = message.tool_calls or []
        self.pending = [c.id for c in calls]
        moves = []
        for c in calls:
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

    def next_moves(self, png, note):
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
