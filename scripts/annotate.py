#!/usr/bin/env python3
"""Annotate the ThreadAtlas screenshot with labeled bounding boxes.

Loads dynamic element coordinates from docs/element-positions.json
if available, falling back gracefully to static defaults.
Uses supersampled drawing for smooth anti-aliased results.
"""

import os
import json
from PIL import Image, ImageDraw, ImageFont

# Resolve absolute paths relative to the script location
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.normpath(os.path.join(base_dir, "docs/screenshot.png"))
DST_DOCS = os.path.normpath(os.path.join(base_dir, "docs/screenshot_annotated.png"))

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

SS = 4  # 4x Supersample factor for ultra-sharp anti-aliased drawing

PALETTE = [
    (232,  65,  65),   # 1  red
    ( 50, 120, 230),   # 2  blue
    ( 40, 180,  99),   # 3  green
    (220, 150,  20),   # 4  orange
    (150,  70, 200),   # 5  purple
    ( 30, 180, 180),   # 6  teal
    (220,  80, 150),   # 7  pink
    ( 50, 190, 220),   # 8  cyan
    (180, 100,  50),   # 9  brown
    ( 80, 130,  60),   # 10 dark green
    (100, 100, 200),   # 11 indigo
    (200,  60, 100),   # 12 crimson
    (100, 170, 130),   # 13 sea green
    ( 80,  80, 160),   # 14 slate blue
    (180,  70,  70),   # 15 dark red
]

# Load coordinates extracted from DOM
positions = {}
positions_path = os.path.join(base_dir, "docs/element-positions.json")
if os.path.exists(positions_path):
    try:
        with open(positions_path, "r") as f:
            positions = json.load(f)
        print(f"Loaded dynamic layout coordinates from {positions_path}")
    except Exception as e:
        print(f"Warning: Failed to load {positions_path}, using defaults. {e}")


def get_geometry(key, fallback_box, W, H, fallback_marker=None):
    """Retrieve box and marker coordinates, falling back if not found in JSON."""
    geom = positions.get(key)
    # Handle array elements (like toolRows) by extracting the first element
    if isinstance(geom, list) and len(geom) > 0:
        geom = geom[0]

    if isinstance(geom, dict) and all(k in geom for k in ("x", "y", "w", "h")):
        x, y, w, h = geom["x"], geom["y"], geom["w"], geom["h"]
        if w > 0 and h > 0:
            # Inset toolRows slightly to prevent left/right border overlapping
            if key == "toolRows":
                x += 8
                w -= 16

            # Clip coordinates strictly within the viewport dimensions (W x H)
            x1 = max(0, x)
            y1 = max(0, y)
            x2 = min(W, x + w)
            y2 = min(H, y + h)

            box = (x1, y1, x2, y2)
            cx = x1 + (x2 - x1) // 2
            cy = y1 + (y2 - y1) // 2
            # Offset vertical centers for very tall panels to look nicer
            if key == "sessionList":
                cy = min(cy, 300)
            elif key == "timeline":
                cy = min(cy, 250)
            return box, (cx, cy)

    bx = fallback_box
    if fallback_marker:
        mk = fallback_marker
    else:
        mk = (bx[0] + (bx[2] - bx[0]) // 2, bx[1] + (bx[3] - bx[1]) // 2)
    return bx, mk


# Definitions of features and their fallback geometry
features = [
    # ---- Top toolbar ----
    {
        "key": "themeToggle",
        "fallback_box": (1485, 10, 1595, 42),
        "fallback_marker": (1540, 26),
        "label": "Light / Dark theme toggle"
    },
    {
        "key": "rescanBtn",
        "fallback_box": (1601, 11, 1706, 41),
        "fallback_marker": (1653, 26),
        "label": "Rescan local sessions"
    },
    {
        "key": "importBtn",
        "fallback_box": (1712, 11, 1808, 41),
        "fallback_marker": (1760, 26),
        "label": "Import files (browser-side)"
    },
    {
        "key": "sshBtn",
        "fallback_box": (1814, 11, 1900, 41),
        "fallback_marker": (1857, 26),
        "label": "SSH sync to remote host"
    },
    {
        "key": "pathDisplay",
        "fallback_box": (140, 13, 1470, 39),
        "fallback_marker": (805, 26),
        "label": "Primary workspace path display"
    },

    # ---- Sidebar ----
    {
        "key": "searchInput",
        "fallback_box": (12, 113, 194, 141),
        "fallback_marker": (103, 127),
        "label": "Search by title or path"
    },
    {
        "key": "sourceFilter",
        "fallback_box": (202, 113, 307, 141),
        "fallback_marker": (254, 127),
        "label": "Filter by source type"
    },
    {
        "key": "sessionCount",
        "fallback_box": (240, 65, 269, 91),
        "fallback_marker": (254, 78),
        "label": "Session count badge"
    },
    {
        "key": "sortToggle",
        "fallback_box": (275, 64, 303, 92),
        "fallback_marker": (289, 78),
        "label": "Sort order toggle"
    },
    {
        "key": "sessionList",
        "fallback_box": (0, 150, 319, 1080),
        "fallback_marker": (160, 300),
        "label": "Session list — click to load"
    },

    # ---- Detail panel ----
    {
        "key": "filterTabs",
        "fallback_box": (1329, 102, 1580, 128),
        "fallback_marker": (1454, 115),
        "label": "Message filter tabs (default / not tool / user / answer)"
    },
    {
        "key": "exportBtn",
        "fallback_box": (1484, 66, 1580, 94),
        "fallback_marker": (1532, 80),
        "label": "Export session as JSON"
    },
    {
        "key": "copyBtn",
        "fallback_box": (1446, 66, 1478, 94),
        "fallback_marker": (1462, 80),
        "label": "Copy to clipboard"
    },
    {
        "key": "toolRows",
        "fallback_box": (361, 458, 1559, 494),
        "fallback_marker": (960, 476),
        "label": "Collapsible tool call — click to expand / collapse"
    },

    # ---- Timeline panel ----
    {
        "key": "timeline",
        "fallback_box": (1600, 52, 1920, 1080),
        "fallback_marker": (1760, 250),
        "label": "Timeline — click to jump to message"
    },
]


def draw_marker(draw, cx, cy, num, color, font, r):
    """Draw a numbered circle marker with smooth white border."""
    # White halo
    draw.ellipse([cx - r - 3, cy - r - 3, cx + r + 3, cy + r + 3],
                 fill=(255, 255, 255, 255))
    # Colored circle
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 fill=(*color, 230))
    # Number text, centered
    text = str(num)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text((cx - tw // 2, cy - th // 2 - 1), text,
              fill=(255, 255, 255, 255), font=font)


def main():
    if not os.path.exists(SRC):
        print(f"Error: Raw screenshot not found at {SRC}. Run capture first.")
        return

    img = Image.open(SRC).convert("RGBA")
    W, H = img.size
    print(f"Input image size: {W}×{H}")

    # Legend area height at the bottom
    legend_h = 240
    canvas = Image.new("RGBA", (W, H + legend_h), (255, 255, 255, 255))
    canvas.paste(img, (0, 0))

    # Supersample for anti-aliasing
    cw, ch = canvas.size
    big = canvas.resize((cw * SS, ch * SS), Image.LANCZOS)
    draw = ImageDraw.Draw(big)

    # 4x Supersampled Fonts
    font_marker = ImageFont.truetype(FONT_BOLD, 12 * SS)
    font_legend_title = ImageFont.truetype(FONT_BOLD, 16 * SS)
    font_legend_num = ImageFont.truetype(FONT_BOLD, 10 * SS)
    font_legend_text = ImageFont.truetype(FONT_REG, 11 * SS)

    marker_r = 12 * SS

    # Draw bounding boxes and markers
    for i, feat in enumerate(features):
        color = PALETTE[i % len(PALETTE)]
        box, marker = get_geometry(feat["key"], feat["fallback_box"], W, H, feat["fallback_marker"])
        
        x1, y1, x2, y2 = [v * SS for v in box]
        
        # Outline border only, no fill
        draw.rectangle([x1, y1, x2, y2],
                       outline=color,
                       width=2 * SS)
        # Marker
        mx, my = marker[0] * SS, marker[1] * SS
        draw_marker(draw, mx, my, i + 1, color, font_marker, r=marker_r)

    # ---- Legend ----
    legend_top = (H + 20) * SS
    # Divider line
    draw.line([(40 * SS, legend_top - 5 * SS),
               ((W - 40) * SS, legend_top - 5 * SS)],
              fill=(226, 232, 240, 255), width=1 * SS)
    # Title
    draw.text((50 * SS, legend_top), "Interactive Features Guide",
              fill=(15, 23, 42, 255), font=font_legend_title)

    legend_body_top = legend_top + 36 * SS

    cols = 3
    items_per_col = (len(features) + cols - 1) // cols
    col_w = (W * SS) // cols
    row_h = 32 * SS
    marker_r_legend = 10 * SS

    for i, feat in enumerate(features):
        color = PALETTE[i % len(PALETTE)]
        col = i // items_per_col
        row = i % items_per_col
        x = 50 * SS + col * col_w
        y = legend_body_top + row * row_h

        draw_marker(draw, x + marker_r_legend, y + marker_r_legend,
                    i + 1, color, font_legend_num, r=marker_r_legend)
        text_x = x + marker_r_legend * 2 + 10 * SS
        text_y = y + 2 * SS
        draw.text((text_x, text_y), feat["label"],
                  fill=(71, 85, 105, 255), font=font_legend_text)

    # Downscale for final anti-aliased result
    final = big.resize((cw, ch), Image.LANCZOS).convert("RGB")
    final.save(DST_DOCS, "PNG")
    print(f"Saved annotated screenshot: {DST_DOCS}")

    
    print(f"Final annotated size: {final.size}")


if __name__ == "__main__":
    main()
