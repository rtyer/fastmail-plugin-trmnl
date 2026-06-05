import "dotenv/config";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
const app = createServer();

app.listen(port, () => {
  console.log(`fastmail-plugin-trmnl listening on :${port}`);
});
