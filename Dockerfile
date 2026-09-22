# syntax=docker/dockerfile:1
FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY cmd ./cmd
COPY internal ./internal
# modernc.org/sqlite needs no cgo, so the binary is static and the runtime image can be distroless.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cajui ./cmd/cajui \
    && mkdir /out/data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/cajui /cajui
# 65532 is distroless "nonroot"; a fresh named volume inherits this ownership.
COPY --from=build --chown=65532:65532 /out/data /data
# The process must bind the container interface; compose.yaml publishes the port on 127.0.0.1 of the host only.
ENV CAJUI_ADDR=0.0.0.0:8080 CAJUI_ALLOW_NON_LOOPBACK=1 CAJUI_DB=/data/cajui.db
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["/cajui"]
