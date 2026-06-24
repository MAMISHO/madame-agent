import os
import sys

smallest_file = None
min_size = float('inf')

for root, dirs, files in os.walk('.'):
    for file in files:
        if file.endswith('.py'):
            path = os.path.join(root, file)
            try:
                size = os.path.getsize(path)
                if size < min_size:
                    min_size = size
                    smallest_file = path
            except OSError:
                continue

if smallest_file:
    with open(smallest_file, 'r') as f:
        print(f.read())
else:
    print("No .py files found.")
