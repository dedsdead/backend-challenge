// typeorm-migration-guard.js
//
// Real OpenCode plugin (tool.execute.after hook). Replaces the previous,
// non-existent `migration-atomic-reminder.mjs` referenced by
// docs/*/hooks-reference.md and the old (dead) hooks test.
//
// Reminds about the mandatory generate -> drift-check -> run atomic chain
// (see .opencode/rules/typeorm-migrations.mdc) right after a migration is
// generated, since forgetting to run it immediately is called out there as
// "the #1 source of production bugs".

const GENERATE_PATTERN = /typeorm:generate\b/;

export const TypeormMigrationGuard = async () => {
  return {
    "tool.execute.after": async (input, output) => {
      if (input?.tool !== "bash") return;
      const command = output?.args?.command;
      if (!command || !GENERATE_PATTERN.test(command)) return;

      console.warn(
        "[typeorm-migration-guard] TypeORM atomic chain reminder: this migration " +
          "must be run on the local DB immediately (`npm run typeorm:run`), then " +
          "verified, before starting any other entity/migration change. See " +
          ".opencode/rules/typeorm-migrations.mdc."
      );
    },
  };
};

export default TypeormMigrationGuard;
