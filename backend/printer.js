const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PRINTER_NAME = '4BARCODE 3B-365B';

function printRaw(data) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `label_${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, data, 'ascii');

    const ps = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LabelPrinter {
    [StructLayout(LayoutKind.Sequential)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    public static bool SendRaw(string printerName, byte[] data) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
        DOCINFOA di = new DOCINFOA() { pDocName = "PAPELUAN Labels", pDataType = "RAW" };
        StartDocPrinter(hPrinter, 1, di);
        StartPagePrinter(hPrinter);
        IntPtr p = Marshal.AllocCoTaskMem(data.Length);
        Marshal.Copy(data, 0, p, data.Length);
        int w; WritePrinter(hPrinter, p, data.Length, out w);
        Marshal.FreeCoTaskMem(p);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);
        return true;
    }
}
'@
$data = [System.IO.File]::ReadAllBytes("${tmpFile.replace(/\\/g, '\\\\')}")
$result = [LabelPrinter]::SendRaw("${PRINTER_NAME}", $data)
if ($result) { Write-Output "OK" } else { Write-Error "FAIL" }
`;

    execFile('powershell.exe', ['-NoProfile', '-Command', ps], (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}

      if (err) return reject(new Error(stderr || err.message));
      if (stdout.trim() === 'OK') return resolve();
      reject(new Error('No se pudo enviar a la impresora'));
    });
  });
}

module.exports = { printRaw, PRINTER_NAME };
