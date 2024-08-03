FROM node:lts AS kube-wb-service-discovery-builder
WORKDIR /src
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM node:lts
COPY --from=kube-wb-service-discovery-builder /src/node_modules node_modules
COPY --from=kube-wb-service-discovery-builder /src/dist dist
CMD ["node", "dist/"]