# SPDX-License-Identifier: GPL-2.0-or-later
# Single entry point for building, testing, packaging and releasing. Run `make` for help.
# CI runs exactly `make ci` after scripts/ci/provision.sh, locally or in GitHub/GitLab.

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

UUID     := $(shell python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
ZIP      := build/$(UUID).shell-extension.zip
RELEASES := 24.04 26.04
RELEASE  ?= 24.04

##@ Develop

.PHONY: help
help: ## Show this help
	@awk 'BEGIN { FS = ":.*## " } \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } \
		/^[a-z0-9-]+:.*## / { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

node_modules: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch $@

.PHONY: deps
deps: node_modules ## Install development dependencies

.PHONY: hooks
hooks: ## Enable the git hooks in .githooks/
	git config core.hooksPath .githooks

.PHONY: build
build: node_modules ## Compile the extension into dist/
	scripts/build.sh

.PHONY: test
test: node_modules ## Run unit tests (Vitest)
	npm test

.PHONY: test-gjs
test-gjs: node_modules ## Run GJS integration tests (adapters)
	scripts/test-gjs.sh

.PHONY: lint
lint: node_modules ## Check formatting, lint rules and types
	npm run --silent format:check
	npm run --silent lint
	npm run --silent typecheck

.PHONY: check
check: lint ## lint + unit coverage + icons + tooling tests
	npm run --silent test:coverage
	scripts/check-icons.sh
	python3 -m unittest discover --start-directory scripts/tests --quiet

.PHONY: format
format: node_modules ## Apply formatting
	npm run --silent format

##@ Package

.PHONY: zip
zip: build ## Build the extension zip (manual install / extensions.gnome.org)
	scripts/pack.sh

.PHONY: deb
deb: build ## Build the .deb (needs debhelper: on the host use `make incus-package`)
	scripts/build-deb.sh

.PHONY: package
package: zip deb ## Build the zip and the .deb

##@ Run on this machine

.PHONY: install
install: zip ## Install the zip for the current user
	gnome-extensions install --force $(ZIP)
	@echo "Installed. Try it now with 'make nested' (enabled automatically there) or 'make smoke'."
	@echo "For your real session: log out and in, then run: gnome-extensions enable $(UUID)"

.PHONY: uninstall
uninstall: ## Remove the user installation
	gnome-extensions uninstall $(UUID)

.PHONY: nested
nested: ## Nested GNOME Shell with the extension enabled (GNOME 49+: mutter-dev-bin)
	scripts/nested-shell.sh

.PHONY: demo
demo: ## Create the imon-demo-* instances (running, busy, stopped, frozen, VM) for realistic data
	scripts/demo-instances.sh up

.PHONY: demo-clean
demo-clean: ## Delete the imon-demo-* instances (nothing else)
	scripts/demo-instances.sh down

.PHONY: smoke
smoke: install ## Headless GNOME Shell: extension loads, no errors, survives disable/enable
	scripts/smoke-shell.sh

.PHONY: screenshots
screenshots: zip ## Screenshots of the expanded menu row from a throwaway Shell (SCHEME=light|dark, VM=<name>)
	scripts/ui-screenshots.sh --scheme $(or $(SCHEME),light) $(if $(VM),--vm $(VM))

.PHONY: logs
logs: ## Follow GNOME Shell logs
	journalctl --follow --output=cat /usr/bin/gnome-shell

##@ Clean environments (Incus)

.PHONY: incus-ci
incus-ci: ## Run `make ci` in a clean Ubuntu container (RELEASE=24.04|26.04)
	scripts/incus-run.sh $(RELEASE) make ci

.PHONY: incus-ci-all
incus-ci-all: ## Run `make ci` on every supported Ubuntu release
	for release in $(RELEASES); do scripts/incus-run.sh $$release make ci; done

.PHONY: incus-package
incus-package: ## Build zip and .deb in a clean container -> build/incus-<release>/
	scripts/incus-run.sh $(RELEASE) make package

.PHONY: vm
vm: ## GNOME desktop VM with Incus and the .deb installed (RELEASE=24.04|26.04)
	scripts/test-vm.sh $(RELEASE)

##@ CI and release

.PHONY: ci
ci: check test-gjs package ## Everything CI runs (inside a provisioned Ubuntu)

.PHONY: changelog-preview
changelog-preview: ## Preview the next release's changelog from commits
	scripts/release.py --dry-run

.PHONY: release
release: ## Commit and tag a release locally (BUMP=auto|major|minor|patch or NEW_VERSION=x.y.z)
	scripts/release.py $(if $(NEW_VERSION),--version $(NEW_VERSION),--bump $(or $(BUMP),auto))

.PHONY: ppa-source
ppa-source: build ## Build a signed source package for a PPA (SERIES=noble|resolute)
	scripts/ppa-source.sh $(SERIES)

##@ Housekeeping

.PHONY: po
po: ## Regenerate the translation template
	scripts/update-po.sh

.PHONY: clean
clean: ## Remove build outputs
	rm -rf dist build

.PHONY: distclean
distclean: clean ## Also remove node_modules
	rm -rf node_modules
