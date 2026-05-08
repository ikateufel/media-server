; Inno Setup 6 — https://jrsoftware.org/isinfo.php
;
; ANTES DE COMPILAR ESTE SCRIPT:
;   1. Na raiz do projecto: npm ci && npm run build
;   2. Garante que existe a pasta .output\ com o servidor Nitro.
;   3. Abre este ficheiro no Inno Setup Compiler e faz Build > Compile.
;
; O instalador copia apenas .output + launcher; Node.js deve estar instalado no PC de destino (>= 22).

#define MyAppName "Reprodutor de vídeo"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Video Player"
#define MyAppExeName "start-video-player.cmd"

#define SourceRoot "..\\.."

[Setup]
AppId={{A7E3F9B2-4C1D-4E8A-9F2B-3C5D7E9A1B2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\VideoPlayer
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=VideoPlayer-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Opcional: idioma PT — descomenta se tiveres Portuguese.isl no Inno Setup
; [Languages]
; Name: "portuguese"; MessagesFile: "compiler:Languages\Portuguese.isl"

[Files]
; Build Nuxt/Nitro (obrigatório)
Source: "{#SourceRoot}\.output\*"; DestDir: "{app}\.output"; Flags: ignoreversion recursesubdirs createallsubdirs

; Launcher e exemplo de configuração
Source: "start-video-player.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: ".env.installer.example"; DestDir: "{app}"; DestName: "env.example.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho no Ambiente de trabalho"; GroupDescription: "Atalhos:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Iniciar o servidor agora"; Flags: nowait postinstall skipifsilent shellexec
