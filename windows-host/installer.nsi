Unicode True
!ifndef VERSION
!define VERSION "0.0.0"
!endif
Name "Msfwr Windows Host"
OutFile "${INSTALLER}"
InstallDir "$LOCALAPPDATA\Programs\Msfwr"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Msfwr  |  Attended remote support"

!ifdef RELEASE_SIGNER
!uninstfinalize '"${RELEASE_SIGNER}" "%1"' = 0
!finalize '"${RELEASE_SIGNER}" "%1"' = 0
!endif

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME

; Auto-uninstallation timeline: the app can remove itself after a chosen
; number of hours. 24 hours is the default; users can pick other values
; such as 4 or 5 hours, or keep it installed indefinitely.
Var UninstHours ; "" = keep installed; otherwise number of hours
Page custom UninstTimelinePage UninstTimelineLeave "Auto-uninstall timing"

Function UninstTimelinePage
  !insertmacro MUI_HEADER_TEXT "Auto-uninstall timing" "Choose when Msfwr should remove itself."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Msfwr can uninstall itself automatically once this support window closes. Pick how long it should stay installed:"
  Pop $0
  ${NSD_CreateRadioButton} 0 30u 100% 12u "24 hours (recommended)"
  Pop $R0
  ${NSD_CreateRadioButton} 0 46u 100% 12u "4 hours"
  Pop $R1
  ${NSD_CreateRadioButton} 0 62u 100% 12u "5 hours"
  Pop $R2
  ${NSD_CreateRadioButton} 0 78u 100% 12u "8 hours"
  Pop $R3
  ${NSD_CreateRadioButton} 0 94u 100% 12u "12 hours"
  Pop $R4
  ${NSD_CreateRadioButton} 0 110u 100% 12u "48 hours"
  Pop $R5
  ${NSD_CreateRadioButton} 0 126u 100% 12u "Custom number of hours:"
  Pop $R6
  ${NSD_CreateText} 150 126u 60u 12u ""
  Pop $R7
  ${NSD_CreateRadioButton} 0 144u 100% 12u "Keep installed (no auto-uninstall)"
  Pop $R8
  SendMessage $R0 ${BM_SETCHECK} 0 0 ; default: 24 hours
  nsDialogs::Show
FunctionEnd

Function UninstTimelineLeave
  StrCpy $UninstHours ""
  SendMessage $R0 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "24"
  ${EndIf}
  SendMessage $R1 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "4"
  ${EndIf}
  SendMessage $R2 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "5"
  ${EndIf}
  SendMessage $R3 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "8"
  ${EndIf}
  SendMessage $R4 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "12"
  ${EndIf}
  SendMessage $R5 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstHours "48"
  ${EndIf}
  SendMessage $R6 ${BM_GETCHECK} 0 0 $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_GetText} $R7 $0
    ${If} $0 > 0
    ${AndIf} $0 <= 720
      StrCpy $UninstHours $0
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Enter a number of hours between 1 and 720, or pick another option." /SD IDOK
      StrCpy $UninstHours "24"
    ${EndIf}
  ${EndIf}
FunctionEnd

!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Msfwr.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Msfwr requires 64-bit Windows."
    Abort
  ${EndIf}
  SetShellVarContext current
FunctionEnd

Section "Msfwr"
  SetOutPath "$INSTDIR"
  File /oname=Msfwr.exe "${HOST_FILE}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Msfwr.lnk" "$INSTDIR\Msfwr.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "DisplayName" "Msfwr Windows Host"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "Publisher" "Msfwr"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr" "NoRepair" 1

  ; Schedule the auto-uninstall chosen on the timeline page (default 24 h).
  ; A one-shot Task Scheduler task runs the silent uninstaller at NOW+hours.
  ; The timing script lives in the install folder so quoting stays simple:
  ; no nested single/double quotes inside an nsExec command line.
  DeleteRegValue HKCU "Software\Msfwr" "AutoUninstallHours"
  ${If} $UninstHours != ""
    File /oname=schedule-uninstall.ps1 "schedule-uninstall.ps1"
    nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\schedule-uninstall.ps1" -Hours $UninstHours -Uninstaller "$INSTDIR\Uninstall.exe"'
    Pop $9            ; exit code
    Pop $8            ; script output (diagnostics only)
    ${If} $9 != 0
      MessageBox MB_ICONEXCLAMATION "Msfwr is installed, but the automatic uninstall could not be scheduled (code $9). You can uninstall it any time from Windows Settings.$\r$\n$\r$\nDetails: $TEMP\msfwr-schedule-uninstall.log" /SD IDOK
    ${EndIf}
    WriteRegStr HKCU "Software\Msfwr" "AutoUninstallHours" "$UninstHours"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ; Remove any pending auto-uninstall task so this section always wins.
  nsExec::ExecToLog 'schtasks.exe /delete /f /tn msfwr-auto-uninstall'
  DeleteRegValue HKCU "Software\Msfwr" "AutoUninstallHours"
  Delete "$SMPROGRAMS\Msfwr.lnk"
  Delete "$INSTDIR\Msfwr.exe"
  Delete "$INSTDIR\schedule-uninstall.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  ; Unattended access: remove sign-in startup and the saved access key.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Msfwr"
  Delete "$LOCALAPPDATA\Msfwr\unattended.json"
  RMDir "$LOCALAPPDATA\Msfwr"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Msfwr"
SectionEnd
