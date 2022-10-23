import type { IncomingMessage, ServerResponse } from "http";

import * as dotenv from "dotenv";
dotenv.config();

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// Cloudwatch
const region = "eu-west-2";
const cwClient = new CloudWatchClient({ region });

setInterval(sendMetricData, 500);

// Server
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

async function sendMetricData() {
  const params = {
    MetricData: [
      {
        MetricName: "CONCURRENT_CONNECTIONS",
        Dimensions: [
          {
            Name: "CONNECTED_USERS",
            Value: "IDK",
          },
        ],
        Unit: "None",
        Value: Array.from(wss.clients).length,
      },
    ],
    Namespace: "SERVER/CONNECTIONS",
  };

  try {
    const data = await cwClient.send(new PutMetricDataCommand(params));
    console.log("Success", data.$metadata.requestId);
  } catch (err) {
    console.log("Error", err);
  }
}
