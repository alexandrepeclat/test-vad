Write-Host "Converting WAV files to MP3 with loudness normalization..."

$DATA_DIR = ".\data"
$FFMPEG = "ffmpeg"

# Lookup for all WAV files in data
$files = Get-ChildItem $DATA_DIR -Filter *.wav

foreach ($f in $files) {

    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)

    $mp3_out = Join-Path $DATA_DIR "$($base).mp3"

    # CONVERSION + LOUDNESS NORMALIZATION
    if (!(Test-Path $mp3_out)) {

        Write-Host "Converting $($f.Name) → $($base).mp3"

        # -------------------------------------------------
        # loudnorm params (EBU R128)
        #
        # I   = Integrated loudness (target volume)
        #       -16 LUFS = standard podcast / YouTube level
        #
        # TP  = True Peak (max peak after encoding)
        #       -1.5 dB = avoids clipping (especially MP3)
        #
        # LRA = Loudness Range (dynamic range)
        #       11 = natural voice dynamics (not too compressed)
        # -------------------------------------------------

        & $FFMPEG -i "$($f.FullName)" `
            -af "loudnorm=I=-16:TP=-1.5:LRA=11" `
            -vn -acodec libmp3lame -b:a 192k `
            "$mp3_out"
    }
}

Write-Host "Done!"