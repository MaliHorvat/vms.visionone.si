# VisionOne AI – zaznavanje objektov (YOLO), območja, linije, zadrževanje, sabotaža
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 YOLO_CONFIG_DIR=/app/.ultralytics
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# PyTorch samo za procesor (brez CUDA) – bistveno manjša slika
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt
# model prenesemo že ob gradnji, da AI deluje tudi brez interneta
ARG MODEL=yolo11n.pt
RUN python -c "from ultralytics import YOLO; YOLO('${MODEL}')"

COPY detector.py .
CMD ["python", "detector.py"]
