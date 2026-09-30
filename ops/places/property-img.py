# Shrinks one downloaded image for bina.et/property (called by property-import.js):
#   photo   -> at most 720px, WebP ~30 KB, the card photo (fast on Ethiopian mobile data)
#   gallery -> at most 1200px, WebP, the photos on the /property/<slug> page
#   logo  -> 96x96 WebP, the logo centred on white (shown in a small circle on the photo)
import sys
from PIL import Image, ImageOps
Image.MAX_IMAGE_PIXELS = 40_000_000
mode, src, dst = sys.argv[1:4]
with Image.open(src) as probe:
    if probe.format not in ('JPEG', 'PNG', 'WEBP', 'GIF', 'ICO'):
        sys.exit('unsupported format %s' % probe.format)
    probe.verify()
im = ImageOps.exif_transpose(Image.open(src))
if mode == 'gallery':
    im = im.convert('RGB')
    im.thumbnail((1200, 1200))
    im.save(dst, 'WEBP', quality=70, method=5)
elif mode == 'photo':
    im = im.convert('RGB')
    im.thumbnail((720, 720))
    im.save(dst, 'WEBP', quality=72, method=5)
else:
    im = im.convert('RGBA')
    im.thumbnail((84, 84))
    bg = Image.new('RGBA', (96, 96), (255, 255, 255, 255))
    bg.paste(im, ((96 - im.width) // 2, (96 - im.height) // 2), im)
    bg.convert('RGB').save(dst, 'WEBP', quality=88)
