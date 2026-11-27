### Copyright (c) 2022-2026 Zenin Easa Panthakkalakath ###

# Shortcuts for the npm scripts. Installers are built on the platform they
# are for (no cross-compiling); see scripts/distribute.mjs for the tools each
# one needs, and .github/workflows/release.yml for all of them at once.

.PHONY: install clean lint lintfix test package distribute

install:
	npm ci

clean:
	rm -rf node_modules out test-results

lint:
	npm run lint

lintfix:
	npx eslint --config eslint.config.js --fix
	npx copyright-header --fix --copyrightHolder "Zenin Easa Panthakkalakath"

test:
	npm test

# out/package/HexHoot-<platform>-<arch>
package:
	npm run package

# out/release: the installers for this machine
distribute:
	npm run distribute
