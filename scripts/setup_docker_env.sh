npm run build
docker compose up -d --wait --wait-timeout 180
node docker/local/run.cjs seed