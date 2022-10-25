# Build
FROM node:16-alpine as build
WORKDIR /app

COPY package.json package-lock.json .
RUN npm install

COPY tsconfig.json .
COPY src ./src
RUN npm run build

# Production
FROM node:16-alpine
WORKDIR /app

COPY package.json package-lock.json .
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

CMD ["npm", "start"]