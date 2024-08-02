FROM node:lts as kube-wb-service-registry-builder
WORKDIR /src
COPY package*.json ./
RUN npm i
COPY . .
RUN npm run build

FROM node:lts
COPY --from=kube-wb-service-registry-builder /src/dist dist
COPY --from=kube-wb-service-registry-builder /src/node_modules node_modules
CMD ["node", "dist/"]