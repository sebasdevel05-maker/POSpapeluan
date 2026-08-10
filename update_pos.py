import sqlite3
import json
import sys
import shutil
import os
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = r'C:\Users\sgali\OneDrive\Escritorio\pos\backend\db\pos.db'
BACKUP_PATH = DB_PATH + '.backup_' + datetime.now().strftime('%Y%m%d_%H%M%S')
JSON_PATH = r'C:\Users\sgali\OneDrive\Escritorio\pos\inventory_data.json'

# Backup
shutil.copy2(DB_PATH, BACKUP_PATH)
print(f"Backup creado: {BACKUP_PATH}")

# Load inventory data
with open(JSON_PATH, 'r', encoding='utf-8') as f:
    products = json.load(f)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys = OFF")
cur = conn.cursor()

# ============================================
# 1. BORRAR TODOS LOS MOVIMIENTOS
# ============================================
print("\n=== BORRANDO MOVIMIENTOS ===")

cur.execute("SELECT COUNT(*) FROM sales")
n_sales = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM sale_items")
n_items = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM inventory_movements")
n_movements = cur.fetchone()[0]

cur.execute("DELETE FROM sale_items")
cur.execute("DELETE FROM sales")
cur.execute("DELETE FROM inventory_movements")
print(f"  Ventas eliminadas: {n_sales}")
print(f"  Items de venta eliminados: {n_items}")
print(f"  Movimientos de inventario eliminados: {n_movements}")

# ============================================
# 2. BORRAR PRODUCTOS Y CATEGORIAS ANTERIORES
# ============================================
print("\n=== LIMPIANDO PRODUCTOS Y CATEGORIAS ===")
cur.execute("SELECT COUNT(*) FROM products")
n_prod = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM categories")
n_cat = cur.fetchone()[0]

cur.execute("DELETE FROM products")
cur.execute("DELETE FROM categories")

# Reset autoincrement
cur.execute("DELETE FROM sqlite_sequence WHERE name='sales'")
cur.execute("DELETE FROM sqlite_sequence WHERE name='sale_items'")
cur.execute("DELETE FROM sqlite_sequence WHERE name='inventory_movements'")
cur.execute("DELETE FROM sqlite_sequence WHERE name='products'")
cur.execute("DELETE FROM sqlite_sequence WHERE name='categories'")

print(f"  Productos anteriores eliminados: {n_prod}")
print(f"  Categorias anteriores eliminadas: {n_cat}")

# ============================================
# 3. CREAR NUEVAS CATEGORIAS (desde "Tipo")
# ============================================
print("\n=== CREANDO CATEGORIAS ===")
tipos = sorted(set(p['tipo'] for p in products if p['tipo']))
cat_map = {}
for tipo in tipos:
    cur.execute("INSERT INTO categories (name, description) VALUES (?, ?)",
                (tipo, f"Categoria: {tipo}"))
    cat_map[tipo] = cur.lastrowid
    print(f"  + {tipo} (id={cat_map[tipo]})")

print(f"  Total categorias creadas: {len(cat_map)}")

# ============================================
# 4. INSERTAR PRODUCTOS CON INVENTARIO
# ============================================
print("\n=== INSERTANDO PRODUCTOS ===")
inserted = 0
skipped = 0

for i, p in enumerate(products):
    desc = p['descripcion']
    if not desc:
        skipped += 1
        continue

    # Generate barcode: PAPL-XXXXX
    barcode = f"PAPL-{i+1:05d}"

    name = desc
    marca = p['marca']
    if marca:
        name = f"{marca} - {desc}"

    category_id = cat_map.get(p['tipo'], None)
    cost_price = p['costo_unitario']
    sale_price = p['precio_venta']
    stock = p['inv_disponible']
    min_stock = 2

    cur.execute("""
        INSERT INTO products (barcode, name, description, category_id, cost_price, sale_price, stock, min_stock, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    """, (barcode, name, f"Marca: {marca} | Cat: {p['categoria']}", category_id, cost_price, sale_price, stock, min_stock))
    inserted += 1

print(f"  Productos insertados: {inserted}")
print(f"  Productos omitidos (sin descripcion): {skipped}")

conn.commit()

# ============================================
# 5. VERIFICACION
# ============================================
print("\n=== VERIFICACION ===")
cur.execute("SELECT COUNT(*) FROM categories")
print(f"  Categorias en DB: {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM products WHERE active=1")
print(f"  Productos activos: {cur.fetchone()[0]}")
cur.execute("SELECT SUM(stock) FROM products WHERE active=1")
print(f"  Stock total: {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM sales")
print(f"  Ventas: {cur.fetchone()[0]}")
cur.execute("SELECT COUNT(*) FROM inventory_movements")
print(f"  Movimientos: {cur.fetchone()[0]}")

cur.execute("SELECT c.name, COUNT(p.id) as qty FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY qty DESC LIMIT 10")
print("\n  Top 10 categorias por productos:")
for row in cur.fetchall():
    print(f"    {row[0]}: {row[1]} productos")

conn.close()
print("\n=== ACTUALIZACION COMPLETA ===")
