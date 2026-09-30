# prints "width height white dhash" for an image file: white = share of near-white pixels (a logo on a white page is
# mostly white); dhash = a 64-bit picture fingerprint, nearly the same for the same photo at another size
import sys
try:
    from PIL import Image
    with Image.open(sys.argv[1]) as im:
        w, h = im.size
        g = im.convert('L').resize((64, 64))
        px = list(g.getdata()); white = sum(1 for v in px if v > 238) / len(px)
        g9 = im.convert('L').resize((9, 8)); q = list(g9.getdata()); bits = 0
        for r in range(8):
            for c in range(8):
                bits = (bits << 1) | (1 if q[r * 9 + c] > q[r * 9 + c + 1] else 0)
        print(w, h, round(white, 3), '%016x' % bits)
except Exception:
    print(0, 0, 0)
