import type { IncomingMessage, ServerResponse } from "http";

import * as dotenv from "dotenv";
dotenv.config();

import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { createServer } from "http";
import { WebSocketServer } from "ws";

// Cloudwatch
const region = "eu-west-2";
const cwClient = new CloudWatchClient({
  region,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID!,
    secretAccessKey: process.env.SECRET_ACCESS_KEY!,
  },
});
const maxClients = 2;

// Server
const server = createServer(requestHandler);
const wss = new WebSocketServer({ server });

let prevClientsCount = 0;

wss.on("connection", function connection(ws) {
  const clientsCount = wss.clients.values.length;

  if (clientsCount >= maxClients && prevClientsCount < maxClients) {
    sendMetricData(true);
  } else if (clientsCount < maxClients && prevClientsCount >= maxClients) {
    sendMetricData(false);
  }

  prevClientsCount = clientsCount;

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

async function sendMetricData(isFull: boolean) {
  const params = {
    MetricData: [
      {
        MetricName: "IS_FULL",
        Unit: "None",
        Value: isFull ? 1 : 0,
      },
    ],
    Namespace: "SERVER/FULL",
  };

  try {
    const data = await cwClient.send(new PutMetricDataCommand(params));
    console.log("Success", data.$metadata.requestId);
  } catch (err) {
    console.log("Error", err);
  }
}
