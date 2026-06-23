# PaddleOCR Model Files (Placeholder)

This directory is where PaddleOCR model files must be placed for offline OCR.

## Required Model Structure

```
src/models/paddleocr/
├── text/
│   ├── det_db/
│   │   └── model.json + *.bin
│   └── rec_crnn/
│       └── ch/
│           └── model.json + *.bin
├── layout/
│   └── model.json + *.bin
├── table/
│   ├── structure/
│   │   └── model.json + *.bin
│   └── cell/
│       └── model.json + *.bin
├── formula/
│   └── latex/
│       └── model.json + *.bin
└── barcode/
    └── detect.json + *.bin
```

## How to Download and Convert

Run the helper script:

```powershell
.\scripts\download-paddleocr-models.ps1
```

This will:
1. Download PaddleOCR inference models from Baidu CDN (PaddlePaddle format)
2. Convert them to TensorFlow.js GraphModel format (requires Python with paddle2onnx, onnx-tf, tensorflow)
3. Place them in this directory

## Manual Conversion Steps

If the automatic script fails, follow these steps:

### Prerequisites
```bash
pip install paddlepaddle paddle2onnx onnx onnx-tf tensorflow
```

### 1. Download PaddleOCR inference models
```bash
# Detection (V4, 4.7MB)
curl -O https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.tar
# Recognition (V4, 10MB)
curl -O https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar
# Classification (2MB)
curl -O https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar
```

### 2. Extract and convert each model
```bash
# Paddle → ONNX
paddle2onnx --model_dir det_extracted --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file det_model.onnx --opset_version 11
paddle2onnx --model_dir rec_extracted --model_filename inference.pdmodel --params_filename inference.pdiparams --save_file rec_model.onnx --opset_version 11

# ONNX → TF.js GraphModel
python3 -m onnx_tf.convert -i det_model.onnx -o src/models/paddleocr/text/det_db/
python3 -m onnx_tf.convert -i rec_model.onnx -o src/models/paddleocr/text/rec_crnn/ch/
```

### 3. Create placeholder models for optional features
For layout, table, formula, and barcode models, create minimal model.json files or use the detection/recognition models as placeholders.

## Total Size

The full model bundle is approximately 112MB when properly converted.
