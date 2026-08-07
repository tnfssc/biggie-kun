# biggie-kun — static Go binary, no language runtime in the final image
# docker build -t biggie-kun .

FROM golang:1.25.7-bookworm@sha256:564e366a28ad1d70f460a2b97d1d299a562f08707eb0ecb24b659e5bd6c108e1 AS build
WORKDIR /src
COPY server/go.mod ./
COPY server/*.go ./
COPY server/*.css ./
COPY server/web ./web
COPY server/cmd ./cmd
RUN CGO_ENABLED=0 GOOS=linux go test ./... \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath \
       -ldflags="-s -w -buildid=" -o /out/biggie-kun ./cmd/biggie-kun \
    && /out/biggie-kun --help

FROM gcr.io/distroless/static-debian12:nonroot@sha256:f5b485ea962d9bd1186b2f6b3a061191539b905b82ec395de78cbfae51f20e35 AS runtime
LABEL org.opencontainers.image.title="biggie-kun" \
      org.opencontainers.image.description="1B token context window"

COPY --from=build /out/biggie-kun /usr/local/bin/biggie-kun
WORKDIR /tmp
EXPOSE 11500

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/usr/local/bin/biggie-kun", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/biggie-kun"]
CMD ["serve", \
     "--listen", "0.0.0.0", \
     "--port", "11500", \
     "--ollama-host", "http://host.docker.internal:11434", \
     "--model", "llama3.2"]
