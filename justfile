set dotenv-load := true
set shell := ["bash", "-lc"]

default:
    @just --list

# Run every test suite
test:
    bun run test

# Type check the whole workspace
typecheck:
    bun run typecheck

# YAML-safety lint plus typecheck
lint:
    bun run lint

# Clean local run data
clean:
    rm -rf .aos/
