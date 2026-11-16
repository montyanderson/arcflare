PRAGMA foreign_keys = ON;
CREATE TABLE users (
  id TEXT PRIMARY KEY COLLATE NOCASE,
  password TEXT NOT NULL,
  created INTEGER NOT NULL DEFAULT (unixepoch()),
  karma INTEGER NOT NULL DEFAULT 1,
  about TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','editor','admin')),
  banned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires);
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('story','comment','poll','pollopt')),
  by TEXT NOT NULL REFERENCES users(id),
  time INTEGER NOT NULL DEFAULT (unixepoch()),
  title TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  parent INTEGER REFERENCES items(id),
  root INTEGER REFERENCES items(id),
  score INTEGER NOT NULL DEFAULT 0,
  dead INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX items_recent ON items(type, id DESC);
CREATE INDEX items_parent ON items(parent);
CREATE INDEX items_root ON items(root);
CREATE INDEX items_author ON items(by, id DESC);
CREATE UNIQUE INDEX items_live_url ON items(url) WHERE url <> '' AND dead = 0 AND deleted = 0;
CREATE TABLE votes (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  direction INTEGER NOT NULL CHECK(direction IN (-1,1)),
  time INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY(user_id,item_id)
);
CREATE TRIGGER vote_add AFTER INSERT ON votes BEGIN
  UPDATE items SET score = score + NEW.direction WHERE id = NEW.item_id;
  UPDATE users SET karma = karma + NEW.direction
    WHERE id = (SELECT by FROM items WHERE id = NEW.item_id AND type <> 'pollopt') AND id <> NEW.user_id;
END;
CREATE TRIGGER vote_remove AFTER DELETE ON votes BEGIN
  UPDATE items SET score = score - OLD.direction WHERE id = OLD.item_id;
  UPDATE users SET karma = karma - OLD.direction
    WHERE id = (SELECT by FROM items WHERE id = OLD.item_id AND type <> 'pollopt') AND id <> OLD.user_id;
END;
CREATE TABLE flags (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  PRIMARY KEY(user_id,item_id)
);
CREATE TABLE saved (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  PRIMARY KEY(user_id,item_id)
);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE moderation (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  time INTEGER NOT NULL DEFAULT (unixepoch())
);
