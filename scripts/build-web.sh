#!/usr/bin/env bash

set -euo pipefail

# Create "zip" and "tar" versions of the nvpm-registry.json file
# and leave the .tmp directory out of the archive
mkdir -p ./.tmp

for ext in gz xz bz2 zip; do
  case "${ext}" in
    gz)
      if ! tar -C .tmp -czf "./.tmp/nvpm-registry.${ext}" nvpm-registry.json; then
        echo "Failed to create nvpm-registry.${ext}" >&2
        exit 1
      fi
      ;;
    xz)
      if ! tar -C .tmp -cJf "./.tmp/nvpm-registry.${ext}" nvpm-registry.json; then
        echo "Failed to create nvpm-registry.${ext}" >&2
        exit 1
      fi
      ;;
    bz2)
      if ! tar -C .tmp -cjf "./.tmp/nvpm-registry.${ext}" nvpm-registry.json; then
        echo "Failed to create nvpm-registry.${ext}" >&2
        exit 1
      fi
      ;;
    zip)
      rm -f "./.tmp/nvpm-registry.${ext}"
      if ! (cd .tmp && zip -q "../.tmp/nvpm-registry.${ext}" nvpm-registry.json); then
        echo "Failed to create nvpm-registry.${ext}" >&2
        exit 1
      fi
      ;;
    *)
      echo "Unknown archive extension: ${ext}" >&2
      exit 1
      ;;
  esac
done

# ---

# Copy static assets over

## nvpm-registry.* files
if ! cp ./.tmp/nvpm-registry.* web/static/; then
  echo "Failed to copy nvpm-registry.* to web/static/" >&2
  exit 2
fi
## package.schema.json
if ! cp package.schema.json web/static/; then
  echo "Failed to copy package.schema.json" >&2
  exit 3
fi

# ---

# Build the actual web project

## Change to the web directory
if ! cd web; then
  echo "Failed to change directory to web" >&2
  exit 4
fi
## Install dependencies
if ! bun install --frozen-lockfile; then
  echo "Failed to install dependencies with bun" >&2
  exit 5
fi
## Build the project
if ! bun run build; then
  echo "Failed to build the web project with bun" >&2
  exit 6
fi
