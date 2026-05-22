#!/usr/bin/env bash

cp package.schema.json web/static/ && \
cp nvpm-registry.json web/static/ && \
cd web && \
bun install --frozen-lockfile && \
bun run build
