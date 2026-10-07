# SPDX-License-Identifier: GPL-2.0-or-later
# Single entry point for testing, building, packaging and releasing. Run `make` for help.
#
# Three suites, each a chain of the one before it:
#   test suite     check (format, lint, types, unit coverage, icons, tooling tests) and
#                  test-gjs (adapters under GJS); `make test-all` runs both.
#   build suite    build compiles into dist/; zip and deb package dist/; package does both.
#   release suite  ci = check + test-gjs + package, which is exactly what CI runs after
#                  scripts/ci/provision.sh; incus-ci runs ci in a clean container. changelog-preview,
#                  ppa-source and release prepare and tag a release; release is for the maintainer.

SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
MAKEFLAGS += --no-print-directory

UUID     := $(shell python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
ZIP      := build/$(UUID).shell-extension.zip
RELEASES := 24.04 26.04
RELEASE  ?= 24.04

# Step banner and closing line from scripts/lib/ui.sh; the clock starts with the make run.
# Only the aggregate targets (test-all, check, build, ci) close with DONE: zip, deb and package
# are links in the chain, whose scripts already end with their own "ok:" line.
export UI_T0 := $(shell date +%s)
STEP = @source scripts/lib/ui.sh; ui_step
DONE = @source scripts/lib/ui.sh; ui_done

# Variables listed by `make help`: name, default, meaning.
##? RELEASE      24.04          Ubuntu release for incus-ci, incus-package and vm (24.04 or 26.04)
##? SERIES       (required)     Ubuntu series for ppa-source (noble or resolute)
##? SCHEME       light          Colour scheme for screenshots (light or dark)
##? VM           (none)         Existing Incus VM that screenshots drives
##? BUMP         auto           Version bump for release (auto, major, minor or patch)
##? NEW_VERSION  (none)         Exact version for release, instead of BUMP

node_modules: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch $@

##@ Test suite
# What to run before review: quality gates that need no packaging.

.PHONY: test-all
test-all: check test-gjs ## Everything a local gate needs: check + test-gjs
	$(DONE) "test-all passed"

.PHONY: check
check: lint ## lint + unit coverage + icons + tooling tests
	$(STEP) "Unit tests with coverage"
	npm run --silent test:coverage
	$(STEP) "Icon names"
	scripts/check-icons.sh
	$(STEP) "Tooling tests"
	python3 -m unittest discover --start-directory scripts/tests --quiet
	$(DONE) "check passed"

.PHONY: test
test: node_modules ## Run unit tests (Vitest)
	npm test

.PHONY: test-gjs
test-gjs: node_modules ## Run GJS integration tests (adapters)
	scripts/test-gjs.sh

.PHONY: lint
lint: node_modules ## Check formatting, lint rules and types
	$(STEP) "Format, lint rules and types"
	npm run --silent format:check
	npm run --silent lint
	npm run --silent typecheck

.PHONY: format
format: node_modules ## Apply formatting
	npm run --silent format

##@ Build suite
# Turn the sources into dist/ and the package formats made from it.

.PHONY: build
build: node_modules ## Compile the extension into dist/
	scripts/build.sh
	$(DONE) "build finished"

.PHONY: zip
zip: build ## Build the extension zip (manual install / extensions.gnome.org)
	scripts/pack.sh

.PHONY: deb
deb: build ## Build the .deb (needs debhelper: on the host use `make incus-package`)
	scripts/build-deb.sh

.PHONY: package
package: zip deb ## Build the zip and the .deb

##@ Release suite
# What CI runs, and the steps that prepare and tag a release (see docs/RELEASING.md).

.PHONY: ci
ci: check test-gjs package ## Everything CI runs (inside a provisioned Ubuntu)
	$(DONE) "ci passed"

.PHONY: changelog-preview
changelog-preview: ## Preview the next release's changelog from commits
	scripts/release.py --dry-run

.PHONY: ppa-source
ppa-source: build ## Build a signed source package for a PPA (SERIES=noble|resolute)
	scripts/ppa-source.sh $(SERIES)

.PHONY: release
release: ## Commit and tag a release locally (BUMP=auto|major|minor|patch or NEW_VERSION=x.y.z)
	scripts/release.py $(if $(NEW_VERSION),--version $(NEW_VERSION),--bump $(or $(BUMP),auto))

##@ Run and verify
# Try the extension on this machine, and check that the machine can build it.

.PHONY: doctor
doctor: ## Check the development tools and say how to install what is missing
	scripts/doctor.sh

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

.PHONY: smoke
smoke: install ## Headless GNOME Shell: extension loads, no errors, survives disable/enable
	scripts/smoke-shell.sh

.PHONY: demo
demo: ## Create the imon-demo-* instances (running, busy, stopped, frozen, VM) for realistic data
	scripts/demo-instances.sh up

.PHONY: demo-clean
demo-clean: ## Delete the imon-demo-* instances (nothing else)
	scripts/demo-instances.sh down

.PHONY: screenshots
screenshots: zip ## Screenshots of the expanded menu row from a throwaway Shell (SCHEME, VM)
	scripts/ui-screenshots.sh --scheme $(or $(SCHEME),light) $(if $(VM),--vm $(VM))

.PHONY: shell-logs
shell-logs: ## Follow GNOME Shell logs
	journalctl --follow --output=cat /usr/bin/gnome-shell

.PHONY: vm
vm: ## GNOME desktop VM with Incus and the .deb installed (RELEASE=24.04|26.04)
	scripts/test-vm.sh $(RELEASE)

##@ Clean environments
# The same targets inside throwaway Incus containers, so results do not depend on this machine.

.PHONY: incus-ci
incus-ci: ## Run `make ci` in a clean Ubuntu container (RELEASE=24.04|26.04)
	scripts/incus-run.sh $(RELEASE) make ci

.PHONY: incus-ci-all
incus-ci-all: ## Run `make ci` on every supported Ubuntu release
	for release in $(RELEASES); do scripts/incus-run.sh $$release make ci; done

.PHONY: incus-package
incus-package: ## Build zip and .deb in a clean container -> build/incus-<release>/
	scripts/incus-run.sh $(RELEASE) make package

##@ Housekeeping
# Help, setup and cleanup.

.PHONY: help
help: ## Show this help
	@source scripts/lib/ui.sh; awk -v bold="$$UI_BOLD" -v cyan="$$UI_CYAN" -v reset="$$UI_RESET" -f scripts/help.awk $(MAKEFILE_LIST)

.PHONY: deps
deps: node_modules ## Install development dependencies

.PHONY: hooks
hooks: ## Enable the git hooks in .githooks/
	git config core.hooksPath .githooks

.PHONY: po
po: ## Regenerate the translation template
	scripts/update-po.sh

.PHONY: clean
clean: ## Remove build outputs
	rm -rf dist build

.PHONY: distclean
distclean: clean ## Also remove node_modules
	rm -rf node_modules
