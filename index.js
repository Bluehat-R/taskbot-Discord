// index.js
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

// ==============================
// DB準備
// ==============================
const db = new sqlite3.Database("./tasks.db");

// tasksテーブル
db.run(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  content TEXT NOT NULL,
  due_date TEXT,
  created_by TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  display_id INTEGER
)`);

// remindersテーブル
db.run(`CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  remind_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
)`);

// 既存DBにdisplay_id列がなければ追加
db.run(`ALTER TABLE tasks ADD COLUMN display_id INTEGER`, (err) => {
  if (!err) {
    db.run(`UPDATE tasks SET display_id = id WHERE display_id IS NULL`);
  }
});

// ==============================
// 日本語リマインドパーサー
// ==============================
function parseJapaneseReminder(input, dueDate) {
  const now = new Date();

  let relNow = input.match(/^(\d+)(分|時間|日)後$/);
  if (relNow) {
    let num = parseInt(relNow[1]);
    let unit = relNow[2];
    let date = new Date(now);
    if (unit === "分") date.setMinutes(date.getMinutes() + num);
    if (unit === "時間") date.setHours(date.getHours() + num);
    if (unit === "日") date.setDate(date.getDate() + num);
    return date;
  }

  let dayMatch = input.match(/^(今日|明日|明後日)(?: (\d{1,2}):(\d{2}))?$/);
  if (dayMatch) {
    let date = new Date(now);
    if (dayMatch[1] === "明日") date.setDate(date.getDate() + 1);
    if (dayMatch[1] === "明後日") date.setDate(date.getDate() + 2);
    if (dayMatch[2]) {
      date.setHours(parseInt(dayMatch[2]), parseInt(dayMatch[3]), 0, 0);
    } else {
      date.setHours(9, 0, 0, 0);
    }
    return date;
  }

  let relDue = input.match(/^期限の(\d+)(分|時間|日)前$/);
  if (relDue && dueDate) {
    let num = parseInt(relDue[1]);
    let unit = relDue[2];
    let date = new Date(dueDate);
    if (unit === "分") date.setMinutes(date.getMinutes() - num);
    if (unit === "時間") date.setHours(date.getHours() - num);
    if (unit === "日") date.setDate(date.getDate() - num);
    return date;
  }

  let abs = input.match(
    /^(\d{4})?\/(\d{1,2})\/(\d{1,2})(?: (\d{1,2}):(\d{2}))?$/
  );
  if (abs) {
    let year = abs[1] || now.getFullYear();
    let month = abs[2].padStart(2, "0");
    let day = abs[3].padStart(2, "0");
    let hour = abs[4] || "09";
    let min = abs[5] || "00";
    let date = new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
    if (date < now) date.setFullYear(date.getFullYear() + 1);
    return date;
  }

  let jpDate = input.match(/^(\d{1,2})月(\d{1,2})日(?: (\d{1,2}):(\d{2}))?$/);
  if (jpDate) {
    let year = now.getFullYear();
    let month = jpDate[1].padStart(2, "0");
    let day = jpDate[2].padStart(2, "0");
    let hour = jpDate[3] || "09";
    let min = jpDate[4] || "00";
    let date = new Date(`${year}-${month}-${day}T${hour}:${min}:00`);
    if (date < now) date.setFullYear(year + 1);
    return date;
  }

  let timeOnly = input.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) {
    let date = new Date(now);
    date.setHours(parseInt(timeOnly[1]), parseInt(timeOnly[2]), 0, 0);
    if (date < now) date.setDate(date.getDate() + 1);
    return date;
  }

  return null;
}

// ==============================
// 表示用ID（display_id）採番
// ==============================
function getNextDisplayId(serverId, cb) {
  db.all(
    "SELECT display_id FROM tasks WHERE server_id = ? AND display_id IS NOT NULL ORDER BY display_id ASC",
    [serverId],
    (err, rows) => {
      if (err) return cb(1);
      let next = 1;
      for (const r of rows) {
        if (r.display_id === next) next++;
        else if (r.display_id > next) break;
      }
      cb(next);
    }
  );
}

// ==============================
// Discordクライアント
// ==============================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// ==============================
// タスク関連処理
// ==============================
async function handleAddTask(interaction, content, due) {
  getNextDisplayId(interaction.guild.id, (nextDisplayId) => {
    db.run(
      "INSERT INTO tasks (server_id, channel_id, content, due_date, created_by, display_id) VALUES (?, ?, ?, ?, ?, ?)",
      [
        interaction.guild.id,
        interaction.channel.id,
        content,
        due,
        interaction.user.id,
        nextDisplayId,
      ],
      function () {
        interaction.reply(
          `📝 タスクを追加しました: **${content}** (期限: ${due || "なし"})\n` +
            `ID: **${nextDisplayId}**`
        );
      }
    );
  });
}

async function handleListTask(interaction) {
  db.all(
    "SELECT * FROM tasks WHERE server_id = ?",
    [interaction.guild.id],
    (err, rows) => {
      if (rows.length === 0)
        return interaction.reply("📭 このサーバーにはまだタスクがありません！");
      let desc = rows
        .map(
          (t) =>
            `${t.display_id}. ${t.status === "done" ? "✅" : "🟩"} ${
              t.content
            } (期限: ${t.due_date || "なし"})`
        )
        .join("\n");
      const embed = new EmbedBuilder()
        .setTitle("📋 タスク一覧")
        .setDescription(desc)
        .setColor(0x00aaff);
      interaction.reply({ embeds: [embed] });
    }
  );
}

async function handleDoneTask(interaction, displayId) {
  db.get(
    "SELECT * FROM tasks WHERE server_id = ? AND display_id = ?",
    [interaction.guild.id, displayId],
    (err, task) => {
      if (!task) return interaction.reply("❌ タスクが見つかりません。");
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`done_yes_${task.id}`)
          .setLabel("Yes")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`done_no_${task.id}`)
          .setLabel("No")
          .setStyle(ButtonStyle.Danger)
      );
      interaction.reply({
        content: `「${task.content}」を完了にしますか？`,
        components: [row],
      });
    }
  );
}

async function handleRemoveTask(interaction, displayId) {
  db.get(
    "SELECT * FROM tasks WHERE server_id = ? AND display_id = ?",
    [interaction.guild.id, displayId],
    (err, task) => {
      if (!task) return interaction.reply("❌ タスクが見つかりません。");
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`remove_yes_${task.id}`)
          .setLabel("Yes")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`remove_no_${task.id}`)
          .setLabel("No")
          .setStyle(ButtonStyle.Danger)
      );
      interaction.reply({
        content: `「${task.content}」を削除しますか？`,
        components: [row],
      });
    }
  );
}

// ==============================
// リマインダー処理
// ==============================
async function handleRemindAdd(interaction, displayId, input) {
  db.get(
    "SELECT * FROM tasks WHERE server_id = ? AND display_id = ?",
    [interaction.guild.id, displayId],
    (err, task) => {
      if (!task) return interaction.reply("❌ タスクが見つかりません。");

      let remindDate = parseJapaneseReminder(input, task.due_date);
      if (!remindDate)
        return interaction.reply("⚠️ 時間の形式が理解できませんでした。");

      db.run(
        "INSERT INTO reminders (task_id, remind_at) VALUES (?, ?)",
        [task.id, remindDate.toISOString()],
        function () {
          interaction.reply(
            `⏰ リマインダーを追加しました！\nタスク: **${
              task.content
            }** (ID: ${task.display_id})\n日時: ${remindDate.toLocaleString(
              "ja-JP"
            )}`
          );
        }
      );
    }
  );
}

// ==============================
// ボタン処理
// ==============================
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;
    if (commandName === "task") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const content = interaction.options.getString("内容");
        const due = interaction.options.getString("期限");
        await handleAddTask(interaction, content, due);
      } else if (sub === "list") {
        await handleListTask(interaction);
      } else if (sub === "done") {
        await handleDoneTask(interaction, interaction.options.getInteger("id"));
      } else if (sub === "remove") {
        await handleRemoveTask(
          interaction,
          interaction.options.getInteger("id")
        );
      }
    }
    if (commandName === "remind") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const displayId = interaction.options.getInteger("task_id");
        const input = interaction.options.getString("指定");
        await handleRemindAdd(interaction, displayId, input);
      }
    }
    if (commandName === "help") {
      const embed = new EmbedBuilder()
        .setTitle("📖 タスク管理Bot ヘルプ")
        .setColor(0x00aaff)
        .setDescription(
          [
            "`/task add 内容 yyyy/mm/dd` → タスクを追加",
            "`/task list` → タスク一覧を表示",
            "`/task done id` → タスクを完了（表示ID）",
            "`/task remove id` → タスクを削除（表示ID）",
            "`/remind add id 指定` → リマインダーを追加（表示ID）",
            "`/help` → このヘルプを表示",
          ].join("\n")
        );
      interaction.reply({ embeds: [embed] });
    }
  }

  if (interaction.isButton()) {
    const [action, result, taskId] = interaction.customId.split("_");
    if (action === "done" && result === "yes") {
      db.run("UPDATE tasks SET status = 'done' WHERE id = ?", [taskId]);
      interaction.update({
        content: "✅ タスクを完了しました！",
        components: [],
      });
    }
    if (action === "remove" && result === "yes") {
      db.run("DELETE FROM tasks WHERE id = ?", [taskId]);
      interaction.update({
        content: "🗑️ タスクを削除しました！",
        components: [],
      });
    }
    if (["done", "remove"].includes(action) && result === "no") {
      interaction.update({
        content: "❌ キャンセルしました。",
        components: [],
      });
    }
  }
});

// ==============================
// リマインド通知ループ
// ==============================
setInterval(() => {
  const now = new Date();
  db.all(
    `SELECT reminders.id, reminders.task_id, reminders.remind_at,
            tasks.content, tasks.server_id, tasks.created_by, tasks.channel_id, tasks.display_id
     FROM reminders
     JOIN tasks ON reminders.task_id = tasks.id`,
    [],
    (err, rows) => {
      if (err || !rows) return;
      rows.forEach((r) => {
        const remindTime = new Date(r.remind_at);
        if (Math.abs(remindTime - now) < 60000) {
          const guild = client.guilds.cache.get(r.server_id);
          if (guild) {
            const channel = guild.channels.cache.get(r.channel_id);
            const mention = `<@${r.created_by}>`;
            if (channel) {
              channel.send(
                `🔔 ${mention} リマインドです！\nタスク: **${r.content}** (ID: ${r.display_id})`
              );
            }
          }
          db.run("DELETE FROM reminders WHERE id = ?", [r.id]);
        }
      });
    }
  );
}, 60000);

// ==============================
// スラッシュコマンド登録
// ==============================
client.on("ready", async () => {
  const data = [
    {
      name: "task",
      description: "タスク管理",
      options: [
        {
          type: 1,
          name: "add",
          description: "タスクを追加",
          options: [
            {
              type: 3,
              name: "内容",
              description: "タスク内容",
              required: true,
            },
            {
              type: 3,
              name: "期限",
              description: "yyyy/mm/dd",
              required: false,
            },
          ],
        },
        { type: 1, name: "list", description: "タスク一覧を表示" },
        {
          type: 1,
          name: "done",
          description: "タスクを完了にする",
          options: [
            { type: 4, name: "id", description: "表示ID", required: true },
          ],
        },
        {
          type: 1,
          name: "remove",
          description: "タスクを削除する",
          options: [
            { type: 4, name: "id", description: "表示ID", required: true },
          ],
        },
      ],
    },
    {
      name: "remind",
      description: "リマインダー管理",
      options: [
        {
          type: 1,
          name: "add",
          description: "リマインダーを追加",
          options: [
            { type: 4, name: "task_id", description: "表示ID", required: true },
            {
              type: 3,
              name: "指定",
              description:
                "リマインドの指定（例: 明日 9:00, 10分後, 9/29 18:00...）",
              required: true,
            },
          ],
        },
      ],
    },
    { name: "help", description: "タスク管理Botの使い方を表示" },
  ];
  await client.application.commands.set(data);
  console.log(`✅ ログインしました: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
