# DNS Propagation Monitor
# Checks DNS every 30 minutes for up to 5 hours

$domain = "captured.thecatalyst.dev"
$correctIP = "167.99.112.163"
$oldIP = "68.66.226.94"
$checkInterval = 60    # 1 minute in seconds
$maxChecks = 300       # 5 hours = 300 checks

Write-Host "Starting DNS propagation monitor for $domain" -ForegroundColor Cyan
Write-Host "Checking every minute for up to 5 hours..." -ForegroundColor Cyan
Write-Host ""

for ($i = 1; $i -le $maxChecks; $i++) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] Check $i/$maxChecks" -ForegroundColor Yellow
    
    # Run nslookup and capture output
    $result = nslookup $domain 8.8.8.8 2>&1 | Out-String
    
    # Check if old IP is still present
    $hasOldIP = $result -match [regex]::Escape($oldIP)
    $hasCorrectIP = $result -match [regex]::Escape($correctIP)
    
    if ($hasCorrectIP -and -not $hasOldIP) {
        # SUCCESS - Only correct IP found
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "   ___  _   _  ___ ___ ___  ___ ___ " -ForegroundColor Green
        Write-Host "  / __|| | | |/ __/ __/ _ \/ __/ __|" -ForegroundColor Green
        Write-Host "  \__ \| |_| | (_| (_|  __/\__ \__ \" -ForegroundColor Green
        Write-Host "  |___/ \___/ \___\___\___||___/___/" -ForegroundColor Green
        Write-Host "" -ForegroundColor Green
        Write-Host "  DNS PROPAGATION COMPLETE!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "Domain: $domain" -ForegroundColor White
        Write-Host "Resolved to: $correctIP" -ForegroundColor White
        Write-Host "Old IP ($oldIP) is no longer cached" -ForegroundColor White
        Write-Host ""
        Write-Host "Ready to run Certbot:" -ForegroundColor Cyan
        Write-Host 'ssh -i "$env:USERPROFILE\.ssh\catalyst_capture_dev" root@167.99.112.163 "certbot --nginx -d captured.thecatalyst.dev --non-interactive --agree-tos --email admin@thecatalyst.dev --redirect"' -ForegroundColor Gray
        
        # Play system beep
        [Console]::Beep(800, 200)
        [Console]::Beep(1000, 200)
        [Console]::Beep(1200, 400)
        
        exit 0
    }
    elseif ($hasCorrectIP -and $hasOldIP) {
        Write-Host "  Status: Both IPs still resolving ($correctIP and $oldIP)" -ForegroundColor Red
        Write-Host "  Action: Waiting for old IP to expire from cache..." -ForegroundColor Yellow
    }
    else {
        Write-Host "  Status: Unexpected DNS response" -ForegroundColor Red
        Write-Host "  Response: $result" -ForegroundColor Gray
    }
    
    if ($i -lt $maxChecks) {
        Write-Host "  Next check in 1 minute..." -ForegroundColor DarkGray
        Write-Host ""
        Start-Sleep -Seconds $checkInterval
    }
}

# Max time reached
Write-Host ""
Write-Host "========================================" -ForegroundColor Red
Write-Host "  TIMEOUT: 5 hours elapsed" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host "DNS propagation not complete after $maxChecks checks." -ForegroundColor Yellow
Write-Host "You may need to verify your DNS configuration or wait longer." -ForegroundColor Yellow
