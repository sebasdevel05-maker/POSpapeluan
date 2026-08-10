import zipfile
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE = r'C:\Users\sgali\OneDrive\Escritorio\pos'
DEST = r'C:\Users\sgali\OneDrive\Escritorio\POS PAPELUAN REMOTO.zip'

EXCLUDE_DIRS = {'parqueadero', 'unpacked_parqueadero', '.git'}

EXCLUDE_FILES = {
    'extract_inventory.py',
    'update_pos.py',
    'inventory_data.json',
    'crear_zip_pos.py',
    'crear_zip_remoto.py',
    'Sistema Financiero PAPELUAN.xlsx',
}

# Ngrok executable
NGROK_PATH = r'C:\Users\sgali\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe'

count = 0
with zipfile.ZipFile(DEST, 'w', zipfile.ZIP_DEFLATED) as zf:
    # Add all POS files
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

    # Add ngrok.exe
    if os.path.exists(NGROK_PATH):
        zf.write(NGROK_PATH, 'POS PAPELUAN/ngrok.exe')
        count += 1
        print(f"  + ngrok.exe ({os.path.getsize(NGROK_PATH) / (1024*1024):.1f} MB)")

size_mb = os.path.getsize(DEST) / (1024 * 1024)
print(f"Archivos incluidos: {count}")
print(f"ZIP creado: {DEST}")
print(f"Tamano: {size_mb:.1f} MB")
