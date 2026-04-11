from pathlib import Path
path = Path('src/controllers/inventoryController.js')
data = path.read_text(encoding='utf-8')
old = '          stockQuantity: stockUpdate, // ← direct set\n        },\n      },\n'
new = '          stockQuantity: stockUpdate, // ← direct set\n          location_id: locationId,\n        },\n      },\n'
if old not in data:
    raise SystemExit('old snippet not found')
data = data.replace(old, new, 1)
path.write_text(data, encoding='utf-8')
