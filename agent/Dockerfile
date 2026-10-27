# VisionOne agent – Docker (Linux strežnik / NAS)
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /visionone-agent .

FROM alpine:3.20
RUN apk add --no-cache iproute2 ca-certificates
COPY --from=build /visionone-agent /usr/local/bin/visionone-agent
# config.json priklopi kot volumen ali uporabi VO_PORTAL / VO_TOKEN
ENTRYPOINT ["/usr/local/bin/visionone-agent", "run"]
