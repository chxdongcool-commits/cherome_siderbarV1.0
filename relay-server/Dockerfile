FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 18791

CMD ["node", "dist/main.js"]
