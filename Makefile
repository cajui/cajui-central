 .PHONY: run build test check fmt docker-build docker-check
run:
	go run ./cmd/cajui
build:
	go build -trimpath -o bin/cajui ./cmd/cajui
test:
	go test -race -count=1 -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out
check:
	@test -z "$$(gofmt -l cmd internal)" || (echo 'Run make fmt'; exit 1)
	go vet ./...
	$(MAKE) test
	@go tool cover -func=coverage.out | awk '/^total:/ {if ($$3+0 < 80) {print "Coverage below 80%"; exit 1}}'
fmt:
	gofmt -w cmd internal
docker-build:
	docker build -t cajui:local .
# Same checks as `make check`, inside the Go image; caches live in named volumes.
docker-check:
	docker run --rm -v "$(CURDIR)":/src -w /src -v cajui-go-mod:/go/pkg/mod -v cajui-go-build:/root/.cache/go-build golang:1.27 make check

.PHONY: check-fast check-full check-ui check-python test-ui test-compose
PYTHON ?= python3
check-python:
	$(PYTHON) scripts/compile_locales.py --check
	$(PYTHON) -m unittest discover -s tests -v
check-ui:
	npm --prefix tests/ui run format:check
	npm --prefix tests/ui run test:model
check-fast:
	$(MAKE) check
	$(MAKE) check-python
	$(MAKE) check-ui
check-full:
	npm ci --prefix tests/ui --ignore-scripts
	go mod verify
	$(MAKE) check-fast
	$(MAKE) build
	go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...
	sh scripts/test_mqtt.sh
	$(MAKE) test-compose
	$(MAKE) test-ui
test-ui:
	$(PYTHON) scripts/test_ui.py
test-compose:
	$(PYTHON) scripts/test_compose.py
