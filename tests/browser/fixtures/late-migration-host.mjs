import { createLateMigrationServer } from "./late-migration-server.mjs";
const server = await createLateMigrationServer();
server.listen(Number(process.env.LATE_MIGRATION_QA_PORT || 4174), "127.0.0.1", () => console.log("Late migration local fixture: http://127.0.0.1:" + server.address().port));
