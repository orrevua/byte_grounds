# Decoration art

Every `.png` in this folder shows up in the map editor's **Decoration** picker (the file name,
without `.png`, is the sheet's name). Sheets are cut into 32×32 squares, the LPC grid, so use
32px LPC-style tilesheets. After adding files, commit and push; Vercel rebuilds and they appear.

Keep file names stable: maps refer to sheets by name, so renaming a file makes its pieces
disappear from maps that use it.

## Suggested free LPC packs (same style as the characters)

Download from OpenGameArt, unzip, and copy the **PNG sheets** here:

- [LPC] House interior and decorations (Reemax): https://opengameart.org/content/lpc-house-interior-and-decorations
- LPC Interior castle tiles (Lanea Zimmerman / Sharm): https://opengameart.org/content/lpc-interior-castle-tiles
- [LPC] Upholstery: chairs, couches, beds (bluecarrot16): https://opengameart.org/node/94814
- LPC shelves rework: https://opengameart.org/content/lpc-shelves-rework

Before adding a pack, check its license on its page (most LPC art is CC-BY-SA 3.0 and/or
GPL 3.0, which require crediting the authors) and add an entry to `CREDITS.md` below.
