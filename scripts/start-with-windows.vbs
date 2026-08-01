' Arranque do servidor sem janela: delega para start-with-windows.ps1
' (verifica alteracoes, faz install/build e reinicia se preciso).

Dim sh, fso, scriptDir, rootDir, ps1, psExe, cmd, logDir, logPath, errPath, rc

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
sh.CurrentDirectory = rootDir

ps1 = fso.BuildPath(scriptDir, "start-with-windows.ps1")
psExe = fso.BuildPath(sh.ExpandEnvironmentStrings("%SystemRoot%"), "System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then
  psExe = "powershell.exe"
End If

Function Q(p)
  Q = Chr(34) & p & Chr(34)
End Function

Function CanWriteToFolder(folderPath)
  Dim testPath, f
  On Error Resume Next
  testPath = fso.BuildPath(folderPath, ".write_test.tmp")
  Set f = fso.OpenTextFile(testPath, 2, True)
  If Err.Number = 0 Then
    f.WriteLine "ok"
    f.Close
    fso.DeleteFile testPath, True
    CanWriteToFolder = True
  Else
    CanWriteToFolder = False
    Err.Clear
  End If
  On Error GoTo 0
End Function

Sub EnsureFolderTree(targetPath)
  Dim parts, i, current
  parts = Split(targetPath, "\")
  If UBound(parts) < 1 Then Exit Sub
  current = parts(0)
  If Right(current, 1) = ":" Then current = current & "\"
  For i = 1 To UBound(parts)
    If Len(parts(i)) > 0 Then
      If Right(current, 1) = "\" Then
        current = current & parts(i)
      Else
        current = current & "\" & parts(i)
      End If
      If Not fso.FolderExists(current) Then
        On Error Resume Next
        fso.CreateFolder current
        On Error GoTo 0
      End If
    End If
  Next
End Sub

Sub AppendLog(path, msg)
  Dim f
  On Error Resume Next
  Set f = fso.OpenTextFile(path, 8, True)
  If Err.Number = 0 Then
    f.WriteLine "[" & Now & "] " & msg
    f.Close
  End If
  On Error GoTo 0
End Sub

If Not fso.FolderExists(fso.BuildPath(rootDir, "data")) Then
  On Error Resume Next
  fso.CreateFolder fso.BuildPath(rootDir, "data")
  On Error GoTo 0
End If

logDir = fso.BuildPath(rootDir, "data")
If Not CanWriteToFolder(logDir) Then
  logDir = fso.BuildPath(sh.ExpandEnvironmentStrings("%LOCALAPPDATA%"), "video_player\data")
  EnsureFolderTree logDir
End If

logPath = fso.BuildPath(logDir, "startup-server.log")
errPath = fso.BuildPath(logDir, "startup-error.log")

If Not fso.FileExists(ps1) Then
  AppendLog errPath, "falta start-with-windows.ps1"
  WScript.Quit 1
End If

AppendLog logPath, "boot: a chamar start-with-windows.ps1"
cmd = Q(psExe) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Q(ps1)
rc = sh.Run(cmd, 0, True)
If rc <> 0 Then
  AppendLog errPath, "start-with-windows.ps1 saiu com codigo " & rc
End If
WScript.Quit rc
