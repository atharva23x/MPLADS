FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy project files
COPY backend/ backend/
COPY frontend/ frontend/

EXPOSE 5000

ENV PORT=5000

CMD ["gunicorn", "--chdir", "backend", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "120", "app:app"]
