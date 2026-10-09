# Gera os ícones da PWA do móvel a partir do favicon inline de apps/web/index.html:
# quadrado de 32 unidades, raio 7, fundo #6366f1, o glifo "Y" em branco.
# Uso, da raiz: python3 -I apps/movel/scripts/gerar-icones.py apps/movel/public
# (precisa de Pillow). Os PNGs gerados são versionados; rode de novo só se a marca mudar.
import sys
from pathlib import Path
from PIL import Image, ImageDraw

DESTINO = Path(sys.argv[1])
FUNDO = (0x63, 0x66, 0xF1, 255)
BRANCO = (255, 255, 255, 255)
# M9 9h5l2 6 2-6h5L18 20v4h-4v-4z
GLIFO = [(9, 9), (14, 9), (16, 15), (18, 9), (23, 9), (18, 20), (18, 24), (14, 24), (14, 20)]
SS = 4  # supersampling para o antisserrilhado


def desenhar(lado, margem, arredondado):
    """`margem`: fração do lado, em cada borda, entre a imagem e o quadrado de 32
    unidades do desenho. Com `arredondado`, o fundo é o quadrado de raio 7 e o
    resto transparente; sem, o fundo cobre a imagem toda (o sistema recorta)."""
    L = lado * SS
    img = Image.new("RGBA", (L, L), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0 = L * margem
    escala = (L - 2 * x0) / 32
    if arredondado:
        d.rounded_rectangle([x0, x0, L - x0 - 1, L - x0 - 1], radius=7 * escala, fill=FUNDO)
    else:
        d.rectangle([0, 0, L, L], fill=FUNDO)
    d.polygon([(x0 + x * escala, x0 + y * escala) for x, y in GLIFO], fill=BRANCO)
    return img.resize((lado, lado), Image.LANCZOS)


# "any": o próprio favicon, ampliado.
desenhar(192, 0, True).save(DESTINO / "icon-192.png", optimize=True)
desenhar(512, 0, True).save(DESTINO / "icon-512.png", optimize=True)
# "maskable": fundo até a borda e o desenho dentro dos 80% centrais (10% por
# borda, 20% no total) — a zona segura que o Android não recorta.
desenhar(512, 0.10, False).save(DESTINO / "icon-512-maskable.png", optimize=True)
# iOS arredonda sozinho e não lida bem com transparência: fundo até a borda.
desenhar(180, 0, False).convert("RGB").save(DESTINO / "apple-touch-icon.png", optimize=True)
