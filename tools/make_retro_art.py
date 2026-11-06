#!/usr/bin/env python3
"""Draws every pixel-art graphic for Josh's Blog's early-2000s look.

All art here is original and drawn in code, so it can be regenerated or tweaked:
    python3 tools/make_retro_art.py
Writes into docs/img/. Needs Pillow. Text uses Silkscreen (Jason Kottke, 2001,
SIL Open Font License), the pixel font that classic web buttons were made with.
"""
import math
import os
import random
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "img")
os.makedirs(OUT, exist_ok=True)
FONT = ImageFont.truetype(os.path.join(HERE, "silkscreen-400.ttf"), 8)
FONT_B = ImageFont.truetype(os.path.join(HERE, "silkscreen-700.ttf"), 8)
FONT_2X = ImageFont.truetype(os.path.join(HERE, "silkscreen-700.ttf"), 16)

C = {
    "k": (0, 0, 0), "w": (255, 255, 255), "g": (192, 192, 192), "G": (128, 128, 128), "D": (64, 64, 64),
    "r": (232, 48, 48), "R": (150, 16, 16), "y": (255, 224, 64), "Y": (224, 160, 0),
    "b": (48, 96, 224), "B": (16, 32, 128), "c": (64, 192, 255), "n": (168, 104, 48), "N": (96, 48, 16),
    "t": (240, 208, 144), "p": (255, 112, 192), "P": (144, 64, 192), "l": (112, 224, 64), "L": (32, 128, 32),
    "o": (255, 144, 32), "s": (255, 216, 168), "S": (160, 216, 255), "m": (255, 64, 160),
}
T = (0, 0, 0, 0)


def col(c):
    if isinstance(c, str):
        return C[c] + (255,)
    return c if len(c) == 4 else tuple(c) + (255,)


def canvas(w=16, h=16, bg=T):
    return Image.new("RGBA", (w, h), bg)


def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height:
        im.putpixel((x, y), col(c))


def rect(im, x0, y0, x1, y1, c):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(im, x, y, c)


def box(im, x0, y0, x1, y1, c):
    for x in range(x0, x1 + 1):
        px(im, x, y0, c); px(im, x, y1, c)
    for y in range(y0, y1 + 1):
        px(im, x0, y, c); px(im, x1, y, c)


def art(im, x0, y0, rows):
    """Stamp an ASCII drawing. '.' is see-through; other letters are palette colors."""
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                px(im, x0 + x, y0 + y, ch)


def text(im, x, y, s, c="k", font=FONT):
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    d.text((x, y), s, font=font, fill=col(c))


def text_at(im, x, top, s, c="k", font=FONT):
    """Like text(), but `top` is where the tops of the capital letters land."""
    text(im, x, top - font.getbbox("H")[1], s, c, font)


def text_w(s, font=FONT):
    b = font.getbbox(s)
    return b[2] - b[0]


def sheet(frames, name):
    """Frames side by side, for CSS steps() hover animations."""
    w, h = frames[0].size
    s = canvas(w * len(frames), h)
    for i, f in enumerate(frames):
        s.paste(f, (i * w, 0))
    s.save(os.path.join(OUT, name))


def gif(frames, name, ms=150, loop=0):
    """Animated GIF with 1-bit transparency, like the real thing."""
    pal_frames = []
    for f in frames:
        f = f.convert("RGBA")
        alpha = f.getchannel("A")
        p = f.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=255)
        mask = Image.eval(alpha, lambda a: 255 if a < 128 else 0)
        p.paste(255, mask)
        p.info["transparency"] = 255
        pal_frames.append(p)
    durations = ms if isinstance(ms, list) else [ms] * len(frames)
    pal_frames[0].save(os.path.join(OUT, name), save_all=True, append_images=pal_frames[1:],
                       duration=durations, loop=loop, transparency=255, disposal=2, optimize=False)


# ---------------------------------------------------------------------------
# Nav icons: 16x16, 4 frames each, animate on hover
# ---------------------------------------------------------------------------
def icon_home():
    frames = []
    smoke = [[(11, 2)], [(11, 2), (12, 1)], [(11, 2), (12, 1), (12, 0)], [(12, 1), (13, 0)]]
    for f in range(4):
        im = canvas()
        art(im, 0, 3, [
            "..........kkk...",
            ".......kk.kRk...",
            "......krrkkRk...",
            ".....krrrrkRk...",
            "....krrrrrrkk...",
            "...krrrrrrrrk...",
            "..krrrrrrrrrrk..",
            ".kkkkkkkkkkkkkk.",
            "..ktttttttttttk.",
            "..ktkkktttkkktk.",
            "..ktknktttkSktk.",
            "..ktknktttkkktk.",
            "..kkkkkkkkkkkkk.",
        ])
        px(im, 3 + 0, 13, "y")  # doorknob glint
        for (x, y) in smoke[f]:
            px(im, x, y, "g")
        frames.append(im)
    return frames


def icon_computer():
    frames = []
    typing = [
        [(5, 5, "l"), (6, 5, "w")],
        [(5, 5, "l"), (6, 5, "l"), (7, 5, "l")],
        [(5, 5, "l"), (6, 5, "l"), (7, 5, "l"), (8, 5, "l"), (5, 7, "l"), (6, 7, "w")],
        [(5, 5, "l"), (6, 5, "l"), (7, 5, "l"), (8, 5, "l"), (5, 7, "l"), (6, 7, "l"), (7, 7, "l"), (5, 9, "w")],
    ]
    for f in range(4):
        im = canvas()
        rect(im, 2, 2, 13, 11, "g"); box(im, 2, 2, 13, 11, "k")
        rect(im, 4, 4, 11, 10, "B"); box(im, 3, 3, 12, 11, "G")
        px(im, 12, 12, "k")
        rect(im, 6, 12, 9, 12, "g"); px(im, 5, 12, "k"); px(im, 10, 12, "k")
        rect(im, 2, 13, 13, 14, "g"); box(im, 1, 13, 14, 15, "k")
        for x in range(3, 13, 2):
            px(im, x, 14, "G")
        px(im, 11, 10, "l" if f % 2 == 0 else "L")  # power light
        for (x, y, c) in typing[f]:
            px(im, x, y, c)
        frames.append(im)
    return frames


def icon_palette():
    frames = []
    dots = [("r", (4, 4)), ("y", (9, 3)), ("b", (10, 7)), ("l", (6, 10))]
    for f in range(4):
        im = canvas()
        art(im, 0, 1, [
            "....kkkkkkk.....",
            "..kkttttttttk...",
            ".kttttttttttk...",
            ".kttttttttttk...",
            "kttttttttttttk..",
            "kttkkttttttttk..",
            "ktk..kttttttk...",
            "kttkkttttttk....",
            ".kttttttttk.....",
            ".kttttttttk.....",
            "..kkttttkk......",
            "....kkkk........",
        ])
        for i, (c, (x, y)) in enumerate(dots):
            rect(im, x, y, x + 1, y + 1, c)
            if i == f:
                px(im, x, y, "w")
        # brush, tip dipped in the color that's sparkling
        for (x, y) in [(15, 0), (14, 1), (13, 2)]:
            px(im, x, y, "n")
        px(im, 12, 3, "g")
        px(im, 11, 4, dots[f][0]); px(im, 10, 5, dots[f][0])
        frames.append(im)
    return frames


NOTE = [
    "...k...",
    "...kk..",
    "...k.k.",
    "...k..k",
    "...k..k",
    "...k.k.",
    "...k...",
    ".kkk...",
    "kkkk...",
    ".kk....",
]


def icon_notes():
    frames = []
    for (a, b) in [(4, 4), (2, 5), (5, 2), (3, 3)]:
        im = canvas()
        art(im, 0, a, [r.replace("k", "P") for r in NOTE])
        art(im, 8, b, [r.replace("k", "b") for r in NOTE])
        frames.append(im)
    return frames


def icon_tv():
    frames = []
    rnd = random.Random(7)
    for f in range(4):
        im = canvas()
        for (x, y) in [(4, 0), (5, 1), (6, 2), (11, 0), (10, 1), (9, 2)]:
            px(im, x, y, "k")
        px(im, 7, 3, "k"); px(im, 8, 3, "k")
        rect(im, 1, 4, 14, 14, "n"); box(im, 0, 3, 15, 15, "k")
        rect(im, 2, 5, 10, 13, "k")
        if f < 2:
            for y in range(6, 13):
                for x in range(3, 10):
                    px(im, x, y, rnd.choice(["w", "g", "G", "D"]))
        else:
            rect(im, 3, 6, 9, 12, "B")
            art(im, 5, 7, ["r..", "rr.", "rrr", "rr.", "r.."] if f == 2 else ["w..", "ww.", "www", "ww.", "w.."])
        px(im, 12, 6, "y"); px(im, 12, 8, "k"); px(im, 13, 8, "k"); px(im, 12, 9, "k")
        for x in range(12, 14):
            px(im, x, 11, "N"); px(im, x, 12, "N")
        frames.append(im)
    return frames


def icon_mail():
    frames = []
    for f in range(4):
        im = canvas()
        rect(im, 1, 6, 14, 14, "w"); box(im, 0, 5, 15, 15, "k")
        for i in range(7):
            px(im, 1 + i, 14 - i // 2, "g"); px(im, 14 - i, 14 - i // 2, "g")
        if f == 0:
            for i in range(8):
                px(im, 1 + i, 6 + i // 1 if i < 5 else 10, "G")
            art(im, 1, 6, ["k............k", ".k..........k.", "..k........k..", "...k......k...", "....kkkkkk...."])
        else:
            lift = [0, 2, 4, 5][f]
            # letter rising out
            rect(im, 4, 6 - lift + 1, 11, 10, "y"); box(im, 3, 6 - lift, 12, 10, "k")
            if f == 3:
                rect(im, 5, 3, 10, 3, "G"); rect(im, 5, 5, 9, 5, "G")
            art(im, 0, 5, ["k..............k", ".k............k.", "..kk........kk..", "....kkkkkkkk...."])
        frames.append(im)
    return frames


def icon_people():
    frames = []
    head = ["..kkkk..", ".kyyyyk.", "kykyykyk", "kyyyyyyk", "kykyykyk", ".kykkyk.", "..kkkk..",
            ".kbbbbk.", "kbbbbbbk"]
    head2 = [r.replace("b", "L") for r in head]
    for (a, b) in [(4, 5), (3, 6), (4, 5), (5, 4)]:
        im = canvas()
        art(im, 0, a + 1, head2)
        art(im, 8, b, head)
        frames.append(im)
    return frames


def icon_smiley_wink():
    frames = []
    for f in range(4):
        im = canvas()
        rect(im, 3, 2, 12, 13, "y"); rect(im, 2, 3, 13, 12, "y")
        for (x0, y0, x1, y1) in [(4, 1, 11, 1), (4, 14, 11, 14), (1, 4, 1, 11), (14, 4, 14, 11)]:
            rect(im, x0, y0, x1, y1, "k")
        for (x, y) in [(2, 2), (3, 2), (2, 3), (12, 2), (13, 2), (13, 3), (2, 12), (2, 13), (3, 13), (13, 12), (13, 13), (12, 13)]:
            px(im, x, y, "k")
        rect(im, 3, 3, 3, 3, "y")
        px(im, 5, 5, "k"); px(im, 5, 6, "k")
        if f == 2:
            px(im, 9, 6, "k"); px(im, 10, 6, "k")
        else:
            px(im, 10, 5, "k"); px(im, 10, 6, "k")
        for (x, y) in [(4, 9), (5, 10), (6, 11), (7, 11), (8, 11), (9, 11), (10, 10), (11, 9)]:
            px(im, x, y, "k")
        px(im, 4, 8, "o" if f else "y"); px(im, 11, 8, "o" if f else "y")
        frames.append(im)
    return frames


def icon_gear():
    frames = []
    for f in range(4):
        im = canvas()
        d = ImageDraw.Draw(im)
        a0 = f * (math.pi / 16)
        pts = []
        for i in range(16):
            ang = a0 + i * math.pi / 8
            r = 7.4 if i % 2 == 0 else 5.2
            pts.append((7.5 + r * math.cos(ang), 7.5 + r * math.sin(ang)))
        d.polygon(pts, fill=col("G"), outline=col("k"))
        d.ellipse((5, 5, 10, 10), fill=col("g"), outline=col("k"))
        rect(im, 7, 7, 8, 8, "w")
        frames.append(im)
    return frames


def icon_shield():
    frames = []
    for f in range(4):
        im = canvas()
        art(im, 1, 1, [
            ".kkkkkkkkkkkk.",
            "kbbbbbbwwwwwwk",
            "kbbbbbbwwwwwwk",
            "kbbbbbbwwwwwwk",
            "kbbbbbbwwwwwwk",
            "kbbbbbbwwwwwwk",
            "kwwwwwwrrrrrrk",
            "kwwwwwwrrrrrrk",
            ".kwwwwwrrrrrk.",
            ".kwwwwwrrrrrk.",
            "..kwwwwrrrrk..",
            "...kwwwrrrk...",
            "....kkkkkk....",
        ])
        gx = 3 + f * 3
        for (x, y) in [(gx, 3), (gx + 1, 2), (gx - 1, 4)]:
            px(im, x, y, "y")
        frames.append(im)
    return frames


def icon_book():
    frames = []
    for f in range(4):
        im = canvas()
        rect(im, 2, 3, 13, 13, "w"); box(im, 1, 2, 14, 14, "k")
        rect(im, 7, 3, 8, 13, "g")
        for y in (5, 7, 9, 11):
            rect(im, 3, y, 5, y, "G"); rect(im, 10, y, 12, y, "G")
        rect(im, 1, 14, 14, 15, "R")
        if f in (1, 2):  # page turning
            x = 9 if f == 1 else 6
            rect(im, x, 2, x + 2, 12, "w"); box(im, x, 1, x + 2, 12, "k")
        frames.append(im)
    return frames


def icon_card():
    frames = []
    for f in range(4):
        im = canvas()
        rect(im, 1, 4, 14, 12, "c"); box(im, 0, 3, 15, 13, "k")
        rect(im, 1, 6, 14, 7, "B")
        rect(im, 2, 10, 6, 10, "w"); rect(im, 11, 9, 13, 11, "y")
        sx = 1 + f * 4
        for i in range(3):
            px(im, sx + i, 11 - i * 2, "w"); px(im, sx + i + 1, 11 - i * 2, "w")
        frames.append(im)
    return frames


def icon_door():
    frames = []
    for f in range(4):
        im = canvas()
        rect(im, 3, 1, 12, 15, "D"); box(im, 2, 0, 13, 15, "k")
        w = [9, 7, 5, 7][f]
        rect(im, 3, 1, 3 + w, 15, "n"); box(im, 3, 1, 3 + w, 15, "N")
        px(im, 2 + w, 8, "y")
        frames.append(im)
    return frames


def icon_key():
    frames = []
    for f in range(4):
        im = canvas()
        art(im, 1, 4, [
            ".kkkk.......",
            "kyyyyk......",
            "kyk.yk......",
            "kyyyykkkkkkk",
            "kyyyyyyyyyyk",
            ".kkkkkkykkyk",
            "......k.kk.k",
        ][: 7])
        sx = [13, 14, 13, 12][f]
        px(im, sx, 2 + f % 2, "y"); px(im, sx, 4 - f % 2, "w")
        frames.append(im)
    return frames


ICONS = {
    "feed": icon_home, "software": icon_computer, "art": icon_palette, "music": icon_notes,
    "youtube": icon_tv, "chats": icon_mail, "friends": icon_people, "profile": icon_smiley_wink,
    "settings": icon_gear, "mod": icon_shield, "rules": icon_book, "card": icon_card,
    "logout": icon_door, "login": icon_key,
}


# ---------------------------------------------------------------------------
# Little animated GIFs
# ---------------------------------------------------------------------------
def sparkle_frames(size=9, color="g"):
    frames = []
    m = size // 2
    for r in [1, 3, 4, 2]:
        im = canvas(size, size)
        for i in range(-r, r + 1):
            px(im, m + i, m, color if abs(i) < r else "w"); px(im, m, m + i, color if abs(i) < r else "w")
        if r >= 3:
            for d in (1,):
                for (x, y) in [(m - d, m - d), (m + d, m - d), (m - d, m + d), (m + d, m + d)]:
                    px(im, x, y, "w")
        px(im, m, m, "w")
        frames.append(im)
    return frames


def new_badge():
    frames = []
    cols = ["r", "o", "r", "R"]
    w = text_w("NEW!", FONT) + 6
    for f in range(4):
        im = canvas(w, 11)
        rect(im, 1, 1, w - 2, 9, "y"); box(im, 0, 0, w - 1, 10, "k")
        for (x, y) in [(0, 0), (w - 1, 0), (0, 10), (w - 1, 10)]:
            px(im, x, y, T)
        text(im, 3, -2, "NEW!", cols[f], FONT)
        frames.append(im)
    return frames


THUMB = [
    "....kk.....",
    "...kxxk....",
    "...kxxk....",
    "..kxxxk....",
    "kkkxxxkkkk.",
    "kxkxxxxxxxk",
    "kxkxxxxkkk.",
    "kxkxxxxxxxk",
    "kxkxxxxkkk.",
    "kxkxxxxxxk.",
    "kkkkkkkkk..",
]


def props():
    """Thumbs up: [not given, hover, given, given+hover]."""
    out = []
    for fill, dy, shine in [("g", 1, False), ("w", 0, False), ("o", 1, True), ("y", 0, True)]:
        im = canvas(11, 12)
        art(im, 0, dy, [r.replace("x", fill) for r in THUMB])
        if shine:
            px(im, 4, 2 + dy, "w")
        out.append(im)
    return out


def hourglass():
    frames = []
    # sand rows inside the glass: top bulb rows 3..6, bottom bulb rows 8..11
    top_rows = {3: (2, 8), 4: (3, 7), 5: (4, 6), 6: (5, 5)}
    bot_rows = {8: (5, 5), 9: (4, 6), 10: (3, 7), 11: (2, 8)}
    for f in range(4):
        im = canvas(11, 15)
        rect(im, 0, 0, 10, 1, "n"); rect(im, 0, 13, 10, 14, "n")
        for y in range(2, 13):
            d = abs(y - 7)
            px(im, 5 - d, y, "k"); px(im, 5 + d, y, "k")
        keep_top = [4, 3, 2, 1][f]          # how many top rows still hold sand (from the neck up)
        fill_bot = [1, 2, 3, 4][f]          # how many bottom rows are filled (from the base up)
        for y in sorted(top_rows)[-keep_top:]:
            a, b = top_rows[y]; rect(im, a, y, b, y, "y")
        for y in sorted(bot_rows)[-fill_bot:]:
            a, b = bot_rows[y]; rect(im, a, y, b, y, "y")
        if f < 3:
            px(im, 5, 7, "y")
        frames.append(im)
    return frames


def envelope_alert():
    frames = []
    for f in range(4):
        im = canvas(20, 14)
        rect(im, 1, 3, 18, 12, "w"); box(im, 0, 2, 19, 13, "k")
        opened = f in (1, 2)
        if opened:
            art(im, 0, 0, ["....kkkkkkkkkkkk....", "..kk............kk..", "kk................kk"])
            rect(im, 4, 1, 15, 6, "y"); box(im, 4, 1, 15, 7, "k")
            rect(im, 7, 3, 12, 3, "G"); rect(im, 7, 5, 11, 5, "G")
        for i in range(9):
            px(im, 1 + i, 3 + i // 2 if not opened else 12 - i // 2, "G")
            px(im, 18 - i, 3 + i // 2 if not opened else 12 - i // 2, "G")
        frames.append(im)
    return frames


def bg_tile():
    """64x64 dark tile: faint grid and a few slow-blinking stars."""
    frames = []
    base = (12, 14, 20)
    rnd = random.Random(42)
    stars = [(rnd.randrange(64), rnd.randrange(64), rnd.randrange(4)) for _ in range(5)]
    dust = [(rnd.randrange(64), rnd.randrange(64)) for _ in range(12)]
    for f in range(4):
        im = canvas(64, 64, base + (255,))
        for i in range(64):
            px(im, i, 0, (18, 21, 30)); px(im, 0, i, (18, 21, 30))
        for (x, y) in dust:
            px(im, x, y, (34, 38, 52))
        for (x, y, phase) in stars:
            s_ = (f + phase) % 4
            px(im, x, y, (150, 156, 175) if s_ != 2 else (235, 235, 235))
            if s_ == 2:
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
                    px(im, x + dx, y + dy, (70, 76, 96))
        frames.append(im)
    return frames


def scanner_bar():
    """Knight Rider style light sweeping across a dark bar."""
    frames = []
    W = 120
    positions = list(range(4, W - 4, 8)) + list(range(W - 12, 4, -8))
    for pos in positions:
        im = canvas(W, 6, (10, 10, 10, 255))
        box(im, 0, 0, W - 1, 5, (60, 60, 60))
        for x in range(1, W - 1):
            d = abs(x - pos)
            if d < 14:
                v = int(255 * (1 - d / 14) ** 1.5)
                for y in range(1, 5):
                    px(im, x, y, (max(40, v), int(v * 0.15), 0))
        frames.append(im)
    return frames


def star_bullet():
    frames = []
    for f in range(4):
        im = canvas(9, 9)
        shapes = [
            ["....y....", "....y....", "...yyy...", "yyyyyyyyy", ".yyyyyyy.", "..yyyyy..", "..yy.yy..", ".yy...yy.", "........."],
            ["....w....", "...yyy...", "..yyyyy..", "yyyyyyyyy", ".yyyyyyy.", "..yyyyy..", "..yy.yy..", ".y.....y.", "........."],
            ["....y....", "....y....", "...yyy...", "yywyyyyyy", ".yyyyyyy.", "..yyyyy..", "..yy.yy..", ".yy...yy.", "........."],
            ["....y....", "....y....", "...yyy...", "yyyyyyyyy", ".yyyyyyy.", "..yyyyy..", "..yy.yy..", ".yy...yy.", "........."],
        ]
        art(im, 0, 0, shapes[f])
        for y in range(9):
            for x in range(9):
                if im.getpixel((x, y))[3] and not any(
                        0 <= x + dx < 9 and 0 <= y + dy < 9 and im.getpixel((x + dx, y + dy))[3] for dx, dy in [(0, 0)]):
                    pass
        frames.append(im)
    return frames


def user_icon():
    im = canvas(12, 13)
    art(im, 0, 0, [
        "...kkkkkk...",
        "..kssssssk..",
        ".kssssssssk.",
        ".kssksskssk.",
        ".kssssssssk.",
        ".kskssssksk.",
        "..kskkkksk..",
        "...kssssk...",
        "....kkkk....",
        "..kkbbbbkk..",
        ".kbbbbbbbbk.",
        "kbbbbbbbbbbk",
        "kkkkkkkkkkkk",
    ])
    return im


def mood_face(kind):
    im = canvas(15, 15)
    # round yellow face with outline
    art(im, 0, 0, [
        ".....kkkkk.....",
        "...kkyyyyykk...",
        "..kyyyyyyyyyk..",
        ".kyyyyyyyyyyyk.",
        ".kyyyyyyyyyyyk.",
        "kyyyyyyyyyyyyyk",
        "kyyyyyyyyyyyyyk",
        "kyyyyyyyyyyyyyk",
        "kyyyyyyyyyyyyyk",
        "kyyyyyyyyyyyyyk",
        ".kyyyyyyyyyyyk.",
        ".kyyyyyyyyyyyk.",
        "..kyyyyyyyyyk..",
        "...kkyyyyykk...",
        ".....kkkkk.....",
    ])
    px(im, 4, 3, "w"); px(im, 3, 4, "w")
    E = lambda pts: [px(im, x, y, "k") for (x, y) in pts]
    eyes_dot = [(5, 5), (5, 6), (9, 5), (9, 6)]
    smile = [(4, 9), (5, 10), (6, 10), (7, 10), (8, 10), (9, 10), (10, 9)]
    if kind == "happy":
        E(eyes_dot + smile)
    elif kind == "excited":
        E(eyes_dot); art(im, 4, 9, ["kkkkkkk", "krrrrrk", ".kkkkk."])
    elif kind == "chill":
        E([(4, 6), (5, 6), (6, 6), (8, 6), (9, 6), (10, 6), (5, 10), (6, 10), (7, 10), (8, 10), (9, 9)])
    elif kind == "creative":
        E(eyes_dot + smile); art(im, 10, 0, ["..y..", ".yyy.", "yywyy", ".yyy.", "..y.."])
    elif kind == "sleepy":
        E([(4, 6), (5, 6), (6, 6), (8, 6), (9, 6), (10, 6), (6, 10), (7, 10), (8, 10)])
        art(im, 11, 0, ["bbb.", ".b..", "bbb."])
    elif kind == "hungry":
        E(eyes_dot); art(im, 5, 8, [".kkk.", "kpppk", "kpppk", ".kkk."])
    elif kind == "sad":
        E(eyes_dot + [(4, 11), (5, 10), (6, 10), (7, 10), (8, 10), (9, 10), (10, 11)]); px(im, 10, 7, "c"); px(im, 10, 8, "c")
    elif kind == "annoyed":
        E([(4, 5), (5, 5), (6, 5), (8, 5), (9, 5), (10, 5), (5, 6), (9, 6), (5, 10), (6, 10), (7, 10), (8, 10), (9, 10)])
        for y in range(1, 14):
            for x in range(1, 14):
                p = im.getpixel((x, y))
                if p[:3] == C["y"]:
                    px(im, x, y, (255, 170, 80))
    elif kind == "loved":
        art(im, 3, 4, ["r.r.r.r", "rrrkrrr", ".r...r."]); E(smile)
    elif kind == "cool":
        art(im, 2, 5, ["kkkkkkkkkkk", ".kkkk.kkkk.", "..kk...kk.."]); E(smile)
    elif kind == "accomplished":
        E(eyes_dot + smile); art(im, 0, 11, ["....", "y...", ".y..", "..y."])
        art(im, 10, 10, ["...l", "..l.", "l.l.", ".l.."])
    elif kind == "nostalgic":
        E([(4, 6), (5, 5), (6, 6), (8, 6), (9, 5), (10, 6)] + smile)
    elif kind == "silly":
        E(eyes_dot + smile); art(im, 7, 10, ["rr", "rr"])
    elif kind == "thoughtful":
        E(eyes_dot + [(6, 10), (7, 10), (8, 10)]); art(im, 11, 1, ["...g", "..gg", ".g..", "g..."][:0])
        px(im, 12, 2, "g"); px(im, 13, 1, "g"); px(im, 13, 0, "w")
    elif kind == "busy":
        E(eyes_dot + [(5, 10), (6, 10), (7, 10), (8, 10), (9, 10)]); px(im, 12, 3, "c"); px(im, 12, 4, "c"); px(im, 13, 5, "c")
    return im


MOODS = ["happy", "excited", "chill", "creative", "sleepy", "hungry", "sad", "annoyed", "loved", "cool",
         "accomplished", "nostalgic", "silly", "thoughtful", "busy"]


# ---------------------------------------------------------------------------
# Blinkies (150x20) and buttons (88x31)
# ---------------------------------------------------------------------------
PIX_STAR = ["..y..", "..y..", "yyyyy", ".yyy.", ".y.y."]
PIX_BOLT = ["...yy", "..yy.", ".yyyy", "..yy.", ".yy.."]
PIX_ARROW = ["o....", "oo...", "ooo..", "oo...", "o...."]


def blinkie(name, parts, schemes, ms=220):
    """parts: list of str or icon rows; schemes: per-frame (bg, border, text) colors."""
    frames = []
    for (bg, border, fg) in schemes:
        im = canvas(150, 20, col(bg))
        box(im, 0, 0, 149, 19, border); box(im, 1, 1, 148, 18, (40, 40, 40))
        # measure total width
        widths = [text_w(p, FONT_B) if isinstance(p, str) else len(p[0]) for p in parts]
        gap = 4
        total = sum(widths) + gap * (len(parts) - 1)
        x = (150 - total) // 2
        for p, w in zip(parts, widths):
            if isinstance(p, str):
                text(im, x, 4, p, fg, FONT_B)
            else:
                art(im, x, 7, p)
            x += w + gap
        frames.append(im)
    gif(frames, name, ms)


def button88(name, draw, frames_n=1, ms=300):
    frames = []
    for f in range(frames_n):
        im = canvas(88, 31, col("w"))
        draw(im, f)
        # classic 1px bevel
        box(im, 0, 0, 87, 30, "k")
        for x in range(1, 87):
            px(im, x, 1, (255, 255, 255)) if False else None
        frames.append(im)
    if frames_n == 1:
        frames[0].convert("RGB").save(os.path.join(OUT, name.replace(".gif", ".gif")), "GIF")
    else:
        gif(frames, name, ms)


def vgrad(im, x0, y0, x1, y1, c0, c1, steps=6):
    """Banded (not smooth) gradient — 2003 Photoshop look."""
    h = y1 - y0 + 1
    for y in range(h):
        t = int((y / max(1, h - 1)) * (steps - 1) + 0.5) / (steps - 1)
        c = tuple(int(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
        rect(im, x0, y0 + y, x1, y0 + y, c)


def btn_blog(im, f):
    vgrad(im, 1, 1, 86, 29, (10, 10, 10), (70, 70, 80))
    text_at(im, 6, 5, "JOSH'S", (200, 200, 200), FONT_B)
    text_at(im, 6, 15, "BLOG", "o", FONT_2X)
    for i, (x, y) in enumerate([(70, 7), (79, 16), (66, 21)]):
        if (f + i) % 3 == 0:
            for d in (-2, -1, 0, 1, 2):
                px(im, x + d, y, "w"); px(im, x, y + d, "w")
        elif (f + i) % 3 == 1:
            px(im, x, y, "w"); px(im, x - 1, y, (200, 200, 255)); px(im, x + 1, y, (200, 200, 255))


def btn_trunk(im, f):
    vgrad(im, 1, 1, 86, 29, (20, 90, 40), (120, 220, 90))
    for (x0, x1) in [(5, 8), (21, 24)]:
        rect(im, x0, 8, x1, 22, "k"); rect(im, x0 + 1, 9, x1 - 1, 21, "g")
    rect(im, 9, 14, 20, 16, "k"); rect(im, 9, 15, 20, 15, "g")
    text_at(im, 31, 7, "TRUNK", "w", FONT_B)
    text_at(im, 31, 18, "GYM APP", "y", FONT)


def btn_paulie(im, f):
    vgrad(im, 1, 1, 86, 29, (60, 20, 90), (255, 140, 60))
    # three-against-four polyrhythm lights
    for i in range(4):
        rect(im, 4 + i * 6, 8, 7 + i * 6, 11, "y" if (f % 4) == i else "D")
    for i in range(3):
        rect(im, 4 + i * 8, 18, 7 + i * 8, 21, "c" if (f % 3) == i else "D")
    text_at(im, 32, 7, "PAULIE", "w", FONT_B)
    text_at(im, 32, 18, "DRUM MIDI", "y", FONT)


def btn_card(im, f):
    vgrad(im, 1, 1, 86, 29, (0, 70, 140), (0, 180, 220))
    rect(im, 5, 8, 25, 22, "w"); box(im, 4, 7, 26, 23, "k"); rect(im, 5, 11, 25, 13, "B")
    rect(im, 7, 17, 13, 18, "G")
    sx = 6 + (f * 7) % 18
    px(im, sx, 21, "y"); px(im, sx + 1, 20, "y"); px(im, sx + 2, 19, "w")
    text_at(im, 31, 7, "JOSH", "w", FONT_B)
    text_at(im, 31, 18, "CARD", "y", FONT_B)


def under_construction():
    frames = []
    for f in range(3):
        im = canvas(88, 31, col("k"))
        for x in range(88):
            for y in range(31):
                if (y < 6 or y > 24) and ((x + y + f * 4) // 6) % 2 == 0:
                    px(im, x, y, "y")
        rect(im, 0, 6, 87, 24, "y")
        text_at(im, 5, 8, "UNDER", "k", FONT_B)
        text_at(im, 9, 17, "CONSTRUCTION", "k", FONT)
        lamp = "r" if f == 1 else "o"
        rect(im, 71, 7, 79, 15, "k"); rect(im, 72, 8, 78, 14, lamp)
        if f == 1:
            for (x, y) in [(75, 6), (70, 11), (80, 11)]:
                px(im, x, y, "w")
        box(im, 0, 0, 87, 30, "k")
        frames.append(im)
    gif(frames, "under-construction.gif", 350)


def header_banner():
    """960x150: dithered night sky over a pixel city skyline with lit windows."""
    W, H = 960, 150
    im = Image.new("RGB", (W, H))
    top, bot = (6, 8, 18), (44, 58, 92)
    bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
    levels = 6
    pal = [tuple(int(top[i] + (bot[i] - top[i]) * k / (levels - 1)) for i in range(3)) for k in range(levels)]
    for y in range(H):
        t = y / (H - 1) * (levels - 1)
        for x in range(W):
            base = int(t)
            k = base + (1 if (t - base) * 16 > bayer[y % 4][x % 4] + 0.5 else 0)
            im.putpixel((x, y), pal[min(k, levels - 1)])
    rnd = random.Random(2003)
    for _ in range(200):
        x, y = rnd.randrange(W), rnd.randrange(int(H * 0.6))
        im.putpixel((x, y), (230, 230, 220) if rnd.random() < 0.4 else (120, 130, 160))
    for _ in range(10):
        x, y = rnd.randrange(8, W - 8), rnd.randrange(6, int(H * 0.45))
        for d in (-1, 1):
            im.putpixel((x + d, y), (140, 150, 190)); im.putpixel((x, y + d), (140, 150, 190))
        im.putpixel((x, y), (255, 255, 255))
    # moon
    mx, my, r = 880, 34, 15
    for y in range(my - r, my + r + 1):
        for x in range(mx - r, mx + r + 1):
            if (x - mx) ** 2 + (y - my) ** 2 <= r * r:
                im.putpixel((x, y), (214, 214, 196) if (x - mx + 4) ** 2 + (y - my + 3) ** 2 > 30 else (236, 236, 220))
    for (cx, cy) in [(874, 30), (886, 42), (879, 44)]:
        im.putpixel((cx, cy), (170, 170, 150)); im.putpixel((cx + 1, cy), (170, 170, 150))

    def skyline(seed, base_y, min_h, max_h, color, win_color, win_chance):
        r2 = random.Random(seed)
        x = -10
        while x < W:
            bw = r2.randrange(18, 54)
            bh = r2.randrange(min_h, max_h)
            top_y = base_y - bh
            for yy in range(max(0, top_y), H):
                for xx in range(max(0, x), min(W, x + bw)):
                    im.putpixel((xx, yy), color)
            ax = x + bw // 2
            if r2.random() < 0.3 and 0 <= ax < W:
                tall = r2.randrange(6, 16)
                for yy in range(max(0, top_y - tall), top_y):
                    im.putpixel((ax, yy), color)
                if r2.random() < 0.6:
                    im.putpixel((ax, max(0, top_y - tall)), (255, 60, 40))
            elif r2.random() < 0.2:
                for yy in range(max(0, top_y - 7), top_y):
                    for xx in range(max(0, x + 4), min(W, x + 12)):
                        im.putpixel((xx, yy), color)
            for yy in range(top_y + 4, H - 2, 5):
                for xx in range(x + 3, x + bw - 3, 4):
                    if 0 <= xx < W - 1 and 0 <= yy < H - 1 and r2.random() < win_chance:
                        c = win_color if r2.random() < 0.85 else (150, 200, 255)
                        for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)]:
                            im.putpixel((xx + dx, yy + dy), c)
            x += bw + r2.randrange(0, 4)
    skyline(11, H + 2, 40, 95, (20, 24, 36), (120, 100, 50), 0.22)
    skyline(29, H + 2, 18, 62, (8, 9, 14), (255, 190, 80), 0.32)
    im.save(os.path.join(OUT, "header.png"), optimize=True)


def favicon():
    im = canvas(32, 32, (14, 14, 16, 255))
    box(im, 0, 0, 31, 31, (90, 90, 100))
    text(im, 9, 5, "J", "o", FONT_2X)
    for (x, y) in [(24, 6), (6, 24)]:
        for d in (-2, -1, 0, 1, 2):
            px(im, x + d, y, "w"); px(im, x, y + d, "w")
    im.save(os.path.join(OUT, "favicon.png"))


def main():
    sheet(props(), "props.png")
    gif(scanner_bar(), "scanner.gif", 40)
    for name, fn in ICONS.items():
        sheet(fn(), f"i-{name}.png")
    gif(sparkle_frames(9), "sparkle.gif", 120)
    gif(sparkle_frames(13, "c"), "sparkle-big.gif", 140)
    gif(new_badge(), "new.gif", 200)
    gif(hourglass(), "hourglass.gif", 220)
    gif(envelope_alert(), "mail.gif", 260)
    gif(bg_tile(), "bg-stars.gif", 400)
    sheet(star_bullet(), "star.png")
    user_icon().save(os.path.join(OUT, "user.gif"))
    for m in MOODS:
        mood_face(m).save(os.path.join(OUT, f"mood-{m}.gif"))
    dark, dark2 = (16, 16, 16), (28, 28, 28)
    blinkie("blinkie-blog.gif", [PIX_ARROW, "JOSH'S BLOG", PIX_ARROW],
            [(dark, "o", "o"), (dark2, "y", "y")], 400)
    blinkie("blinkie-sam.gif", ["SOFTWARE", PIX_STAR, "ART", PIX_STAR, "MUSIC"],
            [(dark, "c", "c"), (dark, "o", "o"), (dark, "l", "l")], 300)
    blinkie("blinkie-comments.gif", [PIX_ARROW, "SAY SOMETHING", PIX_ARROW],
            [(dark, "l", "l"), (dark2, "L", "w")], 450)
    blinkie("blinkie-noads.gif", ["NO ADS", PIX_BOLT, "NO POP-UPS"],
            [(dark, "r", "w"), (dark2, "r", "r")], 500)
    blinkie("blinkie-18.gif", ["MEMBERS 18+", PIX_STAR, "BE COOL"],
            [(dark, "c", "w"), (dark2, "b", "c")], 500)
    button88("btn-blog.gif", btn_blog, 3, 280)
    button88("btn-trunk.gif", btn_trunk, 1)
    button88("btn-paulie.gif", btn_paulie, 12, 160)
    button88("btn-card.gif", btn_card, 3, 240)
    under_construction()
    header_banner()
    favicon()
    print("wrote", len(os.listdir(OUT)), "files to", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
