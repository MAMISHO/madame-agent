import os

def find_smallest_py():
    files = []
    base_dir = "/Users/mamisho/dev/madame-agent"
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.py'):
                path = os.path.abspath(os.path.join(root, file))
                try:
                    size = os.path.getsize(path)
                    files.append((path, size))
                except Exception as e:
                    pass

    if not files:
          print("No .py files found.")
           return

    # Sort by size
    sorted_files = sorted(files, key=lambda f: f[1])
    
    print("FILES FOUND (sorted by size):")
    for f in sorted_files:
          print(f"{f[0]} ({f[1]} bytes)")

    smallest = sorted_files[0]
     print("\nSMALLEST FILE:")
     print(f"Path: {smallest[0]}")
     print(f"Size: {smallest[1]} bytes")
    
      print("\nCONTENT:")
     try:
        with open(smallest[0], 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        print(content)
    except Exception as e:
          print(f"Error reading file: {e}")

if __name__ == "__main__":
    find_smallest_py()
