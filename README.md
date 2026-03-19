# Discord タスク管理Bot

## 概要
Discord上でタスク管理とリマインドができるBotです。
日本語の自然な時間指定に対応しています。

## 主な機能
・タスク追加 / 一覧 / 完了 / 削除
・リマインダー機能
・日本語日時解析（例: 明日 9:00, 10分後, 期限の1時間前）
・ボタンUIによる操作確認

## 技術スタック
・Node.js
・discord.js
・SQLite

## 起動方法

npm install
node index.js


## 環境変数
.env ファイルに以下を設定
DISCORD_TOKEN=your_token_here

## ポイント
・自然言語でのリマインド指定を実装
・SQLiteによる永続化
・Discord UIを活用した操作性
