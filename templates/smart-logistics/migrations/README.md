# migrations

Changes to a database that already has rows in it.

`src/db/Schema.jo` describes the shape this build expects and creates whatever is
missing, which is the whole story for an empty file. It cannot add a column,
reshape a table, or move data between them — `CREATE TABLE IF NOT EXISTS` does
nothing to a table that exists. Each of those changes is a `.sql` file here, and
`src/db/Migrations.jo` applies the ones a given database has not had.

## Adding one

Edit `Schema.jo` so it describes the new shape, then write a file here that gets
an old database to it. **Both.** `Schema.jo` is what a fresh database is built
from, and the migration is what an existing one is carried through, so a change
made in only one of them works on exactly half your databases.

Name it `<UTC timestamp>-<what-it-does>.sql`:

```
20260906T142300-supplier-contact-email.sql
```

Files are applied in filename order, so the stamp is the ordering. It goes to the
second, which means two migrations written on the same day still have an order
that does not depend on what they were named.

Give the file its own transaction:

```sql
-- Suppliers gain an address to send orders to.
--
-- Empty is the honest default for every supplier that already exists: nobody has
-- recorded one, and the orders page falls back to the supplier name exactly as it
-- did before.

BEGIN IMMEDIATE;

ALTER TABLE suppliers
  ADD COLUMN contact_email TEXT NOT NULL DEFAULT '';

COMMIT;
```

The `BEGIN`/`COMMIT` is so the file can be run by hand against a copy of a real
database, which is how it gets reviewed before a deploy. The runner skips those
markers and wraps the file in a transaction of its own, together with the row
recording it — so all of it lands or none of it does, and there is no state where
a database has been changed but not marked.

A migration that creates a table should say `IF NOT EXISTS` and expect to find it
already there. `Schema` runs first, and it already declares every table this build
knows about.

## Once written, never edited

Editing a file that some database has already run changes nothing for that
database and everything for the next one. The two then disagree, with no symptom
until something depends on the difference. Correct a mistake with another
migration.

The same rule is why a migration hard-codes the shape it produces instead of
sharing DDL with `Schema.jo`. `Schema.jo` always describes the *current* shape,
so a migration that referred to it would silently change meaning every time the
schema moved on, and a database migrating through several steps would take a
different route than the one that was tested.

## What a database has had

Recorded in `schema_migrations`, one row per file:

```sh
sqlite3 data/logistics.db "SELECT * FROM schema_migrations ORDER BY version"
```

A database created by `Schema` at the current shape is **baselined**: every file
here is recorded without being run, because the shape they lead to is already
there. Only a database that existed before a file was written is actually put
through it.

If a migration fails, it is rolled back, nothing is recorded, and the app stops
with the error rather than serving against a half-changed database.
