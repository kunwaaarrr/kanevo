import os, shutil, html, json
from PIL import Image

RAW="user-flow/frames_raw"
CAND="user-flow/candidates"
by={int(f[1:4]):f for f in os.listdir(CAND)}
OUT="user-flow/screens"; shutil.rmtree(OUT,ignore_errors=True); os.makedirs(OUT)

def src_path(kind,num):
    if kind=="r": return os.path.join(CAND,by[num])
    return os.path.join(RAW,f"f_{num:05d}.jpg")

# (kind,num, section, title, caption, tag)
FLOW=[
 ("r",1,  "Plan / Budget","Budget — default (Available)","Default view: one <b>Available to Spend</b> column with a progress bar under each category. This is with ⋮ menu → Progress Bars ON.",""),
 ("r",110,"Plan / Budget","Budget — Assigned &amp; Available","The SAME budget after ⋮ menu → <b>Progress Bars is turned OFF</b>: two columns (Assigned + Available), no bars. This is what you pressed to make the columns show.","⋮ toggle"),
 ("f",108,"Plan / Budget","Views filter sheet","Top-bar Views icon: All / Underfunded / Overfunded / Money Available / Snoozed.","top bar"),
 ("r",2,  "Plan / Budget","Month picker","Tapping “Jul 2026 ▾” opens the month/year picker.","top bar"),
 ("r",6,  "Plan / Budget","Edit Plan (Cost to Be Me)","Set monthly income and per-category targets via Add Target.",""),

 ("r",7,  "The ⋮ overflow menu","Overflow menu — full","Every item top-to-bottom. <b>Progress Bars</b> toggles the Assigned/Available columns; Refresh (sync) and Support (help) act in place; the rest open the screens below.","⋮ menu"),
 ("r",9,  "The ⋮ overflow menu","→ Recent Moves — All","Money-move history, All tab.","⋮ menu"),
 ("r",10, "The ⋮ overflow menu","→ Recent Moves — Moved","Moved tab (No Money Moves yet).","⋮ menu"),
 ("r",11, "The ⋮ overflow menu","→ Recent Moves — Assigned","Assigned tab — where each dollar went.","⋮ menu"),
 ("r",15, "The ⋮ overflow menu","→ After Undo, menu shows Redo","Once you undo, the menu’s second item becomes Redo.","⋮ menu"),
 ("f",338,"The ⋮ overflow menu","→ Undo — bottom popup","Undo pops a bottom pill: Phone &amp; Internet reverted to $0.00.","popup"),
 ("f",320,"The ⋮ overflow menu","→ Redo — bottom popup","Redo pops the green pill: Phone &amp; Internet re-applied at $20.00.","popup"),
 ("r",20, "The ⋮ overflow menu","→ Open Plan","Switch plans / plans shared with you.","⋮ menu"),
 ("r",25, "The ⋮ overflow menu","→ Collapse/Expand","Submenu: Collapse All / Expand All Groups.","⋮ menu"),
 ("r",26, "The ⋮ overflow menu","→ Collapse result","Groups collapsed to headers only.","⋮ menu"),
 ("r",33, "The ⋮ overflow menu","→ Hide Amounts to Share","Privacy mode — amounts masked.","⋮ menu"),

 ("r",49, "Assign Money","Assign Money (helper)","Reached by tapping the green <b>Ready to Assign ▸</b> bar. Auto-assign helper; underfunded highlighted.","tap bar"),
 ("r",50, "Assign Money","Assign Money — scrolled","Wants group and remaining categories.",""),
 ("r",52, "Assign Money","Auto-Assign by…","Underfunded / Assigned Last Month / Spent Last Month / Average.",""),
 ("f",1366,"Assign Money","Assign amount — calculator keypad","Tap a category’s amount on the budget → keypad slides up (with + − = calculator). Tabs: Auto-Assign / Move Money / Details.","tap row"),

 ("r",43, "Settings","Plans &amp; App","Current plan, New/Open Plan, Make a Fresh Start.","⋮→Settings"),
 ("r",44, "Settings","App &amp; Account","Display Options, Notifications, App Lock, Share, Account.",""),
 ("r",45, "Settings","Account &amp; Misc","Manage Bank Connections, Log Out, Diagnostics, Privacy, Terms.",""),

 ("r",111,"Spending","Register","Transactions with search + uncleared filter.","tab"),
 ("r",69, "Spending","Search + keyboard","Searching the register.",""),
 ("r",72, "Spending","Transaction — Outflow","Payee, category, account, date, photo, memo, cleared, flag.",""),
 ("r",73, "Spending","Transaction — Inflow","Inflow toggle turns the amount green.",""),
 ("r",85, "Spending","Transaction — details &amp; delete","Never Repeat and Delete Transaction.",""),

 ("r",91, "Accounts","Accounts","Cash &amp; Kun balances, Add Account, Manage Bank Connections.","tab"),

 ("r",92, "Reflect","Overview","Spending Breakdown, Income vs Spending, Net Worth.","tab"),
 ("r",95, "Reflect","Net Worth &amp; Age of Money","Assets/Debts trend and Age of Money guidance.",""),
 ("r",98, "Reflect","Breakdown — by month","Total spending and top categories.",""),
 ("r",99, "Reflect","Breakdown — month picker","Pick the month/year for the breakdown.",""),
 ("r",101,"Reflect","Breakdown — presets","Last 3/6/12 Months, Year to Date, Last Year, All Dates.",""),
 ("r",102,"Reflect","Breakdown — Last 3 Months","Preset range applied (May–July 2026).",""),
 ("r",106,"Reflect","Breakdown — Filter","Include/exclude category groups.",""),

 ("r",112,"Home","For You","‘You’re all caught up’, tips, connect with support.","tab"),
 ("r",113,"Home","Greeting &amp; quick actions","‘Well, hello there Kunwar’, Pinned, Current Goal.",""),
]

items=[]
for i,(kind,num,sec,title,cap,tag) in enumerate(FLOW,1):
    sp=src_path(kind,num)
    t=(num/15.0) if kind=="f" else float(by[num][5:11])
    slug=sec.split()[0].lower().replace("/","").replace("⋮","menu")
    dst=f"{i:02d}_{slug}.jpg"
    shutil.copy(sp, os.path.join(OUT,dst))
    items.append(dict(n=i,sec=sec,title=title,cap=cap,tag=tag,img=f"screens/{dst}",
                      t=f"{int(t//60)}:{t%60:04.1f}"))
IMG={it["n"]:it["img"] for it in items}

# ---------- card sections ----------
secs=[]
for it in items:
    if not secs or secs[-1]["name"]!=it["sec"]:
        secs.append(dict(name=it["sec"],items=[]))
    secs[-1]["items"].append(it)
SUB={"Plan / Budget":"Give every dollar a job","The ⋮ overflow menu":"Every button, top to bottom",
 "Assign Money":"Fund the categories","Settings":"App, plan & account","Spending":"Register & transactions",
 "Accounts":"Balances & connections","Reflect":"Reports & insights","Home":"Dashboard & goals"}
cards=[]
for si,s in enumerate(secs):
    tiles=[]
    for it in s["items"]:
        badge=f'<span class="tag">{it["tag"]}</span>' if it["tag"] else ""
        pop=" pop" if it["tag"]=="popup" else ""
        tiles.append(f'''<a class="card{pop}" href="{it['img']}" target="_blank">
          <div class="ph"><span class="num">{it['n']}</span>{badge}<img loading="lazy" src="{it['img']}" alt=""></div>
          <div class="meta"><div class="t">{it['title']}</div><div class="c">{it['cap']}</div><div class="ts">{it['t']}</div></div>
        </a>''')
    star=" star" if s["name"].startswith("The ⋮") else ""
    cards.append(f'''<section class="sec{star}">
      <div class="sechead"><span class="dot d{si}"></span><h2>{html.escape(s['name'])}</h2><span class="sub">{html.escape(SUB[s['name']])}</span><span class="cnt">{len(s['items'])}</span></div>
      <div class="row">{''.join(tiles)}</div>
    </section>''')

# ---------- decision-tree SVG ----------
def N(title,screen,edge,children=None): return dict(title=title,screen=screen,edge=edge,children=children or [])
tree=N("Open app",None,None,[
  N("Plan  (budget)",1,"Plan tab",[
     N("Month picker",4,"tap  Jul 2026 ▾"),
     N("Views filter sheet",3,"tap  Views icon"),
     N("Assign Money",17,"tap  Ready to Assign ▸",[
        N("Auto-Assign by…",19,"tap  Auto-Assign by…"),
     ]),
     N("Calculator keypad",20,"tap  a category’s $ amount"),
     N("New transaction",26,"tap  + Transaction"),
     N("⋮ Overflow menu",7,"tap  ⋮ (three dots)",[
        N("Recent Moves",9,"Recent Moves"),
        N("Undo / Redo popup",11,"Undo · Redo"),
        N("Open Plan",13,"Open Plan"),
        N("Assigned / Available",2,"Progress Bars (toggle)"),
        N("Collapse / Expand",14,"Collapse/Expand ▸",[
           N("Groups collapsed",15,"Collapse All"),
        ]),
        N("Hide Amounts",16,"Hide Amounts"),
        N("Settings",21,"Settings & Privacy"),
     ]),
  ]),
  N("Spending  (register)",24,"Spending tab",[
     N("Search + keyboard",25,"tap  search"),
     N("Transaction editor",26,"tap  a transaction"),
  ]),
  N("Accounts",29,"Accounts tab"),
  N("Reflect  (reports)",30,"Reflect tab",[
     N("Net Worth / Age of Money",31,"scroll down"),
     N("Spending Breakdown",32,"tap  Spending Breakdown",[
        N("Month picker",33,"tap  month"),
        N("Presets",34,"Presets tab"),
        N("Filter",36,"tap  Filter"),
     ]),
  ]),
  N("Home  (dashboard)",37,"Home tab",[
     N("Greeting / quick actions",38,"scroll down"),
  ]),
])

COLW=310; NW=236; NH=96; THW=40; THH=87; V=116; PADX=30; PADY=30
leaf=[0]
def layout(n,depth):
    n["x"]=PADX+depth*COLW
    if n["children"]:
        for c in n["children"]: layout(c,depth+1)
        n["y"]=(n["children"][0]["y"]+n["children"][-1]["y"])/2
    else:
        n["y"]=PADY+leaf[0]*V; leaf[0]+=1
layout(tree,0)
maxx=[0]; maxy=[0]
def bounds(n):
    maxx[0]=max(maxx[0],n["x"]+NW); maxy[0]=max(maxy[0],n["y"]+NH)
    for c in n["children"]: bounds(c)
bounds(tree)
W=maxx[0]+PADX; H=maxy[0]+PADY

TABCOL={1:"#4b4ddb",24:"#0891b2",29:"#64748b",30:"#7c3aed",37:"#d97706"}
def esc(s): return html.escape(str(s))
parts=[]
def edge(px,py,cx,cy,label):
    midx=px+(cx-px)/2
    parts.append(f'<path d="M{px:.0f},{py:.0f} H{midx:.0f} V{cy:.0f} H{cx:.0f}" fill="none" stroke="#c7cadd" stroke-width="1.6"/>')
    if label:
        w=len(label)*6.4+10
        lx=midx+6; ly=cy
        parts.append(f'<rect x="{lx:.0f}" y="{ly-9:.0f}" width="{w:.0f}" height="18" rx="9" fill="#eef0fb" stroke="#dcdef5"/>')
        parts.append(f'<text x="{lx+w/2:.0f}" y="{ly+4:.0f}" font-size="11" font-family="ui-monospace,Menlo,monospace" fill="#4548b8" text-anchor="middle">{esc(label)}</text>')
def draw(n,tabcol=None):
    for c in n["children"]:
        edge(n["x"]+NW, n["y"]+NH/2, c["x"], c["y"]+NH/2, c["edge"])
    # node box
    x,y=n["x"],n["y"]
    if n["screen"] is None:
        parts.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="14" fill="#161826"/>')
        parts.append(f'<text x="{x+NW/2:.0f}" y="{y+NH/2-4:.0f}" font-size="15" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui">Open app</text>')
        parts.append(f'<text x="{x+NW/2:.0f}" y="{y+NH/2+16:.0f}" font-size="11" fill="#aeb2cc" text-anchor="middle" font-family="ui-monospace,monospace">bottom tab bar ↓</text>')
    else:
        col=tabcol or "#e4e6f0"
        parts.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="14" fill="#fff" stroke="{col}" stroke-width="1.5"/>')
        parts.append(f'<rect x="{x}" y="{y}" width="6" height="{NH}" rx="3" fill="{col}"/>')
        img=IMG.get(n["screen"])
        parts.append(f'<image href="{img}" x="{x+14}" y="{y+(NH-THH)/2:.0f}" width="{THW}" height="{THH}" preserveAspectRatio="xMidYMid slice"/>')
        parts.append(f'<rect x="{x+14}" y="{y+(NH-THH)/2:.0f}" width="{THW}" height="{THH}" rx="4" fill="none" stroke="#e4e6f0"/>')
        tx=x+14+THW+12
        # wrap title to ~18 chars
        words=n["title"].split(); lines=[""]
        for w_ in words:
            if len(lines[-1])+len(w_)+1<=20: lines[-1]=(lines[-1]+" "+w_).strip()
            else: lines.append(w_)
        for li,ln in enumerate(lines[:2]):
            parts.append(f'<text x="{tx}" y="{y+30+li*17:.0f}" font-size="13.5" font-weight="650" fill="#161826" font-family="system-ui">{esc(ln)}</text>')
        parts.append(f'<a href="{img}" target="_blank"><text x="{tx}" y="{y+NH-14:.0f}" font-size="11" fill="#7a80a0" font-family="ui-monospace,monospace" text-decoration="underline">screen {n["screen"]} ↗</text></a>')
    for c in n["children"]:
        draw(c, tabcol if n["screen"] is not None and n["screen"] not in TABCOL else TABCOL.get(c["screen"], tabcol))
# color propagation: tabs get their color, descendants inherit
def draw_root(n):
    for c in n["children"]:
        edge(n["x"]+NW,n["y"]+NH/2,c["x"],c["y"]+NH/2,c["edge"])
    x,y=n["x"],n["y"]
    parts.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="14" fill="#161826"/>')
    parts.append(f'<text x="{x+NW/2:.0f}" y="{y+NH/2-4:.0f}" font-size="15" font-weight="700" fill="#fff" text-anchor="middle" font-family="system-ui">Open app</text>')
    parts.append(f'<text x="{x+NW/2:.0f}" y="{y+NH/2+16:.0f}" font-size="11" fill="#aeb2cc" text-anchor="middle" font-family="ui-monospace,monospace">5 tabs ↓</text>')
    for c in n["children"]:
        drawsub(c, TABCOL.get(c["screen"], "#4b4ddb"))
def drawsub(n,col):
    for c in n["children"]:
        edge(n["x"]+NW,n["y"]+NH/2,c["x"],c["y"]+NH/2,c["edge"])
    x,y=n["x"],n["y"]
    parts.append(f'<rect x="{x}" y="{y}" width="{NW}" height="{NH}" rx="14" fill="#fff" stroke="{col}" stroke-width="1.5"/>')
    parts.append(f'<rect x="{x}" y="{y}" width="6" height="{NH}" rx="3" fill="{col}"/>')
    img=IMG.get(n["screen"])
    parts.append(f'<image href="{img}" x="{x+14}" y="{y+(NH-THH)/2:.0f}" width="{THW}" height="{THH}" preserveAspectRatio="xMidYMid slice"/>')
    parts.append(f'<rect x="{x+14}" y="{y+(NH-THH)/2:.0f}" width="{THW}" height="{THH}" rx="4" fill="none" stroke="#e4e6f0"/>')
    tx=x+14+THW+12
    words=n["title"].split(); lines=[""]
    for w_ in words:
        if len(lines[-1])+len(w_)+1<=20: lines[-1]=(lines[-1]+" "+w_).strip()
        else: lines.append(w_)
    for li,ln in enumerate(lines[:2]):
        parts.append(f'<text x="{tx}" y="{y+30+li*17:.0f}" font-size="13.5" font-weight="650" fill="#161826" font-family="system-ui">{esc(ln)}</text>')
    parts.append(f'<a href="{img}" target="_blank"><text x="{tx}" y="{y+NH-14:.0f}" font-size="11" fill="#7a80a0" font-family="ui-monospace,monospace" text-decoration="underline">screen {n["screen"]} ↗</text></a>')
    for c in n["children"]: drawsub(c,col)
draw_root(tree)
svg=f'<svg viewBox="0 0 {W:.0f} {H:.0f}" width="{W:.0f}" height="{H:.0f}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="max-width:none">{"".join(parts)}</svg>'

total=len(items)
HTML=f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kanevo — User Flow (YNAB reference)</title>
<style>
:root{{--bg:#f5f6fa;--panel:#fff;--ink:#161826;--soft:#5a6078;--line:#e4e6f0;--accent:#4b4ddb;--pop:#16a34a;--radius:14px}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}}
header{{max-width:1240px;margin:0 auto;padding:34px 28px 6px}}
.kick{{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:12px}}
h1{{margin:0 0 8px;font-size:30px;letter-spacing:-.02em}}
header p{{margin:0;color:var(--soft);max-width:76ch}}
.note{{max-width:1240px;margin:14px auto 0;padding:0 28px}}
.note .box{{background:#eef7f0;border:1px solid #bfe0c8;border-radius:12px;padding:14px 16px;font-size:14px;color:#1c4b2e}}
.note .box b{{color:#14532d}}
.legend{{display:flex;gap:10px 20px;flex-wrap:wrap;margin:16px 0 4px;font-size:13px;color:var(--soft)}}
.legend b{{color:var(--ink)}}
main{{max-width:1240px;margin:0 auto;padding:0 28px 20px}}
.sec{{margin-top:26px;border-radius:16px;padding:2px 2px 6px}}
.sec.star{{background:linear-gradient(180deg,#eef0ff,transparent 120px);box-shadow:inset 0 0 0 1px #dfe1fb;padding:2px 14px 10px}}
.sechead{{display:flex;align-items:center;gap:10px;padding:14px 6px 8px}}
.sechead h2{{margin:0;font-size:19px;letter-spacing:-.01em}}
.sechead .sub{{color:var(--soft);font-size:13px}}
.sechead .cnt{{margin-left:auto;font:600 11px/1 ui-monospace,monospace;color:var(--soft);background:var(--panel);border:1px solid var(--line);padding:5px 9px;border-radius:20px}}
.dot{{width:11px;height:11px;border-radius:50%}}
.d0{{background:#4b4ddb}}.d1{{background:#e11d48}}.d2{{background:#0891b2}}.d3{{background:#64748b}}.d4{{background:#7c3aed}}.d5{{background:#d97706}}.d6{{background:#0d9488}}.d7{{background:#16a34a}}
.row{{display:flex;gap:16px;overflow-x:auto;padding:6px 4px 16px;scroll-snap-type:x proximity}}
.card{{flex:0 0 auto;width:216px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;text-decoration:none;color:inherit;scroll-snap-align:start;transition:transform .12s,box-shadow .12s}}
.card:hover{{transform:translateY(-3px);box-shadow:0 12px 28px rgba(22,24,38,.14)}}
.card.pop{{border-color:var(--pop);box-shadow:0 0 0 1px var(--pop)}}
.ph{{position:relative;background:#0c0e18;aspect-ratio:1080/2340;display:block}}
.ph img{{width:100%;height:100%;object-fit:cover;display:block}}
.num{{position:absolute;top:8px;left:8px;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font:600 13px/26px ui-monospace,monospace;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35)}}
.tag{{position:absolute;top:9px;right:8px;font:600 10px/1 ui-monospace,monospace;color:#fff;background:rgba(20,22,34,.82);padding:4px 7px;border-radius:20px}}
.card.pop .tag{{background:var(--pop)}}
.meta{{padding:11px 12px 13px}}
.meta .t{{font-weight:650;font-size:13.5px;margin-bottom:4px;letter-spacing:-.01em}}
.meta .c{{font-size:12px;color:var(--soft);line-height:1.42}}
.meta .ts{{margin-top:7px;font:11px/1 ui-monospace,monospace;color:#99a0bb}}
.tree{{max-width:1240px;margin:10px auto 0;padding:0 28px}}
.tree h2{{font-size:22px;margin:30px 0 4px}}
.tree p{{color:var(--soft);margin:0 0 14px;max-width:76ch}}
.treebox{{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:10px;overflow:auto}}
footer{{max-width:1240px;margin:0 auto;padding:24px 28px 60px;color:var(--soft);font-size:13px}}
@media(max-width:640px){{.card{{width:168px}}header,main,footer,.tree,.note{{padding-left:16px;padding-right:16px}}}}
</style></head><body>
<header>
  <div class="kick">Screen recording · 15 fps · settled frames only</div>
  <h1>Kanevo — YNAB user-flow reference</h1>
  <p>Every distinct screen from the recording, grouped by app section, plus a decision map of how they connect. Frames were taken only where the video is <b>temporally still</b>, so nothing is mid-animation. Click any screen to open it full-resolution (native 1080×2340).</p>
</header>
<div class="note"><div class="box">
  <b>How the Assigned / Available columns show:</b> they are not a separate screen — it’s a toggle. Open the <b>⋮ menu → Progress Bars</b>. When Progress Bars is <b>ON</b> the budget shows one “Available to Spend” column with a bar under each row (screen 1). Turn Progress Bars <b>OFF</b> and it switches to the two-column <b>Assigned + Available</b> numeric view (screen 2). That is the button you pressed.
</div></div>
<main>
  <div class="legend" style="max-width:1240px;margin:18px auto 0">
    <span><b>{total}</b> screens · 8 sections</span>
    <span><span style="color:#16a34a">■</span> green = undo/redo bottom popup</span>
    <span>tag <b>⋮ menu</b> = opened from the three-dot menu</span>
    <span>Numbers = flow order · mm:ss = time in clip</span>
  </div>
  {''.join(cards)}
</main>
<div class="tree">
  <h2>Decision map — what you tap, and what it shows</h2>
  <p>Each arrow is a decision (a tap or gesture); each box is the screen it opens, linked to its numbered screenshot above. The bottom tab bar (Home · Plan · Spending · Accounts · Reflect) is always available. Scroll the box to see the whole tree.</p>
  <div class="treebox"><img src="tree.png?v=3" alt="Decision map — each tap and the screen it opens" style="display:block;width:1912px;max-width:none"></div>
</div>
<footer>Full-res images live in <b>user-flow/screens/</b> (numbered to match). All {len(by)} settled frames are in <b>user-flow/candidates/</b>. Verified from the recording: the Progress-Bars column toggle, the Ready-to-Assign → Assign-Money entry, and the tap-a-category → calculator keypad (screen 20).</footer>
</body></html>'''
open("user-flow/index.html","w").write(HTML)
json.dump(items,open("user-flow/flow.json","w"),indent=1)
print("wrote",total,"screens + tree; svg",int(W),"x",int(H))
