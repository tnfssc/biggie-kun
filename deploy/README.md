# Deploy

Static Go app container + `cloudflared` sidecar. Context stays in RAM
(`tmpfs` + read-only root).

```bash
cp .env.example .env
# paste CLOUDFLARED_TUNNEL_TOKEN

docker compose --env-file .env -f docker-compose.yml up -d --build
```

Cloudflare public hostname service URL: `http://biggie-kun:11500`.

Host Ollama must listen beyond loopback (`OLLAMA_HOST=0.0.0.0`) so
`host.docker.internal:11434` works from the app container.

The app accepts request bodies up to 4.1 GB by default. Cloudflare plan limits
may be lower, so send billion-token-scale requests through a direct/private
route or a proxy configured for that body size.
