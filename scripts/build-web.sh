#!/usr/bin/env bash

set -euo pipefail

REPO='mistweaverco/nvpm-registry'
TMP_DIR='.tmp'
NVPM_REGISTRY_NAME='nvpm-registry'
NVPM_REGISTRY_FILE="${NVPM_REGISTRY_NAME}.json.zip"

rm "$TMP_DIR"/*

# Function to get latest release version
get_latest_version() {
    # GitHub automatically redirects /latest to the latest release
    # We can extract the version from the redirect URL
    local version
    local redirect_url

    if command -v curl >/dev/null 2>&1; then
        redirect_url=$(curl -s -I "https://github.com/${REPO}/releases/latest" | grep -i "location:" | sed 's/.*\/releases\/tag\///' | tr -d '\r')
    else
        echo "curl is not available."
        exit 1
    fi

    if [ -z "$redirect_url" ]; then
        echo "Failed to get latest version from GitHub"
        exit 1
    fi

    echo "$redirect_url"
}

download_and_unzip_registry() {
  local version
  version=$(get_latest_version)
  local download_url="https://github.com/${REPO}/releases/download/${version}/${NVPM_REGISTRY_FILE}"

  local download_success=false
  local unzip_success=false

  if command -v curl >/dev/null 2>&1; then
      if curl -L -o "$TMP_DIR/${NVPM_REGISTRY_FILE}" "$download_url"; then
          download_success=true
      fi
  fi

  if [ "$download_success" = false ]; then
      echo "Failed to download from ${download_url}"
      rm "$TMP_DIR"/*
      exit 1
  fi

  if command -v unzip >/dev/null 2>&1; then
      if unzip -j "${TMP_DIR}/${NVPM_REGISTRY_FILE}" -d "${TMP_DIR}"; then
          unzip_success=true
      fi
  fi

  if [ "$unzip_success" = false ]; then
      echo "Failed to unzip ${TMP_DIR}/${NVPM_REGISTRY_FILE} into ${TMP_DIR}"
      rm -rf "$TMP_DIR"
      exit 1
  fi
}

# Create "zip" and "tar" versions
# and leave the .tmp directory out of the archive
create_archives() {
  for ext in gz xz bz2 zip; do
    case "${ext}" in
      gz)
        if ! tar -C .tmp -czf "./.tmp/${NVPM_REGISTRY_NAME}.${ext}" "${NVPM_REGISTRY_FILE}"; then
          echo "Failed to create ${NVPM_REGISTRY_NAME}.${ext}" >&2
          exit 1
        fi
        ;;
      xz)
        if ! tar -C .tmp -cJf "./.tmp/${NVPM_REGISTRY_NAME}.${ext}" "${NVPM_REGISTRY_FILE}"; then
          echo "Failed to create ${NVPM_REGISTRY_NAME}.${ext}" >&2
          exit 1
        fi
        ;;
      bz2)
        if ! tar -C .tmp -cjf "./.tmp/${NVPM_REGISTRY_NAME}.${ext}" "${NVPM_REGISTRY_FILE}"; then
          echo "Failed to create ${NVPM_REGISTRY_NAME}.${ext}" >&2
          exit 1
        fi
        ;;
      zip)
        rm -f "./.tmp/${NVPM_REGISTRY_NAME}.${ext}"
        if ! (cd .tmp && zip -q "../.tmp/${NVPM_REGISTRY_NAME}.${ext}" "${NVPM_REGISTRY_FILE}"); then
          echo "Failed to create ${NVPM_REGISTRY_NAME}.${ext}" >&2
          exit 1
        fi
        ;;
      *)
        echo "Unknown archive extension: ${ext}" >&2
        exit 1
        ;;
    esac
  done
}

download_and_unzip_registry
create_archives

# Copy static assets over

## nvpm-registry.* files
if ! cp ./.tmp/${NVPM_REGISTRY_NAME}.* web/static/; then
  echo "Failed to copy ${NVPM_REGISTRY_NAME}.* to web/static/" >&2
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
