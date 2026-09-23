; Instalador de "Calculadora de Alquileres" (Inmobiliaria M.M. Fuentes)
; Se compila con:  makensis -DVERSION=1.0.0 build/instalador-completo.nsi   (después de "electron-builder --win --dir")
; OJO: no renombrar este archivo a "build/installer.nsi" — electron-builder usa ese nombre por
; convención como script NSIS personalizado para su propio target "nsis" (el que arma el auto-
; update con electron-updater), y este script pisaría el suyo (choca "VIProductVersion already
; defined" al correr "npm run dist").
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!ifndef VERSION
  !define VERSION "1.4.2"
!endif
!define APPNAME "Calculadora de Alquileres"
!define COMPANY "Inmobiliaria M.M. Fuentes"
!define EXE "Calculadora de Alquileres.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CalculadoraAlquileresMMFuentes"

Name "${APPNAME}"
OutFile "..\dist\Calculadora-de-Alquileres-Instalador-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user          ; no pide permisos de administrador
BrandingText "${COMPANY}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=3082 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=3082 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=3082 "FileDescription" "Instalador de ${APPNAME}"
VIAddVersionKey /LANG=3082 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=3082 "LegalCopyright" "${COMPANY}"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SpanishInternational"

Section "Instalar"
  ; si la app está abierta (actualización), la cerramos para poder reemplazar los archivos
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Pop $0
  Sleep 500

  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"

  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"

  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Pop $0
  Sleep 500
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd
