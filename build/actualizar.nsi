; Actualizador: reemplaza sólo el código de la app (app.asar) en una instalación existente.
Unicode true
!ifndef VERSION
  !define VERSION "1.4.2"
!endif
!define APPNAME "Calculadora de Alquileres"
!define EXE "Calculadora de Alquileres.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CalculadoraAlquileresMMFuentes"

Name "Actualización de ${APPNAME}"
OutFile "..\dist\Actualizar-Calculadora-de-Alquileres.exe"
RequestExecutionLevel user
BrandingText "Inmobiliaria M.M. Fuentes"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=3082 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=3082 "CompanyName" "Inmobiliaria M.M. Fuentes"
VIAddVersionKey /LANG=3082 "FileDescription" "Actualización de ${APPNAME}"
VIAddVersionKey /LANG=3082 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=3082 "LegalCopyright" "Inmobiliaria M.M. Fuentes"

!include "MUI2.nsh"
!define MUI_ICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir ${APPNAME}"
!define MUI_WELCOMEPAGE_TEXT "Este asistente actualiza ${APPNAME} a la versión ${VERSION}. A partir de esta versión, la app va a buscar sola las próximas actualizaciones y se va a instalar la nueva versión solita al cerrarla, sin pedir nada — ésta es la última vez que hace falta instalar a mano.$\r$\n$\r$\nSe cerrará la aplicación si está abierta. Sus datos guardados se conservan."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SpanishInternational"

Function .onInit
  ReadRegStr $INSTDIR HKCU "${UNINSTKEY}" "InstallLocation"
  StrCmp $INSTDIR "" 0 +2
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\${APPNAME}"
  IfFileExists "$INSTDIR\resources\app.asar" +3 0
    MessageBox MB_OK|MB_ICONSTOP "No encontré ${APPNAME} instalada en:$\r$\n$INSTDIR$\r$\n$\r$\nInstale primero la aplicación con el instalador completo."
    Abort
FunctionEnd

Section "Actualizar"
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Pop $0
  Sleep 800
  SetOverwrite on
  SetOutPath "$INSTDIR\resources"
  File "..\dist\win-unpacked\resources\app.asar"
  File "icon.ico"
  ; actualiza el ícono de los accesos directos que ya existen
  IfFileExists "$DESKTOP\${APPNAME}.lnk" 0 +2
    CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\icon.ico" 0
  IfFileExists "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" 0 +2
    CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\resources\icon.ico" 0
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\resources\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
SectionEnd
