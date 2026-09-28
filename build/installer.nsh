; Live-fix install dir on the Directory page: drive roots (e.g. D:\) are
; rejected by NSIS AllowRootDirInstall (Install stays disabled). Append
; ${APP_FILENAME} (= sanitized productName, "Deakrix Riftbound Tracker") so the
; field becomes e.g. D:\Deakrix Riftbound Tracker and Install can proceed.
; Matches electron-builder's instFilesPre append (assistedInstaller.nsh).
Function .onVerifyInstDir
  Push $R0
  Push $R1
  StrLen $R0 $INSTDIR
  StrCmp $R0 3 0 restore
  ; Exactly three chars — expect "X:\"
  StrCpy $R1 $INSTDIR "" 1
  StrCmp $R1 ":\" 0 restore
  StrCpy $INSTDIR "$INSTDIR${APP_FILENAME}"
restore:
  Pop $R1
  Pop $R0
FunctionEnd
