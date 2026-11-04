"""Generate the Voxel Focus World app icon as SVG: an isometric floating voxel island with a cottage
and a tree, inside an orange focus-timer ring, on the app's sky gradient.
Usage: python make_icon.py OUT_DIR
Writes icon.svg (rounded square, transparent corners), icon-maskable.svg (full bleed, art in the
safe zone) and icon-favicon.svg (simplified, reads at 16-32 px)."""
import math
import os
import sys

OUT = sys.argv[1]

A = 0.866
B = 0.5


def iso(cx, cy, s):
    def p(x, y, z):
        return (cx + (x - y) * A * s, cy + (x + y) * B * s - z * s)
    return p


def poly(pts, fill, extra=''):
    d = ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)
    return f'<polygon points="{d}" fill="{fill}"{extra}/>'


def cube(p, i, j, k, top, right, left, lip=None, w=1.0, d=1.0, h=1.0):
    i1, j1, k1 = i + w, j + d, k + h
    out = []
    out.append(poly([p(i1, j, k), p(i1, j1, k), p(i1, j1, k1), p(i1, j, k1)], right))  # +x face
    out.append(poly([p(i, j1, k), p(i1, j1, k), p(i1, j1, k1), p(i, j1, k1)], left))  # +y face
    out.append(poly([p(i, j, k1), p(i1, j, k1), p(i1, j1, k1), p(i, j1, k1)], top))
    if lip:  # a band of grass hanging over the dirt sides
        t = 0.24 * h
        out.append(poly([p(i1, j, k1 - t), p(i1, j1, k1 - t), p(i1, j1, k1), p(i1, j, k1)], lip[0]))
        out.append(poly([p(i, j1, k1 - t), p(i1, j1, k1 - t), p(i1, j1, k1), p(i, j1, k1)], lip[1]))
    return out


def scene(cx, cy, s):
    p = iso(cx, cy, s)
    el = []
    grass = ('#86dc5c', '#a8714a', '#8a5a36')
    stone = ('#c1c7d0', '#9aa2ad', '#7f8794')
    # underside: tapering rock under the island
    for (i, j) in [(1, 1)]:
        el += cube(p, i, j, -3, *stone)
    for (i, j) in [(0.5, 0.5), (1.5, 0.5), (0.5, 1.5), (1.5, 1.5)]:
        el += cube(p, i, j, -2, *stone)
    for i in range(3):
        for j in range(3):
            el += cube(p, i, j, -1, '#a8714a', '#a8714a', '#8a5a36')
    for i in range(3):
        for j in range(3):
            el += cube(p, i, j, 0, *grass, lip=('#6cc443', '#5bb336'))
    # tree at the back right
    el += cube(p, 2.35, 0.35, 1, '#9b6a43', '#8a5a35', '#6e4529', w=0.3, d=0.3, h=0.9)
    tx, ty = p(2.5, 0.5, 2.25)
    el.append(f'<circle cx="{tx:.1f}" cy="{ty:.1f}" r="{0.62*s:.1f}" fill="#4fae3c"/>')
    el.append(f'<circle cx="{tx - 0.22*s:.1f}" cy="{ty - 0.2*s:.1f}" r="{0.38*s:.1f}" fill="#62c04a"/>')
    el.append(f'<circle cx="{tx + 0.2*s:.1f}" cy="{ty + 0.18*s:.1f}" r="{0.3*s:.1f}" fill="#409c31"/>')
    # cottage in the middle: walls, glowing window, door, hipped red roof, chimney
    i0, j0, i1, j1 = 0.75, 0.85, 1.95, 2.05
    el.append(poly([p(i1, j0, 1), p(i1, j1, 1), p(i1, j1, 2), p(i1, j0, 2)], '#f4e7cf'))
    el.append(poly([p(i0, j1, 1), p(i1, j1, 1), p(i1, j1, 2), p(i0, j1, 2)], '#e2cfae'))
    el.append(poly([p(i1, 1.25, 1.35), p(i1, 1.65, 1.35), p(i1, 1.65, 1.75), p(i1, 1.25, 1.75)], '#ffd36b'))  # window
    el.append(poly([p(1.15, j1, 1), p(1.5, j1, 1), p(1.5, j1, 1.62), p(1.15, j1, 1.62)], '#6b4428'))  # door
    o = 0.16
    a, b, c, d = p(i0 - o, j0 - o, 2), p(i1 + o, j0 - o, 2), p(i1 + o, j1 + o, 2), p(i0 - o, j1 + o, 2)
    top = p((i0 + i1) / 2, (j0 + j1) / 2, 2.85)
    el += cube(p, 1.45, 0.95, 2.2, '#c06a4f', '#b0644c', '#8f4f3b', w=0.28, d=0.28, h=0.75)  # chimney behind the ridge
    el.append(poly([b, c, top], '#e8524a'))  # +x slope
    el.append(poly([d, c, top], '#c4443c'))  # +y slope
    # a bush at the front left
    bx, by = p(0.35, 2.55, 1.25)
    el.append(f'<circle cx="{bx:.1f}" cy="{by:.1f}" r="{0.3*s:.1f}" fill="#62c04a"/>')
    el.append(f'<circle cx="{bx + 0.12*s:.1f}" cy="{by - 0.1*s:.1f}" r="{0.1*s:.1f}" fill="#ff6f91"/>')
    return '\n'.join(el)


def ring(cx, cy, r, w, frac):
    a0 = -math.pi / 2
    a1 = a0 + frac * 2 * math.pi
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    large = 1 if frac > 0.5 else 0
    track = f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="{w}"/>'
    arc = f'<path d="M{x0:.2f},{y0:.2f} A{r},{r} 0 {large} 1 {x1:.2f},{y1:.2f}" fill="none" stroke="#ff7a2f" stroke-width="{w}" stroke-linecap="round"/>'
    dot = f'<circle cx="{x1:.2f}" cy="{y1:.2f}" r="{w*0.32:.2f}" fill="#ffffff"/>'
    return track + arc + dot


def svg(rounded, k=1.0, favicon=False):
    # k shrinks the art towards the centre (maskable safe zone)
    bg = ('<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
          '<stop offset="0" stop-color="#5fb8ff"/><stop offset="0.55" stop-color="#9fd6ff"/><stop offset="1" stop-color="#dff3ff"/>'
          '</linearGradient></defs>')
    rect = f'<rect width="512" height="512" rx="{112 if rounded else 0}" fill="url(#g)"/>'
    s = 50 if not favicon else 56
    body = ring(256, 256, 206, 30 if not favicon else 46, 0.72)
    body += scene(256, 256 - 1.62 * s, s)  # art spans about cy-1.75s .. cy+5s: centre it
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{bg}{rect}'
            f'<g transform="translate(256 256) scale({k}) translate(-256 -256)">{body}</g></svg>')


os.makedirs(OUT, exist_ok=True)
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg(True))
open(os.path.join(OUT, 'icon-maskable.svg'), 'w').write(svg(False, 0.78))
open(os.path.join(OUT, 'icon-favicon.svg'), 'w').write(svg(True, 1.0, favicon=True))
open(os.path.join(OUT, 'icon-apple.svg'), 'w').write(svg(False, 0.9))  # iOS rounds the corners itself
print('ok')
