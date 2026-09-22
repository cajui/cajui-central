 .PHONY: run build test check fmt
run:
	go run ./cmd/cajui
build:
	go build -trimpath -o bin/cajui ./cmd/cajui
test:
	go test -race -count=1 -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out
check:
	@test -z "$$(gofmt -l cmd internal)" || (echo 'Execute make fmt'; exit 1)
	go vet ./...
	$(MAKE) test
	@go tool cover -func=coverage.out | awk '/^total:/ {if ($$3+0 < 80) {print "Cobertura mínima: 80%"; exit 1}}'
fmt:
	gofmt -w cmd internal
