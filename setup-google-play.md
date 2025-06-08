# Google Play Store アップロード手順

## 1. 必要なツールのインストール

### Node.js と npm の確認
```bash
node --version
npm --version
```

### Bubblewrap CLI のインストール
```bash
npm install -g @bubblewrap/cli
```

### Java Development Kit (JDK) のインストール
- JDK 8 以上が必要
- [Oracle JDK](https://www.oracle.com/java/technologies/downloads/) または [OpenJDK](https://openjdk.org/) をインストール

### Android Studio のインストール
- [Android Studio](https://developer.android.com/studio) をダウンロードしてインストール
- Android SDK と Android SDK Build-tools をインストール

## 2. PWAのデプロイ確認

現在のPWAが以下のURLで正常に動作することを確認：
- https://cutommetronome-ovreb9h5n-hayanospls-projects.vercel.app

## 3. アイコンの準備

1. `generate-icons.html` をブラウザで開く
2. 「全てのアイコンを生成」ボタンをクリック
3. 各サイズのアイコンをダウンロードして `public/` フォルダに配置：
   - icon-72.png
   - icon-96.png
   - icon-128.png
   - icon-144.png
   - icon-152.png
   - icon-192.png
   - icon-384.png
   - icon-512.png
   - favicon.ico

## 4. TWAプロジェクトの初期化

```bash
# プロジェクトディレクトリで実行
bubblewrap init --manifest=https://cutommetronome-ovreb9h5n-hayanospls-projects.vercel.app/manifest.json
```

## 5. Android APKのビルド

### 署名キーの生成
```bash
# Android キーストアの生成
keytool -genkey -v -keystore android.keystore -alias android -keyalg RSA -keysize 2048 -validity 10000
```

### APKのビルド
```bash
bubblewrap build
```

## 6. Google Play Console でのアプリ登録

### Google Play Console アカウントの準備
1. [Google Play Console](https://play.google.com/console/) にアクセス
2. デベロッパーアカウントを作成（$25の登録料が必要）
3. 新しいアプリを作成

### アプリ情報の設定
- **アプリ名**: カスタムメトロノーム - ポリリズム対応
- **カテゴリ**: 音楽・オーディオ
- **対象年齢**: すべての年齢層
- **説明**: 高機能なポリリズム対応メトロノーム。複数パターンの組み合わせ、テンポカーブ、プリセット機能を搭載。

### 必要な素材の準備
- **アプリアイコン**: 512x512 PNG（透明背景不可）
- **フィーチャーグラフィック**: 1024x500 PNG
- **スクリーンショット**: 携帯電話用（16:9比率）
- **プライバシーポリシー**: 必須

## 7. スクリーンショットの撮影

### モバイル用スクリーンショット
以下の画面を撮影：
1. メイン画面（メトロノーム操作）
2. パターン設定画面
3. テンポカーブ編集画面
4. プリセット管理画面

### Chrome DevTools での撮影方法
1. F12でデベロッパーツールを開く
2. デバイスモード（携帯電話アイコン）をクリック
3. iPhone 12 Pro または Pixel 5 を選択
4. 各画面でスクリーンショットを撮影

## 8. APKのアップロード

1. Google Play Console で「リリース」→「本番環境」を選択
2. 「新しいリリースを作成」をクリック
3. 生成されたAPKファイルをアップロード
4. リリースノートを記入
5. 「リリースを確認」をクリック

## 9. ストア掲載情報の入力

### ストア掲載情報
- **アプリ名**: カスタムメトロノーム
- **簡単な説明**: 高機能ポリリズムメトロノーム
- **詳細な説明**: 
  ```
  🎵 高機能なポリリズム対応メトロノーム

  【主な機能】
  ✓ 複数パターンの同時再生
  ✓ テンポカーブ編集
  ✓ プリセット保存・共有
  ✓ 32/32拍子まで対応
  ✓ オフライン対応PWA

  【こんな方におすすめ】
  • 音楽家・楽器演奏者
  • 音楽学生
  • リズム練習をしたい方
  • 複雑なリズムパターンを練習したい方

  【特徴】
  • 直感的な操作性
  • 豊富なカスタマイズオプション
  • データの保存・共有機能
  • レスポンシブデザイン
  ```

## 10. 審査とリリース

1. 全ての項目を入力後、「審査に送信」をクリック
2. Google の審査（通常1-3日）
3. 承認後、Google Play Store で公開

## 11. 追加の最適化

### ASO（アプリストア最適化）
- **キーワード**: メトロノーム, リズム, 音楽, 練習, ポリリズム
- **レビュー対応**: ユーザーレビューへの返信
- **アップデート**: 定期的な機能追加

### プロモーション
- **SNS**: Twitter, Instagram での宣伝
- **音楽コミュニティ**: 音楽フォーラムでの紹介
- **YouTube**: デモ動画の作成

## 注意事項

1. **プライバシーポリシー**: 必須（データ収集について記載）
2. **利用規約**: 推奨
3. **著作権**: 音楽関連のアプリは著作権に注意
4. **継続的なメンテナンス**: バグ修正とアップデート

## トラブルシューティング

### よくある問題
- **ビルドエラー**: Java/Android SDK のパス設定を確認
- **署名エラー**: キーストアファイルのパスを確認
- **アップロードエラー**: APKサイズ制限（100MB）を確認

### サポートリソース
- [Bubblewrap Documentation](https://github.com/GoogleChromeLabs/bubblewrap)
- [Google Play Console Help](https://support.google.com/googleplay/android-developer/)
- [TWA Documentation](https://developer.chrome.com/docs/android/trusted-web-activity/) 