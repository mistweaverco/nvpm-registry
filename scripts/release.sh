#!/usr/bin/env bash


RELEASE_ACTION="create"
GH_TAG=$(date +%Y-%m)
PREVIOUS_GH_TAG=$(date -d "-1 month" +%Y-%m)
NOTES_TITLE=""
NOTES_BODY=""

create_registry() {
  bun . || exit 1
  cd .tmp || exit 2
  zip -r registry.json.zip registry.json && zip -r nvpm-registry.json.zip nvpm-registry.json || exit 3
  sha256sum nvpm-registry.json nvpm-registry.json.zip > nvpm-checksums.txt || exit 4
  sha256sum registry.json registry.json.zip > checksums.txt || exit 5
}

set_release_action() {
  if gh release view "$GH_TAG" --json id --jq .id > /dev/null 2>&1; then
    echo "Release $GH_TAG already exists, updating it"
    RELEASE_ACTION="edit"
  else
    echo "Release $GH_TAG does not exist, creating it"
    RELEASE_ACTION="create"
  fi
}

get_release_notes() {
  local repo
  local notes_json=""
  repo=$(gh repo view --json owner,name -q '.owner.login + "/" + .name')
  notes_json=$(gh api \
    -X POST \
    "repos/$repo/releases/generate-notes" \
    -f tag_name="$GH_TAG" \
    -f previous_tag_name="$PREVIOUS_GH_TAG"
  )
  if [ -z "$notes_json" ]; then
    echo "Failed to get release notes for $GH_TAG"
    exit 6
  fi
  NOTES_TITLE=$(echo "$notes_json" | jq -r '.name')
  NOTES_BODY=$(echo "$notes_json" | jq -r '.body')
}

do_gh_release() {
  git tag --force "$GH_TAG"
  git push --force origin "$GH_TAG"
  get_release_notes
  if [ "$RELEASE_ACTION" == "edit" ]; then
    echo "Overwriting existing release $GH_TAG"
    gh release upload --clobber "$GH_TAG" \
      .tmp/nvpm-registry.json.zip \
      .tmp/nvpm-checksums.txt \
      .tmp/registry.json.zip \
      .tmp/checksums.txt || exit 7
    gh release edit "$GH_TAG" \
      --title "$NOTES_TITLE" \
      --notes-file <(echo "$NOTES_BODY")
  else
    echo "Creating new release $GH_TAG"
    gh release create "$GH_TAG" \
      .tmp/nvpm-registry.json.zip \
      .tmp/nvpm-checksums.txt \
      .tmp/registry.json.zip \
      ./tmp/checksums.txt \
      --title "$NOTES_TITLE" \
      --notes-file <(echo "$NOTES_BODY") || exit 8
  fi
}

release() {
  create_registry
  set_release_action
  do_gh_release
}

release
