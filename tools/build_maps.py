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
Seats on chairs, sofas, stools and beds are automatic (derived in the app from
`shared/src/seat-catalog.json`), so the JSON keeps only the seats that differ from the derived one
on their tile (overrides); the layout code still calls `seat()` for every seat it means.
To look at a result, open it in the map editor (`/editor?map=<id>`).
Bump a map's `rev` (the MapBuilder argument after its name) whenever its layout changes: a copy
saved in the editor from an older revision then stops hiding the new built-in.

Usage:
    python tools/build_maps.py            # writes shared/src/maps/{office,lounge,home}.json

Author-time only (standard library); the app imports the generated JSON.
"""

import json
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shared" / "src" / "maps"
SEAT_CATALOG = ROOT / "shared" / "src" / "seat-catalog.json"

WALL = "#22262d"
# The north wall's face, behind its wall art and windows.
WALL_FACE = "#cdbf9f"


class Obj:
    """A whole sheet object: cell rect (`sx`, `sy`, `w`, `h`) and its block mode."""

    def __init__(self, sheet, sx, sy, w=1, h=1, block="base"):
        self.sheet, self.sx, self.sy, self.w, self.h, self.block = sheet, sx, sy, w, h, block


def load_seat_catalog():
    """(sheet, sx, sy) -> (kind, dir), expanded like `shared/src/seats.ts`: each rule covers its
    rect with a stride, later rules override earlier ones, `none` removes cells."""
    index = {}
    for r in json.loads(SEAT_CATALOG.read_text(encoding="utf-8"))["rules"]:
        step_x, step_y = r.get("step", [1, 1])
        for dy in range(0, r.get("h", 1), step_y):
            for dx in range(0, r.get("w", 1), step_x):
                key = (r["sheet"], r["x"] + dx, r["y"] + dy)
                if r["kind"] == "none":
                    index.pop(key, None)
                else:
                    index[key] = (r["kind"], r["dir"])
    return index


SEAT_SPOTS = load_seat_catalog()


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


# Gemini Studio pieces (client/src/assets/decor/byte_grounds_studio_grid.png, made with Gemini; see
# tools/pixelate_image.py). Chairs are 1x2: the seat is the lower cell.
G = "byte_grounds_studio_grid"
GEMINI = {
    "g_round_table": Obj(G, 0, 0, 2, 2),
    "g_tv": Obj(G, 2, 0, 2, 2),
    "g_conf_table": Obj(G, 4, 0, 5, 2),
    "g_whiteboard": Obj(G, 9, 0, 2, 2),
    "g_chair_down": Obj(G, 0, 2, 1, 2, "free"),
    "g_chair_up": Obj(G, 1, 2, 1, 2, "free"),
    "g_chair_right": Obj(G, 2, 2, 1, 2, "free"),
    "g_water": Obj(G, 4, 2, 1, 2),
    "g_vending": Obj(G, 5, 2, 2, 2),
    "g_bookshelf": Obj(G, 7, 2, 2, 2),
    "g_monstera": Obj(G, 9, 2, 2, 2),
    "g_coffee_bar": Obj(G, 0, 4, 2, 2),
    "g_cactus": Obj(G, 2, 4, 1, 2),
    "g_sofa": Obj(G, 3, 4, 2, 2),
    "g_armchair": Obj(G, 5, 4, 2, 2),
    "g_lamp": Obj(G, 7, 4, 1, 2),
    "g_beanbag": Obj(G, 8, 4, 2, 2),
    "g_coffee_table": Obj(G, 0, 6, 2, 1, "all"),
    "g_rug": Obj(G, 2, 6, 2, 1, "none"),
}
O2 = "byte_grounds_office2_grid"
B = "byte_grounds_building_grid"
H = "byte_grounds_home_grid"
LV = "byte_grounds_living_grid"
PL = "byte_grounds_plants_grid"
CF = "byte_grounds_cafe_grid"
BD = "byte_grounds_bedroom_grid"
GEMINI.update({
    # office2: desks (front = monitor faces the viewer: sit south, face up), equipment, big tables
    "o2_desk_pc": Obj(O2, 0, 0, 3, 2),
    "o2_desk_back": Obj(O2, 3, 0, 3, 2),
    "o2_l_desk": Obj(O2, 6, 0, 3, 2),
    "o2_stand_desk": Obj(O2, 9, 0, 2, 2),
    "o2_cabinet": Obj(O2, 0, 2, 1, 2),
    "o2_copier": Obj(O2, 1, 2, 2, 2),
    "o2_server": Obj(O2, 3, 2, 1, 2),
    "o2_lockers": Obj(O2, 4, 2, 2, 2),
    "o2_bin": Obj(O2, 6, 2, 1, 1),
    "o2_boxes": Obj(O2, 7, 2, 2, 2),
    "o2_booth": Obj(O2, 9, 2, 1, 2),
    "o2_chair_black": Obj(O2, 10, 2, 1, 2, "free"),  # front view: faces the viewer (sit facing down)
    "o2_chair_down": Obj(O2, 0, 4, 1, 2, "free"),  # front view too
    "o2_side_table": Obj(O2, 0, 6, 1, 1),
    "o2_projector": Obj(O2, 2, 4, 2, 2),
    "o2_corkboard": Obj(O2, 4, 4, 2, 2),
    "o2_fig": Obj(O2, 6, 4, 1, 2),
    "o2_arc_lamp": Obj(O2, 7, 4, 2, 2),
    "o2_water": Obj(O2, 9, 4, 1, 2),
    "o2_drinks": Obj(O2, 10, 4, 1, 2),
    "o2_long_table": Obj(O2, 0, 7, 7, 2),
    "o2_oval_table": Obj(O2, 0, 11, 5, 3),
    # building: wall art (2 rows: hangs on the 2-tile north wall), doors, reception, small items
    "b_wall_cream": Obj(B, 0, 0, 3, 2, "none"),
    "b_wall_lilac": Obj(B, 3, 0, 3, 2, "none"),
    "b_window": Obj(B, 6, 0, 3, 2, "none"),
    "b_pillar": Obj(B, 9, 0, 1, 2, "none"),
    "b_door": Obj(B, 10, 0, 1, 2, "none"),
    "b_clock": Obj(B, 6, 2, 1, 1, "none"),
    "b_painting": Obj(B, 7, 2, 1, 1, "none"),
    "b_wall_tv": Obj(B, 8, 2, 2, 1, "none"),
    "b_wall_shelf": Obj(B, 0, 4, 2, 1, "none"),
    "b_extinguisher": Obj(B, 2, 4, 1, 1),
    "b_reception": Obj(B, 3, 4, 2, 2),
    "b_column": Obj(B, 7, 4, 1, 2),
    "b_coat": Obj(B, 8, 4, 1, 2),
    "b_mat": Obj(B, 0, 6, 2, 1, "none"),
    "b_bin": Obj(B, 2, 6, 1, 1),
    # home
    "h_bed_quilt": Obj(H, 0, 0, 2, 2),
    "h_bed_double": Obj(H, 2, 0, 2, 2),
    "h_nightstand": Obj(H, 4, 0, 1, 2),
    "h_wardrobe": Obj(H, 5, 0, 2, 2),
    "h_sink_mirror": Obj(H, 7, 0, 1, 2),
    "h_shower": Obj(H, 8, 0, 2, 2),
    "h_bathtub": Obj(H, 0, 2, 2, 1),
    "h_toilet": Obj(H, 2, 2, 1, 2),
    "h_towels": Obj(H, 3, 2, 1, 2),
    "h_fridge": Obj(H, 4, 2, 1, 2),
    "h_chair": Obj(H, 5, 2, 1, 2, "free"),
    "h_kitchen_sink": Obj(H, 6, 2, 2, 2),
    "h_stove": Obj(H, 8, 2, 1, 2),
    "h_microwave": Obj(H, 9, 2, 2, 2),
    "h_table": Obj(H, 0, 4, 2, 2),
    "h_fireplace": Obj(H, 2, 4, 2, 2),
    "h_piano": Obj(H, 4, 4, 2, 2),
    "h_aquarium": Obj(H, 6, 4, 2, 2),
    "h_tv": Obj(H, 8, 4, 2, 2),
    "h_armchair": Obj(H, 0, 6, 2, 2),
    "h_palm": Obj(H, 2, 6, 2, 2),
    # byte_grounds_living: pastel sofas / armchairs (front = facing the viewer, back = facing up)
    "lv_sofa_front": Obj(LV, 0, 0, 4, 2),
    "lv_sofa_back": Obj(LV, 4, 0, 4, 2),
    "lv_armchair_front": Obj(LV, 8, 0, 3, 2),
    "lv_armchair_back": Obj(LV, 0, 2, 3, 2),
    "lv_sofa3": Obj(LV, 3, 2, 3, 2),
    "lv_armchair_blue": Obj(LV, 6, 2, 3, 2),
    "lv_side_lamp": Obj(LV, 9, 2, 1, 2),
    "lv_coffee_table": Obj(LV, 0, 4, 2, 2),
    "lv_tv": Obj(LV, 2, 4, 2, 2),
    "lv_bookshelf": Obj(LV, 4, 4, 2, 2),
    "lv_floor_lamp": Obj(LV, 6, 4, 1, 2),
    "lv_rug_stripes": Obj(LV, 8, 6, 3, 1, "none"),
    "lv_sideboard": Obj(LV, 7, 4, 3, 2),
    "lv_rug_pink": Obj(LV, 0, 6, 3, 2, "none"),
    "lv_pouf": Obj(LV, 3, 6, 3, 2, "free"),
    "lv_bench": Obj(LV, 6, 6, 2, 1),
    # byte_grounds_plants
    "p_monstera": Obj(PL, 0, 0, 2, 3),
    "p_snake": Obj(PL, 2, 0, 1, 2),
    "p_fig": Obj(PL, 3, 0, 2, 3),
    "p_olive": Obj(PL, 5, 0, 2, 3),
    "p_succulents": Obj(PL, 7, 0, 2, 2),
    "p_cactus": Obj(PL, 9, 0, 1, 2),
    "p_pothos": Obj(PL, 0, 3, 2, 2),
    "p_bonsai": Obj(PL, 2, 3, 2, 2),
    "p_tulips": Obj(PL, 4, 3, 1, 2),
    "p_sunflowers": Obj(PL, 5, 3, 2, 2),
    "p_lavender": Obj(PL, 7, 3, 1, 2),
    "p_daisies": Obj(PL, 8, 3, 1, 2),
    "p_planter": Obj(PL, 0, 5, 3, 2),
    "p_hanging": Obj(PL, 3, 5, 2, 2),
    "p_pampas": Obj(PL, 5, 5, 2, 2),
    "p_bush": Obj(PL, 7, 5, 2, 2),
    # byte_grounds_cafe (counter = coffee machine, pastry case = snacks, cooler = water)
    "c_counter": Obj(CF, 0, 0, 5, 3),
    "c_pastry": Obj(CF, 5, 0, 3, 2),
    "c_fridge": Obj(CF, 8, 0, 1, 2),
    "c_round_table": Obj(CF, 9, 0, 2, 2),
    "c_chair_down": Obj(CF, 0, 3, 1, 2, "free"),
    "c_chair_up": Obj(CF, 1, 3, 1, 2, "free"),
    "c_stool_yellow": Obj(CF, 2, 3, 1, 2, "free"),
    "c_stool_mint": Obj(CF, 3, 3, 1, 2, "free"),
    "c_water": Obj(CF, 4, 3, 1, 2),
    "c_sink": Obj(CF, 5, 3, 3, 2),
    "c_stove": Obj(CF, 8, 3, 3, 2),
    "c_table_two": Obj(CF, 0, 5, 3, 2),
    "c_menu": Obj(CF, 3, 5, 2, 2),
    "c_shelf": Obj(CF, 5, 5, 2, 1),
    "c_microwave": Obj(CF, 7, 5, 2, 2),
    "c_bins": Obj(CF, 9, 5, 2, 2),
    # byte_grounds_bedroom (same scale as the pastel living set)
    "bd_bed_double": Obj(BD, 0, 0, 3, 3),
    "bd_bed_single": Obj(BD, 3, 0, 3, 2),
    "bd_wardrobe": Obj(BD, 6, 0, 2, 3),
    "bd_dresser": Obj(BD, 8, 0, 2, 2),
    "bd_nightstand": Obj(BD, 10, 0, 1, 2),
    "bd_desk": Obj(BD, 0, 3, 2, 2),
    "bd_chair_down": Obj(BD, 2, 3, 1, 2, "free"),
    "bd_chair_up": Obj(BD, 3, 3, 1, 2, "free"),
    "bd_basket": Obj(BD, 4, 3, 1, 1),
    "bd_bathtub": Obj(BD, 5, 3, 3, 2),
    "bd_toilet": Obj(BD, 8, 3, 1, 2),
    "bd_sink": Obj(BD, 9, 3, 1, 2),
    "bd_shower": Obj(BD, 0, 5, 2, 2),
    "bd_towels": Obj(BD, 2, 5, 2, 2),
    "bd_mirror": Obj(BD, 4, 5, 1, 2),
    "bd_toy_chest": Obj(BD, 5, 5, 2, 2),
    "bd_toy_shelf": Obj(BD, 7, 5, 2, 2),
    "bd_plant_stool": Obj(BD, 9, 5, 2, 2),
    "bd_bath_mat": Obj(BD, 0, 7, 2, 2, "none"),
})
# Gemini floor textures (byte_grounds_floors.png): 3x3-cell seamless blocks, in this order.
GEMINI_FLOORS = ["oak", "lavender", "grey", "stone", "teal", "walnut"]

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
    def __init__(self, map_id, name, rev, w, h, floor_color):
        self.id, self.name, self.rev, self.w, self.h = map_id, name, rev, w, h
        self.tiles = [[0] * w for _ in range(h)]
        self.colors = [[floor_color] * w for _ in range(h)]
        self.floor_decor = []
        self.object_decor = []
        self.seats = []
        self.occupied = {}  # (x, y) -> object name, for object-layer and floor objects
        self.spawn = None
        self.rooms = {}
        self.zones = []
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

    def floor3(self, x0, y0, x1, y1, kind):
        """A Gemini floor texture: its 3x3-cell block repeats with the map grid, so it tiles. It
        replaces an earlier Gemini floor on those tiles (a room drawn over the base floor)."""
        i = GEMINI_FLOORS.index(kind)
        bx, by = (i % 3) * 3, (i // 3) * 3
        inside = lambda d: x0 <= d["x"] <= x1 and y0 <= d["y"] <= y1 and d["sheet"] == "byte_grounds_floors"
        self.floor_decor = [d for d in self.floor_decor if not inside(d)]
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if not self.tiles[y][x]:
                    self.floor_decor.append({"x": x, "y": y, "sheet": "byte_grounds_floors", "sx": bx + x % 3, "sy": by + y % 3, "layer": "floor"})

    def gchair(self, x, y, facing, tuck=False, over=False):
        """A Gemini chair with its top-left on (x, y); the seat is the lower cell. `tuck`: the seat
        slides under a table's walkable top row; `over`: the top cell overlaps a table's front edge."""
        self.put({"down": "g_chair_down", "up": "g_chair_up", "right": "g_chair_right"}[facing], x, y, tuck=tuck, over=over)
        self.seat(x, y + 1, facing)

    def top_wall(self, pattern=("b_wall_cream", "b_window")):
        """The north wall two tiles deep, dressed with Gemini wall art (3-wide pieces in turn,
        pillars filling what's left)."""
        self.hwall(1, 1, self.w - 2)
        for y in (0, 1):
            for x in range(1, self.w - 1):
                self.colors[y][x] = WALL_FACE
        x, i = 1, 0
        while x + 3 <= self.w - 1:
            self.put(pattern[i % len(pattern)], x, 0)
            x, i = x + 3, i + 1
        while x <= self.w - 2:
            self.put("b_pillar", x, 0)
            x += 1

    def put_s(self, name, x, y, **kw):
        """`put`, plus a seat on each cell the seat catalog makes one (chairs, sofas, beds...)."""
        o = GEMINI.get(name) or CAT[name]
        self.put(name, x, y, **kw)
        for dy in range(o.h):
            for dx in range(o.w):
                spot = SEAT_SPOTS.get((o.sheet, o.sx + dx, o.sy + dy))
                if spot:
                    self.seat(x + dx, y + dy, spot[1], spot[0])

    def room(self, name, x, y):
        """A named point inside a room; the build checks each one is reachable from spawn."""
        self.rooms[name] = (x, y)

    def zone(self, name, x, y, w, h):
        """A meeting room: everyone inside hears each other at full volume and can share screens."""
        self.zones.append({"name": name, "x": x, "y": y, "w": w, "h": h})

    # objects
    def put(self, name, x, y, on=None, tuck=False, over=False):
        """Stamp a whole catalog object with its top-left on tile (x, y). `on` = a table-top
        item: it sits over an object cell and copies that object's base row. `tuck` = a chair
        pushed under the walkable top row of a desk (it may share that tile). `over` = a chair whose
        top cell overlaps the front edge of a table (drawing only; it blocks nothing)."""
        o = (GEMINI.get(name) or CAT[name]) if isinstance(name, str) else name
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
                if over and key in self.occupied and c is cells[0]:
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

    def derived_seats(self):
        """Seats the app derives from the decor: (x, y) -> seat; the last seat cell on a tile wins."""
        derived = {}
        for c in self.floor_decor + self.object_decor:
            assert "rot" not in c and "flipX" not in c, f"{self.id}: built-ins don't rotate decor"
            spot = SEAT_SPOTS.get((c["sheet"], c["sx"], c["sy"]))
            if spot:
                derived[(c["x"], c["y"])] = {"x": c["x"], "y": c["y"], "kind": spot[0], "dir": spot[1]}
        return derived

    def override_seats(self):
        """Authored seats the derivation doesn't already give (the ones written to the JSON)."""
        derived = self.derived_seats()
        return [st for st in self.seats if derived.get((st["x"], st["y"])) != st]

    def effective_seats(self):
        """What players get: authored seats, then derived ones on the other tiles."""
        authored = {(st["x"], st["y"]) for st in self.seats}
        return self.seats + [st for key, st in self.derived_seats().items() if key not in authored]

    def check(self):
        sx, sy = int(self.spawn[0]), int(self.spawn[1])
        if not self.walkable(sx, sy):
            raise ValueError(f"{self.id}: spawn ({sx},{sy}) is blocked")
        seen = self.reachable()
        for name, p in self.rooms.items():
            if p not in seen:
                raise ValueError(f"{self.id}: room {name} at {p} is unreachable")
        for st in self.effective_seats():
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
            "rev": self.rev,
            "width": self.w,
            "height": self.h,
            "tiles": [t for row in self.tiles for t in row],
            "spawn": {"x": self.spawn[0], "y": self.spawn[1]},
            "colors": [c for row in self.colors for c in row],
            "decor": self.floor_decor + self.object_decor,
            "seats": self.override_seats(),
            "zones": self.zones,
        }


def write(m):
    data = m.to_json()
    w = data["width"]
    rows = [json.dumps(data["tiles"][i : i + w]) for i in range(0, len(data["tiles"]), w)]
    crow = [json.dumps(data["colors"][i : i + w]) for i in range(0, len(data["colors"]), w)]
    seats = ",\n    ".join(json.dumps(s, separators=(",", ":")) for s in data["seats"])
    parts = [
        f'  "id": {json.dumps(data["id"])}',
        f'  "name": {json.dumps(data["name"])}',
        f'  "rev": {data["rev"]}',
        f'  "width": {w}',
        f'  "height": {data["height"]}',
        '  "tiles": [\n    ' + ",\n    ".join(r[1:-1] for r in rows) + "\n  ]",
        f'  "spawn": {json.dumps(data["spawn"])}',
        '  "colors": [\n    ' + ",\n    ".join(r[1:-1] for r in crow) + "\n  ]",
        '  "decor": [\n    ' + ",\n    ".join(json.dumps(d, separators=(",", ":")) for d in data["decor"]) + "\n  ]",
        '  "seats": [\n    ' + seats + "\n  ]" if seats else '  "seats": []',
    ]
    if data["zones"]:
        parts.append('  "zones": [\n    ' + ",\n    ".join(json.dumps(z, separators=(",", ":")) for z in data["zones"]) + "\n  ]")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{m.id}.json").write_text("{\n" + ",\n".join(parts) + "\n}\n", encoding="utf-8")
    seats, overrides = len(m.effective_seats()), len(data["seats"])
    print(f"{m.id}: {w}x{data['height']}, {len(data['decor'])} decor cells, {seats} seats ({overrides} overrides)")


# ---------- maps ----------

def build_office():
    """The Office (default room), all Gemini art: open workspace, meeting room, lounge, café, reception."""
    m = MapBuilder("office", "Office", 2, 40, 28, "#4a4f5c")
    m.top_wall()
    m.vwall(26, 2, 12, gaps=(9, 10))  # meeting room (north east)
    m.hwall(12, 27, 38)
    m.hwall(16, 1, 25, gaps=(12, 13, 20, 21))  # workspace / south rooms
    m.vwall(13, 17, 26, gaps=(21, 22))  # lounge | café
    m.vwall(28, 17, 26, gaps=(20, 21))  # café | reception
    m.floor3(1, 2, 38, 26, "grey")
    m.floor3(1, 2, 26, 16, "oak")
    m.floor3(27, 2, 38, 11, "lavender")
    m.floor3(1, 17, 12, 26, "teal")
    m.floor3(13, 17, 27, 26, "stone")
    m.floor3(13, 21, 13, 22, "teal")

    # Meeting room: oval table for eight, TV, whiteboard, plants, water.
    m.zone("Meeting room", 27, 2, 12, 10)
    m.put("p_monstera", 27, 2)
    m.put("g_tv", 31, 2)
    m.put("g_whiteboard", 34, 2)
    m.put("p_fig", 37, 2)
    m.put("o2_oval_table", 30, 5)
    for x in (31, 32, 33):
        m.put_s("g_chair_down", x, 4, tuck=True)
        m.put_s("g_chair_up", x, 7, over=True)
    m.put_s("g_chair_right", 29, 5)
    m.put("g_water", 37, 9)
    m.put("p_cactus", 27, 9)

    # Workspace: two rows of four desks, equipment on the east side, a project corner.
    for x in (2, 7, 12, 17):
        for y in (3, 8):
            m.put("o2_desk_pc", x, y)
            m.put_s("g_chair_up", x + 1, y + 1, over=True)  # back view: sits facing the monitor
    m.put("p_snake", 5, 3)
    m.put("p_cactus", 10, 3)
    m.put("p_snake", 15, 8)
    m.put("o2_server", 21, 2)
    m.put("o2_copier", 22, 2)
    m.put("o2_lockers", 24, 2)
    m.put("o2_cabinet", 22, 6)
    m.put("o2_cabinet", 23, 6)
    m.put("o2_corkboard", 21, 9)
    m.put("o2_boxes", 24, 9)
    m.put("o2_l_desk", 2, 13)
    m.put_s("g_chair_up", 3, 14, over=True)
    m.put("o2_stand_desk", 7, 13)
    m.put("o2_arc_lamp", 10, 13)
    m.put("o2_projector", 16, 12)
    m.put("p_monstera", 23, 12)

    # Lounge: sofas around a coffee table, armchairs, shelf, lamp, rug, plants.
    m.put_s("lv_sofa_front", 2, 17)
    m.put_s("lv_armchair_front", 6, 17)
    m.put("lv_floor_lamp", 9, 17)
    m.put("lv_bookshelf", 10, 17)
    m.put("lv_coffee_table", 3, 20)
    m.put("lv_rug_pink", 8, 20)
    m.put_s("lv_sofa_back", 2, 23)
    m.put_s("lv_armchair_back", 6, 23)
    m.put("p_pothos", 10, 24)

    # Café: counter with the coffee machine, pastry case (snacks), water cooler, two tables.
    m.put("c_counter", 15, 17)
    m.put("c_pastry", 21, 17)
    m.put("c_water", 25, 17)
    m.put("c_fridge", 26, 17)
    for tx in (16, 21):
        m.put("c_round_table", tx, 22)
        for x in (tx, tx + 1):
            m.put_s("c_chair_down", x, 21, tuck=True)
            m.put_s("c_chair_up", x, 23, over=True)
    m.put("c_menu", 25, 23)
    m.put("c_bins", 14, 25)

    # Reception and entrance.
    m.put("b_reception", 33, 18)
    m.put("b_coat", 29, 17)
    m.put("p_fig", 37, 17)
    m.put_s("lv_sofa3", 30, 22)
    m.put("p_bush", 37, 23)
    m.put("b_mat", 33, 25)

    m.spawn = (34.5, 24.5)
    for name, p in {"meeting": (28, 9), "work": (6, 6), "lounge": (6, 21), "cafe": (20, 20), "reception": (32, 20)}.items():
        m.room(name, *p)
    return m


def build_lounge():
    """Lounge & Café, all Gemini art: a café with tables, and a lounge with two sofa corners."""
    m = MapBuilder("lounge", "Lounge & Café", 2, 36, 26, "#4a4f5c")
    m.top_wall(("b_window", "b_wall_lilac"))
    m.vwall(18, 2, 24, gaps=(12, 13, 14))
    m.floor3(1, 2, 17, 24, "stone")
    m.floor3(18, 2, 34, 24, "oak")
    m.floor3(19, 12, 34, 24, "teal")

    # Café: counter (coffee), pastry case (snacks), fridge, water, shelf; six tables for four.
    m.put("c_counter", 2, 2)
    m.put("c_pastry", 8, 2)
    m.put("c_fridge", 12, 2)
    m.put("c_water", 13, 2)
    m.put("c_shelf", 15, 2)
    for ty in (8, 14):
        for tx in (3, 8, 13):
            m.put("c_round_table", tx, ty)
            for x in (tx, tx + 1):
                m.put_s("c_chair_down", x, ty - 1, tuck=True)
                m.put_s("c_chair_up", x, ty + 1, over=True)
    for tx in (2, 7, 12):
        m.put_s("c_table_two", tx, 19)
    m.put("p_tulips", 16, 8)
    m.put("p_sunflowers", 16, 14)
    m.put("c_menu", 15, 22)
    m.put("c_bins", 1, 23)
    m.put("p_planter", 9, 23)

    # Lounge: TV corner (sofa and armchairs facing the TV).
    m.put("lv_bookshelf", 20, 2)
    m.put("lv_floor_lamp", 23, 2)
    m.put("lv_tv", 25, 2)
    m.put("lv_bookshelf", 29, 2)
    m.put("p_monstera", 33, 2)
    m.put("lv_coffee_table", 25, 5)
    m.put_s("lv_armchair_back", 21, 7)
    m.put_s("lv_sofa_back", 24, 7)
    m.put_s("lv_armchair_back", 28, 7)
    m.put("lv_rug_stripes", 24, 10)
    m.put("lv_sideboard", 30, 9)
    m.put("p_bonsai", 19, 9)
    m.put("p_hanging", 33, 6)
    m.put_s("lv_armchair_blue", 21, 10)

    # Second corner: sofa facing a sofa across a coffee table, rug, reading nook, plants.
    m.put_s("lv_sofa3", 21, 13)
    m.put_s("lv_armchair_front", 25, 13)
    m.put("lv_coffee_table", 21, 16)
    m.put_s("lv_sofa_back", 21, 19)
    m.put("lv_rug_pink", 25, 17)
    m.put_s("lv_armchair_blue", 29, 13)
    m.put("lv_side_lamp", 32, 13)
    m.put_s("lv_pouf", 30, 17)
    m.put_s("lv_bench", 29, 22)
    m.put("p_olive", 33, 13)
    m.put("p_bush", 33, 21)
    m.put("p_pampas", 19, 22)
    m.put("lv_bookshelf", 25, 21)
    m.put("lv_floor_lamp", 27, 21)
    m.put("p_snake", 24, 13)

    m.spawn = (26.5, 23.5)
    for name, p in {"cafe": (8, 11), "lounge": (27, 11), "corner": (27, 21)}.items():
        m.room(name, *p)
    return m


def build_home():
    """Home, all pastel Gemini art: bedroom, bathroom, kitchen, living room with a kids' corner."""
    m = MapBuilder("home", "Home", 2, 30, 22, "#4a4f5c")
    m.top_wall(("b_wall_lilac", "b_window"))
    m.vwall(11, 2, 9)
    m.vwall(18, 2, 9)
    m.hwall(10, 1, 28, gaps=(5, 6, 14, 15, 22, 23))
    m.floor3(1, 2, 28, 20, "oak")
    m.floor3(1, 2, 10, 9, "walnut")
    m.floor3(12, 2, 17, 9, "stone")
    m.floor3(19, 2, 28, 9, "grey")

    # Bedroom: double bed between nightstands, dresser, wardrobe, desk, rug, plant.
    m.put("bd_nightstand", 1, 2)
    m.put_s("bd_bed_double", 2, 2)
    m.put("bd_nightstand", 5, 2)
    m.put("bd_dresser", 6, 2)
    m.put("bd_wardrobe", 8, 2)
    m.put("bd_bath_mat", 2, 6)
    m.put("bd_desk", 7, 7)
    m.put_s("bd_chair_up", 7, 8, over=True)
    m.put("bd_plant_stool", 1, 8)
    m.put("bd_basket", 10, 9)

    # Bathroom.
    m.put("bd_bathtub", 12, 2)
    m.put("bd_toilet", 15, 2)
    m.put("bd_sink", 16, 2)
    m.put("bd_towels", 12, 6)
    m.put("bd_shower", 16, 6)
    m.put("bd_mirror", 17, 2)

    # Kitchen with a little dining table.
    m.put("c_stove", 19, 2)
    m.put("c_sink", 22, 2)
    m.put("c_fridge", 25, 2)
    m.put("c_microwave", 26, 2)
    m.put("c_round_table", 22, 6)
    for x in (22, 23):
        m.put_s("c_chair_down", x, 5, tuck=True)
        m.put_s("c_chair_up", x, 7, over=True)
    m.put("p_lavender", 19, 8)
    m.put("c_bins", 27, 8)

    # Living room: sofa facing the TV across a coffee table, armchairs, shelf, lamp, plants.
    m.put("lv_sideboard", 1, 11)
    m.put("lv_tv", 8, 11)
    m.put("lv_floor_lamp", 10, 11)
    m.put("lv_bookshelf", 11, 11)
    m.put_s("lv_armchair_front", 4, 14)
    m.put("lv_coffee_table", 8, 14)
    m.put_s("lv_armchair_blue", 11, 14)
    m.put("lv_rug_stripes", 8, 16)
    m.put_s("lv_sofa_back", 7, 17)
    m.put("p_monstera", 1, 17)

    # Kids' corner: a single bed, toys, pouf, rug.
    m.put("bd_toy_chest", 24, 11)
    m.put("bd_toy_shelf", 26, 11)
    m.put_s("bd_bed_single", 24, 14)
    m.put_s("lv_pouf", 20, 14)
    m.put("lv_rug_pink", 20, 17)
    m.put("p_fig", 27, 17)
    m.put("p_planter", 14, 17)
    m.put("b_coat", 17, 12)
    m.put("b_mat", 15, 20)

    m.spawn = (15.5, 19.5)
    for name, p in {"bedroom": (5, 6), "bath": (14, 5), "kitchen": (25, 6), "living": (12, 19), "kids": (22, 13)}.items():
        m.room(name, *p)
    return m


def build_studio():
    """Gemini Studio: a small office furnished only with the Gemini-made sheets."""
    m = MapBuilder("studio", "Gemini Studio", 1, 32, 22, "#4a4f5c")
    # Walls: meeting room (top right), kitchenette (top left), lounge (bottom left).
    m.vwall(18, 1, 10, gaps=(8, 9))
    m.hwall(10, 19, 30, gaps=())
    m.vwall(9, 1, 7, gaps=(5, 6))
    m.hwall(12, 1, 11, gaps=(9, 10))
    m.floor3(19, 1, 30, 9, "lavender")
    m.floor3(1, 1, 8, 7, "stone")
    m.floor3(1, 13, 11, 20, "teal")
    m.floor3(10, 1, 17, 11, "oak")
    m.floor3(1, 8, 9, 11, "oak")
    m.floor3(12, 12, 30, 20, "grey")
    m.floor3(19, 11, 30, 11, "grey")

    # Meeting room: conference table for 11, TV and whiteboard on the north wall.
    m.zone("Meeting room", 19, 1, 12, 9)
    m.put("g_tv", 23, 1)
    m.put("g_whiteboard", 27, 1)
    m.put("g_monstera", 19, 1)
    m.put("g_conf_table", 22, 5)
    for x in range(22, 27):
        m.gchair(x, 4, "down", tuck=True)
        m.gchair(x, 6, "up", over=True)
    m.gchair(21, 4, "right")
    m.put("g_water", 30, 7)

    # Kitchenette: coffee bar, vending machine, water, a round table for four.
    m.put("g_coffee_bar", 1, 1)
    m.put("g_vending", 4, 1)
    m.put("g_water", 7, 1)
    m.put("g_round_table", 3, 5)
    m.gchair(3, 4, "down", tuck=True)
    m.gchair(4, 4, "down", tuck=True)
    m.gchair(3, 6, "up", over=True)
    m.gchair(4, 6, "up", over=True)
    m.put("g_cactus", 7, 5)

    # Work corner (oak): two round tables with chairs, shelves and plants.
    m.put("g_bookshelf", 10, 1)
    m.put("g_bookshelf", 12, 1)
    m.put("g_monstera", 16, 1)
    for tx in (11, 15):
        m.put("g_round_table", tx, 6)
        m.gchair(tx, 5, "down", tuck=True)
        m.gchair(tx + 1, 5, "down", tuck=True)
        m.gchair(tx, 7, "up", over=True)
        m.gchair(tx + 1, 7, "up", over=True)
    m.put("g_lamp", 17, 4)

    # Lounge (teal): sofa, armchair, coffee table, bean bags, rug, lamp, shelf, cactus.
    m.put("g_lamp", 1, 13)
    m.put("g_sofa", 3, 13)
    m.seat(3, 14, "down"); m.seat(4, 14, "down")
    m.put("g_armchair", 6, 13)
    m.seat(6, 14, "down")
    m.put("g_bookshelf", 9, 13)
    m.put("g_cactus", 11, 13)
    m.put("g_coffee_table", 4, 16)
    m.put("g_rug", 7, 17)
    m.put("g_beanbag", 1, 17)
    m.seat(1, 18, "down")
    m.put("g_beanbag", 9, 17)
    m.seat(9, 18, "down")

    # Open area (grey): a meeting corner with bean bags and plants by the entrance.
    m.put("g_round_table", 22, 14)
    m.gchair(22, 13, "down", tuck=True)
    m.gchair(23, 13, "down", tuck=True)
    m.gchair(22, 15, "up", over=True)
    m.gchair(23, 15, "up", over=True)
    m.put("g_beanbag", 27, 13)
    m.seat(27, 14, "down")
    m.put("g_beanbag", 27, 17)
    m.seat(27, 18, "down")
    m.put("g_monstera", 13, 13)
    m.put("g_monstera", 29, 19)
    m.put("g_lamp", 18, 13)

    m.spawn = (16.5, 19.5)
    for name, p in {"meeting": (20, 8), "kitchen": (6, 6), "work": (13, 10), "lounge": (6, 19), "open": (20, 18)}.items():
        m.room(name, *p)
    return m


if __name__ == "__main__":
    for build in (build_office, build_lounge, build_home, build_studio):
        write(build())


