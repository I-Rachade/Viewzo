import { defineConfig } from "prisma/config";

// Only used to generate the client and the SQL migrations. The Worker talks
// to D1 through @prisma/adapter-d1; the file below is a local scratch copy.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: "file:./.scratch.db" },
});
