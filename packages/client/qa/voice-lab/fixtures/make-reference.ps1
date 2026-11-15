# Gera o áudio de referência do laboratório de voz com a voz PT-BR do Windows
# (Microsoft Maria Desktop), 48 kHz, mono, 16-bit. Determinístico na mesma máquina.
# O .wav fica fora do git (ver .gitignore); rode este script uma vez.
#
#   powershell -File make-reference.ps1 [-Out ref-ptbr-48k.wav]
param(
  [string]$Out = (Join-Path $PSScriptRoot "ref-ptbr-48k.wav"),
  [string]$Voice = "Microsoft Maria Desktop"
)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice($Voice) } catch { Write-Warning "voz '$Voice' ausente; usando a padrão" }
$s.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($Out, $fmt)
$texto = @"
Boa tarde, pessoal. Este é o áudio de referência para o teste de voz do Muchat.
Vou falar frases curtas e longas, com pausas, para medir cortes, atrasos e distorção.
Primeira frase: o pato nadou no lago enquanto o gato dormia no telhado.
Segunda frase: trinta e três tigres tristes comem trigo em três pratos de trigo.
Agora uma pausa mais longa.
Palavras com consoantes explosivas: pato, bate, cabo, tapa, pipoca, tatu, cacto.
Sibilantes: sessenta e seis sapos, cesta de cerejas, sossego, sussurro.
Números: um, dois, três, quatro, cinco, seis, sete, oito, nove, dez.
Frase longa sem pausa para testar o portão de voz e a continuidade da fala durante vários segundos seguidos sem nenhuma interrupção perceptível no fluxo das palavras.
Fala baixa e rápida, como quem comenta algo de lado.
Fim do bloco. Repetindo o bloco mais uma vez.
Boa tarde, pessoal. Este é o áudio de referência para o teste de voz do Muchat.
Primeira frase: o pato nadou no lago enquanto o gato dormia no telhado.
Palavras com consoantes explosivas: pato, bate, cabo, tapa, pipoca, tatu, cacto.
Números: um, dois, três, quatro, cinco, seis, sete, oito, nove, dez.
Fim da gravação de referência.
"@
$s.Speak($texto)
$s.SetOutputToNull()
$s.Dispose()
$f = Get-Item $Out
"gerado: $Out ($($f.Length) bytes, ~$([math]::Round(($f.Length-44)/96000,1)) s)"
