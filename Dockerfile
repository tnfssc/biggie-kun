# biggie-kun — single opaque Node binary image
# docker build -t biggie-kun .

FROM oven/bun:1.2-debian AS build
WORKDIR /src
COPY server/package.json ./
COPY server/src ./src
# Compile to one native binary. No JS sources in the runtime image.
RUN bun build ./src/cli.js --compile --outfile /out/biggie-kun \
    && chmod 755 /out/biggie-kun \
    && /out/biggie-kun --help

FROM debian:bookworm-slim AS runtime
LABEL org.opencontainers.image.title="biggie-kun" \
      org.opencontainers.image.description="1B token context window"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 biggie \
    && useradd --uid 10001 --gid biggie --home-dir /tmp --no-create-home \
        --shell /usr/sbin/nologin biggie \
    && install -d -o biggie -g biggie /tmp

COPY --from=build /out/biggie-kun /usr/local/bin/biggie-kun

RUN chmod 755 /usr/local/bin/biggie-kun \
    && test -x /usr/local/bin/biggie-kun \
    && if command -v node >/dev/null 2>&1; then echo "node present" >&2; exit 1; fi \
    && if command -v python3 >/dev/null 2>&1; then echo "python3 present" >&2; exit 1; fi

USER biggie:biggie
WORKDIR /tmp
EXPOSE 11500

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["curl", "-fsS", "http://127.0.0.1:11500/health"]

ENTRYPOINT ["/usr/bin/tini", "--", "biggie-kun"]
CMD ["serve", \
     "--listen", "0.0.0.0", \
     "--port", "11500", \
     "--ollama-host", "http://host.docker.internal:11434", \
     "--model", "llama3.2"]
