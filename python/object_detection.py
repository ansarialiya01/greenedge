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
 
# Only one frame is processed at a time (models and global data are shared)
frame_lock = threading.Lock()
 
# Print every raw detection in the terminal, e.g. "RAW: person 0.82 2.1 m".
# Set to False once everything works.
DEBUG_RAW = True
 
# =========================================================
# YOLO MODELS
# =========================================================
 
model = YOLO("yolov8s.pt")
 
# Optional pothole model (2 classes: 0 = pothole, 1 = speed_breaker).
# If the file is not in this folder, the server runs without pothole detection.
POTHOLE_MODEL_PATH = os.path.join(BASE_DIR, "pothole_sb_backup.pt")
pothole_model = None
 
if os.path.exists(POTHOLE_MODEL_PATH):
    pothole_model = YOLO(POTHOLE_MODEL_PATH)
    print("Pothole model loaded")
    print("Pothole model classes:", pothole_model.names)
else:
    print("pothole_sb_backup.pt not found - pothole detection OFF")
 
# =========================================================
# SETTINGS
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
 
# Objects farther than this are ignored.
# Distance is only used for filtering, it is never spoken.
ALERT_DISTANCE = 2.0
 
# Vehicles move fast, so they are detected from farther away
VEHICLE_ALERT_DISTANCE = 5.0
 
# Pothole settings
POTHOLE_MAX_DISTANCE = 2.0
POTHOLE_CONFIDENCE = 0.5        # higher = fewer false alerts (was 0.35)
POTHOLE_IOU = 0.4               # avoids several boxes on one pothole
POTHOLE_EVERY_N_FRAMES = 2
POTHOLE_CLASS_ID = 0            # class 0 = pothole, class 1 = speed_breaker (ignored)
POTHOLE_MAX_BOX_AREA = 0.35     # a box bigger than this is usually a false detection
POTHOLE_MIN_CENTER_Y = 0.5      # only the lower half of the frame (user's walking path)
 
# Real object width in meters, used for distance estimation
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
 
# Focal length for a 640px wide frame. To calibrate: place a person at a
# known distance, read the distance printed in the terminal, then adjust.
FOCAL_LENGTH_PX = 600
 
# Threat priority weights (higher = more dangerous)
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
 
# Objects whose movement direction is reported
MOVING_OBJECTS = {"car", "bus", "truck", "motorcycle", "bicycle"}
 
# Motion detection settings
TRACK_MAX_AGE = 1.5        # seconds a previous detection can still be matched
APPROACH_GROWTH = 1.10     # box grew by 10% = object is getting closer
LATERAL_SHIFT = 0.04       # moved sideways by more than 4% of frame width
 
# Voice settings
ANNOUNCEMENT_REPEAT_SECONDS = 3.0
 
# True = also say "Go left." / "Go right." after the object message.
# "Stop." is always said when there is no safe path.
SPEAK_PATH_ADVICE = False
 
# =========================================================
# STATE
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
 
last_announced_at = {}
 
frame_counter = 0
cached_potholes = []
prev_tracks = []
 
# Short position words used in voice messages
POSITION_SHORT = {
    "Left": "on left",
    "Right": "on right",
    "Center": "ahead",
}
 
# =========================================================
# HELPERS
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
    """Wide objects can block several zones (e.g. a car in Center + Right)."""
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
 
 
def priority_key(item):
    """Vehicles always come first, then sort by threat score."""
    is_vehicle = item["name"] in MOVING_OBJECTS
    return (1 if is_vehicle else 0, threat_score(item))
 
 
def get_safe_direction(detections):
    """Returns: Straight / Left / Right / Stop"""
 
    nearest = {"Left": None, "Center": None, "Right": None}
 
    for d in detections:
        if d["name"] == "traffic light":
            continue
 
        for z in d.get("zones", [d["position"]]):
            if nearest[z] is None or d["distance"] < nearest[z]:
                nearest[z] = d["distance"]
 
    if nearest["Center"] is None:
        return "Straight"
 
    if nearest["Left"] is None:
        return "Left"
    if nearest["Right"] is None:
        return "Right"
 
    # Both sides blocked: go toward the side with the farther obstacle
    if nearest["Left"] > nearest["Right"]:
        return "Left"
    if nearest["Right"] > nearest["Left"]:
        return "Right"
 
    return "Stop"
 
 
# =========================================================
# MOTION TRACKING
# =========================================================
 
def update_motion(detections, now, frame_width):
    """
    Compares with the previous frame and sets d["motion"] to:
    approaching / left_to_right / right_to_left / None
    """
 
    global prev_tracks
 
    new_tracks = []
    used = set()
 
    for d in detections:
 
        d["motion"] = None
 
        if d["name"] not in MOVING_OBJECTS:
            continue
 
        b = d["box"]
        cx = (b["x1"] + b["x2"]) / 2
        w = max(b["x2"] - b["x1"], 1)
 
        best = None
        best_dist = None
 
        for i, t in enumerate(prev_tracks):
 
            if i in used:
                continue
            if t["name"] != d["name"]:
                continue
            if now - t["time"] > TRACK_MAX_AGE:
                continue
 
            dist = abs(t["cx"] - cx)
 
            if dist < 0.25 * frame_width and (
                best is None or dist < best_dist
            ):
                best = i
                best_dist = dist
 
        if best is not None:
 
            used.add(best)
            t = prev_tracks[best]
 
            growth = w / max(t["w"], 1)
            shift = (cx - t["cx"]) / frame_width
 
            if growth >= APPROACH_GROWTH:
                d["motion"] = "approaching"
            elif shift >= LATERAL_SHIFT:
                d["motion"] = "left_to_right"
            elif shift <= -LATERAL_SHIFT:
                d["motion"] = "right_to_left"
 
        new_tracks.append({
            "name": d["name"],
            "cx": cx,
            "w": w,
            "time": now,
        })
 
    prev_tracks = new_tracks
 
 
def motion_text(item):
    """Short motion phrase: 'moving left', 'moving right', 'coming'."""
 
    motion = item.get("motion")
 
    if motion == "approaching":
        return "coming"
 
    if motion == "left_to_right":
        return "moving right"
 
    if motion == "right_to_left":
        return "moving left"
 
    return ""
 
 
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
# VOICE MESSAGE (short)
# Examples: "Car moving left." / "Car coming." / "Person ahead." /
#           "Red light. Stop."
# =========================================================
 
def make_voice_message(item, safe_direction="Straight", others=None):
 
    if not item:
        return ""
 
    name = item.get("name", "")
 
    if not name or name == "None":
        return ""
 
    if name == "traffic light":
 
        return {
            "Red": "Red light. Stop.",
            "Yellow": "Yellow light. Wait.",
            "Green": "Green light.",
        }.get(item.get("traffic_light_color"), "Traffic light.")
 
    object_name = name.replace("_", " ").capitalize()
 
    motion = motion_text(item)
 
    if motion:
        message = f"{object_name} {motion}."
    else:
        position = POSITION_SHORT.get(item.get("position"), "ahead")
        message = f"{object_name} {position}."
 
    if safe_direction == "Stop":
        message += " Stop."
    elif SPEAK_PATH_ADVICE and safe_direction in ("Left", "Right"):
        message += f" Go {safe_direction.lower()}."
 
    return message
 
 
# =========================================================
# FRAME ENCODING
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
    """
    Runs the pothole model on a CLEAN frame (no boxes drawn on it).
    Only class 0 (pothole) is used. Class 1 (speed_breaker) is ignored,
    because the model is not reliable on it yet.
    """
 
    found = []
 
    if pothole_model is None:
        return found
 
    frame_height = frame.shape[0]
 
    result = pothole_model(
        frame,
        verbose=False,
        conf=POTHOLE_CONFIDENCE,
        iou=POTHOLE_IOU
    )[0]
 
    for box in result.boxes:
 
        if int(box.cls[0]) != POTHOLE_CLASS_ID:
            continue
 
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
 
        w = (x2 - x1) / frame_width
        h = (y2 - y1) / frame_height
        center_y = ((y1 + y2) / 2) / frame_height
 
        # Very large box = almost always a false detection
        if w * h > POTHOLE_MAX_BOX_AREA or w > 0.8:
            continue
 
        # Ignore the upper part of the frame (far away / not on the path)
        if center_y < POTHOLE_MIN_CENTER_Y:
            continue
 
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
 
    # Keep a clean copy BEFORE any boxes are drawn.
    # The pothole model must see the real road, not our drawings.
    clean_frame = frame.copy() if pothole_model is not None else None
 
    results = model(
        frame,
        verbose=False,
        conf=MIN_DETECTION_CONFIDENCE
    )[0]
 
    detections = []
 
    frame_height, frame_width = frame.shape[:2]
 
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
 
        distance = estimate_distance(label, box_width, frame_width)
 
        if DEBUG_RAW:
            print("RAW:", label, round(confidence, 2), distance, "m")
 
        if label in MOVING_OBJECTS:
            max_allowed_distance = VEHICLE_ALERT_DISTANCE
        else:
            max_allowed_distance = ALERT_DISTANCE
 
        if distance > max_allowed_distance:
            continue
 
        position = get_position(x1, x2, frame_width)
        zones = get_zones(x1, x2, frame_width)
 
        traffic_light_color = None
 
        if label == "traffic light":
            crop = frame[y1:y2, x1:x2]
            traffic_light_color = detect_traffic_light_color(crop)
 
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
 
        # Draw box and label on the frame
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
 
    # Run the pothole model every N frames and reuse the last result in between
    frame_counter += 1
 
    if pothole_model is not None:
        if frame_counter % POTHOLE_EVERY_N_FRAMES == 0:
            cached_potholes = detect_potholes(clean_frame, frame_width)
 
        for p in cached_potholes:
            draw_pothole(frame, p)
 
        detections.extend(cached_potholes)
 
    update_motion(detections, time.monotonic(), frame_width)
 
    nearby_detections = [item for item in detections if item["nearby"]]
 
    safe_direction = "Straight"
    closest = None
 
    if nearby_detections:
 
        # Vehicles get priority, then the highest threat score
        closest = max(nearby_detections, key=priority_key)
 
        safe_direction = get_safe_direction(nearby_detections)
 
        navigation_data["closest"] = closest
 
        navigation_data["others"] = sorted(
            [item for item in nearby_detections if item is not closest],
            key=priority_key,
            reverse=True
        )
 
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
 
        else:
 
            position = closest["position"]
            object_name = closest["name"]
            motion = motion_text(closest)
 
            navigation_data["path"] = "OBSTACLE CLOSE"
 
            if motion:
                description = f"WARNING - {object_name} {motion}"
            elif position == "Center":
                description = f"STOP - {object_name} ahead"
            elif position == "Left":
                description = f"OBJECT ON LEFT - {object_name}"
            else:
                description = f"OBJECT ON RIGHT - {object_name}"
 
            if safe_direction == "Left":
                description += " | SAFE PATH: LEFT"
            elif safe_direction == "Right":
                description += " | SAFE PATH: RIGHT"
            elif safe_direction == "Stop":
                description += " | NO SAFE PATH - STOP"
            else:
                description += " | SAFE PATH: STRAIGHT"
 
            navigation_data["description"] = description
 
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
 
    # Voice message: only announce when something changed or after a repeat interval
    voice_message = ""
    current_time = time.monotonic()
 
    state = last_announced_at.setdefault(
        "STATE",
        {"key": None, "time": 0.0}
    )
 
    if nearby_detections:
 
        top = closest
 
        key = (
            top["name"],
            top["position"],
            safe_direction,
            top.get("traffic_light_color"),
            top.get("motion"),
        )
 
        changed = key != state["key"]
 
        repeat = (
            current_time - state["time"] >= ANNOUNCEMENT_REPEAT_SECONDS
        )
 
        if changed or repeat:
            voice_message = make_voice_message(
                top, safe_direction, navigation_data["others"]
            )
            state.update(key=key, time=current_time)
 
    else:
 
        # "Path clear." is said only once, not every few seconds
        if state["key"] != "CLEAR":
            voice_message = "Path clear."
            state.update(key="CLEAR", time=current_time)
 
    print(
        "FINAL VOICE MESSAGE:",
        voice_message if voice_message else "EMPTY"
    )
 
    navigation_data["voice_message"] = voice_message
    navigation_data["annotated_frame"] = None
 
    annotated_frame = encode_frame(frame)
 
    return frame, annotated_frame, voice_message
 
 
# =========================================================
# API ROUTES
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
 
        # If several requests arrive together, process them one by one
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
 
 
@app.route("/api/navigation_data")
def get_navigation_data():
    return jsonify(navigation_data)
 
 
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
 
    app.run(
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 5000)),
        debug=False,
        threaded=True,
        ssl_context=(
            r"C:\mkcert\10.76.182.165+2.pem",
            r"C:\mkcert\10.76.182.165+2-key.pem"
        )
    )