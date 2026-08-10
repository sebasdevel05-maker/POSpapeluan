import zipfile
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = r'C:\Users\sgali\OneDrive\Escritorio\pos'
DEST = r'C:\Users\sgali\OneDrive\Escritorio\POS PAPELUAN REMOTO.zip'
NGROK_NEW = r'C:\Users\sgali\OneDrive\Escritorio\pos\ngrok_temp\ngrok.exe'

EXCLUDE_DIRS = {'parqueadero', 'unpacked_parqueadero', '.git', 'ngrok_temp'}

EXCLUDE_FILES = {
    'extract_inventory.py',
    'update_pos.py',
    'inventory_data.json',
    'crear_zip_pos.py',
    'crear_zip_remoto.py',
    'crear_zip_remoto2.py',
    'Sistema Financiero PAPELUAN.xlsx',
    'ngrok_new.zip',
}

count = 0
with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES:
                continue
            if '.backup_' in f or f.endswith('.backup'):
                continue
            full = os.path.join(root, f)
            arc = os.path.join('POS PAPELUAN', os.path.relpath(full, BASE))
            zf.write(full, arc)
            count += 1

    # Add NEW ngrok.exe
    zf.write(NGROK_NEW, 'POS PAPELUAN/ngrok.exe')
    count += 1
    print(f"  + ngrok.exe v3.39.4 ({os.path.getsize(NGROK_NEW) / (1024*1024):.1f} MB)")

size_mb = os.path.getsize(DEST) / (1024 * 1024)
print(f"Archivos: {count}")
print(f"ZIP: {DEST}")
print(f"Tamano: {size_mb:.1f} MB")
