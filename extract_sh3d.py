import zipfile
import xml.etree.ElementTree as ET
import json
import os
import math

BASE_DIR = "."
OUTPUT_BASE = "output_json"

# Map filenames to floor indices
FLOOR_MAP = {
    "groundgloor.sh3d": "0",
    "1stfloor.sh3d": "1",
    "2ndfloor.sh3d": "2",
    "3rdfloor.sh3d": "3",
    "4thfloor.sh3d": "4"
}

def extract_file(sh3d_filename, floor_id):
    sh3d_path = os.path.join(BASE_DIR, sh3d_filename)
    if not os.path.exists(sh3d_path):
        print(f"Skipping {sh3d_filename} (not found)")
        return

    floor_dir = os.path.join(OUTPUT_BASE, f"floor{floor_id}")
    os.makedirs(floor_dir, exist_ok=True)

    with zipfile.ZipFile(sh3d_path, 'r') as z:
        xml_data = z.read("Home.xml")

    root = ET.fromstring(xml_data)
    ns_uri = root.tag.split("}")[0].strip("{") if root.tag.startswith("{") else ""
    ns = {"n": ns_uri} if ns_uri else {}
    def q(tag): return f".//n:{tag}" if ns_uri else f".//{tag}"

    walls, doors, windows, furniture = [], [], [], []

    for wall in root.findall(q("wall"), ns):
        walls.append(wall.attrib)

    for tag in ["pieceOfFurniture", "doorOrWindow"]:
        for item in root.findall(q(tag), ns):
            data = item.attrib.copy()
            if "width" in data and "x" in data and "y" in data:
                try:
                    x, y, w = float(data["x"]), float(data["y"]), float(data["width"])
                    angle = float(data.get("angle", 0))
                    dx, dy = math.cos(angle) * (w / 2), math.sin(angle) * (w / 2)
                    data["xStart"], data["yStart"] = str(x - dx), str(y - dy)
                    data["xEnd"], data["yEnd"] = str(x + dx), str(y + dy)
                except: pass
            furniture.append(data)
            name = data.get("name", "").lower()
            cat_id = data.get("catalogId", "").lower()
            if "door" in name or "door" in cat_id: doors.append(data)
            elif "window" in name or "window" in cat_id: windows.append(data)

    def save(name, data):
        with open(os.path.join(floor_dir, name), "w") as f:
            json.dump(data, f, indent=4)

    save("walls.json", walls)
    save("doors.json", doors)
    save("furniture.json", furniture)
    print(f"Extracted {sh3d_filename} to floor{floor_id}")

for filename, floor_id in FLOOR_MAP.items():
    extract_file(filename, floor_id)

print("All extractions complete!")
