#Requires -Version 5.1
# Compara tamanhos origem/saida (int64). Env: VP_ORIG_BYTES, VP_OUT_BYTES
# Exit 0 = reducao OK (<=70% do original)
# Exit 1 = reducao insuficiente, pode retry qualidade
# Exit 2 = saida invalida/pequena demais (nao fazer retry qualidade)
$orig = 0L
$out = 0L
[void][long]::TryParse($env:VP_ORIG_BYTES, [ref]$orig)
[void][long]::TryParse($env:VP_OUT_BYTES, [ref]$out)

if ($orig -le 0 -or $out -le 0) { exit 2 }

$maxOk = [long][math]::Floor($orig * 0.70)
$minValid = [long][math]::Max(1L, [long][math]::Floor($orig * 0.05))

if ($out -lt $minValid) { exit 2 }

$tooSmall = [long][math]::Floor($orig * 0.40)
if ($out -lt $tooSmall) { exit 2 }

if ($out -le $maxOk) { exit 0 }
exit 1
