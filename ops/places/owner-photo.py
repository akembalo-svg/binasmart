#!/usr/bin/env python3
"""owner-photo.py <in> <out.webp>
Publishes one photo that an owner sent through Bini (property/owner-listing.js):
rotate by EXIF, drop ALL metadata (phones write the GPS position of the house into the file),
fit inside 1280 px, save as WebP q82. Prints "width height" of the result."""
import sys
from PIL import Image, ImageOps

src, dst = sys.argv[1], sys.argv[2]
im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
im.thumbnail((1280, 1280), Image.LANCZOS)
im.save(dst, 'WEBP', quality=82, method=5)   # a new image object: no EXIF/GPS is copied across
print(im.size[0], im.size[1])
