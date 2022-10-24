import type { IncomingMessage, ServerResponse } from "http";
import type { RawData } from "ws";

import * as dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { WebSocketServer } from "ws";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { AutoScalingClient, SetDesiredCapacityCommand } from "@aws-sdk/client-auto-scaling";
import { createClient } from "redis";

let awsCredentials;
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  awsCredentials = {
    region: "eu-west-2",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  };
}
const dynamoDBClient = new DynamoDBClient(awsCredentials ?? {});
const autoScalingClient = new AutoScalingClient(awsCredentials ?? {});

const server = createServer(requestHandler);
const wss = new WebSocketServer({ server });

const redisPublisherClient = createClient({ url: process.env.REDIS_URL });
redisPublisherClient.on("error", (error) => console.log("Redis Client Error", error));

const redisSubscriberClient = redisPublisherClient.duplicate();

redisPublisherClient.connect();
redisSubscriberClient.connect();

const stream = "testing123";
const gameState = {
  gameLength: 5,
  roundTime: 0,
  panEnabled: true,
  zoomEnabled: true,
  moveEnabled: true,
  players: [] as any,
};

// heartbeat
declare module "ws" {
  interface WebSocket {
    isAlive: boolean;
  }
}

setInterval(() => {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();

    ws.isAlive = false;
    ws.ping();
  });
}, 1000 * 25);

let canScale = true;
wss.on("connection", async (ws) => {
  const shouldScale =
    Array.from(wss.clients).length >= Number(process.env.MAX_CONNECTIONS!) * 0.5 &&
    canScale &&
    process.env.NODE_ENV === "production";

  if (shouldScale) {
    canScale = false;
    updateScalingCapacity();
  }

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", messageHandler);

  const id = Math.floor(Math.random() * 1000000);

  ws.on("close", async () => {
    await redisPublisherClient.XADD(stream, "*", {
      event: JSON.stringify({ id: "player left", player: { id } }),
    });
  });

  ws.on("error", async () => {
    await redisPublisherClient.XADD(stream, "*", {
      event: JSON.stringify({ id: "player left", player: { id } }),
    });
  });

  await redisPublisherClient.XADD(stream, "*", {
    event: JSON.stringify({ id: "player joined", player: { id } }),
  });
});

streamListener();

server.listen(process.env.PORT ?? 8080, () => {
  console.log(`Server is running on port ${process.env.PORT ?? 8080}`);
});

async function messageHandler(data: RawData) {
  const dataString = data.toString();
  let message;
  try {
    message = JSON.parse(dataString);
  } catch (error) {
    console.log(error);
    return;
  }

  switch (message.event) {
    case "ping": {
      const res = await redisPublisherClient.PING();

      wss.clients.forEach((client) => {
        client.send(res);
      });
    }
  }
}

function requestHandler(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage> & {
    req: IncomingMessage;
  }
) {
  switch (req.url) {
    case "/available": {
      if (Array.from(wss.clients).length >= Number(process.env.MAX_CONNECTIONS!)) {
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
      res.end(Array.from(wss.clients).length.toString());
      return;
    }

    default: {
      res.writeHead(404);
      res.end();
      return;
    }
  }
}

async function updateScalingCapacity() {
  const updateItemCommand = new UpdateItemCommand({
    TableName: "instances",
    Key: { id: { S: "1" } },
    UpdateExpression: "SET amount = if_not_exists(amount, :start) + :inc",
    ExpressionAttributeValues: {
      ":inc": { N: "1" },
      ":start": { N: "0" },
    },
    ReturnValues: "UPDATED_NEW",
  });

  const response = await dynamoDBClient.send(updateItemCommand);
  const amount = Number(response.Attributes!.amount.N);

  const setDesiredCapacityCommand = new SetDesiredCapacityCommand({
    AutoScalingGroupName: "ws-server-group",
    DesiredCapacity: amount,
    HonorCooldown: false,
  });
  autoScalingClient.send(setDesiredCapacityCommand);
}

async function streamListener() {
  let lastId;

  while (true) {
    const streams = await redisSubscriberClient.XREAD(
      { key: stream, id: lastId ?? "0" },
      { BLOCK: 0 }
    );

    // Defensive
    // Sending a block request so can't be null
    if (!streams) continue;

    const messages: { id: string; message: any }[] = streams[0].messages;
    const parsedMessages = messages.map(({ message }) => JSON.parse(message.event));

    parsedMessages.forEach((event: any) => {
      switch (event.id) {
        case "player joined": {
          broadcast(JSON.stringify(parsedMessages));
          gameState.players.push(event.player);
          break;
        }

        case "player left": {
          broadcast(JSON.stringify(parsedMessages));
          gameState.players.splice(
            gameState.players.findIndex((player: any) => player.id === event.player.id),
            1
          );
          break;
        }
      }
    });

    lastId = messages[messages.length - 1].id;
  }
}

function broadcast(message: any) {
  wss.clients.forEach((client) => {
    client.send(message);
  });
}
