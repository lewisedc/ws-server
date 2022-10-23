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
  switch (req.url) {
    case "/available": {
      if (wss.clients.values.length >= Number(process.env.MAX_CONNECTIONS!)) {
        res.writeHead(503);
        res.end();
        return;
      }

      res.writeHead(200);
      res.end();
      return;
    }

    case "/connections": {
      res.writeHead(200);
      res.end(wss.clients.values.length.toString());
      return;
    }

    default: {
      res.writeHead(404);
      res.end();
      return;
    }
  }
}
