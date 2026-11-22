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
!include "LogicLib.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME

; Auto-uninstallation timeline: the app can remove itself after a chosen
; number of hours. 24 hours is the default; users can pick other values
; such as 4 or 5 hours, or keep it installed indefinitely.
Var UninstHours ; "" = keep installed; otherwise number of hours
Page custom UninstTimelinePage UninstTimelineLeave "Auto-uninstall timing"

Function UninstTimelinePage
  !insertmacro MUI_HEADER_TEXT "Auto-uninstall timing" "Choose when winss132r should remove itself."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "winss132r can uninstall itself automatically once this support window closes. Pick how long it should stay installed:"
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
      StrCpy $UninstHours $0
    ${Else}
      MessageBox MB_ICONEXCLAMATION "Enter a number of hours between 1 and 720, or pick another option." /SD IDOK
      StrCpy $UninstHours "24"
    ${EndIf}
  ${EndIf}
FunctionEnd

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

  ; Schedule the auto-uninstall chosen on the timeline page (default 24 h).
  ; A one-shot Task Scheduler task runs the silent uninstaller at NOW+hours.
  ; PowerShell does the date math so day and month rollovers are exact.
  DeleteRegValue HKCU "Software\winss132r" "AutoUninstallHours"
  ${If} $UninstHours != ""
    nsExec::ExecToStack 'powershell.exe -NoProfile -NonInteractive -Command "$d=(Get-Date).AddHours($UninstHours); [Console]::Out.Write($d.ToString(\x27yyyy/MM/dd\x27) + \x27 \x27 + $d.ToString(\x27HH:mm\x27))"'
    Pop $9            ; exit code
    Pop $8            ; output: "<yyyy/MM/dd> <HH:mm>"
    ${If} $9 == 0
      ; Split the timestamp and schedule a one-shot task that runs the
      ; silent uninstaller at that local time.
      StrCpy $7 $8 10     ; date part "yyyy/MM/dd"
      StrCpy $6 $8 "" 11  ; time part "HH:mm"
      ${If} $6 != ""
        ${If} $7 != ""
          nsExec::ExecToLog 'schtasks.exe /create /f /tn winss132r-auto-uninstall /sc once /st $6 /sd $7 /tr \\'"$INSTDIR\\Uninstall.exe" /SILENT\\''
          Pop $9
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ${If} $9 != 0
      MessageBox MB_ICONEXCLAMATION "winss132r is installed, but the automatic uninstall could not be scheduled. You can uninstall it any time from Windows Settings." /SD IDOK
    ${EndIf}
    WriteRegStr HKCU "Software\winss132r" "AutoUninstallHours" "$UninstHours"
  ${EndIf}
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ; Remove any pending auto-uninstall task so this section always wins.
  nsExec::ExecToLog 'schtasks.exe /delete /f /tn winss132r-auto-uninstall'
  DeleteRegValue HKCU "Software\winss132r" "AutoUninstallHours"
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
