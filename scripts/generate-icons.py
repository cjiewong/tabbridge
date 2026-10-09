"""Reproducible, dependency-free PNG icon generator (4x supersampling)."""
from pathlib import Path
import struct
import zlib

destination = Path(__file__).resolve().parent.parent / "extension" / "icons"
destination.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    scale = 4
    arrows = [[(.24,.30),(.59,.30),(.59,.20),(.79,.35),(.59,.50),(.59,.40),(.24,.40)],[(.76,.60),(.41,.60),(.41,.50),(.21,.65),(.41,.80),(.41,.70),(.76,.70)]]
    def inside(x,y,polygon):
        result=False
        for (a,b),(c,d) in zip(polygon,polygon[1:]+polygon[:1]):
            if (b>y)!=(d>y) and x<(c-a)*(y-b)/(d-b)+a: result=not result
        return result
    rows=[]
    for py in range(size):
        row=bytearray([0])
        for px in range(size):
            samples=[]
            for sy in range(scale):
                for sx in range(scale):
                    x=(px+(sx+.5)/scale)/size;y=(py+(sy+.5)/scale)/size
                    cx=min(max(x,.23),.77);cy=min(max(y,.23),.77)
                    if (x-cx)**2+(y-cy)**2>.23**2: samples.append((23,78,64,0))
                    elif any(inside(x,y,a) for a in arrows):samples.append((255,255,255,255))
                    else:samples.append((23,78,64,255))
            row.extend(round(sum(s[i] for s in samples)/len(samples)) for i in range(4))
        rows.append(row)
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
    (destination/f'{size}.png').write_bytes(png)
