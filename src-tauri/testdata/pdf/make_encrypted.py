#!/usr/bin/env python3
"""Writes encrypted.pdf: one page, user password "geheim" (reportlab, RC4/AES as reportlab chooses).
Used by `pdf/tests.rs` (design 006 E7). The other test PDFs are written by the tests themselves."""
from reportlab.pdfgen import canvas
c = canvas.Canvas('encrypted.pdf', encrypt='geheim')
c.drawString(100, 700, 'secret')
c.showPage()
c.save()
