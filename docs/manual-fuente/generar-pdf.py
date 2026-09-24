"""Genera docs/manual-usuario-reservasia.pdf a partir de index.html.

Uso (desde cualquier carpeta):  python docs/manual-fuente/generar-pdf.py
Requiere Google Chrome instalado y PyMuPDF (pip install pymupdf).
"""
import pathlib
import subprocess
import tempfile

import fitz

HERE = pathlib.Path(__file__).resolve().parent
HTML = HERE / "index.html"
OUT = HERE.parent / "manual-usuario-reservasia.pdf"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
HEADER = "RESERVASIA: MANUAL DE USUARIO"
GRAY = (0.35, 0.35, 0.35)

with tempfile.TemporaryDirectory() as tmp:
    raw_pdf = pathlib.Path(tmp) / "sin-encabezado.pdf"
    # Perfil temporal propio: si no, Chrome headless puede engancharse a una
    # ventana de Chrome que el usuario ya tenga abierta y no imprimir nada.
    subprocess.run(
        [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            f"--user-data-dir={tmp}",
            "--no-pdf-header-footer",
            "--virtual-time-budget=15000",
            f"--print-to-pdf={raw_pdf}",
            HTML.as_uri(),
        ],
        check=True,
        capture_output=True,
    )

    doc = fitz.open(raw_pdf)
    for number, page in enumerate(doc, start=1):
        page.insert_text((42, 24), HEADER, fontsize=5.5, fontname="helv", color=GRAY)
        label = str(number)
        width = fitz.get_text_length(label, fontname="helv", fontsize=5.5)
        page.insert_text((570 - width, 24), label, fontsize=5.5, fontname="helv", color=GRAY)
    doc.set_metadata({"title": "ReservasIA: Manual de usuario", "author": "Nexora"})
    doc.save(OUT, garbage=3, deflate=True)
    pages = len(doc)
    doc.close()

print(f"{OUT} ({pages} páginas, {OUT.stat().st_size // 1024} KB)")
