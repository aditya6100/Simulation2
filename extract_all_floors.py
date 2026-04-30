import zipfile
import xml.etree.ElementTree as ET
import json
import os
import math
import glob

# =====================================================
# FOLDER WHERE ALL .sh3d FILES ARE KEPT
# =====================================================
INPUT_FOLDER = "."

# OUTPUT MAIN FOLDER
OUTPUT_MAIN = "ALL_FLOORS_JSON"

os.makedirs(OUTPUT_MAIN, exist_ok=True)

# =====================================================
# FIND ALL SH3D FILES
# =====================================================
sh3d_files = glob.glob(os.path.join(INPUT_FOLDER, "*.sh3d"))

if not sh3d_files:
    print("No .sh3d files found.")
    exit()

# =====================================================
# SAVE JSON FUNCTION
# =====================================================
def save_json(folder, filename, data):
    path = os.path.join(folder, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

# =====================================================
# PROCESS EACH SH3D FILE
# =====================================================
for SH3D_FILE in sh3d_files:

    floor_name = os.path.splitext(os.path.basename(SH3D_FILE))[0]
    print(f"\nProcessing: {floor_name}")

    OUTPUT_DIR = os.path.join(OUTPUT_MAIN, floor_name)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        # -----------------------------------------
        # OPEN SH3D FILE
        # -----------------------------------------
        with zipfile.ZipFile(SH3D_FILE, 'r') as z:
            files = z.namelist()

            if "Home.xml" not in files:
                print("Home.xml not found in:", floor_name)
                continue

            xml_data = z.read("Home.xml")

        root = ET.fromstring(xml_data)

        # -----------------------------------------
        # NAMESPACE AUTO DETECT
        # -----------------------------------------
        if root.tag.startswith("{"):
            ns_uri = root.tag.split("}")[0].strip("{")
            ns = {"n": ns_uri}

            def q(tag):
                return f".//n:{tag}"
        else:
            ns = {}

            def q(tag):
                return f".//{tag}"

        # -----------------------------------------
        # ARRAYS
        # -----------------------------------------
        levels = []
        walls = []
        rooms = []
        furniture = []
        doors = []
        windows = []
        lights = []
        labels = []
        dimensionLines = []
        polylines = []

        # -----------------------------------------
        # LEVELS
        # -----------------------------------------
        for item in root.findall(q("level"), ns):
            levels.append(item.attrib)

        # -----------------------------------------
        # WALLS
        # -----------------------------------------
        for item in root.findall(q("wall"), ns):
            walls.append(item.attrib)

        # -----------------------------------------
        # ROOMS
        # -----------------------------------------
        for item in root.findall(q("room"), ns):
            rooms.append(item.attrib)

        # -----------------------------------------
        # LABELS
        # -----------------------------------------
        for item in root.findall(q("label"), ns):
            labels.append(item.attrib)

        # -----------------------------------------
        # DIMENSION LINES
        # -----------------------------------------
        for item in root.findall(q("dimensionLine"), ns):
            dimensionLines.append(item.attrib)

        # -----------------------------------------
        # POLYLINES
        # -----------------------------------------
        for item in root.findall(q("polyline"), ns):
            polylines.append(item.attrib)

        # -----------------------------------------
        # FURNITURE / DOORS / WINDOWS / LIGHTS
        # -----------------------------------------
        for tag in ["pieceOfFurniture", "doorOrWindow"]:
            for item in root.findall(q(tag), ns):

                data = item.attrib.copy()

                # ---------------------------------
                # Calculate xStart xEnd etc
                # ---------------------------------
                try:
                    x = float(data.get("x", 0))
                    y = float(data.get("y", 0))
                    w = float(data.get("width", 0))
                    angle = float(data.get("angle", 0))

                    dx = math.cos(angle) * (w / 2)
                    dy = math.sin(angle) * (w / 2)

                    data["xStart"] = str(x - dx)
                    data["yStart"] = str(y - dy)
                    data["xEnd"] = str(x + dx)
                    data["yEnd"] = str(y + dy)

                except:
                    pass

                furniture.append(data)

                name = data.get("name", "").lower()
                catalog = data.get("catalogId", "").lower()

                # Detect Doors
                if "door" in name or "door" in catalog:
                    doors.append(data)

                # Detect Windows
                elif "window" in name or "window" in catalog:
                    windows.append(data)

                # Detect Lights
                elif "light" in name or "lamp" in name:
                    lights.append(data)

        # -----------------------------------------
        # SAVE ALL JSON
        # -----------------------------------------
        save_json(OUTPUT_DIR, "levels.json", levels)
        save_json(OUTPUT_DIR, "walls.json", walls)
        save_json(OUTPUT_DIR, "rooms.json", rooms)
        save_json(OUTPUT_DIR, "furniture.json", furniture)
        save_json(OUTPUT_DIR, "doors.json", doors)
        save_json(OUTPUT_DIR, "windows.json", windows)
        save_json(OUTPUT_DIR, "lights.json", lights)
        save_json(OUTPUT_DIR, "labels.json", labels)
        save_json(OUTPUT_DIR, "dimensionLines.json", dimensionLines)
        save_json(OUTPUT_DIR, "polylines.json", polylines)

        print("Done:", floor_name)

    except Exception as e:
        print("Error in", floor_name, ":", str(e))

print("\n====================================")
print("ALL FLOORS EXTRACTION COMPLETE")
print("Saved in:", OUTPUT_MAIN)
print("====================================")