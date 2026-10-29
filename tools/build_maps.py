"""Author-time generator for the built-in maps (`shared/src/maps/<id>.json`).

Each map is laid out in code from a small catalog of whole objects: a sheet rect of 32px cells
plus how it blocks walking, mirroring the editor's stamp rules (`client/src/editor-model.ts`):
  base  object layer, only the bottom row blocks; upper rows get `baseDy` (desks, shelves, sofas)
  all   object layer, every covered tile blocks (big tables)
  free  object layer, nothing blocks (chairs, stools, small items on a table top)
  none  floor layer, nothing blocks (rugs, beds, wall hangings, floor textures)
Objects may not overlap (except `on=` table-top items and chairs tucked under a desk's walkable
top row), every seat must be reachable from the spawn, and every room must connect; the script
refuses to write a map that breaks a rule (`shared/test/maps.test.ts` re-checks the output).
To look at a result, open it in the map editor (`/editor?map=<id>`).

Usage:
    python tools/build_maps.py            # writes shared/src/maps/{office,lounge,home}.json

Author-time only (standard library); the app imports the generated JSON.
"""

import json
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shared" / "src" / "maps"

WALL = "#22262d"


class Obj:
    """A whole sheet object: cell rect (`sx`, `sy`, `w`, `h`) and its block mode."""

    def __init__(self, sheet, sx, sy, w=1, h=1, block="base"):
        self.sheet, self.sx, self.sy, self.w, self.h, self.block = sheet, sx, sy, w, h, block


# ---------- catalog ----------

FACING_COL = {"down": 0, "up": 1, "right": 0, "left": 1}
FACING_ROW = {"down": 0, "up": 0, "right": 1, "left": 1}
COLORS = ["yellow", "red", "blue", "green", "brown", "charcoal", "grey", "white"]


def chair(style_row, color, facing, sheet="chairs"):
    """chairs/armchairs sheets: each style is 2 rows x 2 cols per colour: (front, back) over
    (side facing right, side facing left)."""
    col = COLORS.index(color) * 2 + FACING_COL[facing]
    return Obj(sheet, col, style_row + FACING_ROW[facing], 1, 1, "free")


def armchair(style_row, color, facing):
    o = chair(style_row, color, facing, "armchairs")
    o.block = "base"
    return o


def sofa(color, facing, pattern=0):
    """sofas.png: per colour 2 cols; plain block rows 0-4 (front, front alt, sides x2, back),
    patterned blocks of 4 rows start at 5, 9, 13, 17 (front, sides x2, back)."""
    c = COLORS.index(color) * 2
    top = 0 if pattern == 0 else 1 + 4 * pattern
    side = top + (2 if pattern == 0 else 1)
    back = top + (4 if pattern == 0 else 3)
    if facing == "down":
        return Obj("sofas", c, top, 2, 1, "base")
    if facing == "up":
        return Obj("sofas", c, back, 2, 1, "base")
    return Obj("sofas", c + (0 if facing == "right" else 1), side, 1, 2, "base")


def bar_stool(color):
    return Obj("bar_stools", COLORS.index(color), 0, 1, 1, "free")


def ottoman(color):
    return Obj("ottomans", COLORS.index(color), 4, 1, 1, "free")


CAT = {
    # office.png
    "desk_south": Obj("office", 10, 8, 3, 2),  # knee hole + drawers face the viewer: sit south, face up
    "desk_north": Obj("office", 10, 6, 3, 2),  # modesty panel faces the viewer: sit north, face down
    "copier": Obj("office", 8, 6, 2, 2),
    "laptop_up": Obj("office", 1, 10, 1, 1, "free"),
    "laptop_up_white": Obj("office", 3, 10, 1, 1, "free"),
    "laptop_closed": Obj("office", 0, 13, 1, 1, "free"),
    "laptop_closed_white": Obj("office", 3, 13, 1, 1, "free"),
    "phone_white": Obj("office", 11, 10, 1, 1, "free"),
    "phone_red": Obj("office", 11, 11, 1, 1, "free"),
    "coffee_maker": Obj("office", 10, 0, 1, 1, "free"),
    "mug": Obj("office", 9, 0, 1, 1, "free"),
    "water_cooler": Obj("office", 10, 20, 1, 2),
    "tv": Obj("office", 0, 20, 3, 2),
    "tv_bars": Obj("office", 3, 20, 3, 2),
    "bin": Obj("office", 3, 2, 1, 1),
    "bin_green": Obj("office", 1, 2, 1, 1),
    "sink_pedestal": Obj("office", 1, 14, 1, 2),
    # tables
    "table_white_round": Obj("tables_stools_grid", 2, 0, 2, 2),
    "table_white_small": Obj("tables_stools_grid", 6, 2, 1, 1),
    "table_round_wood": Obj("tables", 0, 2, 1, 1),
    "table_round_oak": Obj("tables", 0, 3, 1, 1),
    "side_table": Obj("tables", 1, 0, 1, 1),
    "coffee_table": Obj("tables", 0, 1, 2, 1),
    "coffee_table_v": Obj("tables", 2, 1, 1, 2, "all"),
    "dining_table": Obj("tables", 0, 5, 3, 4, "all"),
    # kitchen counters (wooden_furniture row 0-1: top + front, they join side by side)
    "k_counter": Obj("wooden_furniture", 5, 0, 1, 2),
    "k_sink": Obj("wooden_furniture", 6, 0, 1, 2),
    "k_stove": Obj("wooden_furniture", 7, 0, 1, 2),
    "k_veg": Obj("wooden_furniture", 8, 0, 1, 2),
    "k_drawers": Obj("wooden_furniture", 9, 0, 1, 2),
    "k_cupboard": Obj("wooden_furniture", 8, 2, 1, 2),
    "k_cupboard2": Obj("wooden_furniture", 9, 2, 1, 2),
    "glass_cabinet": Obj("wooden_furniture", 12, 2, 1, 2),
    "dish_shelf": Obj("wooden_furniture", 13, 4, 1, 2),
    "dresser": Obj("wooden_furniture", 14, 4, 1, 2),
    "wardrobe": Obj("wooden_furniture", 0, 19, 2, 3),
    "vanity": Obj("wooden_furniture", 3, 19, 1, 3),
    "chess_table": Obj("wooden_furniture", 2, 19, 1, 1),
    "clock": Obj("wooden_furniture", 8, 23, 1, 3),
    "fireplace": Obj("wooden_furniture", 12, 23, 3, 3),
    "piano": Obj("wooden_furniture", 2, 26, 2, 2),
    "bed_single_red": Obj("wooden_furniture", 13, 13, 1, 2, "none"),
    "bed_single_white": Obj("wooden_furniture", 15, 13, 1, 2, "none"),
    "nightstand": Obj("wooden_furniture", 15, 2, 1, 2),
    # bar counter (countertops: left end, middle, right end; top row + front row)
    "bar_l": Obj("countertops", 3, 4, 1, 2),
    "bar_m": Obj("countertops", 4, 4, 1, 2),
    "bar_r": Obj("countertops", 5, 4, 1, 2),
    # house_inside
    "bed_double": Obj("house_inside", 0, 5, 2, 3, "none"),
    "wash_basin": Obj("house_inside", 1, 9, 1, 1),
    "rug_runner": Obj("house_inside", 6, 2, 1, 1, "none"),
    # shelves
    "bookshelf": Obj("bookshelf-brown_grid", 0, 0, 2, 2),
    "bookshelf_green": Obj("bookshelf-green_grid", 0, 0, 2, 2),
    "drawer_shelf": Obj("drawer_shelf-brown_grid", 0, 0, 2, 2),
    # lamps & plants
    "floor_lamp": Obj("lamps", 1, 1, 1, 2),
    "table_lamp": Obj("lamps", 0, 3, 1, 1, "free"),
    "table_lamp2": Obj("lamps", 1, 4, 1, 1, "free"),
    "plant_pot": Obj("plants_grid", 0, 0, 1, 1),
    "plant_box": Obj("plants_grid", 1, 1, 1, 2),
    "tree_box": Obj("plants_grid", 2, 0, 1, 3),
    "tree_vase": Obj("plants_grid", 3, 0, 1, 3),
    "fern": Obj("plants_grid", 4, 1, 1, 2),
    "bouquet": Obj("flowers", 0, 1, 1, 1, "free"),
    "bouquet2": Obj("flowers", 4, 1, 1, 1, "free"),
    "bouquet3": Obj("flowers", 5, 2, 1, 1, "free"),
    "screen_blue": Obj("decorative_furniture", 2, 0, 1, 2),
    "grandfather_clock": Obj("decorative_furniture", 0, 2, 1, 3),
    # wall hangings (floor layer, drawn on wall tiles)
    "painting_land": Obj("paintings", 3, 0, 2, 1, "none"),
    "painting_sea": Obj("paintings", 6, 0, 2, 1, "none"),
    "painting_wide": Obj("paintings", 3, 2, 3, 1, "none"),
    "painting_wide2": Obj("paintings", 3, 3, 3, 1, "none"),
    "painting_abstract": Obj("paintings", 4, 4, 2, 1, "none"),
    "portrait": Obj("paintings", 6, 2, 1, 1, "none"),
    "portrait2": Obj("paintings", 7, 3, 1, 1, "none"),
    "painting_beach": Obj("paintings", 7, 4, 1, 1, "none"),
    "painting_rose": Obj("paintings", 7, 5, 1, 1, "none"),
    "curtains_gold": Obj("curtains", 6, 0, 2, 3, "none"),
    "curtains_red": Obj("curtains", 6, 3, 2, 3, "none"),
    "curtains_white": Obj("curtains", 6, 6, 2, 3, "none"),
}

FLOORS = {
    "wood": ("interior", 0, 3),
    "parquet": ("house_inside", 11, 11),
    "checker": ("interior", 0, 4),
    "stone_green": ("interior", 1, 4),
    "tile_cream": ("interior_tiles", 8, 6),
    "stone_beige": ("interior_tiles", 9, 7),
    "rug_rose": ("interior_tiles", 12, 7),
}


# ---------- builder ----------

class MapBuilder:
    def __init__(self, map_id, name, w, h, floor_color):
        self.id, self.name, self.w, self.h = map_id, name, w, h
        self.tiles = [[0] * w for _ in range(h)]
        self.colors = [[floor_color] * w for _ in range(h)]
        self.floor_decor = []
        self.object_decor = []
        self.seats = []
        self.occupied = {}  # (x, y) -> object name, for object-layer and floor objects
        self.spawn = None
        self.rooms = {}
        self.wall_rect(0, 0, w - 1, h - 1)

    # walls / floors
    def wall(self, x, y):
        self.tiles[y][x] = 1
        self.colors[y][x] = WALL

    def wall_rect(self, x0, y0, x1, y1):
        for x in range(x0, x1 + 1):
            self.wall(x, y0)
            self.wall(x, y1)
        for y in range(y0, y1 + 1):
            self.wall(x0, y)
            self.wall(x1, y)

    def hwall(self, y, x0, x1, gaps=()):
        for x in range(x0, x1 + 1):
            if x not in gaps:
                self.wall(x, y)

    def vwall(self, x, y0, y1, gaps=()):
        for y in range(y0, y1 + 1):
            if y not in gaps:
                self.wall(x, y)

    def floor(self, x0, y0, x1, y1, kind):
        sheet, sx, sy = FLOORS[kind]
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if not self.tiles[y][x]:
                    self.floor_decor.append({"x": x, "y": y, "sheet": sheet, "sx": sx, "sy": sy, "layer": "floor"})

    def room(self, name, x, y):
        """A named point inside a room; the build checks each one is reachable from spawn."""
        self.rooms[name] = (x, y)

    # objects
    def put(self, name, x, y, on=None, tuck=False):
        """Stamp a whole catalog object with its top-left on tile (x, y). `on` = a table-top
        item: it sits over an object cell and copies that object's base row. `tuck` = a chair
        pushed under the walkable top row of a desk (it may share that tile)."""
        o = CAT[name] if isinstance(name, str) else name
        label = name if isinstance(name, str) else f"{o.sheet}:{o.sx},{o.sy}"
        cells = []
        for dy in range(o.h):
            for dx in range(o.w):
                tx, ty = x + dx, y + dy
                if not (0 < tx < self.w - 1 and 0 < ty < self.h - 1) and o.block != "none":
                    raise ValueError(f"{self.id}: {label} at ({x},{y}) leaves the map")
                cell = {"x": tx, "y": ty, "sheet": o.sheet, "sx": o.sx + dx, "sy": o.sy + dy}
                if o.block == "none":
                    cell["layer"] = "floor"
                else:
                    cell["layer"] = "object"
                    if on is not None:
                        if on > 0:
                            cell["baseDy"] = on
                    elif o.block == "base" and o.h - 1 - dy > 0:
                        cell["baseDy"] = o.h - 1 - dy
                cells.append(cell)
        if on is None:
            for c in cells:
                key = (c["x"], c["y"])
                if o.block == "none" and self.tiles[c["y"]][c["x"]]:
                    continue  # wall art: the part hanging on a wall tile
                if tuck and key in self.occupied and not self.tiles[c["y"]][c["x"]]:
                    continue
                if key in self.occupied:
                    raise ValueError(f"{self.id}: {label} at ({x},{y}) overlaps {self.occupied[key]} on {key}")
                if self.tiles[c["y"]][c["x"]]:
                    raise ValueError(f"{self.id}: {label} at ({x},{y}) is on a wall at {key}")
                self.occupied[key] = label
        for c in cells:
            (self.floor_decor if c["layer"] == "floor" else self.object_decor).append(c)
            blocks = o.block == "all" or (o.block == "base" and not c.get("baseDy"))
            if blocks and on is None:
                self.tiles[c["y"]][c["x"]] = 1

    def seat(self, x, y, dir, kind="sit"):
        self.seats.append({"x": x, "y": y, "kind": kind, "dir": dir})

    def chair(self, x, y, facing, style=0, color="charcoal", tuck=False):
        self.put(chair(style, color, facing), x, y, tuck=tuck)
        self.seat(x, y, facing)

    def stool(self, x, y, color, facing="up"):
        self.put(bar_stool(color), x, y)
        self.seat(x, y, facing)

    def sofa(self, x, y, color, facing, pattern=0):
        o = sofa(color, facing, pattern)
        if o.h > 1:
            o.block = "all"  # a side view runs north-south: all of it is seat
        self.put(o, x, y)
        for dy in range(o.h):
            for dx in range(o.w):
                self.seat(x + dx, y + dy, facing)

    def armchair(self, x, y, color, facing, style=4):
        self.put(armchair(style, color, facing), x, y)
        self.seat(x, y, facing)

    def bed(self, name, x, y):
        """Beds face down: lie on the pillow row, feet toward the viewer."""
        o = CAT[name]
        self.put(name, x, y)
        for dx in range(o.w):
            self.seat(x + dx, y, "down", "lie")

    # checks + output
    def walkable(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and not self.tiles[y][x]

    def reachable(self):
        sx, sy = int(self.spawn[0]), int(self.spawn[1])
        seen = {(sx, sy)}
        q = deque([(sx, sy)])
        while q:
            x, y = q.popleft()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if (nx, ny) not in seen and self.walkable(nx, ny):
                    seen.add((nx, ny))
                    q.append((nx, ny))
        return seen

    def check(self):
        sx, sy = int(self.spawn[0]), int(self.spawn[1])
        if not self.walkable(sx, sy):
            raise ValueError(f"{self.id}: spawn ({sx},{sy}) is blocked")
        seen = self.reachable()
        for name, p in self.rooms.items():
            if p not in seen:
                raise ValueError(f"{self.id}: room {name} at {p} is unreachable")
        for st in self.seats:
            x, y = st["x"], st["y"]
            near = [(x, y), (x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
            if not any(p in seen for p in near):
                raise ValueError(f"{self.id}: seat {st} is unreachable")
        if len({(st["x"], st["y"]) for st in self.seats}) != len(self.seats):
            raise ValueError(f"{self.id}: two seats share a tile")

    def to_json(self):
        self.check()
        return {
            "id": self.id,
            "name": self.name,
            "width": self.w,
            "height": self.h,
            "tiles": [t for row in self.tiles for t in row],
            "spawn": {"x": self.spawn[0], "y": self.spawn[1]},
            "colors": [c for row in self.colors for c in row],
            "decor": self.floor_decor + self.object_decor,
            "seats": self.seats,
        }


def write(m):
    data = m.to_json()
    w = data["width"]
    rows = [json.dumps(data["tiles"][i : i + w]) for i in range(0, len(data["tiles"]), w)]
    crow = [json.dumps(data["colors"][i : i + w]) for i in range(0, len(data["colors"]), w)]
    parts = [
        f'  "id": {json.dumps(data["id"])}',
        f'  "name": {json.dumps(data["name"])}',
        f'  "width": {w}',
        f'  "height": {data["height"]}',
        '  "tiles": [\n    ' + ",\n    ".join(r[1:-1] for r in rows) + "\n  ]",
        f'  "spawn": {json.dumps(data["spawn"])}',
        '  "colors": [\n    ' + ",\n    ".join(r[1:-1] for r in crow) + "\n  ]",
        '  "decor": [\n    ' + ",\n    ".join(json.dumps(d, separators=(",", ":")) for d in data["decor"]) + "\n  ]",
        '  "seats": [\n    ' + ",\n    ".join(json.dumps(s, separators=(",", ":")) for s in data["seats"]) + "\n  ]",
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{m.id}.json").write_text("{\n" + ",\n".join(parts) + "\n}\n", encoding="utf-8")
    print(f"{m.id}: {w}x{data['height']}, {len(data['decor'])} decor cells, {len(data['seats'])} seats")


# ---------- maps ----------

def build_office():
    m = MapBuilder("office", "Office", 48, 32, "#4b5568")
    # Meeting room (top right), break room (bottom right), library (bottom left), lobby.
    m.vwall(31, 1, 30, gaps=(9, 10, 19, 20, 21, 27, 28))
    m.hwall(13, 32, 46)
    m.hwall(22, 1, 14, gaps=(11, 12, 13))
    m.vwall(15, 22, 30)
    m.floor(32, 1, 46, 12, "parquet")
    m.floor(32, 14, 46, 30, "tile_cream")
    m.floor(1, 23, 14, 30, "wood")
    m.floor(16, 22, 30, 30, "stone_beige")
    m.floor(36, 23, 43, 28, "rug_rose")
    m.floor(3, 26, 7, 29, "rug_rose")

    # Open plan: six back-to-back desk pods (4 desks each), chairs facing their desk.
    for py in (3, 10):
        for px in (3, 11, 19):
            for dx in (0, 3):
                m.put("desk_north", px + dx, py)
                m.chair(px + dx + 1, py, "down", 4, "charcoal", tuck=True)
                m.put("desk_south", px + dx, py + 2)
                m.chair(px + dx + 1, py + 4, "up", 4, "charcoal")
                m.put("laptop_up" if dx == 0 else "laptop_up_white", px + dx + 1, py + 2, on=1)
                m.put("laptop_closed" if dx == 0 else "laptop_closed_white", px + dx + 2, py, on=1)
                m.put("phone_white" if dx == 0 else "phone_red", px + dx, py, on=1)
    # Huddle tables between the pods and the library.
    for tx in (5, 13, 21):
        m.put("table_white_round", tx, 17)
        for dx in (0, 1):
            m.chair(tx + dx, 17, "down", 4, "grey", tuck=True)
            m.chair(tx + dx, 19, "up", 4, "grey")
    m.put("tree_vase", 1, 1)
    m.put("fern", 1, 9)
    m.put("fern", 1, 17)
    m.put("bookshelf", 25, 1)
    m.put("drawer_shelf", 27, 1)
    m.put("copier", 29, 1)
    m.put("bin", 30, 4)
    m.put("water_cooler", 29, 10)
    m.put("tree_box", 27, 10)
    m.put("plant_box", 30, 16)
    m.put("painting_wide", 9, 0)
    m.put("painting_land", 16, 0)
    m.put("painting_abstract", 21, 0)

    # Meeting room: a 3x4 table for ten, a screen on the north wall.
    m.put("tv_bars", 38, 1)
    m.put("dining_table", 38, 5)
    for dx in range(3):
        m.chair(38 + dx, 4, "down", 4, "grey")
        m.chair(38 + dx, 9, "up", 4, "grey")
    for dy in (1, 2):
        m.chair(37, 5 + dy, "right", 4, "grey")
        m.chair(41, 5 + dy, "left", 4, "grey")
    m.put("laptop_up", 39, 7, on=0)
    m.put("tree_vase", 32, 1)
    m.put("drawer_shelf", 34, 1)
    m.put("bookshelf", 43, 1)
    m.put("tree_vase", 46, 1)
    m.put("fern", 46, 10)
    m.put("floor_lamp", 33, 11)
    m.put("table_round_oak", 34, 9)
    m.chair(33, 9, "right", 4, "grey")
    m.chair(35, 9, "left", 4, "grey")
    m.put("water_cooler", 44, 10)
    m.put("painting_sea", 34, 0)
    m.put("portrait", 45, 0)

    # Break room: kitchenette, café tables, a sofa corner on a rug.
    for i, name in enumerate(["k_cupboard", "k_counter", "k_sink", "k_counter", "k_drawers", "k_stove", "k_veg", "k_cupboard2"]):
        m.put(name, 33 + i, 14)
    m.put("coffee_maker", 36, 14, on=1)
    m.put("mug", 34, 14, on=1)
    m.put("water_cooler", 42, 14)
    m.put("glass_cabinet", 43, 14)
    m.put("tree_vase", 46, 14)
    m.put("painting_wide2", 38, 13)
    for tx in (35, 39, 43):
        m.put("table_round_wood", tx, 18)
        m.chair(tx - 1, 18, "right", 8, "yellow")
        m.chair(tx + 1, 18, "left", 8, "yellow")
    m.sofa(38, 23, "blue", "down")
    m.sofa(40, 23, "blue", "down")
    m.put("coffee_table", 39, 25)
    m.put("bouquet2", 39, 25, on=0)
    m.armchair(36, 25, "blue", "right")
    m.armchair(43, 25, "blue", "left")
    m.sofa(39, 27, "blue", "up")
    m.put("floor_lamp", 36, 23)
    m.put("floor_lamp", 43, 23)
    m.put("fern", 32, 23)
    m.put("plant_box", 46, 28)

    # Library: shelves along the north wall, a reading corner, one quiet desk.
    for i, name in enumerate(["bookshelf", "bookshelf_green", "bookshelf", "drawer_shelf", "bookshelf_green"]):
        m.put(name, 1 + 2 * i, 23)
    m.put("grandfather_clock", 14, 23)
    for dy in (0, 1):
        m.armchair(3, 27 + dy, "green", "right")
        m.armchair(7, 27 + dy, "green", "left")
    m.put("coffee_table_v", 5, 27)
    m.put("floor_lamp", 2, 25)
    m.put("desk_south", 10, 26)
    m.put("table_lamp", 10, 26, on=1)
    m.put("laptop_up", 11, 26, on=1)
    m.chair(11, 28, "up", 4, "green")
    m.put("fern", 1, 29)
    m.put("plant_box", 14, 29)

    # Lobby: reception desk facing the entrance, waiting sofas.
    m.put("desk_north", 22, 24)
    m.chair(23, 24, "down", 4, "charcoal", tuck=True)
    m.put("phone_red", 22, 24, on=1)
    m.put("laptop_closed", 24, 24, on=1)
    m.put("bouquet3", 24, 25, on=0)
    m.floor(16, 25, 20, 29, "rug_rose")
    m.floor(26, 25, 30, 29, "rug_rose")
    for sx, facing, table_x in ((16, "right", 18), (30, "left", 28)):
        m.sofa(sx, 26, "grey", facing)
        m.put("coffee_table_v", table_x, 26)
        m.armchair(table_x, 28, "grey", "up")
        m.armchair(table_x, 24, "grey", "down")
    m.put("tree_vase", 16, 22)
    m.put("tree_vase", 30, 22)
    m.put("plant_box", 19, 29)
    m.put("plant_box", 27, 29)
    m.put("water_cooler", 18, 22)

    m.spawn = (23.5, 28.5)
    for name, p in {"open plan": (10, 8), "meeting": (35, 8), "break": (40, 20), "library": (9, 25), "lobby": (23, 27)}.items():
        m.room(name, *p)
    return m


def build_lounge():
    m = MapBuilder("lounge", "Lounge & Café", 44, 30, "#4a3f36")
    m.vwall(25, 1, 28, gaps=tuple(range(11, 18)))
    m.floor(1, 1, 24, 28, "stone_beige")
    m.floor(1, 1, 16, 3, "checker")
    m.floor(26, 1, 42, 28, "parquet")
    m.floor(29, 5, 37, 11, "rug_rose")
    m.floor(34, 19, 41, 26, "rug_rose")

    # Coffee bar: back counter on the north wall, bar counter with stools in front.
    back = ["k_cupboard", "k_counter", "k_counter", "k_sink", "k_counter", "k_drawers", "k_counter", "k_veg", "k_counter", "k_cupboard2"]
    for i, name in enumerate(back):
        m.put(name, 2 + i, 1)
    m.put("coffee_maker", 3, 1, on=1)
    m.put("coffee_maker", 4, 1, on=1)
    m.put("mug", 6, 1, on=1)
    m.put("coffee_maker", 8, 1, on=1)
    m.put("glass_cabinet", 12, 1)
    m.put("dish_shelf", 13, 1)
    m.put("bar_l", 3, 4)
    for x in range(4, 14):
        m.put("bar_m", x, 4)
    m.put("bar_r", 14, 4)
    for x, item in ((5, "mug"), (7, "bouquet3"), (10, "mug"), (12, "coffee_maker")):
        m.put(item, x, 4, on=1)
    for i, x in enumerate(range(4, 14, 2)):
        m.stool(x, 6, ["red", "yellow", "green", "blue", "brown"][i])
    m.put("tree_box", 16, 1)
    m.put("painting_wide", 18, 0)
    m.put("curtains_red", 21, 0)

    # Café floor: round tables for four, small tables for two.
    for ty in (9, 14, 19):
        for tx in (3, 9, 15):
            m.put("table_white_round", tx, ty)
            for dx in (0, 1):
                m.chair(tx + dx, ty, "down", 8, "green", tuck=True)
                m.chair(tx + dx, ty + 2, "up", 8, "green")
    for tx in (3, 8, 13, 18):
        m.put("table_white_small", tx, 24)
        m.put("mug", tx, 24, on=0)
        m.chair(tx - 1, 24, "right", 8, "green")
        m.chair(tx + 1, 24, "left", 8, "green")
    for ty in (10, 15, 20):
        m.put("table_white_small", 21, ty)
        m.put("bouquet3" if ty == 15 else "mug", 21, ty, on=0)
        m.chair(20, ty, "right", 8, "green")
        m.chair(22, ty, "left", 8, "green")
    m.put("tree_vase", 23, 5)
    m.put("fern", 1, 12)
    m.put("fern", 1, 17)
    m.put("plant_box", 23, 24)
    m.put("floor_lamp", 23, 27)

    # Lounge: fireplace with sofas facing it, an L of sofas, piano, chess.
    m.put("bookshelf", 27, 1)
    m.put("bookshelf_green", 29, 1)
    m.put("fireplace", 32, 1)
    m.put("bookshelf_green", 35, 1)
    m.put("bookshelf", 37, 1)
    m.put("curtains_gold", 40, 0)
    m.armchair(30, 7, "red", "right")
    m.armchair(36, 7, "red", "left")
    m.put("coffee_table", 32, 7)
    m.put("bouquet", 32, 7, on=0)
    m.sofa(31, 10, "red", "up")
    m.sofa(33, 10, "red", "up")
    m.put("floor_lamp", 29, 9)
    m.put("floor_lamp", 37, 9)
    m.sofa(35, 19, "green", "down", 2)
    m.sofa(37, 19, "green", "down", 2)
    m.sofa(40, 21, "green", "left", 2)
    m.put("coffee_table", 36, 22)
    m.put("table_lamp2", 37, 22, on=0)
    m.sofa(35, 25, "green", "up", 2)
    m.sofa(37, 25, "green", "up", 2)
    m.put("piano", 27, 20)
    m.put(ottoman("brown"), 27, 22)
    m.seat(27, 22, "up")
    for tx in (35, 39):
        m.put("table_round_wood", tx, 15)
        m.put("bouquet2" if tx == 35 else "mug", tx, 15, on=0)
        m.armchair(tx - 1, 15, "brown", "right", 0)
        m.armchair(tx + 1, 15, "brown", "left", 0)
    m.put("chess_table", 31, 15)
    m.armchair(30, 15, "brown", "right")
    m.armchair(32, 15, "brown", "left")
    m.put("tree_vase", 42, 5)
    m.put("tree_vase", 42, 14)
    m.put("fern", 26, 26)
    m.put("plant_box", 42, 27)
    m.put("painting_land", 27, 0)
    m.put("grandfather_clock", 26, 12)

    m.spawn = (20.5, 27.5)
    for name, p in {"bar": (9, 3), "café": (12, 21), "lounge": (33, 13), "sofas": (38, 23)}.items():
        m.room(name, *p)
    return m


def build_home():
    m = MapBuilder("home", "Home", 40, 30, "#4a4038")
    m.hwall(12, 1, 20, gaps=tuple(range(7, 13)))
    m.vwall(21, 1, 28, gaps=(20, 21))
    m.hwall(12, 22, 38, gaps=(24, 25))
    m.vwall(28, 13, 28, gaps=(16, 17, 25, 26))
    m.hwall(21, 29, 38)
    m.floor(1, 1, 9, 11, "checker")
    m.floor(10, 1, 20, 11, "parquet")
    m.floor(1, 13, 20, 28, "parquet")
    m.floor(2, 16, 8, 21, "rug_rose")
    m.floor(13, 18, 18, 22, "rug_rose")
    m.floor(22, 1, 38, 11, "parquet")
    m.floor(29, 13, 38, 20, "stone_beige")
    m.floor(29, 22, 38, 28, "stone_green")
    m.floor(22, 13, 27, 28, "tile_cream")
    m.floor(29, 4, 32, 6, "rug_rose")
    m.floor(4, 24, 8, 27, "rug_rose")

    # Kitchen + dining.
    for i, name in enumerate(["k_cupboard", "k_counter", "k_sink", "k_counter", "k_stove", "k_drawers", "k_veg", "k_cupboard2"]):
        m.put(name, 1 + i, 1)
    m.put("coffee_maker", 2, 1, on=1)
    m.put("bar_l", 2, 5)
    for x in range(3, 6):
        m.put("bar_m", x, 5)
    m.put("bar_r", 6, 5)
    m.put("bouquet3", 4, 5, on=1)
    for x in (3, 5):
        m.stool(x, 7, "brown")
    m.put("glass_cabinet", 10, 1)
    m.put("dish_shelf", 11, 1)
    m.put("dining_table", 14, 4)
    m.put("bouquet", 15, 6, on=0)
    for dx in range(3):
        m.chair(14 + dx, 3, "down", 0, "brown")
        m.chair(14 + dx, 8, "up", 0, "brown")
    for dy in (1, 2):
        m.chair(13, 4 + dy, "right", 0, "brown")
        m.chair(17, 4 + dy, "left", 0, "brown")
    m.put("tree_vase", 20, 1)
    m.put("painting_sea", 14, 0)
    m.put("fern", 1, 9)
    m.put("bin_green", 9, 1)

    # Living room: TV corner on a rug, fireplace corner, reading shelf.
    m.put("bookshelf", 1, 13)
    m.put("tv", 4, 14)
    m.put("coffee_table", 4, 17)
    m.armchair(2, 17, "yellow", "right")
    m.armchair(7, 17, "yellow", "left")
    m.sofa(4, 19, "brown", "up")
    m.put("floor_lamp", 2, 19)
    m.put("fireplace", 14, 13)
    m.put("bookshelf_green", 17, 13)
    m.put("grandfather_clock", 20, 13)
    m.armchair(14, 18, "green", "up")
    m.armchair(16, 18, "green", "up")
    m.put("side_table", 15, 18)
    m.put("table_lamp2", 15, 18, on=0)
    m.sofa(14, 21, "green", "up", 1)
    m.put("chess_table", 6, 25)
    m.armchair(5, 25, "brown", "right", 0)
    m.armchair(7, 25, "brown", "left", 0)
    m.put("piano", 1, 25)
    m.put(ottoman("red"), 2, 27)
    m.seat(2, 27, "up")
    m.put("tree_vase", 20, 25)
    m.put("fern", 10, 26)
    m.put("plant_box", 13, 27)
    m.put("painting_wide2", 2, 12)
    m.put("painting_land", 15, 12)

    # Bedroom: double bed between nightstands, wardrobe, vanity.
    m.put("nightstand", 29, 1)
    m.bed("bed_double", 30, 1)
    m.put("nightstand", 32, 1)
    m.put("table_lamp", 29, 1, on=1)
    m.put("table_lamp", 32, 1, on=1)
    m.put("curtains_white", 33, 0)
    m.put("wardrobe", 36, 1)
    m.put("vanity", 23, 1)
    m.chair(23, 4, "up", 2, "white")
    m.put("dresser", 26, 1)
    m.armchair(37, 8, "red", "left")
    m.put("side_table", 36, 8)
    m.put("tree_vase", 38, 4)
    m.put("fern", 22, 9)
    m.put("portrait2", 27, 0)

    # Second bedroom: two single beds, a desk.
    m.bed("bed_single_red", 31, 13)
    m.put("nightstand", 33, 13)
    m.bed("bed_single_white", 35, 13)
    m.put("desk_south", 33, 17)
    m.put("laptop_up", 34, 17, on=1)
    m.chair(34, 19, "up", 4, "blue")
    m.put("bookshelf_green", 37, 19)
    m.put("plant_pot", 29, 13)
    m.put("painting_beach", 34, 12)

    # Bathroom corner.
    m.put("wash_basin", 30, 22)
    m.put("vanity", 32, 22)
    m.put("sink_pedestal", 34, 22)
    m.put("screen_blue", 37, 22)
    m.put("screen_blue", 38, 22)
    m.put("rug_runner", 33, 26)
    m.put("plant_pot", 38, 28)
    m.put("drawer_shelf", 29, 27)

    # Hall: entrance, coat corner.
    m.put("tree_vase", 22, 13)
    m.put(Obj("ottomans", 4, 3, 2, 1, "base"), 26, 14)
    m.seat(26, 14, "down")
    m.seat(27, 14, "down")
    m.put("clock", 27, 21)
    m.put("floor_lamp", 22, 22)
    m.put("painting_rose", 26, 12)

    m.spawn = (24.5, 27.5)
    for name, p in {"kitchen": (5, 9), "living": (10, 20), "bedroom": (30, 8), "kids": (32, 16), "bath": (33, 25), "hall": (24, 20)}.items():
        m.room(name, *p)
    return m


if __name__ == "__main__":
    for build in (build_office, build_lounge, build_home):
        write(build())


