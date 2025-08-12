const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

const users = {};   // username -> socketId
const sockets = {}; // socketId -> username
const rooms = {};   // roomId -> { host, participants: Set<username> }

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("register", (username) => {
    if (!username) return;

    // Agar username already kisi aur socket se registered hai, purane socket ko hatao
    if (users[username] && users[username] !== socket.id) {
      const oldSocketId = users[username];
      delete sockets[oldSocketId];
      console.log(`Removed old socket ${oldSocketId} for username ${username}`);
    }

    users[username] = socket.id;
    sockets[socket.id] = username;

    io.emit("onlineUsers", Object.keys(users));
    console.log("registered:", username, "with socket:", socket.id);
  });

  socket.on("create-room", ({ host, roomId }) => {
    const id = roomId || uuidv4();

    if (!rooms[id]) {
      rooms[id] = { host, participants: new Set() };
      console.log(`Room created: ${id} by host ${host}`);
    }
    rooms[id].participants.add(host);
    socket.join(id);

    socket.emit("room-created", { roomId: id });
    console.log(`${host} created or joined room ${id}`);
  });

  socket.on("invite-users", ({ roomId, invited, from }) => {
    invited.forEach((username) => {
      const sid = users[username];
      if (sid) {
        io.to(sid).emit("invitation", { roomId, from });
        console.log(`Invitation sent to ${username} from ${from} for room ${roomId}`);
      } else {
        const callerSid = users[from];
        if (callerSid) {
          io.to(callerSid).emit("userNotAvailable", { username });
          console.log(`User ${username} not available to invite`);
        }
      }
    });
  });

  socket.on("join-room", ({ roomId, username }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = { host: username, participants: new Set() };
      console.log(`Room ${roomId} did not exist, created with host ${username}`);
    }

    if (!rooms[roomId].participants.has(username)) {
      rooms[roomId].participants.add(username);
      socket.join(roomId);

      const otherSockets = Array.from(rooms[roomId].participants)
        .map((u) => users[u])
        .filter((sid) => sid && sid !== socket.id);

      socket.emit("all-users", otherSockets);
      socket.to(roomId).emit("user-joined", { socketId: socket.id, username });
      console.log(`${username} joined room ${roomId}`);
    } else {
      const otherSockets = Array.from(rooms[roomId].participants)
        .map((u) => users[u])
        .filter((sid) => sid && sid !== socket.id);

      socket.emit("all-users", otherSockets);
      console.log(`${username} re-joined room ${roomId}`);
    }
  });

  socket.on("signal", ({ toSocketId, data }) => {
    if (!toSocketId) return;
    io.to(toSocketId).emit("signal", { from: socket.id, data });
  });

  socket.on("leave-room", ({ roomId, username }) => {
    if (rooms[roomId]) {
      rooms[roomId].participants.delete(username);
      socket.leave(roomId);
      socket.to(roomId).emit("user-left", { socketId: socket.id, username });
      console.log(`${username} left room ${roomId}`);

      if (rooms[roomId].participants.size === 0) {
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted because empty`);
      }
    }
  });

  socket.on("disconnect", () => {
    const username = sockets[socket.id];
    if (username) {
      delete users[username];
      delete sockets[socket.id];

      Object.keys(rooms).forEach((roomId) => {
        if (rooms[roomId].participants.has(username)) {
          rooms[roomId].participants.delete(username);
          socket.to(roomId).emit("user-left", { socketId: socket.id, username });
          console.log(`${username} disconnected and left room ${roomId}`);

          if (rooms[roomId].participants.size === 0) {
            delete rooms[roomId];
            console.log(`Room ${roomId} deleted because empty`);
          }
        }
      });

      io.emit("onlineUsers", Object.keys(users));
    }
    console.log("disconnected", socket.id);
  });
});

const PORT = 5000;
server.listen(PORT, () => console.log(`Signalling server running on :${PORT}`));
