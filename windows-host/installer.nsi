Unicode True
Name "winss132r Windows Host"
OutFile "${INSTALLER}"
InstallDir "$LOCALAPPDATA\Programs\winss132r"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "winss132r  |  Attended remote support"

!ifdef RELEASE_SIGNER
!uninstfinalize '"${RELEASE_SIGNER}" "%1"' = 0
!finalize '"${RELEASE_SIGNER}" "%1"' = 0
!endif

!include "MUI2.nsh"
!include "x64.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\winss132r.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "winss132r requires 64-bit Windows."
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Section "winss132r"
  SetOutPath "$INSTDIR"
  File /oname=winss132r.exe "${HOST_FILE}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\winss132r.lnk" "$INSTDIR\winss132r.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "DisplayName" "winss132r Windows Host"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "Publisher" "winss132r"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$SMPROGRAMS\winss132r.lnk"
  Delete "$INSTDIR\winss132r.exe"
  Delete "$INSTDIR\Uninstall.exe"
  ; Unattended access: remove sign-in startup and the saved access key.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "winss132r"
  Delete "$LOCALAPPDATA\winss132r\unattended.json"
  RMDir "$LOCALAPPDATA\winss132r"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\winss132r"
SectionEnd
