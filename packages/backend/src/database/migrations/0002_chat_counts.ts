import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE chat_messages ADD COLUMN channel_position INTEGER NOT NULL DEFAULT 0`;
  yield* sql`WITH positions AS (
    SELECT sequence, ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY sequence) AS position FROM chat_messages
  ) UPDATE chat_messages SET channel_position = (SELECT position FROM positions WHERE positions.sequence = chat_messages.sequence)`;
  yield* sql`CREATE TABLE chat_channel_counts (
    channel_id TEXT PRIMARY KEY REFERENCES chat_channels(id) ON DELETE CASCADE,
    message_count INTEGER NOT NULL,
    newest_sequence INTEGER NOT NULL
  )`;
  yield* sql`CREATE TABLE chat_sender_counts (
    channel_id TEXT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    message_count INTEGER NOT NULL,
    PRIMARY KEY (channel_id, profile_id)
  )`;
  yield* sql`INSERT INTO chat_channel_counts
    SELECT channel_id, COUNT(*), MAX(sequence) FROM chat_messages GROUP BY channel_id`;
  yield* sql`INSERT INTO chat_sender_counts
    SELECT channel_id, sender_profile_id, COUNT(*) FROM chat_messages GROUP BY channel_id, sender_profile_id`;
  yield* sql`CREATE TRIGGER chat_message_insert_counts AFTER INSERT ON chat_messages BEGIN
    INSERT INTO chat_channel_counts VALUES (NEW.channel_id, 1, NEW.sequence)
      ON CONFLICT(channel_id) DO UPDATE SET message_count = message_count + 1,
        newest_sequence = MAX(newest_sequence, NEW.sequence);
    INSERT INTO chat_sender_counts VALUES (NEW.channel_id, NEW.sender_profile_id, 1)
      ON CONFLICT(channel_id, profile_id) DO UPDATE SET message_count = message_count + 1;
    UPDATE chat_messages SET channel_position = (
      SELECT message_count FROM chat_channel_counts WHERE channel_id = NEW.channel_id
    ) WHERE sequence = NEW.sequence;
  END`;
  yield* sql`CREATE TRIGGER chat_message_delete_counts AFTER DELETE ON chat_messages BEGIN
    UPDATE chat_channel_counts SET message_count = message_count - 1,
      newest_sequence = COALESCE((SELECT MAX(sequence) FROM chat_messages WHERE channel_id = OLD.channel_id), 0)
      WHERE channel_id = OLD.channel_id;
    UPDATE chat_sender_counts SET message_count = message_count - 1
      WHERE channel_id = OLD.channel_id AND profile_id = OLD.sender_profile_id;
  END`;
});
