set dotenv-load := true
set shell := ["bash", "-lc"]

default:
    @just --list

# Run all runtime unit tests
test:
    cd runtime && bun test

# Type check runtime
typecheck:
    cd runtime && bun x tsc --noEmit

# Validate all core configs load correctly
validate:
    cd runtime && bun run ../tests/integration/validate-config.ts

# Launch AOS via Pi adapter
run:
    cd adapters/pi && bun install --silent && pi -e src/index.ts

# Clean session data
clean:
    rm -rf .aos/
