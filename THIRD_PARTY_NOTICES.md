# Third-party notices

The card-recognition pipeline can load the following open-source components at runtime. They are not user photos and are not uploaded by this repository.

## PP-OCRv6 browser SDK and models

- Project: `web-sdk-PP-OCRv6` / PaddleOCR PP-OCRv6 Small
- SDK version used: `0.2.0`
- License: Apache License 2.0
- Purpose: local browser OCR (text detection + recognition)
- Distribution: the pinned SDK/model assets are downloaded by the browser and cached locally by the SDK; inference runs in the browser.

Upstream: https://github.com/chenmohan123/web-sdk-PP-OCRv6

## CollectorVision Cornelius

- Project: CollectorVision
- Model: `cornelius.onnx`
- Pinned revision: `fa7aa3ed896bcb326d7ea218c61ea7289d06803b`
- Upstream license: GNU Affero General Public License v3.0 (CollectorVision also advertises a separate commercial license)
- Purpose: local browser card-corner detection only
- Distribution: this repository does **not** copy or redistribute the Cornelius binary. The browser downloads the pinned upstream model at runtime and caches it locally; inference runs in the browser.

Upstream: https://github.com/HanClinto/CollectorVision

## ONNX Runtime Web

- Project: Microsoft ONNX Runtime Web
- License: MIT
- Purpose: local ONNX inference in the browser.
