Write-Host "Converting WAV files to MP3 with loudness normalization..."

$DATA_DIR = ".\data"
$FFMPEG = "ffmpeg"

# Get all WAV files recursively
$files = Get-ChildItem $DATA_DIR -Recurse -Filter *.wav

foreach ($f in $files) {

    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)

    # Output MP3 in the SAME folder as the source file
    $mp3_out = Join-Path $f.DirectoryName "$base.mp3"

    # Skip if already exists
    if (!(Test-Path $mp3_out)) {

        Write-Host "Converting $($f.FullName) → $mp3_out"

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
            -hide_banner -loglevel info `
            -af "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=16000,pan=mono|c0=0.5*c0+0.5*c1" `
            -vn -acodec libmp3lame -b:a 128k `
            "$mp3_out"
    }
}

Write-Host "Done!"