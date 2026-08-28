# =============================================
#  servidor.ps1 - servidor local para testar o app
# =============================================
#  Nao precisa de Python, nem de Node, nem instalar nada.
#  Usa so o que o Windows ja tem.
#  Para parar: feche a janela ou aperte Ctrl+C.
# =============================================

$porta = 8000
$raiz  = $PSScriptRoot
if (-not $raiz) { $raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition }

$tipos = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".md"   = "text/markdown; charset=utf-8"
  ".csv"  = "text/csv; charset=utf-8"
  ".png"  = "image/png"
  ".webp" = "image/webp"
  ".ico"  = "image/x-icon"
  ".svg"  = "image/svg+xml"
}

try {
  $srv = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $porta)
  $srv.Start()
} catch {
  Write-Host ""
  Write-Host "  Nao consegui abrir a porta $porta." -ForegroundColor Red
  Write-Host "  Provavelmente ja tem outro servidor rodando nela."
  Write-Host "  Feche a outra janela e tente de novo."
  Write-Host ""
  Read-Host "Aperte Enter para sair"
  exit 1
}

Write-Host ""
Write-Host "  Servidor no ar." -ForegroundColor Green
Write-Host "  Pasta: $raiz"
Write-Host ""
Write-Host "  Abra no navegador:  http://localhost:$porta" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Para parar: feche esta janela."
Write-Host ""

Start-Process "http://localhost:$porta/index.html"

while ($true) {
  $cliente = $srv.AcceptTcpClient()
  try {
    $fluxo  = $cliente.GetStream()
    $leitor = New-Object System.IO.StreamReader($fluxo)

    $pedido = $leitor.ReadLine()
    if (-not $pedido) { $cliente.Close(); continue }
    while ($true) { $h = $leitor.ReadLine(); if ($h -eq "" -or $null -eq $h) { break } }

    $rota = ($pedido -split ' ')[1]
    $rota = ($rota -split '\?')[0]
    $rota = [Uri]::UnescapeDataString($rota).TrimStart('/')
    if ($rota -eq '') { $rota = 'index.html' }
    $rota = $rota -replace '/', '\'

    $arquivo = [IO.Path]::GetFullPath((Join-Path $raiz $rota))
    $dentro  = $arquivo.StartsWith([IO.Path]::GetFullPath($raiz), [StringComparison]::OrdinalIgnoreCase)

    if ($dentro -and (Test-Path $arquivo -PathType Leaf)) {
      $ext   = [IO.Path]::GetExtension($arquivo).ToLower()
      $tipo  = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { "application/octet-stream" }
      $corpo = [IO.File]::ReadAllBytes($arquivo)
      $status = "200 OK"
      Write-Host "  200  /$($rota -replace '\\','/')" -ForegroundColor DarkGray
    } else {
      $tipo   = "text/plain; charset=utf-8"
      $corpo  = [Text.Encoding]::UTF8.GetBytes("404 - nao encontrado: $rota")
      $status = "404 Not Found"
      Write-Host "  404  /$($rota -replace '\\','/')" -ForegroundColor DarkYellow
    }

    $cabecalho = "HTTP/1.1 $status`r`n" +
                 "Content-Type: $tipo`r`n" +
                 "Content-Length: $($corpo.Length)`r`n" +
                 "Cache-Control: no-store`r`n" +
                 "Connection: close`r`n`r`n"
    $bytesCab = [Text.Encoding]::ASCII.GetBytes($cabecalho)
    $fluxo.Write($bytesCab, 0, $bytesCab.Length)
    $fluxo.Write($corpo, 0, $corpo.Length)
    $fluxo.Flush()
  } catch {
    # conexao caiu no meio - segue para a proxima
  } finally {
    $cliente.Close()
  }
}
