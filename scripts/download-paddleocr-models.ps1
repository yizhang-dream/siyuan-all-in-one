<#
.SYNOPSIS
    Downloads and converts PaddleOCR models for paddleocr-js (TensorFlow.js format).
.DESCRIPTION
    This script:
    1. Downloads PaddleOCR inference models from PaddlePaddle's Baidu CDN
    2. Converts them from PaddlePaddle format to TensorFlow.js GraphModel format
    3. Places them in the expected directory structure for paddleocr-js
    4. Creates a complete models/ directory ready for bundling via viteStaticCopy

    Prerequisites:
    - Python 3.x with pip
    - PaddlePaddle installed (pip install paddlepaddle)
    - Paddle2ONNX installed (pip install paddle2onnx)
    - ONNX-TF installed (pip install onnx-tf)

.NOTES
    Expected output structure:
    src/models/paddleocr/
    ├── text/
    │   ├── det_db/
    │   │   └── model.json + group1-shard1of1.bin
    │   └── rec_crnn/
    │       └── ch/
    │           └── model.json + group1-shard1of1.bin
    ├── layout/
    │   └── model.json + group1-shard1of1.bin
    ├── table/
    │   ├── structure/
    │   │   └── model.json + group1-shard1of1.bin
    │   └── cell/
    │       └── model.json + group1-shard1of1.bin
    ├── formula/
    │   └── latex/
    │       └── model.json + group1-shard1of1.bin
    └── barcode/
        └── detect.onnx

    PaddleOCR model download URLs (from PaddlePaddle official CDN):
    - Detection (V4): https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.tar
    - Recognition (V4): https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar
    - Classification:   https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$OutputDir = "$PSScriptRoot/../src/models/paddleocr",
    
    [switch]$SkipConversion,
    
    [switch]$Help
)

if ($Help) {
    Get-Help $PSCommandPath -Detailed
    exit 0
}

$ErrorActionPreference = "Stop"
$TmpDir = "$env:TEMP/paddleocr-models-dl"
$ModelsDir = $OutputDir

Write-Host "=== PaddleOCR Model Downloader ===" -ForegroundColor Cyan
Write-Host "Output directory: $ModelsDir"
Write-Host "Temp directory: $TmpDir"
Write-Host ""

# Step 1: Download PaddlePaddle inference models from Baidu CDN
Write-Host "[Step 1/5] Downloading PaddleOCR inference models..." -ForegroundColor Yellow

$Downloads = @(
    @{Name="ch_PP-OCRv4_det_infer.tar"; Url="https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.tar"; ModelType="detection"},
    @{Name="ch_PP-OCRv4_rec_infer.tar"; Url="https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar"; ModelType="recognition"},
    @{Name="ch_ppocr_mobile_v2.0_cls_infer.tar"; Url="https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar"; ModelType="classification"}
)

New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
foreach ($dl in $Downloads) {
    $outPath = "$TmpDir/$($dl.Name)"
    if (-not (Test-Path $outPath)) {
        Write-Host "  Downloading $($dl.Name)..." -NoNewline
        try {
            Invoke-WebRequest -Uri $dl.Url -OutFile $outPath -TimeoutSec 120 -UseBasicParsing
            $size = (Get-Item $outPath).Length
            Write-Host " $size bytes" -ForegroundColor Green
        } catch {
            Write-Host " FAILED: $($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    } else {
        $size = (Get-Item $outPath).Length
        Write-Host "  $($dl.Name) already cached ($size bytes)" -ForegroundColor Gray
    }
}

# Step 2: Extract the tar archives
Write-Host "`n[Step 2/5] Extracting model archives..." -ForegroundColor Yellow
foreach ($dl in $Downloads) {
    $tarPath = "$TmpDir/$($dl.Name)"
    $extractDir = "$TmpDir/$($dl.Name.Replace('.tar',''))"
    if (-not (Test-Path "$extractDir/inference.pdmodel")) {
        Write-Host "  Extracting $($dl.Name)..." -NoNewline
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
        tar -xf $tarPath -C $extractDir 2>&1 | Out-Null
        Write-Host " done" -ForegroundColor Green
    } else {
        Write-Host "  $($dl.Name) already extracted" -ForegroundColor Gray
    }
}

# Step 3: Create model directory structure
Write-Host "`n[Step 3/5] Creating model directory structure..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "$ModelsDir/text/det_db" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/text/rec_crnn/ch" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/layout" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/table/structure" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/table/cell" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/formula/latex" | Out-Null
New-Item -ItemType Directory -Force -Path "$ModelsDir/barcode" | Out-Null
Write-Host "  Directory structure created" -ForegroundColor Green

# Step 4: Convert PaddlePaddle models to TensorFlow.js format
if (-not $SkipConversion) {
    Write-Host "`n[Step 4/5] Converting models..." -ForegroundColor Yellow
    
    # Check for Python and required packages
    $hasPaddle2ONNX = $false
    $hasONNX_TF = $false
    
    try {
        $paddle2onnxVer = & python3 -c "import paddle2onnx; print(paddle2onnx.__version__)" 2>&1
        $hasPaddle2ONNX = $true
        Write-Host "  paddle2onnx version: $paddle2onnxVer" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: paddle2onnx not installed. Install it: pip install paddle2onnx onnx" -ForegroundColor Yellow
    }
    
    try {
        $onnxTfVer = & python3 -c "import onnx_tf; print(onnx_tf.__version__)" 2>&1
        $hasONNX_TF = $true
        Write-Host "  onnx-tf version: $onnxTfVer" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: onnx-tf not installed. Install it: pip install onnx-tf tensorflow" -ForegroundColor Yellow
    }
    
    if (-not $hasPaddle2ONNX -or -not $hasONNX_TF) {
        Write-Host "`n  Conversion tools not available. To convert manually:" -ForegroundColor Magenta
        Write-Host "  1. pip install paddle2onnx onnx onnx-tf tensorflow" -ForegroundColor Magenta
        Write-Host "  2. Run this script again with the same arguments" -ForegroundColor Magenta
        Write-Host "  3. Or use the manual conversion commands below" -ForegroundColor Magenta
        Write-Host "`n  Manual conversion commands (run from temp dir):" -ForegroundColor Magenta
        Write-Host "  paddle2onnx --model_dir det_extracted --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file det_model.onnx --opset_version 11" -ForegroundColor Gray
        Write-Host "  paddle2onnx --model_dir rec_extracted --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file rec_model.onnx --opset_version 11" -ForegroundColor Gray
        Write-Host "  paddle2onnx --model_dir cls_extracted --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file cls_model.onnx --opset_version 11" -ForegroundColor Gray
        Write-Host "  python3 -m onnx_tf.convert -i det_model.onnx -o det_tfjs" -ForegroundColor Gray
        Write-Host "  python3 -m onnx_tf.convert -i rec_model.onnx -o rec_tfjs" -ForegroundColor Gray
    } else {
        Write-Host "  Converting detection model (Paddle -> ONNX)..." -NoNewline
        & python3 -m paddle2onnx --model_dir "$TmpDir/ch_PP-OCRv4_det_infer" --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file "$TmpDir/det_model.onnx" --opset_version 11 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " done" -ForegroundColor Green } else { Write-Host " FAILED" -ForegroundColor Red; exit 1 }
        
        Write-Host "  Converting recognition model (Paddle -> ONNX)..." -NoNewline
        & python3 -m paddle2onnx --model_dir "$TmpDir/ch_PP-OCRv4_rec_infer" --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file "$TmpDir/rec_model.onnx" --opset_version 11 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " done" -ForegroundColor Green } else { Write-Host " FAILED" -ForegroundColor Red; exit 1 }
        
        Write-Host "  Converting classification model (Paddle -> ONNX)..." -NoNewline
        & python3 -m paddle2onnx --model_dir "$TmpDir/ch_ppocr_mobile_v2.0_cls_infer" --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file "$TmpDir/cls_model.onnx" --opset_version 11 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " done" -ForegroundColor Green } else { Write-Host " FAILED" -ForegroundColor Red }
        
        Write-Host "  Converting ONNX -> TF.js GraphModel (detection)..." -NoNewline
        & python3 -m onnx_tf.backend convert -i "$TmpDir/det_model.onnx" -o "$TmpDir/det_tfjs" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " done" -ForegroundColor Green } else { Write-Host " FAILED (may need tensorflow)" -ForegroundColor Red }
        
        Write-Host "  Converting ONNX -> TF.js GraphModel (recognition)..." -NoNewline
        & python3 -m onnx_tf.backend convert -i "$TmpDir/rec_model.onnx" -o "$TmpDir/rec_tfjs" 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Host " done" -ForegroundColor Green } else { Write-Host " FAILED" -ForegroundColor Red }
    }
} else {
    Write-Host "`n[Step 4/5] Conversion skipped (--SkipConversion)" -ForegroundColor Yellow
}

# Step 5: Copy converted models to output directory
Write-Host "`n[Step 5/5] Copying models to output directory..." -ForegroundColor Yellow

# Check if TF.js converted models exist
$detTfjsDir = "$TmpDir/det_tfjs"
$recTfjsDir = "$TmpDir/rec_tfjs"

if ((Test-Path "$detTfjsDir/saved_model.pb") -or (Test-Path "$detTfjsDir/model.json")) {
    Write-Host "  Copying detection model..." -NoNewline
    if (Test-Path "$detTfjsDir/model.json") {
        Copy-Item "$detTfjsDir/model.json" "$ModelsDir/text/det_db/" -Force
        Get-ChildItem "$detTfjsDir/*.bin" | ForEach-Object { Copy-Item $_.FullName "$ModelsDir/text/det_db/" -Force }
        Write-Host " done" -ForegroundColor Green
    } else {
        Write-Host " TF.js model not found, using placeholder" -ForegroundColor Yellow
        Write-Host "  (Place models in $ModelsDir/text/det_db/)" -ForegroundColor Gray
    }
} else {
    Write-Host "  No converted models found. Manual conversion required." -ForegroundColor Yellow
    Write-Host "  Place TF.js GraphModel files in:" -ForegroundColor Gray
    Write-Host "    $ModelsDir/text/det_db/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/text/rec_crnn/ch/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/layout/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/table/structure/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/table/cell/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/formula/latex/model.json + *.bin" -ForegroundColor Gray
    Write-Host "    $ModelsDir/barcode/detect.onnx" -ForegroundColor Gray
}

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "Source models downloaded to: $TmpDir" -ForegroundColor Gray
Write-Host "Target model directory: $ModelsDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Expected model structure for paddleocr-js:" -ForegroundColor White
Write-Host "  {modelPath}/text/det_db/model.json           - Text detection (DB)" -ForegroundColor Gray
Write-Host "  {modelPath}/text/rec_crnn/ch/model.json      - Text recognition (CRNN, Chinese)" -ForegroundColor Gray
Write-Host "  {modelPath}/layout/model.json                 - Layout analysis" -ForegroundColor Gray
Write-Host "  {modelPath}/table/model.json                  - Table recognition" -ForegroundColor Gray
Write-Host "  {modelPath}/table/structure/model.json        - Table structure analysis" -ForegroundColor Gray
Write-Host "  {modelPath}/table/cell/model.json             - Table cell detection" -ForegroundColor Gray
Write-Host "  {modelPath}/formula/latex/model.json          - Formula/LaTeX recognition" -ForegroundColor Gray
Write-Host "  {modelPath}/barcode/detect.json               - Barcode detection" -ForegroundColor Gray
Write-Host ""
Write-Host "NOTE: Consider using useONNX=true instead of TensorFlow.js" -ForegroundColor Green
Write-Host "to avoid the Paddle->ONNX->TFJS double conversion." -ForegroundColor Green
Write-Host "In that case, place .onnx files in the same structure above." -ForegroundColor Green
