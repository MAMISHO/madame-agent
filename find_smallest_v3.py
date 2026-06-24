import os
import subprocess

def get_files():
    cmd = ["find", "/Users/mamisho/dev/madame-agent", "-name", "*.py"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout.splitlines()

files = get_files()
if not files:
    print("No py files found")
else:
    min_file = min(files, key=lambda f: os.path.getsize(f))
    size = os.path.getsize(min_file)
    print(f"MIN_FILE={min_file}")
    print(f"SIZE={size}")
