# image-preview host helper (Windows PowerShell 5.1, run with -STA).
#
#   -Mode decode     stdin: base64 image (png, jpeg, gif, bmp)
#                    stdout: "<origW> <origH> <w> <h>" newline, then base64 BGRA
#                    pixels scaled to fit inside -Max x -Max
#   -Mode clipboard  stdout: base64 PNG of the clipboard image; exit 3 when
#                    the clipboard holds no image, exit 4 when it stays locked
param(
  [Parameter(Mandatory = $true)][ValidateSet('decode', 'clipboard')][string]$Mode,
  [int]$Max = 400
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if ($Mode -eq 'clipboard') {
  Add-Type -AssemblyName System.Windows.Forms
  # Another program may hold the clipboard for a moment right after a paste.
  $image = $null
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try { $image = [System.Windows.Forms.Clipboard]::GetImage(); break }
    catch [System.Runtime.InteropServices.ExternalException] {
      if ($attempt -eq 5) { [Console]::Error.Write('clipboard is locked'); exit 4 }
      Start-Sleep -Milliseconds 100
    }
  }
  if ($null -eq $image) { exit 3 }
  $png = New-Object System.IO.MemoryStream
  $image.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
  [Console]::Out.Write([Convert]::ToBase64String($png.ToArray()))
  exit 0
}

$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$source = [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))

$scale = [Math]::Min(1.0, [Math]::Min($Max / $source.Width, $Max / $source.Height))
$width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
$height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))

$format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
$bitmap = New-Object System.Drawing.Bitmap($width, $height, $format)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($source, 0, 0, $width, $height)
$graphics.Dispose()

$rect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
$data = $bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $format)
$pixels = New-Object byte[] ($width * $height * 4)
for ($y = 0; $y -lt $height; $y++) {
  $row = [IntPtr]::Add($data.Scan0, $y * $data.Stride)
  [System.Runtime.InteropServices.Marshal]::Copy($row, $pixels, $y * $width * 4, $width * 4)
}
$bitmap.UnlockBits($data)

[Console]::Out.Write("$($source.Width) $($source.Height) $width $height`n")
[Console]::Out.Write([Convert]::ToBase64String($pixels))
