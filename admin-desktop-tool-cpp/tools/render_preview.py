#!/usr/bin/env python3
"""Paints a NOCTURNE Key Pass draw list (JSON from tools/dump_layout) to a PNG.

This is a documentation helper: it renders the very same geometry the Windows
app paints with GDI+, using DejaVu Sans as a stand-in for Segoe UI.

    python3 tools/render_preview.py login.json docs/preview-login.png
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
REGULAR = os.path.join(FONT_DIR, "DejaVuSans.ttf")
BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
_fonts = {}


def font(px, bold=False):
    key = (round(px), bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(BOLD if bold else REGULAR, max(1, int(round(px))))
    return _fonts[key]


def rgba(c):
    if len(c) == 3:
        return tuple(c) + (255,)
    return tuple(c)


def vgradient(size, top, bottom):
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    if h == 1:
        d.point((0, 0), fill=top)
        return img
    for y in range(h):
        t = y / (h - 1)
        d.line(
            [(0, y), (w, y)],
            fill=(
                int(top[0] + (bottom[0] - top[0]) * t),
                int(top[1] + (bottom[1] - top[1]) * t),
                int(top[2] + (bottom[2] - top[2]) * t),
                int(top[3] + (bottom[3] - top[3]) * t),
            ),
        )
    return img


def rounded_mask(size, radius):
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    scale = 3
    mask = Image.new("L", (w * scale, h * scale), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w * scale - 1, h * scale - 1], radius=max(0, radius) * scale, fill=255
    )
    return mask.resize((w, h), Image.LANCZOS)


def blend_rect(canvas, box, radius, fill, fill2, stroke, stroke_width):
    x0, y0 = box[0], box[1]
    w, h = box[2], box[3]
    if w <= 0 or h <= 0:
        return
    lw, lh = max(1, int(round(w))), max(1, int(round(h)))
    layer = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    if rgba(fill)[3] > 0:
        if fill2 and rgba(fill2)[3] > 0:
            layer.paste(vgradient((lw, lh), rgba(fill), rgba(fill2)), (0, 0))
        else:
            ImageDraw.Draw(layer).rectangle([0, 0, w, h], fill=rgba(fill))
    if stroke and rgba(stroke)[3] > 0:
        sw = max(1, int(round(stroke_width)))
        ImageDraw.Draw(layer).rounded_rectangle(
            [sw / 2, sw / 2, w - sw / 2, h - sw / 2], radius=radius, outline=rgba(stroke), width=sw
        )
    if radius > 0:
        shape = rounded_mask((lw, lh), radius)
        layer.putalpha(min_alpha(layer.getchannel("A"), shape))
    canvas.alpha_composite(layer, (int(round(x0)), int(round(y0))))


def min_alpha(a, b):
    from PIL import ImageChops

    return ImageChops.darker(a, b)


def blend_circle(canvas, cx, cy, r, fill, fill2, stroke, stroke_width):
    size = int(round(r * 2))
    if size <= 0:
        return
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if rgba(fill)[3] > 0:
        if fill2 and rgba(fill2)[3] > 0:
            grad = vgradient((size, size), rgba(fill), rgba(fill2))
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
            layer.paste(grad, (0, 0), mask)
        else:
            d.ellipse([0, 0, size - 1, size - 1], fill=rgba(fill))
    if stroke and rgba(stroke)[3] > 0:
        sw = max(1, int(round(stroke_width)))
        d.ellipse([sw / 2, sw / 2, size - sw / 2, size - sw / 2], outline=rgba(stroke), width=sw)
    canvas.alpha_composite(layer, (int(round(cx - r)), int(round(cy - r))))


def blend_ring(canvas, cx, cy, r, thickness, progress, start_c, end_c, track_c):
    size = int(round(r * 2)) + int(round(thickness)) + 4
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    off = size / 2
    box = [off - r, off - r, off + r, off + r]
    width = max(1, int(round(thickness)))
    if track_c and rgba(track_c)[3] > 0:
        d.arc(box, 0, 360, fill=rgba(track_c), width=width)
    if progress > 0:
        sweep = 360 * min(1.0, max(0.0, progress))
        steps = 48
        for i in range(steps):
            a0 = -90 + sweep * i / steps
            a1 = -90 + sweep * (i + 1) / steps
            t = (i + 0.5) / steps
            colour = (
                int(start_c[0] + (end_c[0] - start_c[0]) * t),
                int(start_c[1] + (end_c[1] - start_c[1]) * t),
                int(start_c[2] + (end_c[2] - start_c[2]) * t),
                int(start_c[3] + (end_c[3] - start_c[3]) * t),
            )
            d.arc(box, a0, a1 + 1, fill=colour, width=width)
    canvas.alpha_composite(layer, (int(round(cx - off)), int(round(cy - off))))


def blend_glow(canvas, cx, cy, r, colour, intensity):
    from PIL import ImageFilter

    size = max(4, int(round(r * 2)))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 26
    peak = max(0, min(255, int(intensity)))
    for i in range(steps, 0, -1):
        t = i / steps
        rr = size / 2 * t
        a = int(peak * ((1 - t) ** 2.4))
        d.ellipse([size / 2 - rr, size / 2 - rr, size / 2 + rr, size / 2 + rr],
                  fill=(colour[0], colour[1], colour[2], a))
    layer = layer.filter(ImageFilter.GaussianBlur(size / 24))
    canvas.alpha_composite(layer, (int(round(cx - size / 2)), int(round(cy - size / 2))))


def blend_line(canvas, x1, y1, x2, y2, colour, width):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).line([(x1, y1), (x2, y2)], fill=rgba(colour),
                               width=max(1, int(round(width))))
    canvas.alpha_composite(layer)


def fit_text(value, box_w, px, bold=False):
    text = value
    f = font(px, bold)
    while text and f.getlength(text) > box_w:
        text = text[:-1]
    if text != value:
        if len(text) > 1:
            text = text[:-1] + "…"
        else:
            text = ""
    return text


def blend_text(canvas, box, value, px, bold, colour, ax, ay, ellipsis):
    f = font(px, bold)
    text = value
    if ellipsis and f.getlength(text) > box[2]:
        text = fit_text(value, box[2], px, bold)
    if not text:
        return
    ascent, descent = f.getmetrics()
    line_h = ascent + descent
    tw = f.getlength(text)
    x = box[0]
    if ax == "center":
        x = box[0] + (box[2] - tw) / 2
    elif ax == "right":
        x = box[0] + box[2] - tw
    y = box[1]
    if ay == "middle":
        y = box[1] + (box[3] - line_h) / 2
    elif ay == "bottom":
        y = box[1] + box[3] - line_h
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((x, y - ascent * 0.12), text, font=f, fill=rgba(colour))
    canvas.alpha_composite(layer)


def render(data, scale=2):
    scale = int(scale)
    width, height = int(data["width"]), int(data["height"])
    base = Image.new("RGBA", (width * scale, height * scale), (0, 0, 0, 255))
    d = ImageDraw.Draw(base)

    def S(v):
        return v * scale

    for item in data["items"]:
        alpha = item.get("alpha", 1.0)
        kind = item["kind"]
        if kind == "glow":
            blend_glow(base, S(item["x"] + item["w"] / 2), S(item["y"] + item["h"] / 2),
                       S(item["r"]), item["fill"], item.get("intensity", 30) * alpha)
            continue

        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        if kind == "rect":
            blend_rect(layer, (S(item["x"]), S(item["y"]), S(item["w"]), S(item["h"])),
                       S(item.get("r", 0)), item.get("fill"), item.get("fill2"),
                       item.get("stroke"), item.get("sw", 1))
        elif kind == "circle":
            blend_circle(layer, S(item["x"] + item["w"] / 2), S(item["y"] + item["h"] / 2),
                         S(item["r"]), item.get("fill"), item.get("fill2"), item.get("stroke"),
                         item.get("sw", 1))
        elif kind == "ring":
            blend_ring(layer, S(item["x"] + item["w"] / 2), S(item["y"] + item["h"] / 2),
                       S(item["r"]), S(item.get("thickness", 6)), item.get("progress", 0),
                       item.get("fill"), item.get("fill2"), item.get("stroke"))
        elif kind == "line":
            blend_line(layer, S(item["x"]), S(item["y"]), S(item["x"] + item["w"]),
                       S(item["y"] + item["h"]), item.get("stroke"), item.get("sw", 1))
        elif kind == "text":
            blend_text(layer, (S(item["x"]), S(item["y"]), S(item["w"]), S(item["h"])),
                       item["text"], S(item.get("size", 12)), item.get("bold", False),
                       item.get("color"), item.get("ax", "left"), item.get("ay", "top"),
                       item.get("ellipsis", True))
        if alpha < 1.0:
            from PIL import ImageChops

            layer = ImageChops.multiply(
                layer, Image.new("RGBA", layer.size, (255, 255, 255, int(255 * alpha)))
            )
        base.alpha_composite(layer)
    return base.resize((width, height), Image.LANCZOS).convert("RGB")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    with open(sys.argv[1], encoding="utf-8") as handle:
        data = json.load(handle)
    scale = float(sys.argv[3]) if len(sys.argv) > 3 else 2
    image = render(data, scale)
    out = sys.argv[2]
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    image.save(out)
    print("saved", out, image.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
