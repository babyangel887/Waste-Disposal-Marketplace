FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm install --workspace=apps/api --include=dev || npm install
COPY . .
RUN npm run build --workspace=@waste/shared && npm run build --workspace=api
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
