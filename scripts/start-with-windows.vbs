' Arranque do servidor sem janela de consola (log em data\startup-server.log).

Dim sh, fso, scriptDir, rootDir, logDir, logPath, errPath, rc, cmd

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
sh.CurrentDirectory = rootDir

logPath = fso.BuildPath(rootDir, "data\startup-server.log")
errPath = fso.BuildPath(rootDir, "data\startup-error.log")

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
  If Right(current, 1) = ":" Then
    current = current & "\"
  End If

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

AppendLog logPath, "boot: a arrancar"

If Not fso.FolderExists(fso.BuildPath(rootDir, "node_modules")) Then
  AppendLog logPath, "node_modules em falta. A correr npm install..."
  cmd = "cmd /c npm install >> " & Q(logPath) & " 2>&1"
  rc = sh.Run(cmd, 0, True)
  If rc <> 0 Then
    AppendLog errPath, "[" & Now & "] npm install falhou."
    WScript.Quit 1
  End If
End If

If Not fso.FileExists(fso.BuildPath(rootDir, ".output\server\index.mjs")) Then
  AppendLog logPath, "build em falta. A correr npm run build..."
  cmd = "cmd /c npm run build >> " & Q(logPath) & " 2>&1"
  rc = sh.Run(cmd, 0, True)
  If rc <> 0 Then
    AppendLog errPath, "[" & Now & "] build falhou."
    WScript.Quit 1
  End If
End If

AppendLog logPath, "a iniciar npm run start (segundo plano — sem esperar pelo processo)"
cmd = "cmd /c npm run start >> " & Q(logPath) & " 2>&1"
sh.Run cmd, 0, False
WScript.Quit 0
