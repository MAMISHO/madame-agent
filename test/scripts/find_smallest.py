import os
import glob

files = glob.glob('/Users/mamisho/dev/madame-agent/**/*.py')
if not files:
    print("No py files found")
else:
    min_file = min(files, key=lambda f: os.path.getsize(f))
    size = os.path.getsize(min_file)
    print(f"MIN_FILE={min_file}")
    print(f"SIZE={size}")
