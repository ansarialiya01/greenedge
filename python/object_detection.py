from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
import cv2
from ultralytics import YOLO
import time
import base64
import os
import threading
 
app = Flask(__name__)
CORS(app)
 
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
 
# Ek time pe ek hi frame process ho (model aur global data shared hain)
frame_lock = threading.Lock()
 
# True rakho to terminal mein har detect hui cheez dikhegi ("RAW: person 0.82 2.1").
# Sab theek chalne lage to False kar do.
DEBUG_RAW = True
 
# =========================================================
# YOLO MODELS
# =========================================================
 
model = YOLO("yolov8s.pt")
 
# Pothole model (optional). Agar pothole.pt file is folder mein nahi hai
# to server bina pothole detection ke chalega.
POTHOLE_MODEL_PATH = os.path.join(BASE_DIR, "pothole.pt")
pothole_model = None
 
if os.path.exists(POTHOLE_MODEL_PATH):
    pothole_model = YOLO(POTHOLE_MODEL_PATH)
    print("Pothole model loaded")
else:
    print("pothole.pt not found - pothole detection OFF")
 
# =========================================================
# NAVIGATION SETTINGS
# =========================================================
 
NAVIGATION_OBJECTS = {
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
    "chair",
    "bench",
    "backpack",
    "suitcase",
    "dog",
    "cat",
    "traffic light",
    "stop sign",
}
 
MIN_DETECTION_CONFIDENCE = 0.25
 
# =========================================================
# DISTANCE SETTINGS
# =========================================================
 
LONG_RANGE_OBJECTS = {
    "bicycle",
    "car",
    "motorcycle",
    "bus",
    "truck",
}
 
# Pehle 3.0 aur 1.0 tha: itna chhota ki zyadatar objects filter ho jaate the
LONG_RANGE_MAX_DISTANCE = 8.0
SHORT_RANGE_MAX_DISTANCE = 4.0
 
# Pothole settings
POTHOLE_MAX_DISTANCE = 3.0
POTHOLE_CONFIDENCE = 0.35
POTHOLE_EVERY_N_FRAMES = 2
 
# Real object width (meters) - distance estimate ke liye
OBJECT_REAL_WIDTH = {
    "person": 0.5,
    "bicycle": 0.6,
    "car": 1.8,
    "motorcycle": 0.8,
    "bus": 2.5,
    "truck": 2.5,
    "chair": 0.5,
    "bench": 1.5,
    "backpack": 0.3,
    "suitcase": 0.4,
    "dog": 0.4,
    "cat": 0.25,
    "traffic light": 0.3,
    "stop sign": 0.75,
    "pothole": 0.6,
}
 
# 640px wide frame ke liye focal length. Calibrate karne ke liye:
# ek person 2 meter door khada karo aur distance dekho, phir isse adjust karo.
FOCAL_LENGTH_PX = 600
 
# Threat priority weights (zyada = zyada khatarnak)
THREAT_WEIGHT = {
    "car": 3.0,
    "bus": 3.0,
    "truck": 3.0,
    "motorcycle": 2.5,
    "bicycle": 2.0,
    "pothole": 2.0,
    "traffic light": 2.0,
    "person": 1.5,
    "dog": 1.2,
}
 
VEHICLES = {"car", "bus", "truck", "motorcycle"}
 
# Voice settings
ANNOUNCEMENT_REPEAT_SECONDS = 3.0
DISTANCE_CHANGE_THRESHOLD = 0.3
MIN_DISTANCE_UPDATE_SECONDS = 1.0
 
# =========================================================
# NAVIGATION DATA
# =========================================================
 
navigation_data = {
    "closest": {
        "name": "None",
        "distance": 0.0,
        "position": "Center",
        "traffic_light_color": None,
    },
    "others": [],
    "path": "PATH CLEAR",
    "safe_direction": "Straight",
    "description": "No nearby obstacle detected",
    "detections": [],
    "voice_message": "",
    "annotated_frame": None
}
 
# =========================================================
# VOICE STATE
# =========================================================
 
last_announced_at = {}
 
frame_counter = 0
cached_potholes = []
 
# =========================================================
# HELPERS: DISTANCE, ZONES, THREAT, SAFE DIRECTION
# =========================================================
 
def estimate_distance(label, box_width, frame_width):
    real_width = OBJECT_REAL_WIDTH.get(label, 0.5)
    focal = FOCAL_LENGTH_PX * frame_width / 640
    return round((real_width * focal) / max(box_width, 1), 1)
 
 
def get_position(x1, x2, frame_width):
    center = (x1 + x2) / 2
    if center < frame_width / 3:
        return "Left"
    if center > frame_width * 2 / 3:
        return "Right"
    return "Center"
 
 
def get_zones(x1, x2, frame_width):
    """Chaude object kai zones block karte hain (jaise car Center + Right)."""
    third = frame_width / 3
    min_overlap = 0.2 * third
    zones = []
 
    for name, lo, hi in (
        ("Left", 0, third),
        ("Center", third, 2 * third),
        ("Right", 2 * third, frame_width),
    ):
        if min(x2, hi) - max(x1, lo) > min_overlap:
            zones.append(name)
 
    return zones or ["Center"]
 
 
def threat_score(item):
    distance = max(item["distance"], 0.2)
    weight = THREAT_WEIGHT.get(item["name"], 1.0)
    center_bonus = 1.5 if "Center" in item.get("zones", []) else 1.0
    return (weight * center_bonus) / distance
 
 
def get_safe_direction(detections):
    """Return: Straight / Left / Right / Stop"""
 
    nearest = {"Left": None, "Center": None, "Right": None}
 
    for d in detections:
        if d["name"] == "traffic light":
            continue
 
        for z in d.get("zones", [d["position"]]):
            if nearest[z] is None or d["distance"] < nearest[z]:
                nearest[z] = d["distance"]
 
    # Beech ka raasta khali hai
    if nearest["Center"] is None:
        return "Straight"
 
    left_free = nearest["Left"] is None
    right_free = nearest["Right"] is None
 
    if left_free:
        return "Left"
    if right_free:
        return "Right"
 
    # Dono side bhi blocked: jis side obstacle zyada door ho
    if nearest["Left"] > nearest["Right"]:
        return "Left"
    if nearest["Right"] > nearest["Left"]:
        return "Right"
 
    return "Stop"
 
 
# =========================================================
# TRAFFIC LIGHT COLOR
# =========================================================
 
def detect_traffic_light_color(crop):
 
    if crop is None or crop.size == 0:
        return "Unknown"
 
    height, width = crop.shape[:2]
 
    if height < 5 or width < 5:
        return "Unknown"
 
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
 
    red1 = cv2.inRange(hsv, (0, 120, 120), (8, 255, 255))
    red2 = cv2.inRange(hsv, (172, 120, 120), (179, 255, 255))
    red_mask = cv2.bitwise_or(red1, red2)
 
    yellow_mask = cv2.inRange(hsv, (20, 120, 120), (38, 255, 255))
    green_mask = cv2.inRange(hsv, (40, 100, 80), (90, 255, 255))
 
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
 
    red_mask = cv2.morphologyEx(red_mask, cv2.MORPH_OPEN, kernel)
    yellow_mask = cv2.morphologyEx(yellow_mask, cv2.MORPH_OPEN, kernel)
    green_mask = cv2.morphologyEx(green_mask, cv2.MORPH_OPEN, kernel)
 
    color_scores = {
        "Red": cv2.countNonZero(red_mask),
        "Yellow": cv2.countNonZero(yellow_mask),
        "Green": cv2.countNonZero(green_mask)
    }
 
    detected_color = max(color_scores, key=color_scores.get)
 
    if color_scores[detected_color] < 8:
        return "Unknown"
 
    return detected_color
 
 
# =========================================================
# VOICE MESSAGE TEXT
# =========================================================
 
def make_voice_message(item, safe_direction="Straight"):
 
    if not item:
        return ""
 
    name = item.get("name", "")
    distance = item.get("distance", 0)
    position = item.get("position", "Center")
 
    if not name or name == "None":
        return ""
 
    direction = {
        "Left": "on your left",
        "Right": "on your right",
        "Center": "ahead"
    }.get(position, "ahead")
 
    # ---------------- TRAFFIC LIGHT ----------------
 
    if name == "traffic light":
 
        color = item.get("traffic_light_color")
 
        return {
            "Red": f"Red traffic light {direction}. Please stop.",
            "Yellow": f"Yellow traffic light {direction}. Please wait.",
            "Green": f"Green traffic light {direction}. Check traffic before crossing.",
        }.get(color, f"Traffic light {direction}. Color is unclear.")
 
    # ---------------- NORMAL OBJECT ----------------
 
    object_name = name.replace("_", " ").capitalize()
 
    prefix = "Warning! " if name in VEHICLES else ""
 
    message = f"{prefix}{object_name} {distance:.1f} meters {direction}. "
 
    if safe_direction == "Left":
        message += "Move left, path is clear on left."
    elif safe_direction == "Right":
        message += "Move right, path is clear on right."
    elif safe_direction == "Stop":
        message += "No safe path. Please stop."
    else:
        message += "You can continue straight."
 
    return message
 
 
# =========================================================
# ENCODE PROCESSED FRAME
# =========================================================
 
def encode_frame(frame):
 
    success, buffer = cv2.imencode(
        ".jpg",
        frame,
        [int(cv2.IMWRITE_JPEG_QUALITY), 80]
    )
 
    if not success:
        return None
 
    return base64.b64encode(buffer.tobytes()).decode("utf-8")
 
 
# =========================================================
# POTHOLE DETECTION
# =========================================================
 
def detect_potholes(frame, frame_width):
 
    found = []
 
    if pothole_model is None:
        return found
 
    result = pothole_model(
        frame,
        verbose=False,
        conf=POTHOLE_CONFIDENCE
    )[0]
 
    for box in result.boxes:
 
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
 
        distance = estimate_distance(
            "pothole",
            max(x2 - x1, 1),
            frame_width
        )
 
        if distance > POTHOLE_MAX_DISTANCE:
            continue
 
        found.append({
            "track_id": None,
            "name": "pothole",
            "confidence": round(float(box.conf[0]), 2),
            "distance": distance,
            "position": get_position(x1, x2, frame_width),
            "zones": get_zones(x1, x2, frame_width),
            "traffic_light_color": None,
            "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "nearby": True
        })
 
    return found
 
 
def draw_pothole(frame, item):
 
    b = item["box"]
 
    cv2.rectangle(
        frame,
        (b["x1"], b["y1"]),
        (b["x2"], b["y2"]),
        (0, 165, 255),
        3
    )
 
    cv2.putText(
        frame,
        f"pothole | {item['distance']}m | {item['position']}",
        (b["x1"], max(b["y1"] - 8, 15)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (0, 165, 255),
        2,
        cv2.LINE_AA
    )
 
 
# =========================================================
# PROCESS CAMERA FRAME
# =========================================================
 
def process_frame(frame):
 
    global navigation_data
    global last_announced_at
    global frame_counter
    global cached_potholes
 
    # =====================================================
    # YOLO DETECTION
    # (tracker hata diya: mobile frames alag requests mein aate hain,
    #  track_id kahin use nahi hota, aur bytetrack ko lap package chahiye)
    # =====================================================
 
    results = model(
        frame,
        verbose=False,
        conf=MIN_DETECTION_CONFIDENCE
    )[0]
 
    detections = []
 
    frame_height, frame_width = frame.shape[:2]
 
    # =====================================================
    # PROCESS EACH DETECTION
    # =====================================================
 
    for box in results.boxes:
 
        confidence = float(box.conf[0])
 
        track_id = None
 
        if box.id is not None:
            track_id = int(box.id[0])
 
        class_id = int(box.cls[0])
        label = model.names[class_id]
 
        if confidence < MIN_DETECTION_CONFIDENCE:
            continue
 
        if label not in NAVIGATION_OBJECTS:
            continue
 
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
 
        x1 = max(0, min(x1, frame_width - 1))
        y1 = max(0, min(y1, frame_height - 1))
        x2 = max(0, min(x2, frame_width - 1))
        y2 = max(0, min(y2, frame_height - 1))
 
        box_width = max(x2 - x1, 1)
 
        # ---------------- DISTANCE ----------------
 
        distance = estimate_distance(label, box_width, frame_width)
 
        if DEBUG_RAW:
            print("RAW:", label, round(confidence, 2), distance, "m")
 
        if label in LONG_RANGE_OBJECTS:
            max_allowed_distance = LONG_RANGE_MAX_DISTANCE
        else:
            max_allowed_distance = SHORT_RANGE_MAX_DISTANCE
 
        if distance > max_allowed_distance:
            continue
 
        # ---------------- POSITION ----------------
 
        position = get_position(x1, x2, frame_width)
        zones = get_zones(x1, x2, frame_width)
 
        # ---------------- TRAFFIC LIGHT ----------------
 
        traffic_light_color = None
 
        if label == "traffic light":
            crop = frame[y1:y2, x1:x2]
            traffic_light_color = detect_traffic_light_color(crop)
 
        # ---------------- DETECTION DATA ----------------
 
        detections.append({
            "track_id": track_id,
            "name": label,
            "confidence": round(confidence, 2),
            "distance": distance,
            "position": position,
            "zones": zones,
            "traffic_light_color": traffic_light_color,
            "box": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
            "nearby": True
        })
 
        # ---------------- DRAW BOX ----------------
 
        color = (0, 0, 255)
 
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 4)
 
        if label == "traffic light":
            display_text = (
                f"Traffic Light {traffic_light_color} | {distance}m"
            )
        else:
            display_text = (
                f"{label} | {confidence:.2f} | {distance}m | {position}"
            )
 
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.65
        thickness = 2
 
        (text_width, text_height), baseline = cv2.getTextSize(
            display_text, font, font_scale, thickness
        )
 
        label_y1 = max(y1 - text_height - 15, 0)
        label_y2 = max(y1, text_height + 5)
        label_x2 = min(x1 + text_width + 10, frame_width - 1)
 
        cv2.rectangle(frame, (x1, label_y1), (label_x2, label_y2), color, -1)
 
        cv2.putText(
            frame,
            display_text,
            (x1 + 5, max(y1 - 7, text_height)),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA
        )
 
    # =====================================================
    # POTHOLES (har N frame pe, beech mein cache use hota hai)
    # =====================================================
 
    frame_counter += 1
 
    if pothole_model is not None:
        if frame_counter % POTHOLE_EVERY_N_FRAMES == 0:
            cached_potholes = detect_potholes(frame, frame_width)
 
        for p in cached_potholes:
            draw_pothole(frame, p)
 
        detections.extend(cached_potholes)
 
    # =====================================================
    # NEARBY OBJECTS
    # =====================================================
 
    nearby_detections = [item for item in detections if item["nearby"]]
 
    safe_direction = "Straight"
 
    # =====================================================
    # SELECT MOST DANGEROUS OBJECT
    # =====================================================
 
    if nearby_detections:
 
        closest = max(nearby_detections, key=threat_score)
 
        safe_direction = get_safe_direction(nearby_detections)
 
        navigation_data["closest"] = closest
 
        navigation_data["others"] = [
            item for item in nearby_detections if item is not closest
        ]
 
        # ---------------- TRAFFIC LIGHT ----------------
 
        if closest["name"] == "traffic light":
 
            color = closest.get("traffic_light_color")
 
            if color == "Red":
                navigation_data["path"] = "RED LIGHT"
                navigation_data["description"] = "RED LIGHT DETECTED - STOP"
 
            elif color == "Yellow":
                navigation_data["path"] = "YELLOW LIGHT"
                navigation_data["description"] = "YELLOW LIGHT DETECTED - WAIT"
 
            elif color == "Green":
                navigation_data["path"] = "GREEN LIGHT"
                navigation_data["description"] = (
                    "GREEN LIGHT DETECTED - CHECK THE PATH"
                )
 
            else:
                navigation_data["path"] = "TRAFFIC LIGHT"
                navigation_data["description"] = (
                    "TRAFFIC LIGHT DETECTED - COLOR UNCLEAR"
                )
 
        # ---------------- NORMAL OBJECT ----------------
 
        else:
 
            position = closest["position"]
            distance = closest["distance"]
            object_name = closest["name"]
 
            navigation_data["path"] = "OBSTACLE CLOSE"
 
            if position == "Center":
                description = (
                    f"STOP - {object_name} is approximately "
                    f"{distance} meters ahead"
                )
            elif position == "Left":
                description = (
                    f"OBJECT ON LEFT - {object_name} is approximately "
                    f"{distance} meters away"
                )
            else:
                description = (
                    f"OBJECT ON RIGHT - {object_name} is approximately "
                    f"{distance} meters away"
                )
 
            if safe_direction == "Left":
                description += " | SAFE PATH: LEFT"
            elif safe_direction == "Right":
                description += " | SAFE PATH: RIGHT"
            elif safe_direction == "Stop":
                description += " | NO SAFE PATH - STOP"
            else:
                description += " | SAFE PATH: STRAIGHT"
 
            navigation_data["description"] = description
 
    # =====================================================
    # NO OBJECT
    # =====================================================
 
    else:
 
        navigation_data["closest"] = {
            "name": "None",
            "distance": 0.0,
            "position": "Center",
            "traffic_light_color": None
        }
 
        navigation_data["others"] = []
        navigation_data["path"] = "PATH CLEAR"
        navigation_data["description"] = (
            "Safe path. No nearby object detected"
        )
 
    navigation_data["safe_direction"] = safe_direction
    navigation_data["detections"] = detections
 
    # =====================================================
    # PRIORITY VOICE MESSAGE (sirf sabse khatarnak object)
    # =====================================================
 
    voice_message = ""
    current_time = time.monotonic()
 
    state = last_announced_at.setdefault(
        "STATE",
        {"key": None, "distance": None, "time": 0.0}
    )
 
    if nearby_detections:
 
        top = closest
 
        key = (
            top["name"],
            top["position"],
            safe_direction,
            top.get("traffic_light_color")
        )
 
        changed = key != state["key"]
 
        dist_changed = (
            state["distance"] is None
            or abs(top["distance"] - state["distance"])
            >= DISTANCE_CHANGE_THRESHOLD
        )
 
        repeat = (
            current_time - state["time"] >= ANNOUNCEMENT_REPEAT_SECONDS
        )
 
        if changed or dist_changed or repeat:
            voice_message = make_voice_message(top, safe_direction)
            state.update(
                key=key,
                distance=top["distance"],
                time=current_time
            )
 
    else:
 
        if (
            state["key"] != "CLEAR"
            or current_time - state["time"] >= ANNOUNCEMENT_REPEAT_SECONDS
        ):
            voice_message = "Path is clear. You can continue straight."
            state.update(key="CLEAR", distance=None, time=current_time)
 
    print(
        "FINAL VOICE MESSAGE:",
        voice_message if voice_message else "EMPTY"
    )
 
    navigation_data["voice_message"] = voice_message
 
    # =====================================================
    # ENCODE PROCESSED FRAME
    # =====================================================
 
    navigation_data["annotated_frame"] = None
 
    annotated_frame = encode_frame(frame)
 
    return frame, annotated_frame, voice_message
 
 
# =========================================================
# PROCESS MOBILE CAMERA FRAME
# =========================================================
 
@app.route("/api/process_frame", methods=["POST"])
def process_mobile_frame():
 
    if "frame" not in request.files:
        return jsonify({"error": "No frame received"}), 400
 
    try:
 
        file = request.files["frame"]
 
        file_bytes = np.frombuffer(file.read(), np.uint8)
 
        frame = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)
 
        if frame is None:
            return jsonify({"error": "Could not decode frame"}), 400
 
        # Ek saath kai requests aayein to line se process hon
        with frame_lock:
            processed_frame, annotated_frame, voice_message = process_frame(frame)
            response_data = dict(navigation_data)
 
        response_data["annotated_frame"] = annotated_frame
        response_data["voice_message"] = voice_message
 
        print(
            "Mobile voice:",
            voice_message if voice_message else "NO NEW VOICE"
        )
 
        return jsonify(response_data)
 
    except Exception as error:
 
        print("Mobile frame processing error:", error)
 
        return jsonify({"error": str(error)}), 500
 
 
# =========================================================
# NAVIGATION DATA
# =========================================================
 
@app.route("/api/navigation_data")
def get_navigation_data():
    return jsonify(navigation_data)
 
 
# =========================================================
# HEALTH CHECK
# =========================================================
 
@app.route("/")
def home():
 
    return jsonify({
        "status": "Smart Navigation Flask server running",
        "camera_api": "/api/process_frame",
        "navigation_api": "/api/navigation_data",
        "pothole_detection": pothole_model is not None
    })
 
 
# =========================================================
# START SERVER
# =========================================================
 
if __name__ == "__main__":
 
    # voice_assistance.py bhi 5000 pe hai: dono ek saath chalani hon to
    # yahan PORT badal do (jaise 5001) aur Node mein bhi wahi port rakho.
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        threaded=True,
        ssl_context=(
            r"C:\mkcert\172.22.55.165+2.pem",
            r"C:\mkcert\172.22.55.165+2-key.pem"
        )
    )
 