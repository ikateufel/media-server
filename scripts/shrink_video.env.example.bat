@echo off
rem Copiar para shrink_video.env.bat na pasta da biblioteca (ex.: H:\temp\note_h\downloaded\)
rem ou ao lado de uma copia local de shrink_video.bat.
rem O shrink_video.bat carrega este ficheiro automaticamente.
rem
rem NOTA: nao precisa criar este ficheiro se o shrink_video.bat estiver dentro da pasta scripts/
rem do projecto — o .bat usa o caminho relativo (%~dp0..) para achar a raiz automaticamente.
rem So crie se tiver copiado o shrink_video.bat para outro local (ex.: na pasta da biblioteca).
rem Nesse caso, aponte VIDEO_PLAYER_ROOT para a raiz do projecto video_player.
rem
rem Exemplo (substitua pelo caminho real do seu projecto):
rem   set "VIDEO_PLAYER_ROOT=C:\caminho\para\video_player"
