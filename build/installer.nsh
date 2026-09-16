!include "getProcessInfo.nsh"
!include "FileFunc.nsh"

Var pid

!define FLOWAIR_ENGINE_EXECUTABLE "flowair-backend.exe"
!define FLOWAIR_ENGINE_PATH "resources\backend\flowair-backend.exe"
!define FLOWAIR_FIREWALL_RULE "FlowAir Engine"
!define FLOWAIR_LEGACY_FIREWALL_RULE "FlowAir Backend"
!define FLOWAIR_FILE_CLASS "FlowAir.Playlist"
!define FLOWAIR_EXTENSION_KEY "Software\Classes\.flowair"
!define FLOWAIR_CLASS_KEY "Software\Classes\${FLOWAIR_FILE_CLASS}"
!define FLOWAIR_VENDOR_KEY "Software\TridentSky"
!define FLOWAIR_APP_KEY "Software\TridentSky\FlowAir"
!define FLOWAIR_CAPABILITIES_KEY "Software\TridentSky\FlowAir\Capabilities"

!macro killOrphanEngine
  Push $0
  Push $1
  nsExec::ExecToStack `"$SYSDIR\cmd.exe" /C ""$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /NH | "$SYSDIR\findstr.exe" /B /I /C:"${APP_EXECUTABLE_FILENAME}""`
  Pop $0
  Pop $1
  ${if} $0 == 1
    nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM ${FLOWAIR_ENGINE_EXECUTABLE}`
    Pop $1
  ${endIf}
  Pop $1
  Pop $0
!macroend

!macro stopEngine
  Push $0
  Push $1
  Push $2
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM ${FLOWAIR_ENGINE_EXECUTABLE}`
  Pop $0
  StrCpy $1 0
  ${Do}
    nsExec::ExecToStack `"$SYSDIR\cmd.exe" /C ""$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ${FLOWAIR_ENGINE_EXECUTABLE}" /NH | "$SYSDIR\findstr.exe" /B /I /C:"${FLOWAIR_ENGINE_EXECUTABLE}""`
    Pop $0
    Pop $2
    ${if} $0 == 1
      ${ExitDo}
    ${endIf}
    IntOp $1 $1 + 1
    ${if} $1 >= 20
      ${ExitDo}
    ${endIf}
    Sleep 250
  ${Loop}
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !insertmacro stopEngine
!macroend

!macro customInit
  !insertmacro killOrphanEngine
!macroend

!macro customUnInit
  !insertmacro killOrphanEngine
!macroend

!macro customInstall
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6

  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${FLOWAIR_LEGACY_FIREWALL_RULE}"`
  Pop $0
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${FLOWAIR_FIREWALL_RULE}"`
  Pop $0
  nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall add rule name="${FLOWAIR_FIREWALL_RULE}" dir=in action=allow program="$INSTDIR\${FLOWAIR_ENGINE_PATH}" enable=yes profile=any`
  Pop $0
  ${if} $0 == 0
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" FirewallRule "ok"
  ${else}
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" FirewallRule "failed"
    DetailPrint "The FlowAir Engine firewall rule could not be created. Players on other computers may not be able to connect."
  ${endIf}

  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "" "$appExe"
  WriteRegStr SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}" "Path" "$INSTDIR"

  !ifmacrodef registerFileAssociations
    WriteRegStr SHELL_CONTEXT "${FLOWAIR_CLASS_KEY}\shell\open\command" "" '"$appExe" "%1"'
    WriteRegStr SHELL_CONTEXT "${FLOWAIR_CAPABILITIES_KEY}" "ApplicationName" "${PRODUCT_NAME}"
    !ifdef APP_DESCRIPTION
      WriteRegStr SHELL_CONTEXT "${FLOWAIR_CAPABILITIES_KEY}" "ApplicationDescription" "${APP_DESCRIPTION}"
    !endif
    WriteRegStr SHELL_CONTEXT "${FLOWAIR_CAPABILITIES_KEY}" "ApplicationIcon" "$appExe,0"
    WriteRegStr SHELL_CONTEXT "${FLOWAIR_CAPABILITIES_KEY}\FileAssociations" ".flowair" "${FLOWAIR_FILE_CLASS}"
    WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${FLOWAIR_CAPABILITIES_KEY}"
    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  !endif

  ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallDate" "$2$1$0"

  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $0

    nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${FLOWAIR_FIREWALL_RULE}"`
    Pop $0
    nsExec::Exec `"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="${FLOWAIR_LEGACY_FIREWALL_RULE}"`
    Pop $0

    DeleteRegKey SHELL_CONTEXT "Software\Microsoft\Windows\CurrentVersion\App Paths\${APP_EXECUTABLE_FILENAME}"
    DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
    DeleteRegKey SHELL_CONTEXT "${FLOWAIR_CAPABILITIES_KEY}"
    DeleteRegKey /ifempty SHELL_CONTEXT "${FLOWAIR_APP_KEY}"
    DeleteRegKey /ifempty SHELL_CONTEXT "${FLOWAIR_VENDOR_KEY}"

    ReadRegStr $0 SHELL_CONTEXT "${FLOWAIR_EXTENSION_KEY}" ""
    ${if} $0 == "${FLOWAIR_FILE_CLASS}"
      DeleteRegValue SHELL_CONTEXT "${FLOWAIR_EXTENSION_KEY}" ""
    ${endIf}
    DeleteRegValue SHELL_CONTEXT "${FLOWAIR_EXTENSION_KEY}\OpenWithProgids" "${FLOWAIR_FILE_CLASS}"
    DeleteRegKey /ifempty SHELL_CONTEXT "${FLOWAIR_EXTENSION_KEY}\OpenWithProgids"
    DeleteRegKey /ifempty SHELL_CONTEXT "${FLOWAIR_EXTENSION_KEY}"

    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    RMDir /r "$LOCALAPPDATA\${APP_FILENAME}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}

    Pop $0
  ${endIf}
!macroend
