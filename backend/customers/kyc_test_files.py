"""Real document fixtures: security validation must not accept fake image bytes."""
import io
from PIL import Image


def valid_document_bytes(filename):
    if filename.lower().endswith('.pdf'):
        return b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'
    output = io.BytesIO()
    extension = filename.rsplit('.', 1)[-1].lower()
    Image.new('RGB', (8, 8), 'white').save(output, {'png': 'PNG', 'webp': 'WEBP'}.get(extension, 'JPEG'))
    return output.getvalue()
