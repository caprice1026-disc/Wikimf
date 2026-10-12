FROM python:3.13-slim
WORKDIR /app
COPY apps/backend/requirements.lock apps/backend/requirements.lock
RUN python -m pip install --no-cache-dir -r apps/backend/requirements.lock
COPY apps/backend apps/backend
ENV PYTHONPATH=/app/apps/backend
EXPOSE 8000
