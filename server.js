// server/server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

// users: username -> Set(socketId)
// sockets: socketId -> username
// rooms: roomId -> { host, participants: Set<username> }
const users = {};
const sockets = {};
const rooms = {};

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("register", (username) => {
    if (!username) return;
    if (!users[username]) users[username] = new Set();
    users[username].add(socket.id);
    sockets[socket.id] = username;

    console.log(`registered: ${username} with socket: ${socket.id}`);
    io.emit("onlineUsers", Object.keys(users));
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

  socket.on("invite-users", ({ roomId, invited = [], from }) => {
    invited.forEach((username) => {
      const set = users[username];
      if (set && set.size > 0) {
        // send to all sockets of that user
        Array.from(set).forEach((sid) => {
          io.to(sid).emit("invitation", { roomId, from });
        });
        console.log(`Invitation sent to ${username} from ${from} for room ${roomId}`);
      } else {
        // notify caller that user not available
        const callerSockets = users[from] ? Array.from(users[from]) : [];
        if (callerSockets.length > 0) {
          io.to(callerSockets[0]).emit("userNotAvailable", { username });
        }
        console.log(`User ${username} not available to invite`);
      }
    });
  });

  socket.on("join-room", ({ roomId, username }) => {
    if (!roomId || !username) return;

    if (!rooms[roomId]) {
      rooms[roomId] = { host: username, participants: new Set() };
      console.log(`Room ${roomId} did not exist, created with host ${username}`);
    }

    if (!rooms[roomId].participants.has(username)) {
      rooms[roomId].participants.add(username);
      socket.join(roomId);

      // collect all socketIds for participants excluding current socket
      const otherSockets = Array.from(rooms[roomId].participants)
        .flatMap((u) => (users[u] ? Array.from(users[u]) : []))
        .filter((sid) => sid && sid !== socket.id);

      socket.emit("all-users", otherSockets);
      socket.to(roomId).emit("user-joined", { socketId: socket.id, username });

      console.log(`${username} joined room ${roomId}`);
      console.log(`Room ${roomId} participants:`, Array.from(rooms[roomId].participants));
      console.log(`Sockets in room ${roomId}:`, otherSockets);
    } else {
      // re-join case: still send other participants
      const otherSockets = Array.from(rooms[roomId].participants)
        .flatMap((u) => (users[u] ? Array.from(users[u]) : []))
        .filter((sid) => sid && sid !== socket.id);

      socket.emit("all-users", otherSockets);
      console.log(`${username} re-joined room ${roomId}`);
    }
  });

  socket.on("signal", ({ toSocketId, data }) => {
    if (!toSocketId || !data) return;
    io.to(toSocketId).emit("signal", { from: socket.id, data });
  });

  socket.on("leave-room", ({ roomId, username }) => {
    if (!roomId || !username) return;
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
    console.log("disconnect:", socket.id, "username:", username || "unknown");
    if (username) {
      // remove this socket
      if (users[username]) {
        users[username].delete(socket.id);
        if (users[username].size === 0) {
          delete users[username];
        }
      }
      delete sockets[socket.id];

      // remove user from rooms if they have no sockets left
      Object.keys(rooms).forEach((roomId) => {
        if (rooms[roomId].participants.has(username)) {
          if (!users[username]) {
            rooms[roomId].participants.delete(username);
            socket.to(roomId).emit("user-left", { socketId: socket.id, username });
            console.log(`${username} disconnected and left room ${roomId}`);
            if (rooms[roomId].participants.size === 0) {
              delete rooms[roomId];
              console.log(`Room ${roomId} deleted because empty`);
            }
          }
        }
      });

      io.emit("onlineUsers", Object.keys(users));
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Signalling server running on :${PORT}`));
