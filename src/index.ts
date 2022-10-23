import type { IncomingMessage, ServerResponse } from "http";

import * as dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { WebSocketServer } from "ws";

const server = createServer(requestHandler);

const wss = new WebSocketServer({ server });

wss.on("connection", function connection(ws) {
  ws.on("message", function message(data) {
    console.log("received: %s", data);
  });

  ws.send("something");
});

server.listen(process.env.PORT ?? 8080, () => {
  console.log(`Server is running on port ${process.env.PORT ?? 8080}`);
});

function requestHandler(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage> & {
    req: IncomingMessage;
  }
) {
  if (req.url !== "/connections") {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200);
  res.end(Array.from(wss.clients).length.toString());
}
