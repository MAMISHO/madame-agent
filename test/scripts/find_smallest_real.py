import os
import glob

def get_py_files():
    # Recursive search for all .py files
    return glob.glob('/Users/mamisho/dev/madame-agent/**/*.py')

files = get_py_files()
if not files:
    print("No py files found")
else:
    min_file = min(files, key=lambda f: os.path.getsize(f))
    size = os.path.getsize(min_file)
    print(f"MIN_FILE={min_file}")
    print(f"SIZE={size}")
