# For Hugging Face Spaces (Docker) or any container host. No npm install needed: the app has no dependencies.
FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=7860 COOKIE_SECURE=1 TRUST_PROXY=1 KEEP_AWAKE=0 DATA_DIR=/tmp/baleova
RUN mkdir -p /tmp/baleova && chmod 777 /tmp/baleova && chown -R node /app
USER node
EXPOSE 7860
CMD ["node", "server.js"]
