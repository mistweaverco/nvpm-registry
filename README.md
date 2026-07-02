<div align="center">

![NVPM Logo](assets/logo.svg)

# nvpm-registry

[![Made with love][badge-made-with-love]][contributors]
[![Latest release][badge-latest-release]][latest-release]

[What?](#what) •
[Honorable Mentions](#honorable-mentions) •
[Main Differences](#main-differences) •

<p></p>

This is the [registry][registry-website] for [NVPM][website],

<p></p>

</div>

> [!IMPORTANT]
> Package versions are updated once every day.
>
> The update starts at 12 Central European Time (CET) and
> takes around 30 minutes to complete.
> The updater only **updates** the monthly release.
>
> It does also update the release notes if there are any changes.
> This is to avoid spamming the registry with releases.
> This means, there is one **release** per month.

## What?

NVPM is a cross-platform package manager for development tools.
It allows you to easily install, manage, and distribute
development tools across different environments.

It supports a multitude of [package providers](#supported-providers).

It's designed to be uncomplicated, fast, and reliable,
making it easy to manage your development tools.

This is the registry that NVPM uses to fetch package information.

## Supported providers

The registry currently supports the following package providers:

- `cargo`
- `codeberg`
- `composer`
- `gem`
- `generic` (shell commands)
- `github`
- `gitlab`
- `golang`
- `luarocks`
- `npm`
- `nuget`
- `opam`
- `openvsx`
- `pypi`

## Honorable mentions

This registry is based of the work of the
[Mason registry](https://github.com/mason-org/mason-registry),
but differs quite heavily in its implementation.

### Main differences

Main differences between the Mason registry and the NVPM registry:

- Packages don't have a version included.
- Packages are located in `packages/<provider>/<package-id>/nvpm.yaml` where:
  - `<provider>` is the package provider
    (e.g., `npm`, `github`, `gitlab`, `...`)
  - `<package-id>` is the package identifier as defined by the provider
  - Examples:
    - `packages/npm/@mistweaverco/kulala-ls/nvpm.yaml` for npm scoped packages
    - `packages/npm/bash-language-server/nvpm.yaml` for npm top-level packages
    - `packages/github/dprint/dprint/nvpm.yaml` for GitHub repositories
    - `packages/gitlab/mistweaverco/a/b/c/repo-name/nvpm.yaml`
      for GitLab (supports unlimited sub-folders)
- Package IDs use the format `<provider>:<package-id>`
  (e.g., `npm:@mistweaverco/kulala-ls`, `github:dprint/dprint`)
- Releases are done every day at 12 Central European Time (CET),
  but do only **update** the monthly release.
  - This is to avoid spamming the registry.

> [!NOTE]
> The original Mason registry is licensed under
> [Apache 2.0 License](https://github.com/mason-org/mason-registry/blob/main/LICENSE).

[website]: https://nvpm.dev
[registry-website]: https://registry.nvpm.dev
[badge-made-with-love]: assets/badge-made-with-love.svg
[contributors]: https://github.com/mistweaverco/nvpm-registry/graphs/contributors
[logo]: assets/logo.svg
[swahili]: https://en.wikipedia.org/wiki/Swahili_language
[badge-latest-release]: https://img.shields.io/github/v/release/mistweaverco/nvpm-registry?style=for-the-badge
[latest-release]: https://github.com/mistweaverco/nvpm-registry/releases/latest
