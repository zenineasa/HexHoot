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
	npm install

clean:
	rm -rf node_modules bundle.js package-lock.json out

lint:
	npx eslint --config eslint.config.js
	npx copyright-header --copyrightHolder "Zenin Easa Panthakkalakath"

lintfix:
	npx eslint --config eslint.config.js --fix
	npx copyright-header --fix --copyrightHolder "Zenin Easa Panthakkalakath" --forceModificationYear 2024

build-mac-intel:
	$(call BUILD_MAC_DMG,darwin,x64)

build-mac-m1:
	$(call BUILD_MAC_DMG,darwin,arm64)

build-windows:
	npx electron-forge make --platform=win32 --arch=x64

build-linux:
	npx electron-forge make --platform=linux --arch=x64

# To have HexHoot icon on the macOS APP-file and DMG-file
MAC_ICON_PATH := modules/ImagePack/images/DesktopIcons/icon_mac.icns
MAKE_PATH := out/make
define BUILD_MAC_DMG
	$(eval VERSION := $(shell npm pkg get version --workspaces=false | tr -d \"))

	$(eval MAC_APP_PATH := out/hexhoot-$(1)-$(2)/hexhoot.app)
	$(eval MAC_APP_RENAMED_PATH := out/hexhoot-$(1)-$(2)/HexHoot-$(VERSION).app)
	$(eval MAC_DMG_PATH := $(MAKE_PATH)/HexHoot-$(VERSION)-$(2).dmg)

	$(eval APPDMG_JSON_PATH := appdmg.json)
	$(eval ICNS_PATH := out/icon_mac.icns)
	$(eval RSRC_PATH := out/icns.rsrc)

	npx electron-forge package --platform=$(1) --arch=$(2)

	cp $(MAC_ICON_PATH) $(MAC_APP_PATH)/Contents/Resources/electron.icns
	cp -rf $(MAC_APP_PATH) $(MAC_APP_RENAMED_PATH)
	rm -rf $(MAC_APP_PATH)
	touch $(MAC_APP_RENAMED_PATH)

	echo '{' > $(APPDMG_JSON_PATH)
	echo '"title": "HexHoot",' >> $(APPDMG_JSON_PATH)
	echo '"icon": "$(MAC_ICON_PATH)",' >> $(APPDMG_JSON_PATH)
	echo '"background-color": "#2b2e2f",' >> $(APPDMG_JSON_PATH)
	echo '"contents": [' >> $(APPDMG_JSON_PATH)
	echo '{ "x": 448, "y": 344, "type": "link", "path": "/Applications" },' >> $(APPDMG_JSON_PATH)
	echo '{ "x": 192, "y": 344, "type": "file", "path": "$(MAC_APP_RENAMED_PATH)" }' >> $(APPDMG_JSON_PATH)
	echo ']' >> $(APPDMG_JSON_PATH)
	echo '}' >> $(APPDMG_JSON_PATH)

	mkdir -p $(MAKE_PATH)
	rm -rf $(MAC_DMG_PATH)
	npx appdmg $(APPDMG_JSON_PATH) $(MAC_DMG_PATH)

	cp -rf $(MAC_ICON_PATH) $(ICNS_PATH)
	sips -i $(ICNS_PATH)
	DeRez -only icns $(ICNS_PATH) > $(RSRC_PATH)
	Rez -append $(RSRC_PATH) -o $(MAC_DMG_PATH)
	SetFile -a C $(MAC_DMG_PATH)

	rm $(ICNS_PATH) $(RSRC_PATH) $(APPDMG_JSON_PATH)
endef
