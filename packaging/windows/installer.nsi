; Copyright (c) 2026 Zenin Easa Panthakkalakath
;
; NSIS installer for HexHoot. scripts/distribute.mjs passes the values with
; /D defines: APP_NAME, APP_VERSION, APP_ID, EXE_NAME, SOURCE_DIR,
; ICON_PATH, LICENSE_PATH and OUTPUT_FILE (paths from the repository root).
;
; /S installs and uninstalls without asking (winget and CI use it). The
; account and messages live in %APPDATA%\hexhoot and are not touched.

!ifndef APP_NAME
  !error "APP_NAME is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef APP_VERSION
  !error "APP_VERSION is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef APP_ID
  !error "APP_ID is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef EXE_NAME
  !error "EXE_NAME is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef SOURCE_DIR
  !error "SOURCE_DIR is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef ICON_PATH
  !error "ICON_PATH is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef LICENSE_PATH
  !error "LICENSE_PATH is not defined: run this through scripts/distribute.mjs"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is not defined: run this through scripts/distribute.mjs"
!endif

!cd "../.."

!include "MUI2.nsh"

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
Unicode true
; Solid compression maps the whole Electron payload at once, which fails on
; GitHub's Windows runners; per-file LZMA still compresses well.
SetCompressor lzma
RequestExecutionLevel admin

InstallDir "$PROGRAMFILES64\${APP_NAME}"
InstallDirRegKey HKLM "Software\${APP_ID}" "InstallDir"

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2022-2026 Zenin Easa Panthakkalakath"

!define MUI_ICON "${ICON_PATH}"
!define MUI_UNICON "${ICON_PATH}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${LICENSE_PATH}"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Section "-Application" SecApp
  SetRegView 64
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}\*"

  WriteRegStr HKLM "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"

  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "Zenin Easa Panthakkalakath"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "Software\${APP_ID}"
SectionEnd
