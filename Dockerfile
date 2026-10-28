FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics

WORKDIR /app

RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY object_detection.py .

# Model build ke time hi download ho jaye
RUN python -c "from ultralytics import YOLO; YOLO('yolov8s.pt')"

# Agar pothole.pt upload ki hai to ye line rakho, warna hata do
COPY pothole.pt* ./

EXPOSE 7860

CMD ["gunicorn", "-w", "1", "--threads", "4", "--timeout", "120", "-b", "0.0.0.0:7860", "object_detection:app"]