FROM python:3.12-slim
WORKDIR /app
# Only requirements is COPY'd -- the source arrives via bind mount, so a code
# change needs no rebuild (uvicorn --reload picks it up).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
