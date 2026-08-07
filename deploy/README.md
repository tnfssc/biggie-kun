# Deploy

App container + `cloudflared` sidecar. Context stays in RAM (`tmpfs` + read-only root).

```bash
cp .env.example .env
# paste CLOUDFLARED_TUNNEL_TOKEN

docker compose --env-file .env -f docker-compose.yml up -d --build
```

Cloudflare public hostname service URL: `http://biggie-kun:11500`.

Host Ollama must listen beyond loopback (`OLLAMA_HOST=0.0.0.0`) so
`host.docker.internal:11434` works from the app container.
