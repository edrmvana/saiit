#!/usr/bin/env python3
"""Генерирует растровые изображения сайта в каталог assets/.

    python3 tools/make_site_assets.py

Скрипт нужен потому, что изображения собираются процедурно: так логотип
гарантированно совпадает по стилю с иконкой настольного приложения
(admin-desktop-tool-cpp/tools/make_icon.py) и их легко пересобрать.

Выходные файлы:
    assets/nc_logo.webp   — знак NOCTURNE (прозрачный фон), 256 x 256
    assets/blackhole.webp — «чёрная дыра» для косметических карточек, 480 x 375
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")

SS = 3  # суперсэмплинг


def radial(size, stops, center, radius):
    """Радиальный градиент. stops — список (позиция 0..1, (r, g, b, a))."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    steps = 400
    cx, cy = center
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        colour = stops[-1][1]
        prev = stops[0]
        for idx in range(1, len(stops)):
            if t <= stops[idx][0]:
                p0, c0 = prev
                p1, c1 = stops[idx]
                k = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
                k = max(0.0, min(1.0, k))
                colour = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(4))
                break
            prev = stops[idx]
        else:
            colour = stops[-1][1]
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)
    return img


def blur_layer(img, radius):
    return img.filter(ImageFilter.GaussianBlur(radius))


# --------------------------------------------------------------------------
# Логотип: ночное светило с орбитой — та же геометрия, что у иконки приложения,
# но без подложки: логотип ложится на любую тёмную панель сайта.
# --------------------------------------------------------------------------

def build_logo(size=256):
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    cx = cy = n / 2.0

    # Мягкое сияние позади сферы
    halo = radial(
        n,
        [(0.0, (124, 77, 255, 140)), (0.5, (96, 48, 214, 66)), (1.0, (58, 25, 140, 0))],
        (cx, cy),
        int(n * 0.50),
    )
    img = Image.alpha_composite(img, halo)

    # Тело светила
    r = n * 0.255
    orb = radial(
        n,
        [
            (0.0, (243, 234, 255, 255)),
            (0.32, (187, 160, 255, 255)),
            (0.72, (124, 77, 255, 255)),
            (1.0, (54, 27, 132, 255)),
        ],
        (cx - r * 0.26, cy - r * 0.34),
        int(r * 1.75),
    )
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    img.paste(orb, (0, 0), mask)

    # Кольцо орбиты, затухающее к низу
    ring = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    rr = n * 0.395
    rd.ellipse(
        [cx - rr, cy - rr * 0.62, cx + rr, cy + rr * 0.62],
        outline=(205, 182, 255, 205),
        width=max(1, int(n * 0.017)),
    )
    ring = blur_layer(ring, n * 0.004)
    fade = Image.new("L", (n, n), 0)
    ImageDraw.Draw(fade).polygon(
        [(0, 0), (n, 0), (n, int(n * 0.60)), (0, int(n * 0.78))], fill=255
    )
    ring.putalpha(Image.composite(ring.getchannel("A"), Image.new("L", (n, n), 0), fade))
    img = Image.alpha_composite(img, ring)

    # Блик
    hl = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hr = r * 0.19
    hd.ellipse(
        [cx - r * 0.40 - hr, cy - r * 0.44 - hr, cx - r * 0.40 + hr, cy - r * 0.44 + hr],
        fill=(255, 255, 255, 215),
    )
    img = Image.alpha_composite(img, blur_layer(hl, n * 0.005))

    return img.resize((size, size), Image.LANCZOS)


# --------------------------------------------------------------------------
# Чёрная дыра: тёмное ядро, аккреционный диск и звёздная пыль вокруг.
# Карточки косметики поворачивают цвет через hue-rotate, поэтому основа
# нейтрально-фиолетовая.
# --------------------------------------------------------------------------

def build_blackhole(width=480, height=375):
    """Чёрная дыра: аккреционный диск, линзированная дуга и чёрное ядро.

    Порядок слоёв: свечение -> пыль -> весь диск -> ядро -> ближний край
    диска поверх ядра -> фотонное кольцо. Так диск читается как кольцо вокруг
    провала, а не как случайная дуга.
    """
    n = max(width, height) * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    cx = cy = n / 2.0
    tilt = -18.0
    core_r = n * 0.142
    inner_r = n * 0.205
    outer_r = n * 0.400
    squash = 0.30

    def ring(bright, width_px, squash_y=squash, blur=n * 0.004):
        """Яркий край диска: вложенные эллипсы, яркость падает от внутреннего края."""
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        steps = 110
        for i in range(steps):
            t = i / (steps - 1.0)
            rx = inner_r + (outer_r - inner_r) * (t ** 0.85)
            ry = rx * squash_y
            fade = (1.0 - t) ** 1.15
            d.ellipse(
                [cx - rx, cy - ry, cx + rx, cy + ry],
                outline=(255, int(198 + 48 * t), int(250 - 10 * t), int(bright * fade)),
                width=width_px,
            )
        return blur_layer(layer, blur)

    def arc_over_core(radius, colour, width_px, start, end, blur):
        """Тонкая дуга, которая проходит поверх ядра (ближний край диска)."""
        layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        ry = radius * squash
        d.ellipse([cx - radius, cy - ry, cx + radius, cy + ry],
                  outline=colour, width=width_px)
        layer = blur_layer(layer, blur)
        keep = Image.new("L", (n, n), 0)
        kd = ImageDraw.Draw(keep)
        kd.pieslice([cx - radius * 1.4, cy - ry * 1.4 - n * 0.05,
                     cx + radius * 1.4, cy + ry * 1.4 + n * 0.05],
                    start=start, end=end, fill=255)
        layer.putalpha(Image.composite(layer.getchannel("A"), Image.new("L", (n, n), 0), keep))
        return layer

    # 1. свечение
    img = Image.alpha_composite(img, radial(
        n,
        [(0.0, (146, 100, 255, 118)), (0.34, (100, 55, 216, 68)),
         (0.68, (52, 25, 126, 24)), (1.0, (18, 9, 44, 0))],
        (cx, cy), int(n * 0.48)))

    # 2. пыль
    rng = random.Random(20240917)
    dust = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dust)
    for _ in range(300):
        angle = rng.uniform(0, math.tau)
        dist = abs(rng.gauss(n * 0.34, n * 0.09))
        if dist < n * 0.27 or dist > n * 0.47:
            continue
        rad = rng.uniform(n * 0.0010, n * 0.0030)
        alpha = int(120 * max(0.0, 1.0 - abs(dist - n * 0.33) / (n * 0.16)))
        if alpha <= 4:
            continue
        x = cx + math.cos(angle) * dist
        y = cy + math.sin(angle) * dist * 0.92
        dd.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(228, 216, 255, alpha))
    img = Image.alpha_composite(img, blur_layer(dust, n * 0.0020))

    # 3. весь диск, повёрнутый — его середину позже перекроет ядро
    disk = ring(185, max(1, int(n * 0.0075)), blur=n * 0.0045)
    img = Image.alpha_composite(img, disk.rotate(tilt, resample=Image.BICUBIC, center=(cx, cy)))

    # 4. фотонное кольцо: тонкий свет по самому краю горизонта событий
    photon = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(photon).ellipse(
        [cx - core_r * 1.20, cy - core_r * 1.20, cx + core_r * 1.20, cy + core_r * 1.20],
        outline=(255, 250, 255, 210), width=max(1, int(n * 0.0075)))
    img = Image.alpha_composite(img, blur_layer(photon, n * 0.0035))

    # 5. горизонт событий — ровно чёрное ядро
    core = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse([cx - core_r, cy - core_r, cx + core_r, cy + core_r],
                                 fill=(7, 5, 14, 255))
    img = Image.alpha_composite(img, core)

    # 6. ближний край диска проходит перед ядром (нижняя дуга)
    near = arc_over_core(inner_r * 1.02, (255, 252, 255, 235), max(1, int(n * 0.010)),
                         20, 160, n * 0.0035)
    img = Image.alpha_composite(img, near.rotate(tilt, resample=Image.BICUBIC, center=(cx, cy)))

    # 7. линзированная дальняя дуга — свет огибает ядро сверху
    far = arc_over_core(core_r * 1.34, (232, 218, 255, 205), max(1, int(n * 0.011)),
                        196, 344, n * 0.0055)
    img = Image.alpha_composite(img, far)

    box = (
        int((n - width * SS) / 2), int((n - height * SS) / 2),
        int((n + width * SS) / 2), int((n + height * SS) / 2),
    )
    return img.crop(box).resize((width, height), Image.LANCZOS)


def save_flat(img, name, quality):
    """Сохраняет с альфой (оба изображения лежат на тёмном фоне сайта)."""
    path = os.path.join(ASSETS, name)
    img.save(path, format="WEBP", quality=quality, method=6)
    print("wrote %-24s %6d bytes  %dx%d" % (name, os.path.getsize(path), img.width, img.height))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    save_flat(build_logo(), "nc_logo.webp", 86)
    save_flat(build_blackhole(), "blackhole.webp", 70)


if __name__ == "__main__":
    main()
