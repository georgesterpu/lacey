import { test, expect } from "bun:test";
import { postgresParameters } from "../src/postgres";
test("Postgres binds placeholders without changing SQL literals, names or comments", () => {
  expect(
    postgresParameters(
      `SELECT ?, '?', 'it''s ?', "?", ? -- ?\n /* ? */ WHERE x=?`,
    ),
  ).toBe(`SELECT $1, '?', 'it''s ?', "?", $2 -- ?\n /* ? */ WHERE x=$3`);
});
