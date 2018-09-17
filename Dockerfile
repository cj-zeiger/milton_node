FROM node:8
# Create app directory
WORKDIR /usr/src/app
# Install app dependencies
COPY package*.json ./
COPY playmusic ./playmusic/
RUN npm install --quiet
# Copy app source code
COPY . .
#Expose port and start application
EXPOSE 8080
EXPOSE 8081