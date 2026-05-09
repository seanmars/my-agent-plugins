#:property TargetFramework=net10.0-windows10.0.19041.0
#:package System.Drawing.Common@9.0.0

using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;

if (args.Length > 0 && args[0] is "-h" or "--help")
{
    Console.WriteLine("Usage: dotnet run make-icon.cs -- [output] [letter]");
    Console.WriteLine("  output   Output .ico path (default: app.ico)");
    Console.WriteLine("  letter   Single character drawn on the icon (default: N)");
    return 0;
}

var output = args.Length > 0 ? args[0] : "app.ico";
var letter = args.Length > 1 ? args[1] : "P";

int[] sizes = [16, 32, 48, 64, 128, 256];
var pngs = new byte[sizes.Length][];

for (int i = 0; i < sizes.Length; i++)
{
    int s = sizes[i];
    using var bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb);
    using (var g = Graphics.FromImage(bmp))
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAlias;
        g.Clear(Color.Transparent);

        var rect = new Rectangle(0, 0, s, s);
        using var brush = new LinearGradientBrush(
            rect,
            Color.FromArgb(255, 79, 70, 229),
            Color.FromArgb(255, 6, 182, 212),
            45f);
        g.FillEllipse(brush, 1, 1, s - 2, s - 2);

        float fontSize = s * 0.55f;
        using var font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
        using var sf = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center
        };
        g.DrawString(letter, font, Brushes.White, new RectangleF(0, 0, s, s), sf);
    }

    using var ms = new MemoryStream();
    bmp.Save(ms, ImageFormat.Png);
    pngs[i] = ms.ToArray();
}

using var fs = File.Create(output);
using var w = new BinaryWriter(fs);

// ICONDIR
w.Write((ushort)0);              // reserved
w.Write((ushort)1);              // type: 1 = icon
w.Write((ushort)sizes.Length);   // image count

// ICONDIRENTRY array
int dataOffset = 6 + sizes.Length * 16;
for (int i = 0; i < sizes.Length; i++)
{
    int s = sizes[i];
    w.Write((byte)(s >= 256 ? 0 : s));   // width (0 means 256)
    w.Write((byte)(s >= 256 ? 0 : s));   // height
    w.Write((byte)0);                    // palette colors
    w.Write((byte)0);                    // reserved
    w.Write((ushort)1);                  // planes
    w.Write((ushort)32);                 // bits per pixel
    w.Write((uint)pngs[i].Length);       // size of image data
    w.Write((uint)dataOffset);           // offset
    dataOffset += pngs[i].Length;
}

foreach (var data in pngs)
    w.Write(data);

var info = new FileInfo(output);
Console.WriteLine($"Wrote {info.FullName}");
Console.WriteLine($"  Sizes:  {string.Join(", ", sizes)}");
Console.WriteLine($"  Letter: {letter}");
Console.WriteLine($"  Bytes:  {info.Length:N0}");
return 0;
