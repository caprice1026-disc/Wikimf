FROM python:3.13-slim
WORKDIR /app
COPY apps/backend/requirements.txt apps/backend/requirements.txt
RUN python -m pip install --no-cache-dir -r apps/backend/requirements.txt
COPY apps/backend apps/backend
ENV PYTHONPATH=/app/apps/backend
EXPOSE 8000
