FROM node:22-alpine
# Prisma's query engine needs OpenSSL on Alpine
RUN apk add --no-cache openssl
WORKDIR /app
# We pin Prisma 6 on purpose (7+ generates TypeScript-only clients); skip the upgrade banner
ENV PRISMA_HIDE_UPDATE_MESSAGE=true
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npx prisma generate
EXPOSE 3000
# Apply any new migrations before starting, so every deploy brings the database up to date
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
