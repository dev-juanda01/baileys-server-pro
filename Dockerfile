# Dockerfile

# --- Etapa 1: Builder ---
FROM node:18-alpine AS builder
WORKDIR /usr/src/app
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install
COPY . .

# --- Etapa 2: Producción ---
FROM node:18-alpine
WORKDIR /usr/src/app

ENV NODE_ENV=production
RUN apk add --no-cache git
COPY package*.json ./
RUN npm install --omit=dev --clean
COPY --from=builder /usr/src/app .

EXPOSE 3000

# -> ¡CAMBIO CLAVE AQUÍ!
# Le damos al usuario 'node' la propiedad del directorio de la aplicación
# para que pueda crear la carpeta 'sessions' y escribir en ella.
RUN chown -R node:node /usr/src/app

# Creamos un usuario no-root para correr la aplicación por seguridad
USER node

# El comando para iniciar la aplicación
CMD [ "node", "server.js" ]