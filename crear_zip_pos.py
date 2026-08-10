import zipfile
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = r'C:\Users\sgali\OneDrive\Escritorio\pos'
DEST = r'C:\Users\sgali\OneDrive\Escritorio\POS PAPELUAN.zip'

EXCLUDE_DIRS = {
    'parqueadero',
    'unpacked_parqueadero',
    '.git',
}

EXCLUDE_FILES = {
    'extract_inventory.py',
    'update_pos.py',
    'inventory_data.json',
    'crear_zip_pos.py',
    'Sistema Financiero PAPELUAN.xlsx',
}

count = 0
with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

        for f in files:
            if f in EXCLUDE_FILES:
                continue
            if f.endswith('.backup') or '.backup_' in f:
                continue

            full = os.path.join(root, f)
            arc = os.path.join('POS PAPELUAN', os.path.relpath(full, BASE))
            zf.write(full, arc)
            count += 1

size_mb = os.path.getsize(DEST) / (1024 * 1024)
print(f"ZIP creado: {DEST}")
print(f"Archivos incluidos: {count}")
print(f"Tamano: {size_mb:.1f} MB")
