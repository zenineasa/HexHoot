### Copyright (c) 2022 Zenin Easa Panthakkalakath ###

all:
	make clean
	make install
	make lint

install:
	npm install

clean:
	rm -rf node_modules bundle.js package-lock.json

lint:
	npx eslint *.js modules/**/*.js test/*.js test/**/*.js
	npx copyright-header --copyrightHolder "Zenin Easa Panthakkalakath"

lintfix:
	npx eslint *.js modules/**/*.js test/*.js test/**/*.js --fix
	npx copyright-header --fix --copyrightHolder "Zenin Easa Panthakkalakath"
