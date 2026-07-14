; =============================================================================
; OpenBrowser — NSIS Installer Script
; Usage:  makensis /DAPP_VERSION=1.0.0 scripts\installer.nsi
; =============================================================================

!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif

!define APP_NAME       "OpenBrowser"
!define APP_EXE        "OpenBrowser.exe"
!define PUBLISHER      "OpenBrowser"
!define INSTALL_DIR    "$PROGRAMFILES64\${APP_NAME}"
!define UNINSTALL_KEY  "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

!ifndef APP_ARCH
  !define APP_ARCH     "x64"
!endif

; Output EXE lives at project root
; makensis is called from project root: makensis scripts/installer.nsi
; NSIS resolves paths relative to the .nsi file location, so !cd .. goes to project root
!cd ".."

OutFile "OpenBrowser-v${APP_VERSION}-windows-${APP_ARCH}-setup.exe"

; ── General settings ──────────────────────────────────────────────────────────
Name              "${APP_NAME} ${APP_VERSION}"
InstallDir        "${INSTALL_DIR}"
InstallDirRegKey  HKLM "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor     /SOLID lzma
Unicode           True

; ── Modern UI ─────────────────────────────────────────────────────────────────
!include "MUI2.nsh"

!define MUI_ABORTWARNING

; ── Installer / Uninstaller window icon (the .ico shown in the wizard title bar)
!define MUI_ICON   "..\icon.ico"
!define MUI_UNICON "..\icon.ico"

; ── Optional: header banner image (150×57 px BMP, shown top-right of each page)
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "..\icons\installer_header.bmp"
!define MUI_HEADERIMAGE_RIGHT

; ── Optional: sidebar image on Welcome & Finish pages (164×314 px BMP)
!define MUI_WELCOMEFINISHPAGE_BITMAP "..\icons\installer_sidebar.bmp"

; Installer pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN          "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT     "Launch ${APP_NAME}"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ── Install section ───────────────────────────────────────────────────────────
Section "Install"
  SetOutPath "$INSTDIR"

  ; Copy all contents of Release/ into the install directory
  File /r "Release\*"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut  "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut  "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"

  ; Desktop shortcut
  CreateShortcut  "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  ; Write uninstaller binary
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Register in Add/Remove Programs
  WriteRegStr   HKLM "Software\${APP_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "Publisher"       "${PUBLISHER}"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify"        1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair"        1
SectionEnd

; ── Uninstall section ─────────────────────────────────────────────────────────
Section "Uninstall"
  ; Remove all installed files and directories
  RMDir /r "$INSTDIR"

  ; Remove Start Menu folder
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Uninstall ${APP_NAME}.lnk"
  RMDir  "$SMPROGRAMS\${APP_NAME}"

  ; Remove Desktop shortcut
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; Remove registry entries
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
