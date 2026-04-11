from pathlib import Path
text = Path('src/controllers/transactionController.js').read_text()
start = text.index('// (C) FETCH DATA')
print('found start?')
