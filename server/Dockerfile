# server/Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start command (using tsx to run TypeScript directly)
CMD ["npx", "tsx", "src/index.ts"]