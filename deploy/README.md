# Deploy

App container + `cloudflared` sidecar. Context stays in RAM (`tmpfs` + read-only root).

```bash
cp .env.example .env
# paste CLOUDFLARED_TUNNEL_TOKEN

docker compose --env-file .env -f docker-compose.yml up -d --build
```

Cloudflare public hostname service URL: `http://127.0.0.1:11500`
(compose uses `network_mode: host` so the app can reach host Ollama on loopback).
