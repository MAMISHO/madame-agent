import os
import sys

files = []
for root, dirs, files in os.walk('/Users/mamisho/dev/madame-agent'):
    for file in files:
        if file.endswith('.py'):
            files.append(os.path.join(root, file))

if not files:
    print("No .py files found.")
    sys.exit(0)

smallest_file = min(files, key=lambda f: os.path.getsize(f))
print(smallest_file)
