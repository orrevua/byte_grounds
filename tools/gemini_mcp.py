"""Local MCP server: Google Gemini for ByteGrounds art (generate sprites / tile sheets, analyze images).

Tools (for Claude Code):
- generate_image(prompt, output_path, reference_images?) → writes the image Gemini draws to a file
  (relative paths land under the repo's `art/gemini/`). Pass reference images (e.g. an existing
  sheet) to keep a style.
- analyze_image(image_path, prompt) → Gemini's description / answer about a local image.
- list_models() → model ids your key can use (to pick GEMINI_IMAGE_MODEL / GEMINI_TEXT_MODEL).

Then turn a generated image into a game sheet with tools/pixelate_image.py (see docs/sheet-studio.md).

Setup (once):
    pip install mcp google-genai pillow
    claude mcp add gemini -- python <absolute path to this file>
The API key comes from the GEMINI_API_KEY environment variable, set where Claude Code is started.
Optional: GEMINI_IMAGE_MODEL (default gemini-3.1-flash-image), GEMINI_TEXT_MODEL (default
gemini-2.5-flash).
"""

import os
from pathlib import Path

try:  # mcp >= 2
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:  # mcp 1.x
    from mcp.server.fastmcp import FastMCP

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "art" / "gemini"
IMAGE_MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image")
TEXT_MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-2.5-flash")

mcp = FastMCP("Gemini")
_client = None


def client():
    """The Gemini client, created on first use (so the server starts even before the key is set)."""
    global _client
    if _client is None:
        if not os.environ.get("GEMINI_API_KEY"):
            raise RuntimeError("GEMINI_API_KEY is not set in the environment Claude Code was started from.")
        from google import genai

        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def _resolve(path: str, default_dir: Path) -> Path:
    p = Path(path)
    return p if p.is_absolute() else default_dir / p


@mcp.tool()
def generate_image(prompt: str, output_path: str, reference_images: list[str] | None = None) -> str:
    """Generate an image with Gemini and save it. Use for sprite sheets / tile sheets / furniture art.
    `output_path`: a file name (saved under art/gemini/) or an absolute path; .png recommended.
    `reference_images`: optional local image paths Gemini should match in style or edit.
    Tip for game art: ask for top-down 3/4 pixel art, a flat plain background, no grid lines,
    pieces spaced apart, chairs facing down and up."""
    try:
        from google.genai import types
        from PIL import Image

        contents: list = [prompt]
        for ref in reference_images or []:
            contents.append(Image.open(_resolve(ref, REPO)))
        response = client().models.generate_content(
            model=IMAGE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"]),
        )
        out = _resolve(output_path, OUT_DIR)
        out.parent.mkdir(parents=True, exist_ok=True)
        notes: list[str] = []
        saved = 0
        for cand in response.candidates or []:
            for part in cand.content.parts or []:
                if getattr(part, "inline_data", None) and part.inline_data.data:
                    target = out if saved == 0 else out.with_name(f"{out.stem}_{saved + 1}{out.suffix}")
                    target.write_bytes(part.inline_data.data)
                    notes.append(f"saved {target}")
                    saved += 1
                elif getattr(part, "text", None):
                    notes.append(part.text.strip())
        if not saved:
            return f"No image returned by {IMAGE_MODEL}. " + " ".join(notes)
        return "\n".join(notes)
    except Exception as e:  # noqa: BLE001 - reported back to the caller
        return f"Error generating image with {IMAGE_MODEL}: {e} (see list_models for ids your key can use)"


@mcp.tool()
def analyze_image(image_path: str, prompt: str) -> str:
    """Ask Gemini about a local image (a screenshot, a generated sheet, a UI mockup)."""
    try:
        from PIL import Image

        response = client().models.generate_content(model=TEXT_MODEL, contents=[prompt, Image.open(_resolve(image_path, REPO))])
        return response.text or "(no text returned)"
    except Exception as e:  # noqa: BLE001
        return f"Error analyzing image with {TEXT_MODEL}: {e}"


@mcp.tool()
def list_models() -> str:
    """List the Gemini model ids available to this API key (image-capable ones are marked)."""
    try:
        rows = []
        for m in client().models.list():
            name = m.name.removeprefix("models/")
            actions = ",".join(getattr(m, "supported_actions", None) or [])
            rows.append(f"{name}{'  [image]' if 'image' in name else ''}  {actions}")
        return "\n".join(sorted(rows)) or "(no models)"
    except Exception as e:  # noqa: BLE001
        return f"Error listing models: {e}"


if __name__ == "__main__":
    mcp.run()
