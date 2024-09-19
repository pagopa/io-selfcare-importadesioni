FROM node:10.14.2-alpine@sha256:46b2488c02dc82c801eaebc775019262e100af290dd06d61201a8dd53f78c022

WORKDIR /opt/cosmosdb

RUN npm install -g @zeit/cosmosdb-server ts-node

CMD ["sh", "-c", "cosmosdb-server -p 3000"]
