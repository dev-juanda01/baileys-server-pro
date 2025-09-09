FROM node:18-alpine
WORKDIR /usr/src/app

# Establecemos el entorno a producción
ENV NODE_ENV=production

# Copiamos package.json y package-lock.json de nuevo
COPY package*.json ./

# Instalamos ÚNICAMENTE las dependencias de producción
RUN npm install --omit=dev --clean

# Copiamos el código fuente desde la fase de 'builder'
COPY --from=builder /usr/src/app .

# Exponemos el puerto en el que correrá la aplicación
EXPOSE 3000

# El comando para iniciar la aplicación
CMD [ "node", "server.js" ]