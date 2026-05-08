' Arranque do servidor sem janela de consola (log em data\startup-server.log).

Dim sh, fso, scriptDir, rootDir, logPath, errPath, rc, cmd

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)
sh.CurrentDirectory = rootDir

logPath = fso.BuildPath(rootDir, "data\startup-server.log")
errPath = fso.BuildPath(rootDir, "data\startup-error.log")

If Not fso.FolderExists(fso.BuildPath(rootDir, "data")) Then
  fso.CreateFolder fso.BuildPath(rootDir, "data")
End If

Sub AppendLog(path, msg)
  Dim f
  Set f = fso.OpenTextFile(path, 8, True)
  f.WriteLine "[" & Now & "] " & msg
  f.Close
End Sub

Function Q(p)
  Q = Chr(34) & p & Chr(34)
End Function

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
