#!/usr/bin/env python3
"""驗證碼 OCR：ddddocr + 多種前處理投票。

用法：
    python scripts/ocr.py <image.png>
    python scripts/ocr.py <image.png> --json

沒安裝 ddddocr 時 exit code = 2（Node 端會自動退回人工輸入）。
"""
import io
import json
import sys

DIGIT_MAP = str.maketrans({
    "o": "0", "O": "0", "l": "1", "I": "1", "i": "1", "s": "5", "S": "5",
    "b": "8", "B": "8", "z": "2", "Z": "2", "g": "6", "G": "6", "q": "9",
    "Q": "9", "a": "4", "A": "4", "d": "0", "D": "0", "T": "7", "t": "7",
})


def normalize(text: str) -> str:
    """只留英數；若數字佔多數，把常見誤判字母轉成數字。"""
    t = "".join(ch for ch in (text or "") if ch.isalnum())
    if not t:
        return ""
    digits = sum(ch.isdigit() for ch in t)
    if digits * 2 >= len(t):
        t = t.translate(DIGIT_MAP)
        t = "".join(ch for ch in t if ch.isdigit())
    return t


def to_png(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: ocr.py <image> [--json]", file=sys.stderr)
        return 1
    path = sys.argv[1]
    want_json = "--json" in sys.argv[2:]

    try:
        import ddddocr
    except Exception as exc:  # noqa: BLE001
        print(f"ddddocr unavailable: {exc}", file=sys.stderr)
        return 2

    with open(path, "rb") as fh:
        raw = fh.read()

    variants = [raw]
    try:
        from PIL import Image, ImageOps

        img = Image.open(io.BytesIO(raw)).convert("L")
        if img.width < 200:
            for scale in (2, 3):
                variants.append(to_png(img.resize((img.width * scale, img.height * scale), Image.LANCZOS)))
        variants.append(to_png(ImageOps.autocontrast(img)))
        variants.append(to_png(img.point(lambda p: 0 if p < 140 else 255)))
    except Exception:
        pass

    try:
        ocr = ddddocr.DdddOcr(show_ad=False)
    except Exception as exc:  # noqa: BLE001
        print(f"ddddocr init failed: {exc}", file=sys.stderr)
        return 2

    votes = {}
    for data in variants:
        try:
            text = normalize(ocr.classification(data))
        except Exception:
            continue
        if text:
            votes[text] = votes.get(text, 0) + 1

    if not votes:
        return 3

    best = max(votes.items(), key=lambda kv: (kv[1], len(kv[0])))[0]
    if want_json:
        print(json.dumps({"code": best, "votes": votes}, ensure_ascii=False))
    else:
        print(best)
    return 0


if __name__ == "__main__":
    sys.exit(main())
