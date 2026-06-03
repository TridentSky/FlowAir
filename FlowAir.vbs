Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

strCurrentPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
strBatFile = strCurrentPath & "\START.bat"

objShell.Run """" & strBatFile & """", 0, False

Set objShell = Nothing
Set objFSO = Nothing
