FROM node:20-slim

RUN apt-get update && \
    apt-get install -y ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json video-stream-debug.ts ./
RUN git clone https://github.com/emeryao/rtsp-multi-stream.git \
    && cp -f video-stream-debug.ts rtsp-multi-stream/src/video-stream.ts  \
    && cd rtsp-multi-stream \
    && npm install \
    && npm run build \
    && cd .. \
    && npm install

COPY . .

EXPOSE 3000
EXPOSE 10000-10030

CMD ["node", "server.js"]
