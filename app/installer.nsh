; AnyLloyd — custom NSIS installer hooks
; This file is included by electron-builder's NSIS template.

; Install the bundled signaling server alongside the app.
; The server files are already copied via extraResources in package.json.

!macro customInstall
  ; Nothing extra needed — server files are placed in $INSTDIR\resources\server
  ; by electron-builder's extraResources configuration.
!macroend

!macro customUnInstall
  ; Clean up nothing extra — all files are removed by the standard uninstaller.
!macroend
