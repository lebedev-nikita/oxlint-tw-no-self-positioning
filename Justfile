# Local checks and manual release commands.
default:
  @just --list

# Install exact versions from the lockfile.
install:
  npm ci

# Build the TypeScript adapter and the native addon for this machine.
build: install
  npm run build

# Check the TypeScript and Rust sources.
lint: install
  npm run lint
  npm run typecheck
  cargo fmt -- --check
  cargo clippy --all-targets -- -D warnings

# Run integration and Rust tests against the local native addon.
test: build
  npm test
  cargo test

# Run all local quality checks.
check: lint test

# Ensure this clean commit has a matching version tag.
release-check:
  node scripts/check-release.mjs

# Download all eight native packages from a successful CI run of this commit.
fetch-artifacts: release-check
  node scripts/fetch-artifacts.mjs

# Check the assembled npm packages without publishing.
prepare: check fetch-artifacts
  node scripts/manual-publish.mjs --prepare-only

# Publish all eight native packages, then the root package.
publish: release-check check fetch-artifacts
  node scripts/manual-publish.mjs
