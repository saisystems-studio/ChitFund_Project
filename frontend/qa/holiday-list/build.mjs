import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
await build({configFile:false,plugins:[react()],base:"/chitfund/",build:{outDir:join(tmpdir(),"chitfund-holiday-list-build"),emptyOutDir:false,rollupOptions:{input:resolve("qa/holiday-list/index.html")}}});
