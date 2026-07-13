import json, os
from PIL import Image, ImageDraw, ImageFont

# Decision-map generator for the Kanevo / YNAB user-flow reference.
# Reproduces the original tree.png style (rounded outlined nodes with a colored
# left rail + screenshot thumb, orthogonal grey connectors, pill edge labels),
# renumbered to the 65-card set and extended with the Views / Move Money /
# Targets / Settings branches. PIL only.

items = json.load(open("user-flow/flow.json"))
IMG = {it["n"]: it["img"] for it in items}
AR = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARB = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def asc(s):
    for a, b in [("⋮", "(3-dot)"), ("▾", "v"), ("▸", ">"), ("…", "..."),
                 ("·", " / "), ("→", "->"), ("’", "'"), ("✎", "pencil"),
                 ("—", "-"), ("“", '"'), ("”", '"')]:
        s = s.replace(a, b)
    return s

def N(title, screen, edge, children=None):
    return dict(title=title, screen=screen, edge=edge, children=children or [])

tree = N("Open app", None, None, [
  N("Plan  (budget)", 1, "Plan tab", [
     N("Month picker", 4, "tap  Jul 2026 v"),
     N("Edit Plan (Cost to Be Me)", 5, "tap  pencil"),
     N("Views filter sheet", 3, "tap  Views icon", [
        N("Filtered — Underfunded", 6, "select a filter"),
        N("Money Available", 8, "Money Available"),
        N("Overfunded — empty", 7, "Overfunded"),
        N("Snoozed — empty", 9, "Snoozed"),
        N("Manage Views", 10, "Edit"),
        N("New View — name it", 11, "New", [
           N("Pick categories", 12, "name it >"),
        ]),
     ]),
     N("Assign Money", 24, "tap  Ready to Assign >", [
        N("Assign — scrolled", 25, "scroll"),
        N("Auto-Assign by...", 26, "tap  Auto-Assign"),
     ]),
     N("Calculator keypad", 27, "tap  a category amount", [
        N("Move Money", 28, "Move Money tab", [
           N("Category picker", 29, "From / To rows", [
              N("Picker — scrolled", 30, "scroll"),
           ]),
        ]),
        N("Category Details", 31, "Details tab", [
           N("Target — Weekly", 32, "Create Target", [
              N("Weekly day picker", 33, "day"),
              N("Amount keypad", 34, "I need $"),
              N("'Next month' sheet", 35, "next month"),
           ]),
           N("Target — Yearly", 36, "Yearly tab", [
              N("Target date calendar", 37, "due date"),
              N("'Next year' sheet", 38, "next year"),
           ]),
           N("Target — Custom", 39, "Custom tab", [
              N("'I want to' sheet", 40, "I want to"),
              N("Custom — Repeat on", 41, "Repeat on", [
                 N("Frequency spinner", 42, "frequency"),
              ]),
           ]),
        ]),
     ]),
     N("New transaction", 53, "tap  + Transaction"),
     N("Overflow menu", 13, "tap  (3-dot) menu", [
        N("Recent Moves — All", 14, "Recent Moves", [
           N("Moved tab", 15, "Moved"),
           N("Assigned tab", 16, "Assigned"),
        ]),
        N("Undo — bottom popup", 18, "Undo Assignment/Move", [
           N("Menu now shows Redo", 17, "reopen  (3-dot)", [
              N("Redo — bottom popup", 19, "Redo"),
           ]),
        ]),
        N("Open Plan", 20, "Open Plan"),
        N("Assigned / Available", 2, "Progress Bars"),
        N("Collapse / Expand", 21, "Collapse/Expand", [
           N("Groups collapsed", 22, "Collapse All"),
        ]),
        N("Hide Amounts", 23, "Hide Amounts"),
        N("Settings", 43, "Settings & Privacy", [
           N("Settings — App section", 44, "scroll"),
           N("Settings — Account & Misc", 45, "scroll"),
           N("Plan Settings", 46, "Plan"),
           N("New Plan", 47, "New Plan"),
           N("Make a Fresh Start", 48, "Fresh Start"),
           N("Display Options", 49, "Display", [
              N("Dark theme applied", 50, "Dark Theme"),
           ]),
        ]),
     ]),
  ]),
  N("Spending  (register)", 51, "Spending tab", [
     N("Search + keyboard", 52, "tap  search"),
     N("Transaction editor", 53, "tap  a transaction", [
        N("Inflow", 54, "Inflow tab"),
        N("Details & delete", 55, "scroll"),
     ]),
  ]),
  N("Accounts", 56, "Accounts tab"),
  N("Reflect  (reports)", 57, "Reflect tab", [
     N("Net Worth / Age of Money", 58, "scroll down"),
     N("Spending Breakdown", 59, "tap  Spending Breakdown", [
        N("Month picker", 60, "tap  month"),
        N("Presets", 61, "Presets tab", [
           N("Last 3 Months applied", 62, "Last 3 Months"),
        ]),
        N("Filter", 63, "tap  Filter"),
     ]),
  ]),
  N("Home  (dashboard)", 64, "Home tab", [N("Greeting / quick actions", 65, "scroll down")]),
])

COLW = 400; NW = 244; NH = 98; THW = 42; THH = 91; V = 120; PADX = 34; PADY = 34
leaf = [0]
def layout(n, dep):
    n["x"] = PADX + dep * COLW
    if n["children"]:
        for c in n["children"]:
            layout(c, dep + 1)
        n["y"] = (n["children"][0]["y"] + n["children"][-1]["y"]) / 2
    else:
        n["y"] = PADY + leaf[0] * V; leaf[0] += 1
layout(tree, 0)
mx = [0]; my = [0]
def bnd(n):
    mx[0] = max(mx[0], n["x"] + NW); my[0] = max(my[0], n["y"] + NH)
    for c in n["children"]:
        bnd(c)
bnd(tree)
W = int(mx[0] + PADX); H = int(my[0] + PADY)
S = 2
TAB = {1: (75, 77, 219), 51: (8, 145, 178), 56: (100, 116, 139), 57: (124, 58, 237), 64: (217, 119, 6)}

img = Image.new("RGB", (W * S, H * S), (255, 255, 255)); d = ImageDraw.Draw(img)
def F(p, sz): return ImageFont.truetype(p, sz * S)
f_title = F(ARB, 14); f_small = F(AR, 11); f_lab = F(AR, 12); f_root = F(ARB, 15); f_rootsub = F(AR, 11)
def rrect(x, y, w, h, r, fill=None, outline=None, width=1):
    d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S], radius=r * S, fill=fill, outline=outline, width=width * S)
def line(pts, fill, width): d.line([(p[0] * S, p[1] * S) for p in pts], fill=fill, width=width * S, joint="curve")
def text(x, y, s, font, fill, anchor="la"): d.text((x * S, y * S), asc(s), font=font, fill=fill, anchor=anchor)
def tw(s, font): return d.textlength(asc(s), font=font) / S
def wrap(s, font, maxw):
    words = s.split(); lines = [""]
    for w_ in words:
        t = (lines[-1] + " " + w_).strip()
        if tw(t, font) <= maxw: lines[-1] = t
        else: lines.append(w_)
    return lines[:2]

edges = []; nodes = []
def assign(n, col):
    nodes.append((n, col))
    for c in n["children"]:
        edges.append((n, c, c["edge"])); assign(c, col)
nodes.append((tree, None))
for c in tree["children"]:
    edges.append((tree, c, c["edge"])); assign(c, TAB.get(c["screen"], (75, 77, 219)))

# 1) edges
for p, c, lab in edges:
    px, py = p["x"] + NW, p["y"] + NH / 2; cx, cy = c["x"], c["y"] + NH / 2; midx = px + (cx - px) / 2
    line([(px, py), (midx, py), (midx, cy), (cx, cy)], (199, 202, 221), 2)
# 2) nodes
for n, col in nodes:
    x, y = n["x"], n["y"]
    if n["screen"] is None:
        rrect(x, y, NW, NH, 14, fill=(22, 24, 38))
        text(x + NW / 2, y + NH / 2 - 9, "Open app", f_root, (255, 255, 255), anchor="mm")
        text(x + NW / 2, y + NH / 2 + 11, "5 tabs ->", f_rootsub, (174, 178, 204), anchor="mm")
    else:
        rrect(x, y, NW, NH, 14, fill=(255, 255, 255), outline=col, width=2); rrect(x, y, 6, NH, 3, fill=col)
        p = IMG.get(n["screen"]); pth = "user-flow/" + p if p else None
        if pth and os.path.exists(pth):
            th = Image.open(pth).convert("RGB").resize((THW * S, THH * S), Image.LANCZOS)
            img.paste(th, (int((x + 14) * S), int((y + (NH - THH) / 2) * S)))
            d.rectangle([(x + 14) * S, (y + (NH - THH) / 2) * S, (x + 14 + THW) * S, (y + (NH - THH) / 2 + THH) * S], outline=(228, 230, 240), width=1)
        tx = x + 14 + THW + 12
        for li, ln in enumerate(wrap(n["title"], f_title, NW - (14 + THW + 12) - 12)):
            text(tx, y + 18 + li * 18, ln, f_title, (22, 24, 38))
        text(tx, y + NH - 24, f"screen {n['screen']}", f_small, (122, 128, 160))
# 3) labels on top, centered in the gap
for p, c, lab in edges:
    if not lab: continue
    px = p["x"] + NW; cx = c["x"]; cy = c["y"] + NH / 2; gapmid = px + (cx - px) / 2
    w = tw(lab, f_lab) + 16
    rrect(gapmid - w / 2, cy - 11, w, 22, 11, fill=(238, 240, 251), outline=(220, 222, 245), width=1)
    text(gapmid, cy, lab, f_lab, (69, 72, 184), anchor="mm")

img.save("user-flow/tree.png"); print("tree.png", W, "x", H)
