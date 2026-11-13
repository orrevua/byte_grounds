# Chess pieces

`pieces.png` (6 columns K Q R B N P; row 0 white, row 1 black; 48px cells) was generated with
Google Gemini (via `tools/gemini_mcp.py`) for the project owner (source
`art/gemini/chess_pieces.png`, git-ignored), converted with `tools/pixelate_image.py --scale 8.3
--min-blob 20` and cut into cells with `tools/gen_chess_pieces.py`.
