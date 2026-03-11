# Wealth Support — ゴールベース資産形成アドバイザー

学生・20代向けのゴールベース資産形成アドバイザー。
「いつまでにいくら欲しいか」を入力すると、ポートフォリオ提案とシナリオ分析を返します。

---

## 技術スタック

| 層 | 技術 |
|---|---|
| フロントエンド | Next.js 14 (App Router) + TypeScript + Tailwind CSS + Recharts |
| バックエンド | Python FastAPI + yfinance |
| AI | Anthropic API (claude-sonnet-4-5) |

---

## ディレクトリ構成

```
wealth-support/
├── frontend/          # Next.js アプリ
│   ├── app/           # App Router
│   ├── components/    # UI コンポーネント
│   └── types/         # TypeScript 型定義
├── backend/           # FastAPI サーバー
│   ├── main.py
│   ├── requirements.txt
│   └── .env
└── README.md
```

---

## セットアップ & 起動手順

### 前提条件

- Node.js 18+ / npm
- Python 3.11+
- Anthropic API キー

---

### 1. バックエンド（FastAPI）

```bash
cd wealth-support/backend

# 仮想環境を作成・有効化
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# 依存パッケージをインストール
pip install -r requirements.txt

# サーバーを起動（port 8000）
uvicorn main:app --reload
```

ブラウザで http://localhost:8000/docs を開くと Swagger UI が確認できます。

---

### 2. フロントエンド（Next.js）

別ターミナルを開いて:

```bash
cd wealth-support/frontend

# 依存パッケージをインストール
npm install

# 開発サーバーを起動（port 3000）
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

---

## 環境変数

### backend/.env

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

### frontend/.env.local

```
ANTHROPIC_API_KEY=sk-ant-api03-...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## API 仕様

### `POST /api/simulate`

**リクエスト**

```json
{
  "savings": 500000,
  "monthly": 30000,
  "goal": 10000000,
  "years": 10,
  "risk_level": "medium"
}
```

**レスポンス**

```json
{
  "percentiles": {
    "10": [...],
    "25": [...],
    "50": [...],
    "75": [...],
    "90": [...]
  },
  "achievement_probability": 72.3,
  "allocation": { "VTI": 0.6, "AGG": 0.3, "GLD": 0.07, "SHV": 0.03 },
  "allocation_labels": { "VTI": "株式", ... },
  "explanation": "あなたの目標には年利...",
  "expected_annual_return": 0.082,
  "annual_volatility": 0.115
}
```

### リスクレベル別アロケーション

| リスク | 株式 (VTI) | 債券 (AGG) | 金 (GLD) | 現金 (SHV) |
|--------|-----------|-----------|---------|-----------|
| 低     | 30%       | 50%       | 10%     | 10%       |
| 中     | 60%       | 30%       | 7%      | 3%        |
| 高     | 80%       | 15%       | 5%      | 0%        |

---

## 免責事項

本アプリはVTI・AGG・GLD・SHVの過去10年間の日次リターンを用いたモンテカルロシミュレーション（10,000回）に基づいています。将来の運用成果を保証するものではありません。投資判断はご自身の責任のもとで行ってください。
