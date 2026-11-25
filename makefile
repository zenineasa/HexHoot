### Copyright (c) 2022-2024 Zenin Easa Panthakkalakath ###

all:
	make clean
	make install
	make lint
	make build-mac-intel
	make build-mac-m1
	make build-windows
	make build-linux

install:
	npm ci

clean:
	rm -rf node_modules bundle.js out

lint:
	npm run lint

lintfix:
	npx eslint --config eslint.config.js --fix
	npx copyright-header --fix --copyrightHolder "Zenin Easa Panthakkalakath"

build-mac-intel:
	npx electron-forge make --platform=darwin --arch=x64

build-mac-m1:
	npx electron-forge make --platform=darwin --arch=arm64

build-windows:
	npx electron-forge make --platform=win32 --arch=x64

build-linux:
	npx electron-forge make --platform=linux --arch=x64
