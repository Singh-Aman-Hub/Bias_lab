# Stage 1: Build Frontend
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps
COPY frontend/ .
# Vite automatically reads .env.production during `npm run build`
RUN npm run build

# Stage 2: Backend and Final Image
FROM python:3.12-slim
WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend code
COPY backend ./backend

# Copy data folder containing built-in datasets
COPY data ./data

# Copy built frontend from Stage 1
COPY --from=frontend-build /frontend/dist ./frontend/dist

# Set working directory to backend to run the app
WORKDIR /app/backend

# Default runtime environment variables (overridden by Render's dashboard)
ENV PORT=8080

# Start the application
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}
