import os
import glob

files = []
for path in glob.glob("**/*.py", recursive=True):
    size = os.path.getsize(path)
    files.append((path, size))

# Sort by size
files.sort(key=lambda x: x[1])

for f, s in files:
    print(f"{s}\t{f}")

if files:
    smallest = files[0]
    print("-" * 20)
    print(f"SMALLEST: {smallest[0]}")
    print(f"SIZE: {smallest[1]}")
