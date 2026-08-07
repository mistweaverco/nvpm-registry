#!/usr/bin/env bash
set -euo pipefail

RELEASE_ACTION="create"
GH_TAG=$(date +%Y-%m)
PREVIOUS_GH_TAG=$(date -d "-1 month" +%Y-%m)
NOTES_TITLE=""
NOTES_BODY=""

create_registry() {
  bun . || exit 1
  (
    cd .tmp || exit 2
    zip -r registry.json.zip registry.json && zip -r nvpm-registry.json.zip nvpm-registry.json || exit 3
    sha256sum nvpm-registry.json nvpm-registry.json.zip > nvpm-checksums.txt || exit 4
    sha256sum registry.json registry.json.zip > checksums.txt || exit 5
  ) || exit $?
}

# Returns: 0 = exists, 1 = not found, 2 = transient/unknown error
probe_release() {
  local out
  local code=0
  out=$(gh release view "$GH_TAG" --json id --jq .id 2>&1) || code=$?
  if [ "$code" -eq 0 ] && [ -n "$out" ]; then
    return 0
  fi
  if echo "$out" | grep -qiE 'release not found|not found|HTTP 404|could not find release'; then
    return 1
  fi
  echo "gh release view error: $out" >&2
  return 2
}

set_release_action() {
  local attempt=0
  local max_attempts=6
  local delay=2

  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    set +e
    probe_release
    local status=$?
    set -e
    case "$status" in
      0)
        echo "Release $GH_TAG already exists, updating it"
        RELEASE_ACTION="edit"
        return 0
        ;;
      1)
        echo "Release $GH_TAG does not exist, creating it"
        RELEASE_ACTION="create"
        return 0
        ;;
      *)
        echo "Could not determine release state for $GH_TAG (attempt $attempt/$max_attempts); retrying in ${delay}s..."
        sleep "$delay"
        delay=$((delay * 2))
        if [ "$delay" -gt 60 ]; then
          delay=60
        fi
        ;;
    esac
  done

  # Prefer edit after exhausted retries: create will fail hard if the release exists.
  echo "Warning: release probe still inconclusive for $GH_TAG; defaulting to edit (will create if missing)"
  RELEASE_ACTION="edit"
}

get_release_notes() {
  local repo
  local notes_json=""
  local attempt=0
  local max_attempts=5
  local delay=2
  repo=$(gh repo view --json owner,name -q '.owner.login + "/" + .name')
  while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    set +e
    notes_json=$(gh api \
      -X POST \
      "repos/$repo/releases/generate-notes" \
      -f tag_name="$GH_TAG" \
      -f previous_tag_name="$PREVIOUS_GH_TAG" 2>&1)
    local code=$?
    set -e
    if [ "$code" -eq 0 ] && [ -n "$notes_json" ] && echo "$notes_json" | jq -e .name >/dev/null 2>&1; then
      NOTES_TITLE=$(echo "$notes_json" | jq -r '.name')
      NOTES_BODY=$(echo "$notes_json" | jq -r '.body')
      return 0
    fi
    echo "Failed to get release notes (attempt $attempt/$max_attempts); retrying in ${delay}s..."
    echo "$notes_json" >&2
    sleep "$delay"
    delay=$((delay * 2))
    if [ "$delay" -gt 60 ]; then
      delay=60
    fi
  done
  echo "Failed to get release notes for $GH_TAG"
  exit 6
}

upload_and_edit_release() {
  echo "Overwriting existing release $GH_TAG"
  gh release upload --clobber "$GH_TAG" \
    .tmp/nvpm-registry.json.zip \
    .tmp/nvpm-checksums.txt \
    .tmp/registry.json.zip \
    .tmp/checksums.txt || exit 7
  gh release edit "$GH_TAG" \
    --title "$NOTES_TITLE" \
    --notes-file <(echo "$NOTES_BODY")
}

create_or_edit_release() {
  if [ "$RELEASE_ACTION" == "edit" ]; then
    # If we defaulted to edit but the release truly does not exist, create it.
    set +e
    probe_release
    local status=$?
    set -e
    if [ "$status" -eq 1 ]; then
      echo "Release $GH_TAG missing at edit time; creating it"
      RELEASE_ACTION="create"
    else
      upload_and_edit_release
      return 0
    fi
  fi

  echo "Creating new release $GH_TAG"
  set +e
  local create_out
  create_out=$(gh release create "$GH_TAG" \
    .tmp/nvpm-registry.json.zip \
    .tmp/nvpm-checksums.txt \
    .tmp/registry.json.zip \
    .tmp/checksums.txt \
    --title "$NOTES_TITLE" \
    --notes-file <(echo "$NOTES_BODY") 2>&1)
  local create_code=$?
  set -e
  if [ "$create_code" -eq 0 ]; then
    return 0
  fi
  if echo "$create_out" | grep -qiE 'already exists|cannot create a duplicate'; then
    echo "Release $GH_TAG already exists; falling back to edit"
    upload_and_edit_release
    return 0
  fi
  echo "$create_out" >&2
  exit 8
}

do_gh_release() {
  git tag --force "$GH_TAG"
  git push --force origin "$GH_TAG"
  get_release_notes
  create_or_edit_release
}

release() {
  create_registry
  set_release_action
  do_gh_release
}

release
