!macro killOrphanEngine
  nsExec::ExecToStack `"$SYSDIR\cmd.exe" /C tasklist /FI "IMAGENAME eq FlowAir.exe" /NH | find /I "FlowAir.exe"`
  Pop $0
  Pop $1
  ${if} $0 != 0
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM flowair-backend.exe`
    Pop $0
  ${endIf}
!macroend

!macro customInit
  !insertmacro killOrphanEngine
!macroend

!macro customUnInit
  !insertmacro killOrphanEngine
!macroend

!macro customInstall
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="FlowAir Engine"`
  Pop $0
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="FlowAir Backend"`
  Pop $0
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall add rule name="FlowAir Engine" dir=in action=allow program="$INSTDIR\resources\backend\flowair-backend.exe" enable=yes profile=any`
  Pop $0
!macroend

!macro customUnInstall
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="FlowAir Engine"`
  Pop $0
  ${ifNot} ${isUpdated}
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    RMDir /r "$LOCALAPPDATA\FlowAir"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
  ${endIf}
!macroend
