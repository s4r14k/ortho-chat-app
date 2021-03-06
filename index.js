'use strict';

require("dotenv").config();
const express = require('express');
const cors = require("cors");
const app = express();
const http = require('http').Server(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "https://orthologick.fr",
    methods: ["GET", "POST"],
    credentials: true
  }
});
const {
  MongoClient
} = require("mongodb");

const client = new MongoClient(process.env.ATLAS_URI, {
  useUnifiedTopology: true
});
let collection = null;
client.connect((err, data) => {
  if (err) throw err;
  console.log("data connected !");
});

const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const {
  InMemorySessionStore
} = require("./sessionStore");
const sessionStore = new InMemorySessionStore();

const {
  InMemoryMessageStore
} = require("./messageStore");
const messageStore = new InMemoryMessageStore();

const removeDuplicates = (data, key) => {
  return [
    ...new Map(data.map(item => [key(item), item])).values()
  ]
};

app.use(cors());

app.get('/message/:id', (req, res) => {
  let query = {};

  if (Number(req.params.id) !== 1) {
    query = {
      $or: [{
        to: Number(req.params.id)
      }, {
        from: Number(req.params.id)
      }]
    }
  }

  collection = client.db("ortho").collection("chat");

  collection.find(query).toArray()
    .catch(error => {
      throw error
    })
    .then((data) => {
      data.forEach(element => {
        messageStore.saveMessage(element);
      });
      return res.json(data);
    });
});

io.use((socket, next) => {
  const sessionID = socket.handshake.auth.sessionID;
  if (sessionID) {
    // find existing session
    const session = sessionStore.findSession(sessionID);
    if (session) {
      socket.sessionID = sessionID;
      socket.userID = session.userID;
      socket.username = session.username;
      return next();
    }
  }

  const username = socket.handshake.auth.username;
  const userId = socket.handshake.auth.userId;
  if (!username) {
    return next(new Error("invalid username"));
  }
  socket.sessionID = randomId();
  socket.userID = userId;
  socket.username = username;
  next();
});

io.on("connection", (socket) => {
  // persist session
  sessionStore.saveSession(socket.sessionID, {
    userID: socket.userID,
    username: socket.username,
    connected: true,
  });

  // emit session details
  socket.emit("session", {
    sessionID: socket.sessionID,
    userID: socket.userID,
  });

  console.log(sessionStore);

  // join the "userID" room
  socket.join(socket.userID);

  // fetch existing users
  const users = [];
  const messagesPerUser = new Map();
  messageStore.findMessagesForUser(socket.userID).forEach((message) => {
    const {
      from,
      to
    } = message;
    const otherUser = socket.userID === from ? to : from;
    if (messagesPerUser.has(otherUser)) {
      messagesPerUser.get(otherUser).push(message);
    } else {
      messagesPerUser.set(otherUser, [message]);
    }
  });

  sessionStore.findAllSessions().forEach((session) => {
    users.push({
      userID: session.userID,
      username: session.username,
      connected: session.connected,
      messages: messagesPerUser.get(session.userID) || [],
    });
  });


  socket.emit("users", removeDuplicates(users, item => item.userID));
  console.log(users);

  // notify existing users
  socket.broadcast.emit("user connected", {
    userID: socket.userID,
    username: socket.username,
    connected: true,
    messages: messageStore.findMessagesForUser(socket.userID)
  });


  // forward the private message to the right recipient (and to other tabs of the sender)
  socket.on("private message", ({
    content,
    to
  }) => {
    const message = {
      content,
      from: socket.userID,
      to,
      date_sent: new Date()
    };
    socket.to(to).to(socket.userID).emit("private message", message);
    collection.insertOne({
      to: Number(to),
      from: Number(socket.userID),
      content: content,
      date_sent: new Date()
    });
    messageStore.saveMessage(message);
  });

  // notify users upon disconnection
  socket.on("disconnect", async () => {
    const matchingSockets = await io.in(socket.userID).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // notify other users
      socket.broadcast.emit("user disconnected", socket.userID);
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionID, {
        userID: socket.userID,
        username: socket.username,
        connected: false,
      });
    }

    console.log("disconnected", sessionStore)
  });
});

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
  console.log("Listening on port :%s...", http.address().port);
});